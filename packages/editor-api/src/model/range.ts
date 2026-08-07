/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A stretch of a story: two endpoints, each a paragraph and a UTF-16 offset.
//
// A RANGE IS A SNAPSHOT, NOT A TRACKED REGION. Its endpoints name the paragraphs they were found in
// and the offsets they were found at, so it stays meaningful across edits ELSEWHERE in the document
// and becomes an explicit refusal — `InvalidObjectPath` — once one of its paragraphs is gone. What
// it deliberately does not do is follow edits INSIDE itself: a range over "alpha" whose paragraph
// then gains a word at offset 0 still names offsets 0..5. Word's own ranges do move, by keeping a
// live region in the document; this API does not have one, and pretending otherwise would answer
// text from a place the caller was not looking at.
//
// That is also why `Range#start`/`Range#end` are not here, and why they are not merely unimplemented
// either: they are document-wide character positions, a different addressing scheme from the one this
// whole lane uses (paragraph identity plus UTF-16 offset) and one whose value changes whenever any
// earlier paragraph changes length. This engine maintains no such counter, so the members were
// DE-SELECTED — removed from `compat/manifest.json`'s selection and from the authored declarations,
// with the reasons recorded as omissions there — rather than left declared for a shipped object that
// could never satisfy them. A caller who wants the ends of a range asks it for its paragraphs.

