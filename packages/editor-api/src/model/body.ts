/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A story: the main body of a document, and everything in it in reading order.
//
// ITS PARAGRAPHS ARE THE DOCUMENT'S, NOT THE TOP LEVEL'S. A paragraph inside a table cell — or
// inside a table inside a cell, or inside a block-level content control — is an ordinary editable
// paragraph, and Word's own paragraph collection contains it. So does this one. A collection that
// listed only the body's direct children would answer a smaller document than the one on screen.
//
// `clear()` LEAVES ONE EMPTY PARAGRAPH, because a `w:body` with no paragraph at all is not what
// Word produces when a reader selects everything and presses delete. A body that ALREADY holds no
// paragraph has nothing to clear and says so (`InvalidArgument`) rather than inventing a block:
// creating a paragraph in a story that has none is a different operation from editing one, and this
// slice does not implement it.

import {
  ObjectPath,
  clientResult,
  fail,
  hydratedSpan,
  hydratedStyle,
  internalsOf,
  hydratedText,
  type AutomationHandle,
  type ClientResult,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { BookmarkCollection } from './bookmarks.ts';
import { ParagraphCollection, RangeCollection } from './collections.ts';
import { ContentControlCollection } from './content-controls.ts';
import { ListCollection } from './lists.ts';
import { CommentCollection, RevisionCollection } from './review.ts';
import { requireStyleName, spanRefOf } from './addressing.ts';
import { Font } from './font.ts';
import { bodyParagraphLocation, bodyTextLocation, insertableText } from './locations.ts';
import { ModelObject } from './model-object.ts';
import { Paragraph } from './paragraph.ts';
import { Range } from './range.ts';
import { searchOptions, type SearchOptions } from './search-options.ts';
import { textProjection, type TextReadOptions } from './text-options.ts';

/**
 * A story: the main body of a document, a header or footer variant, or a note's body — and
 * everything in it in reading order.
 *
 * Its paragraphs are the DOCUMENT'S, not just the top level's. A paragraph inside a table cell,
 * or inside a table inside a cell, or inside a block-level content control, is an ordinary
 * editable paragraph and appears here, exactly as it does in Word's own paragraph collection. A
 * collection listing only direct children would describe a smaller document than the one on
 * screen.
 *
 * {@link Body.clear} leaves one empty paragraph, matching what Word produces when a reader
 * selects everything and deletes. A body that already holds no paragraph reports
 * `InvalidArgument` rather than inventing a block.
 *
 * @public
 */
export class Body extends ModelObject {
  #paragraphs: ParagraphCollection | undefined;
  #bookmarks: BookmarkCollection | undefined;
  #font: Font | undefined;
  #lists: ListCollection | undefined;
  #contentControls: ContentControlCollection | undefined;
  #revisions: RevisionCollection | undefined;

  /** @internal The main story of the document this context is running against. */
  static main(context: RequestContext, label: string): Body {
    return new Body(context, ObjectPath.of(label, internalsOf(context).roots().body));
  }

  /**
   * @internal A story a read will name: a header or footer variant, or a note's body.
   *
   * The OWNER queues that read — a section, a note — because a pending object cannot address the
   * document yet, and it is the owner that can. Like every object a batch produces in this runtime,
   * the story is addressable from the next batch on.
   */
  static promisedStory(context: RequestContext, label: string): Body {
    return new Body(context, ObjectPath.pending(label));
  }

  /** @internal Bind this story to the handle the owner's read answered. */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'handle') this.path.resolveTo(address.handle);
    else this.path.resolveNull();
  }

  private constructor(context: RequestContext, path: ObjectPath) {
    super(context, path);
  }

  /**
   * The whole story's text.
   *
   * Its paragraphs joined by a carriage return — one paragraph mark each — which is the separator
   * Word's own text property uses, so a caller counting characters counts what Word counts.
   */
  get text(): string {
    return this.loadedProperty<string>('text');
  }

  /**
   * Read this story under an explicit revision projection.
   *
   * The result is available after the next `sync()`. The `text` property keeps the historical
   * `all` projection.
   */
  getText(options?: TextReadOptions): ClientResult<string> {
    const target = `${this.path.label}.getText`;
    const projection = textProjection(options, target);
    const handle = this.#handle();
    const { result, fill } = clientResult<string>(target);
    this.read(
      target,
      () => ({ op: 'getText', target: handle, ...(projection ? { projection } : {}) }),
      (value) => fill(hydratedText(value, target))
    );
    return result;
  }

  /** Every paragraph in this story in reading order, at every depth. */
  get paragraphs(): ParagraphCollection {
    this.#paragraphs ??= this.paragraphsUnder(`${this.path.label}.paragraphs`);
    return this.#paragraphs;
  }

  /**
   * Every bookmark declared in this story, in document order.
   *
   * This is story-scoped: `document.body.bookmarks` covers only the main body story. A header,
   * footer or note body answers its own bookmarks through that body's accessor; this collection
   * does not aggregate bookmarks from other stories.
   */
  get bookmarks(): BookmarkCollection {
    const handle = this.#handle();
    this.#bookmarks ??= BookmarkCollection.of(
      this.context,
      `${this.path.label}.bookmarks`,
      this.path,
      () => ({ op: 'getBookmarks', scope: { body: handle } })
    );
    return this.#bookmarks;
  }

  /** The character formatting of the whole story: what all of it agrees on, and what a write sets. */
  get font(): Font {
    this.#font ??= Font.of(this.context, `${this.path.label}.font`, this.path, 'body');
    return this.#font;
  }

  /**
   * @internal A collection over this story under another name.
   *
   * `document.paragraphs` is the main story's paragraphs, and it is its OWN object: loading it must
   * not quietly load `document.body.paragraphs` too, and an error about it should say which of the
   * two the consumer wrote.
   */
  paragraphsUnder(label: string): ParagraphCollection {
    return ParagraphCollection.of(this.context, label, this.path);
  }

  /**
   * The paragraph style, by the name a reader sees in the styles gallery.
   *
   * Reading answers the name every paragraph in the story agrees on, and `null` where they do not or
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
    this.command('style', () => ({ op: 'setStyle', span: spanRefOf(this.path, 'body'), name }));
  }

  /** Every list this story holds, in the order their numbers first appear. */
  get lists(): ListCollection {
    this.#lists ??= ListCollection.of(
      this.context,
      `${this.path.label}.lists`,
      this.path,
      this.#handle()
    );
    return this.#lists;
  }

  /**
   * The content controls this story holds, in document order — the OUTERMOST ones.
   *
   * A control inside another is reached through the control that holds it, because a flat list of
   * a story's controls makes a field and the group wrapping it look like siblings.
   */
  get contentControls(): ContentControlCollection {
    this.#contentControls ??= ContentControlCollection.of(
      this.context,
      `${this.path.label}.contentControls`,
      this.path,
      { body: this.#handle() }
    );
    return this.#contentControls;
  }

  /** The comments anchored in this story, in document order. Replies hang off the comment. */
  getComments(): CommentCollection {
    const target = `${this.path.label}.getComments`;
    const handle = this.#handle();
    return CommentCollection.of(this.context, target, this.path, () => ({
      op: 'getComments',
      scope: { body: handle },
    }));
  }

  /**
   * The tracked changes in this story that this API can publish as typed objects, in document order.
   *
   * DocxEditor's own accessor: upstream reaches revisions from the document, and this story-scoped
   * collection is what makes a header's, footer's, or note's changes reachable at all. Recorded in
   * `compat/manifest.json`. `items` may omit structural cards; collection-wide decisions still
   * resolve every store-resolvable revision in this story.
   */
  get revisions(): RevisionCollection {
    this.#revisions ??= RevisionCollection.of(
      this.context,
      `${this.path.label}.revisions`,
      this.path,
      this.#handle()
    );
    return this.#revisions;
  }

  /** Every occurrence of `searchText` in this story, as ranges, in reading order. */
  search(searchText: string, options?: SearchOptions): RangeCollection {
    const target = `${this.path.label}.search`;
    if (typeof searchText !== 'string') fail({ code: 'InvalidArgument', target });
    const selected = searchOptions(options, target);
    const projection = selected?.projection ?? 'all';
    const handle = this.#handle();
    return RangeCollection.of(
      this.context,
      target,
      this.path,
      () => ({
        op: 'search',
        scope: { body: handle },
        text: searchText,
        ...(selected === undefined ? {} : { options: selected }),
      }),
      projection
    );
  }

  /**
   * Delete the story's removable content.
   *
   * Section-ending paragraphs and content-control wrappers remain because they define the
   * existing story structure. A complex story can therefore retain several empty paragraphs.
   * Use `replaceParagraphs([''])` when the caller needs fresh structure.
   */
  clear(): void {
    const handle = this.#handle();
    this.commandDiscarding('clear', () => ({
      op: 'replaceSpan',
      span: { body: handle },
      text: '',
    }));
  }

  /**
   * Replace the story's complete block structure with fresh plain paragraphs in one transaction.
   *
   * This is the fresh-document operation. It removes tables, content-control wrappers,
   * paragraph-level section breaks, comments, and revisions from this story. For the main body,
   * the final section properties remain and continue to define the replacement pages.
   *
   * Pass one string per paragraph. Each string must not contain a paragraph mark.
   */
  replaceParagraphs(paragraphs: readonly string[]): void {
    const target = `${this.path.label}.replaceParagraphs`;
    if (!Array.isArray(paragraphs) || paragraphs.length < 1 || paragraphs.length > 10_000) {
      fail({ code: 'InvalidArgument', target });
    }
    const written = paragraphs.map((text) => insertableText(text, target));
    const handle = this.#handle();
    this.commandDiscarding('replaceParagraphs', () => ({
      op: 'replaceStoryBlocks',
      body: handle,
      paragraphs: written,
    }));
  }

  /**
   * Write text over the whole story, or at either edge of it. Answers the text's own range.
   *
   * Text cannot contain a paragraph mark. Use `insertParagraph(...)` or
   * `replaceParagraphs(...)` for paragraph structure.
   */
  insertText(text: string, insertLocation: 'Replace' | 'Start' | 'End'): Range {
    const target = `${this.path.label}.insertText`;
    const written = insertableText(text, target);
    const where = bodyTextLocation(insertLocation, target);
    const handle = this.#handle();
    const created = Range.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () =>
        where === 'Replace'
          ? { op: 'replaceSpan', span: { body: handle }, text: written }
          : {
              op: 'insertText',
              at: { body: handle, at: where === 'Start' ? 'start' : 'end' },
              text: written,
            },
      (value) => {
        created.hydrateAddress({ kind: 'span', span: hydratedSpan(value, target) });
      }
    );
    return created;
  }

  /** Add a paragraph at the start or the end of the story. Answers the new paragraph. */
  insertParagraph(paragraphText: string, insertLocation: 'Start' | 'End'): Paragraph {
    const target = `${this.path.label}.insertParagraph`;
    const written = insertableText(paragraphText, target);
    const where = bodyParagraphLocation(insertLocation, target);
    const handle = this.#handle();
    const created = Paragraph.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({
        op: 'insertParagraph',
        anchor: { body: handle, at: where === 'Start' ? 'first' : 'last' },
        where: where === 'Start' ? 'before' : 'after',
        text: written,
      }),
      (value) => {
        if (value.kind !== 'handle') fail({ code: 'GeneralException', target });
        created.hydrateAddress({ kind: 'handle', handle: value.handle });
      }
    );
    return created;
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, ['text', 'style']);
    if (selected.includes('text')) {
      const handle = this.#handle();
      this.loadTextInto('text', () => ({ op: 'getText', target: handle }));
    }
    if (selected.includes('style')) this.#loadStyle();
  }

  #loadStyle(): void {
    const label = `${this.path.label}.style`;
    this.requireAddressable();
    this.read(
      label,
      () => ({ op: 'getStyle', span: spanRefOf(this.path, 'body') }),
      (value) => {
        this.setLoadedProperty('style', hydratedStyle(value, label));
      }
    );
  }

  #handle(): AutomationHandle {
    this.requireAddressable();
    return this.path.handle();
  }
}
