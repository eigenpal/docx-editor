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
// That is also why `Range#start`/`Range#end` are not here. They are document-wide character
// positions, and a document-wide position is a different addressing scheme from the one this whole
// lane uses (paragraph plus offset) — one whose value changes when any earlier paragraph changes
// length. See the recorded omissions in the model's README section of the task report.

import {
  ObjectPath,
  fail,
  hydratedSpan,
  hydratedText,
  type AutomationSpan,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { ParagraphCollection, RangeCollection, type PromisedItem } from './collections.ts';
import {
  insertableText,
  rangeTextLocation,
  selectionMode,
  type SelectionMode,
} from './locations.ts';
import { ModelObject } from './model-object.ts';
import { Paragraph } from './paragraph.ts';
import { searchOptions, type SearchOptions } from './search-options.ts';

export class Range extends ModelObject implements PromisedItem {
  #paragraphs: ParagraphCollection | undefined;

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

  /** @internal */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'span') this.path.resolveToSpan(address.span);
    else this.path.resolveNull();
  }

  /** @internal */
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

  /** The paragraphs this range covers, in reading order. */
  get paragraphs(): ParagraphCollection {
    this.#paragraphs ??= ParagraphCollection.of(
      this.context,
      `${this.path.label}.paragraphs`,
      this.path
    );
    return this.#paragraphs;
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
   * Put the reader's selection on this range.
   *
   * Refused with `NotSupported` where there is no reader — a document opened from bytes on a
   * server has no caret, and moving one would be a claim about a screen nobody is looking at. The
   * check is at the CALL rather than at the sync, so the mistake is reported where it was made.
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

  protected override onLoad(request: ResolvedLoadOptions): void {
    if (!this.selection(request, ['text']).includes('text')) return;
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

  #span(): AutomationSpan {
    this.requireAddressable();
    return this.path.span();
  }
}