import {
  ObjectPath,
  fail,
  hydratedSpan,
  hydratedStyle,
  hydratedText,
  type AutomationSpan,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { ParagraphCollection, RangeCollection, type PromisedItem } from './collections.ts';
import { BookmarkCollection } from './bookmarks.ts';
import { requireStyleName, spanRefOf } from './addressing.ts';
import { Font } from './font.ts';
import {
  insertableText,
  rangeTextLocation,
  selectionMode,
  type SelectionMode,
} from './locations.ts';
import { ModelObject } from './model-object.ts';
import { Paragraph } from './paragraph.ts';
import { Comment } from './review.ts';
import { searchOptions, type SearchOptions } from './search-options.ts';

/**
 * A stretch of a story: two endpoints, each a paragraph and a UTF-16 offset.
 *
 * A range is a SNAPSHOT, not a tracked region. Its endpoints name the paragraphs they were found
 * in and the offsets they were found at, so it stays meaningful across edits ELSEWHERE in the
 * document and becomes an explicit `InvalidObjectPath` refusal once one of its paragraphs is
 * gone. What it deliberately does not do is follow edits INSIDE itself: a range over `"alpha"`
 * whose paragraph then gains a word at offset 0 still names offsets 0..5. Word's own ranges do
 * move, by keeping a live region in the document; this API has none, and pretending otherwise
 * would answer text from a place the caller was not looking at.
 *
 * That is also why `start` and `end` are absent rather than unimplemented — they are
 * document-wide character positions, a different addressing scheme from this API's paragraph
 * identity plus UTF-16 offset. Ask a range for its {@link Range.paragraphs} instead.
 *
 * @public
 */
export class Range extends ModelObject implements PromisedItem {
  #paragraphs: ParagraphCollection | undefined;
  #font: Font | undefined;
  #bookmarks: BookmarkCollection | undefined;

  /** @internal A range a read already found. */
  static at(context: RequestContext, label: string, address: ObjectAddress): Range {
    if (address.kind !== 'span') fail({ code: 'InvalidObjectPath', target: label });
    return new Range(context, ObjectPath.ofSpan(label, address.span), false);
  }

  /** @internal A range a queued operation will name, or report as nothing. */
  static promised(context: RequestContext, label: string, nullable: boolean): Range {
    return new Range(context, ObjectPath.pending(label), nullable);
  }

  private constructor(context: RequestContext, path: ObjectPath, nullable: boolean) {
    super(context, path, { nullable });
  }

  /** @internal Bind this object to the address the owning read answered. */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'span') this.path.resolveToSpan(address.span);
    else this.path.resolveNull();
  }

  /** @internal Settle as the null object: the read found nothing to name. */
  hydrateNull(): void {
    this.path.resolveNull();
  }

  /**
   * The text between this range's endpoints.
   *
   * A range that crosses paragraph marks reads a carriage return at each one, so counting
   * characters in this string counts the same positions the engine writes at.
   */
  get text(): string {
    return this.loadedProperty<string>('text');
  }

  /** The character formatting of the characters this range covers. */
  get font(): Font {
    this.#font ??= Font.of(this.context, `${this.path.label}.font`, this.path, 'span');
    return this.#font;
  }

  /** The paragraphs this range covers, in reading order. */
  get paragraphs(): ParagraphCollection {
    this.#paragraphs ??= ParagraphCollection.of(
      this.context,
      `${this.path.label}.paragraphs`,
      this.path
    );
    return this.#paragraphs;
  }

  /**
   * The paragraph style, by the name a reader sees in the styles gallery.
   *
   * Reading answers the name every paragraph this range covers agrees on, and `null` where they do not or
   * where the document names no style. Writing applies it to all of them, and a name the document
   * does not already define is refused rather than created — a minted style would report itself
   * applied while the text stayed exactly as it looked.
   */
  get style(): string {
    return this.loadedProperty<string>('style');
  }

  set style(value: string) {
    const target = `${this.path.label}.style`;
    const name = requireStyleName(value, target);
    this.requireAddressable();
    this.command('style', () => ({ op: 'setStyle', span: spanRefOf(this.path, 'span'), name }));
  }

  /**
   * The hyperlink over these characters: an absolute URL, or `#anchor` for a place in the document.
   *
   * `''` where the range is not in a link, and where it straddles two — a stretch covering parts of
   * two different links has no one target, and answering either would be a guess.
   *
   * WRITING IT AUTHORS A LINK over exactly these characters, and `''` removes one. A URL whose
   * scheme this engine would refuse to OPEN is refused here too, by the same allowlist: a document
   * this API writes must not be one it would then decline to follow.
   */
  get hyperlink(): string {
    return this.loadedProperty<string>('hyperlink');
  }

  set hyperlink(value: string) {
    const target = `${this.path.label}.hyperlink`;
    if (typeof value !== 'string' || value.length > 2048) fail({ code: 'InvalidArgument', target });
    const span = this.#span();
    this.command('hyperlink', () => ({ op: 'setHyperlink', span, target: value }));
  }

  /** The bookmarks whose text this range overlaps, in document order. */
  get bookmarks(): BookmarkCollection {
    const span = this.#span();
    this.#bookmarks ??= BookmarkCollection.of(
      this.context,
      `${this.path.label}.bookmarks`,
      this.path,
      () => ({ op: 'getBookmarks', scope: { start: span.start, end: span.end } })
    );
    return this.#bookmarks;
  }

  /** Every occurrence of `searchText` inside this range, as ranges. */
  search(searchText: string, options?: SearchOptions): RangeCollection {
    const target = `${this.path.label}.search`;
    if (typeof searchText !== 'string') fail({ code: 'InvalidArgument', target });
    const selected = searchOptions(options, target);
    const span = this.#span();
    return RangeCollection.of(this.context, target, this.path, () => ({
      op: 'search',
      scope: span,
      text: searchText,
      ...(selected === undefined ? {} : { options: selected }),
    }));
  }

  /**
   * Write text at or over this range. Answers the range the written text occupies.
   *
   * `Before`/`Start` and `After`/`End` land at the SAME position here, and the difference Word
   * draws between them — whether the new text becomes part of this range — has no meaning for a
   * snapshot. Both pairs are accepted because source-compatible code uses all four; what a caller
   * gets back is a range naming the text that was written, in every case.
   */
  insertText(
    text: string,
    insertLocation: 'Replace' | 'Start' | 'End' | 'Before' | 'After'
  ): Range {
    const target = `${this.path.label}.insertText`;
    const written = insertableText(text, target);
    const where = rangeTextLocation(insertLocation, target);
    const span = this.#span();
    const created = Range.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () =>
        where === 'Replace'
          ? { op: 'replaceSpan', span, text: written }
          : {
              op: 'insertText',
              at: where === 'Start' || where === 'Before' ? span.start : span.end,
              text: written,
            },
      (value) => {
        created.hydrateAddress({ kind: 'span', span: hydratedSpan(value, target) });
      }
    );
    return created;
  }

  /**
   * Create a top-level comment anchored to exactly this range.
   *
   * The author is the identity the runtime was opened with. Empty comment text, a missing author,
   * stale endpoints, and ranges crossing a table-cell boundary are refused rather than authored
   * approximately. A collapsed range creates an insertion-point comment.
   */
  insertComment(commentText: string): Comment {
    const target = `${this.path.label}.insertComment`;
    if (typeof commentText !== 'string' || commentText.length === 0) {
      fail({ code: 'InvalidArgument', target });
    }
    const author = this.internals.author;
    if (typeof author !== 'string' || author.trim().length === 0) {
      fail({ code: 'NotSupported', target });
    }
    const span = this.#span();
    const created = Comment.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({ op: 'insertComment', span, text: commentText, author }),
      (value) => {
        if (value.kind !== 'handle') fail({ code: 'GeneralException', target });
        created.hydrateAddress(value);
      }
    );
    return created;
  }

  /** Add a paragraph before or after the one this range starts or ends in. */
  insertParagraph(paragraphText: string, insertLocation: 'Before' | 'After'): Paragraph {
    const target = `${this.path.label}.insertParagraph`;
    const written = insertableText(paragraphText, target);
    const where = rangeTextLocation(insertLocation, target);
    if (where !== 'Before' && where !== 'After') fail({ code: 'InvalidArgument', target });
    const span = this.#span();
    const anchor = where === 'Before' ? span.start.paragraph : span.end.paragraph;
    const created = Paragraph.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({
        op: 'insertParagraph',
        anchor: { paragraph: anchor },
        where: where === 'Before' ? 'before' : 'after',
        text: written,
      }),
      (value) => {
        if (value.kind !== 'handle') fail({ code: 'GeneralException', target });
        created.hydrateAddress({ kind: 'handle', handle: value.handle });
      }
    );
    return created;
  }

  /**
   * Put the reader's selection on this range and navigate the editor viewport to it.
   *
   * The whole range is selected by default. `Start` and `End` instead collapse the caret to that
   * endpoint and reveal it. An already-visible endpoint stays still; an offscreen one is brought
   * into view from the editor's layout, including when its page has not been materialized yet.
   *
   * Refused with `NotSupported` where there is no reader — a document opened from bytes on a
   * server has no caret or viewport, and moving one would be a claim about a screen nobody is
   * looking at. The check is at the CALL rather than at the sync, so the mistake is reported where
   * it was made.
   */
  select(selectionMode_?: SelectionMode): void {
    const target = `${this.path.label}.select`;
    const mode = selectionMode(selectionMode_, target);
    this.requireAddressable();
    if (!this.internals.capabilities.selection) fail({ code: 'NotSupported', target });
    const span = this.#span();
    this.command('select', () => ({
      op: 'selectSpan',
      span,
      mode: mode === 'Select' ? 'select' : mode === 'Start' ? 'start' : 'end',
    }));
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, ['text', 'style', 'hyperlink']);
    if (selected.includes('hyperlink')) {
      const span = this.#span();
      this.loadTextInto('hyperlink', () => ({ op: 'getHyperlink', span }));
    }
    if (selected.includes('text')) {
      const span = this.#span();
      const label = `${this.path.label}.text`;
      this.read(
        label,
        () => ({ op: 'getSpanText', span }),
        (value) => {
          this.setLoadedProperty('text', hydratedText(value, label));
        }
      );
    }
    if (!selected.includes('style')) return;
    const label = `${this.path.label}.style`;
    this.requireAddressable();
    this.read(
      label,
      () => ({ op: 'getStyle', span: spanRefOf(this.path, 'span') }),
      (value) => {
        this.setLoadedProperty('style', hydratedStyle(value, label));
      }
    );
  }

  #span(): AutomationSpan {
    this.requireAddressable();
    return this.path.span();
  }
}
