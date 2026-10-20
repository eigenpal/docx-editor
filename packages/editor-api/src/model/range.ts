/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A stretch of a story: two endpoints, each a paragraph and a UTF-16 offset. A range is a snapshot,
// not a tracked region, and has no document-wide `start`/`end`; the class comment says why. A
// field's cached result is a range too, addressed by its field (`field-result-range.ts`).

import {
  InsertLocation,
  BreakType,
  ChangeTrackingVersion,
  ContentControlType,
  RangeLocation,
} from './editing-enums.ts';
import { Field, FieldCollection } from './fields.ts';
import { fieldResultRead, fieldResultWrite } from './field-result-range.ts';
import type { FieldType, FieldTypeLiteral } from './field-types.ts';
import { InlinePicture, InlinePictureCollection } from './pictures.ts';
import { Table, TableCollection } from './tables.ts';
import {
  ObjectPath,
  fail,
  hydratedSpan,
  hydratedHandle,
  hydratedApplied,
  hydratedStyle,
  hydratedText,
  refuseFieldResultMember,
  type AutomationSpan,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { ParagraphCollection, RangeCollection, type PromisedItem } from './collections.ts';
import { BookmarkCollection } from './bookmarks.ts';
import { requireStyleName, spanRefOf } from './addressing.ts';
import { Font } from './font.ts';
import { ContentControl, ContentControlCollection } from './content-controls.ts';
import {
  insertableText,
  insertableTextWithBreaks,
  rangeTextLocation,
  selectionMode,
  type SelectionMode,
} from './locations.ts';
import { ModelObject } from './model-object.ts';
import { Paragraph } from './paragraph.ts';
import { Comment, RevisionCollection } from './review.ts';
import { searchOptions, type SearchOptions } from './search-options.ts';
import { clientResult, type ClientResult } from '../runtime/client-result.ts';
import {
  optionalFlag,
  rangeGetRangeLocation,
  reviewedTextVersion,
  textRangeMarks,
} from './text-ranges.ts';

/**
 * A stretch of a story: two endpoints, each a paragraph and a UTF-16 offset.
 *
 * A range is a SNAPSHOT, not a tracked region. Its endpoints name the paragraphs they were found
 * in and the offsets they were found at, so it stays meaningful across edits ELSEWHERE in the
 * document and becomes an explicit `InvalidObjectPath` refusal once one of its paragraphs is
 * gone. What it deliberately does not do is follow edits INSIDE itself: once its paragraph
 * gains a word at offset 0, a range over `"alpha"` fails with `StaleDocument` when used, rather
 * than reading or editing whatever now sits at offsets 0..5. Edits after the range, and formatting
 * changes, keep it valid. Word's own ranges do move, by keeping a live region in the document;
 * this API has none, and pretending otherwise would answer text from a place the caller was not
 * looking at.
 *
 * That is also why `start` and `end` are absent rather than unimplemented — they are
 * document-wide character positions, a different addressing scheme from this API's paragraph
 * identity plus UTF-16 offset. Ask a range for its {@link Range.paragraphs} instead.
 *
 * @public
 */
export class Range extends ModelObject implements PromisedItem {
  #tables: TableCollection | undefined;
  #fields: FieldCollection | undefined;
  #inlinePictures: InlinePictureCollection | undefined;
  #paragraphs: ParagraphCollection | undefined;
  #font: Font | undefined;
  #bookmarks: BookmarkCollection | undefined;
  #revisions: RevisionCollection | undefined;
  #contentControls: ContentControlCollection | undefined;

  /** @internal A range a read already found. */
  static at(context: RequestContext, label: string, address: ObjectAddress): Range {
    if (address.kind !== 'span') fail({ code: 'InvalidObjectPath', target: label });
    return new Range(context, ObjectPath.ofSpan(label, address.span), false);
  }

  /** @internal A range a queued operation will name, or report as nothing. */
  static promised(context: RequestContext, label: string, nullable: boolean): Range {
    return new Range(context, ObjectPath.pending(label), nullable);
  }

  /** @internal The cached result of the field `field` names. */
  static ofFieldResult(context: RequestContext, label: string, field: ObjectPath): Range {
    return new Range(context, ObjectPath.fieldResult(label, field), false);
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
   * Partial retargeting and unlinking support ordinary text links directly inside a paragraph.
   * Complex or nested link wrappers and collapsed ranges inside links refuse with `NotSupported`.
   */
  get hyperlink(): string {
    return this.loadedProperty<string>('hyperlink');
  }

  set hyperlink(value: string) {
    const target = `${this.path.label}.hyperlink`;
    if (typeof value !== 'string' || value.length > 2048) fail({ code: 'InvalidArgument', target });
    this.requireUsablePath();
    this.command('hyperlink', () => ({ op: 'setHyperlink', span: this.#span(), target: value }));
  }

  /**
   * The content controls this range overlaps, in document order, at any nesting depth.
   *
   * A control counts when it shares at least one character with the range, and a control that
   * holds the whole range counts too, so a word range inside a locked control reports that
   * control. A block control counts when it holds one of the range's paragraphs. Load
   * `items/cannotEdit`, `items/tag`, and `items/text` to learn what an edit through the range
   * would touch.
   *
   * @example
   * ```ts
   * const controls = range.contentControls;
   * controls.load('items/cannotEdit,items/tag');
   * await context.sync();
   * ```
   */
  get contentControls(): ContentControlCollection {
    this.requireUsablePath();
    this.#contentControls ??= ContentControlCollection.of(
      this.context,
      `${this.path.label}.contentControls`,
      this.path,
      () => ({ span: this.#span() })
    );
    return this.#contentControls;
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

  /**
   * Add a bookmark around this range, or at its position when the range is empty.
   *
   * Names compare without case and are unique in the whole document. A bookmark with the same
   * name moves here, also from another story (a header, a footer, or a note), in the same sync.
   * A name starts with a letter, or with an underscore for a hidden bookmark, holds only
   * letters, digits and underscores, and has at most 40 characters. Any other name fails
   * `context.sync()` with `InvalidArgument`, and nothing in that batch is written. Bookmarks are
   * not revisions, so with `TrackMineOnly` the markers are written directly.
   *
   * @example
   * ```ts
   * const range = context.document.body.paragraphs.getFirst().getRange();
   * range.insertBookmark('Intro');
   * await context.sync();
   * ```
   */
  insertBookmark(name: string): void {
    const target = `${this.path.label}.insertBookmark`;
    this.requireUsablePath();
    // Checked when the batch is sent: a bad name fails `context.sync()`, not the call.
    this.command('insertBookmark', () => {
      if (typeof name !== 'string' || name.length === 0) fail({ code: 'InvalidArgument', target });
      return { op: 'insertBookmark', span: this.#span(), name };
    });
  }

  /**
   * The names of the bookmarks in or overlapping this range, in document order.
   *
   * A range holds a bookmark when the two share text, and a point bookmark when the point is
   * inside the range or at its start. An empty range holds the bookmarks around it. Pass
   * `includeAdjacent` to add bookmarks that only touch the range at one end, and
   * `includeHidden` to add hidden bookmarks, whose names start with an underscore.
   *
   * @example
   * ```ts
   * const names = range.getBookmarks(true, false);
   * await context.sync();
   * console.log(names.value);
   * ```
   */
  getBookmarks(includeHidden?: boolean, includeAdjacent?: boolean): ClientResult<string[]> {
    const target = `${this.path.label}.getBookmarks`;
    const { result, fill } = clientResult<string[]>(target);
    this.read(
      target,
      () => {
        if (
          (includeHidden !== undefined && typeof includeHidden !== 'boolean') ||
          (includeAdjacent !== undefined && typeof includeAdjacent !== 'boolean')
        )
          fail({ code: 'InvalidArgument', target });
        return {
          op: 'getBookmarkNames',
          scope: this.#span(),
          includeHidden: includeHidden === true,
          includeAdjacent: includeAdjacent === true,
        };
      },
      (value) => {
        if (value.kind !== 'texts') fail({ code: 'GeneralException', target });
        fill([...value.texts]);
      }
    );
    return result;
  }

  /**
   * The tracked changes whose characters this range overlaps, in document order.
   *
   * Lists the same `Revision` objects the story's collection lists, so a change reached here is
   * the one `body.revisions` holds. A collapsed range lists the changes it touches. A paragraph
   * mark change is listed only when the range continues into the next paragraph, so reach the
   * mark change of a whole paragraph through `body.revisions`. Membership
   * uses document positions, so the runtime's `revisionTextView` changes what `text` reads, not
   * which changes are listed. A change partly inside the range is listed whole. A replacement
   * stored as a deletion followed by an insertion lists as two members.
   *
   * On this collection, `acceptAll()` and `rejectAll()` resolve every change the range overlaps,
   * structural changes absent from `items` included, and a partly covered change resolves whole.
   * They refuse the whole sync when one of those changes is read-only or cannot be resolved.
   * `resolve()` and `setAuthor()` refuse with `NotSupported`; use the story's collection.
   *
   * A range can overlap changes nobody meant to decide: a change nested inside another, or one
   * by another author beside it. To decide the change a review card shows, use
   * `getReviewItemRevisions`.
   *
   * @example Accept every change in a search result
   * ```ts
   * const matches = context.document.body.search('indemnify');
   * matches.load('items');
   * await context.sync();
   *
   * for (const match of matches.items) match.revisions.acceptAll();
   * await context.sync();
   * ```
   */
  get revisions(): RevisionCollection {
    this.#revisions ??= RevisionCollection.inSpan(
      this.context,
      `${this.path.label}.revisions`,
      this.path,
      () => spanRefOf(this.path, 'span')
    );
    return this.#revisions;
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
      options: {
        ...(selected ?? {}),
        projection: this.revisionTextView(),
      },
    }));
  }

  /**
   * Split this range into ranges that each end after one of `endingMarks`, such as `[' ']` for
   * words or `['.', '!', '?']` for sentences. A paragraph end always ends a range.
   *
   * Each range is an exact span of the document, so you can use it as an edit target in a later
   * sync: `insertText(text, 'Replace')`, `insertText(text, 'After')`, or `delete()`, also with
   * change tracking on. By default each range keeps the spacing after it, so a deleted word
   * takes its space with it; plan edits on those ranges by index. Pass `trimSpacing` as `true`
   * to remove spaces, tabs, and column breaks from the start and end of each range, for reading
   * words; a range that holds only spacing is then left out.
   *
   * A field, an equation, a picture, or a note reference is one character of the range and is
   * never split, so it joins the word it touches. A field reads as its result text; an equation,
   * a picture, and a note reference read as U+FFFC. A tab ends a range only when you list `'\t'`
   * as a mark. An inline content control adds no boundary, so its words join the ranges around
   * it; an edit of part of a content-locked control refuses with `edit.protected-content`. Pass at most 32 marks of at most 32
   * UTF-16 code units each, with no unpaired surrogate; other values refuse with
   * `InvalidArgument`.
   *
   * Ranges follow the runtime's `revisionTextView`. Hidden text, such as a pending insertion in
   * the `original` view, holds no mark, and each range starts and ends at shown characters.
   * Hidden text between two shown characters stays inside the range, so an edit through it
   * also changes that text. Read ranges once, before you edit: after tracked edits, a range can
   * join deleted and inserted text, and an edit that touches your own pending change refuses
   * with `edit.tracked-own-pending-change`. Read the result with `getReviewedText('Current')`.
   *
   * @example
   * ```ts
   * const words = paragraph.getTextRanges([' '], true);
   * words.load('items/text');
   * await context.sync();
   * ```
   */
  getTextRanges(endingMarks: string[], trimSpacing?: boolean): RangeCollection {
    const target = `${this.path.label}.getTextRanges`;
    const marks = textRangeMarks(endingMarks, target);
    const trim = optionalFlag(trimSpacing, target);
    this.requireUsablePath();
    return RangeCollection.of(this.context, target, this.path, () => ({
      op: 'getTextRanges',
      scope: this.#span(),
      endingMarks: marks,
      ...(trim ? { trimSpacing: true } : {}),
      projection: this.revisionTextView(),
    }));
  }

  /**
   * A new range from the start of whichever range starts first to the end of whichever ends
   * last. This range does not change.
   *
   * Use it to address a run of words from {@link Range.getTextRanges}: expand the first word to
   * the last, then replace the result. Both ranges must be in the same story, such as the body
   * or one header; ranges in different stories refuse the sync with `InvalidArgument`. A range
   * that spans paragraphs follows the same `StaleDocument` rule as `Body.getRange`.
   */
  expandTo(range: Range): Range {
    const target = `${this.path.label}.expandTo`;
    if (!(range instanceof Range) || range.context !== this.context)
      fail({ code: 'InvalidArgument', target });
    this.requireUsablePath();
    range.requireUsablePath();
    const expanded = Range.promised(this.context, target, false);
    this.enqueue({
      sort: 'read',
      label: target,
      dependencies: [range.path],
      plan: () => ({ op: 'expandSpan', span: this.#span(), to: range.#span() }),
      settle: (value) => {
        expanded.hydrateAddress({ kind: 'span', span: hydratedSpan(value, target) });
      },
    });
    return expanded;
  }

  /**
   * The whole range, its content, or one of its endpoints, as a range. The default is `Whole`.
   *
   * `Whole` and `Content` answer the same span. `Start` and `End` answer a collapsed range at
   * that endpoint, for an insertion point. `After` refuses with `NotSupported`, because a range
   * here never owns the position after its end. A text write can use the returned range in the
   * same sync; sync before you load it.
   */
  getRange(
    rangeLocation?:
      | RangeLocation.whole
      | RangeLocation.start
      | RangeLocation.end
      | RangeLocation.after
      | RangeLocation.content
      | 'Whole'
      | 'Start'
      | 'End'
      | 'After'
      | 'Content'
  ): Range {
    const target = `${this.path.label}.getRange`;
    const location = rangeGetRangeLocation(rangeLocation, target);
    this.requireUsablePath();
    const found = Range.promised(this.context, target, false);
    this.read(
      target,
      () => ({ op: 'getRange', span: this.#span(), location }),
      (value) => {
        found.hydrateAddress({ kind: 'span', span: hydratedSpan(value, target) });
      }
    );
    return found;
  }

  /**
   * This range's text as if every pending tracked change were accepted (`Current`, the default)
   * or rejected (`Original`). The document does not change.
   *
   * Use it to read back a proposed rewrite between syncs: after tracked edits, `text` reads both
   * the deleted and the inserted words, while `getReviewedText('Current')` reads only the
   * result. A paragraph mark reads as `\r` when that version keeps it. Fields read as their
   * displayed results, like `text`. Formatting changes do not change the text.
   */
  getReviewedText(changeTrackingVersion?: ChangeTrackingVersion): ClientResult<string>;
  /**
   * This range's text as if every pending tracked change were accepted (`Current`, the default)
   * or rejected (`Original`). The document does not change.
   */
  getReviewedText(changeTrackingVersion?: 'Original' | 'Current'): ClientResult<string>;
  getReviewedText(
    changeTrackingVersion?: ChangeTrackingVersion | 'Original' | 'Current'
  ): ClientResult<string> {
    const target = `${this.path.label}.getReviewedText`;
    const version = reviewedTextVersion(changeTrackingVersion, target);
    this.requireUsablePath();
    const { result, fill } = clientResult<string>(target);
    this.read(
      target,
      () => ({ op: 'getReviewedText', span: this.#span(), version }),
      (value) => fill(hydratedText(value, target))
    );
    return result;
  }

  /**
   * Write text at or over this range. Answers the range the written text occupies.
   * Await `context.sync()` before loading or addressing that returned range.
   *
   * With server `document.changeTrackingMode = 'TrackMineOnly'`, this creates a tracked text
   * edit attributed to the runtime author. Tracked range replacement supports adjacent sibling paragraphs outside collaboration.
   * Table and wrapper boundaries refuse. Edits can go inside or beside another author's pending
   * text insertion or deletion: a deletion of their inserted text nests inside their insertion,
   * new text inside their insertion splits it in two, and the returned range names the new text
   * after any deleted text. Each author's change stays a separate decision. These refuse with
   * `NotImplemented`, and `debugInfo.innerError.code` names the rule: a range of only deleted
   * text (`edit.tracked-deleted-text-only`); another author's paragraph mark, formatting, move, or
   * structural change, or a link or content control inside their insertion
   * (`edit.tracked-foreign-revision-unsupported`); and your own pending change, including a
   * range a tracked write returned (`edit.tracked-own-pending-change`). The same edits work in
   * a collaboration session. Font and paragraph formatting support property revisions.
   * Empty text with `Replace` deletes the range; empty text at an insertion point is a no-op.
   * Agent tools that intend a replacement should validate non-empty model output first.
   *
   * `\n`, `\r`, and `\r\n` in `text` are paragraph breaks: the text after one starts a new
   * paragraph with the properties of the paragraph it was written into. With `TrackMineOnly`,
   * each new paragraph mark is a tracked insertion, and rejecting it joins the paragraphs again.
   * The answered range then ends after the last segment, in the last new paragraph. Text that
   * lands inside an inline content control refuses with `NotSupported`
   * (`edit.indivisible-content`), and a write with a break cannot share a sync with another
   * text edit in the same paragraph. `\v` is a manual line break.
   *
   * `Before`/`Start` and `After`/`End` land at the SAME position here, and the difference Word
   * draws between them — whether the new text becomes part of this range — has no meaning for a
   * snapshot. Both pairs are accepted because source-compatible code uses all four; what a caller
   * gets back is a range naming the text that was written, in every case.
   *
   * In a React or Vue host, replace a found match in the editor itself with
   * `editor.exec({ type: 'replaceMatch', match, text })` on a match from `editor.findMatches`.
   * In suggesting mode it records a tracked replacement as the editor's author.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/tracked-replacement | Replace as a tracked change}
   */
  insertText(
    text: string,
    insertLocation: InsertLocation | 'Replace' | 'Start' | 'End' | 'Before' | 'After'
  ): Range {
    const target = `${this.path.label}.insertText`;
    if (this.path.isFieldResult) {
      this.requireUsablePath();
      this.command('insertText', fieldResultWrite(this.path, text, insertLocation, target));
      return Range.ofFieldResult(this.context, target, this.path);
    }
    const written = insertableTextWithBreaks(text, target);
    const where = rangeTextLocation(insertLocation, target);
    this.requireUsablePath();
    const created = Range.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => {
        const span = this.#span();
        return where === 'Replace'
          ? { op: 'replaceSpan', span, text: written }
          : {
              op: 'insertText',
              at: where === 'Start' || where === 'Before' ? span.start : span.end,
              text: written,
            };
      },
      (value) => {
        created.hydrateAddress({ kind: 'span', span: hydratedSpan(value, target) });
      }
    );
    return created;
  }

  /**
   * Delete range content.
   *
   * With `TrackMineOnly`, text becomes deleted runs and each paragraph mark the range covers
   * becomes a deleted paragraph mark, also in collaboration. Marks that `Paragraph.delete()`
   * refuses to strike refuse here with the same codes. A tracked deletion or replacement that
   * starts a paragraph whose previous mark you already proposed deleting refuses with
   * `NotImplemented`.
   */
  delete(): void {
    this.requireUsablePath();
    this.commandDiscarding('delete', () => ({ op: 'replaceSpan', span: this.#span(), text: '' }));
  }

  /** Clear this range's content, preserving the surrounding structure. */
  clear(): void {
    const span = this.#span();
    this.commandDiscarding('clear', () => ({ op: 'replaceSpan', span, text: '' }));
  }

  /**
   * Create a top-level comment anchored to exactly this range.
   *
   * The author is the identity the runtime was opened with. Empty comment text, a missing author,
   * stale endpoints, and ranges crossing a table-cell boundary are refused rather than authored
   * approximately. A collapsed range creates an insertion-point comment. A missing author refuses
   * with `NotSupported` and `debugInfo.innerError.code` `edit.comment-author-required`.
   *
   * In a React or Vue host with the review module, use `useReview().comment` from
   * `@docx-editor.dev/pro/react` or `@docx-editor.dev/pro/vue` instead. It comments on the
   * editor's selection as the editor's author.
   *
   * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/comment-on-found-text | Comment on found text}
   */
  insertComment(commentText: string): Comment {
    const target = `${this.path.label}.insertComment`;
    if (typeof commentText !== 'string' || commentText.length === 0) {
      fail({ code: 'InvalidArgument', target });
    }
    const author = this.internals.author;
    if (typeof author !== 'string' || author.trim().length === 0) {
      fail({ code: 'NotSupported', target, diagnostic: 'edit.comment-author-required' });
    }
    const created = Comment.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({ op: 'insertComment', span: this.#span(), text: commentText, author }),
      (value) => {
        if (value.kind !== 'handle') fail({ code: 'GeneralException', target });
        created.hydrateAddress(value);
      }
    );
    return created;
  }

  /**
   * Wrap this single-paragraph range in a rich-text, plain-text, or date-picker content control.
   * Await sync before configuring the returned control. Other types explicitly refuse.
   * TrackMineOnly supports nonempty ordinary text outside collaboration.
   * Existing revisions and empty tracked ranges refuse with NotSupported.
   */
  insertContentControl(
    contentControlType?:
      | ContentControlType.richText
      | ContentControlType.plainText
      | ContentControlType.buildingBlockGallery
      | ContentControlType.checkBox
      | ContentControlType.comboBox
      | ContentControlType.datePicker
      | ContentControlType.dropDownList
      | ContentControlType.group
      | ContentControlType.picture
      | ContentControlType.repeatingSection
      | 'RichText'
      | 'PlainText'
      | 'BuildingBlockGallery'
      | 'CheckBox'
      | 'ComboBox'
      | 'DatePicker'
      | 'DropDownList'
      | 'Group'
      | 'Picture'
      | 'RepeatingSection'
  ): ContentControl {
    const target = `${this.path.label}.insertContentControl`;
    const type = contentControlType ?? 'RichText';
    if (type !== 'RichText' && type !== 'PlainText' && type !== 'DatePicker')
      fail({ code: 'NotSupported', target });
    const created = ContentControl.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({
        op: 'insertContentControl',
        span: this.#span(),
        subtype: type === 'DatePicker' ? 'date' : type === 'PlainText' ? 'plainText' : 'richText',
        returnHandle: true,
      }),
      (value) => {
        if (value.kind !== 'handle') fail({ code: 'GeneralException', target });
        created.hydrateAddress(value);
      }
    );
    return created;
  }

  /** Tables contained by this range, in document order. */
  get tables(): TableCollection {
    this.requireUsablePath();
    return (this.#tables ??= TableCollection.over(
      this.context,
      `${this.path.label}.tables`,
      this.path,
      () => spanRefOf(this.path, 'span')
    ));
  }
  /** Fields fully contained within this range. */
  get fields(): FieldCollection {
    this.requireUsablePath();
    return (this.#fields ??= FieldCollection.of(
      this.context,
      `${this.path.label}.fields`,
      this.path,
      'span'
    ));
  }
  /**
   * Insert an inert field: Page, NumPages, Ref, PageRef, NoteRef, Seq, StyleRef, Date, Time,
   * Empty with a whole instruction of one of those types, or TOC with supported switches.
   * `text` holds the field arguments. The instruction is never evaluated, and the cached
   * result is empty. Fields that fetch, embed, link, run, or prompt refuse with
   * `InvalidArgument` (`edit.field-unsupported`). With `TrackMineOnly`, the field is one tracked
   * insertion; tracked TOC creation refuses.
   */
  insertField(
    insertLocation: InsertLocation | 'Before' | 'After' | 'Start' | 'End' | 'Replace',
    fieldType?: FieldType,
    text?: string,
    removeFormatting?: boolean
  ): Field;
  /**
   * Insert an inert field: Page, NumPages, Ref, PageRef, NoteRef, Seq, StyleRef, Date, Time,
   * Empty with a whole instruction of one of those types, or TOC with supported switches.
   * `text` holds the field arguments. The instruction is never evaluated, and the cached
   * result is empty. Fields that fetch, embed, link, run, or prompt refuse with
   * `InvalidArgument` (`edit.field-unsupported`). With `TrackMineOnly`, the field is one tracked
   * insertion; tracked TOC creation refuses.
   */
  insertField(
    insertLocation: InsertLocation | 'Before' | 'After' | 'Start' | 'End' | 'Replace',
    fieldType?: FieldTypeLiteral,
    text?: string,
    removeFormatting?: boolean
  ): Field;
  /**
   * Insert an inert field: Page, NumPages, Ref, PageRef, NoteRef, Seq, StyleRef, Date, Time,
   * Empty with a whole instruction of one of those types, or TOC with supported switches.
   * `text` holds the field arguments. The instruction is never evaluated, and the cached
   * result is empty. Fields that fetch, embed, link, run, or prompt refuse with
   * `InvalidArgument` (`edit.field-unsupported`). With `TrackMineOnly`, the field is one tracked
   * insertion; tracked TOC creation refuses.
   */
  insertField(
    insertLocation: InsertLocation | 'Before' | 'After' | 'Start' | 'End' | 'Replace',
    fieldType?: FieldType | FieldTypeLiteral,
    text?: string,
    removeFormatting?: boolean
  ): Field {
    const target = `${this.path.label}.insertField`;
    if (
      (fieldType !== undefined && typeof fieldType !== 'string') ||
      (text !== undefined && typeof text !== 'string') ||
      (removeFormatting !== undefined && typeof removeFormatting !== 'boolean')
    )
      fail({ code: 'InvalidArgument', target });
    const location = rangeTextLocation(insertLocation, target);
    this.requireUsablePath();
    const field = Field.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({
        op: 'insertField',
        span: this.#span(),
        location,
        ...(fieldType === undefined ? {} : { fieldType }),
        ...(text === undefined ? {} : { text }),
        ...(removeFormatting === undefined ? {} : { removeFormatting }),
      }),
      (value) => field.hydrateAddress({ kind: 'handle', handle: hydratedHandle(value, target) })
    );
    return field;
  }

  /**
   * Insert one equation from OOXML: a Flat OPC package (`pkg:package`) whose document part holds
   * one paragraph with exactly one inline `m:oMath` and, around it, plain runs. Other OOXML
   * refuses with `NotSupported` or `InvalidArgument` and `edit.ooxml-unsupported`, and nothing is
   * inserted. With `TrackMineOnly`, the equation is one tracked insertion. Returns the range the
   * inserted content occupies.
   */
  insertOoxml(
    ooxml: string,
    insertLocation: InsertLocation | 'Replace' | 'Start' | 'End' | 'Before' | 'After'
  ): Range {
    const target = `${this.path.label}.insertOoxml`;
    if (typeof ooxml !== 'string') fail({ code: 'InvalidArgument', target });
    const location = rangeTextLocation(insertLocation, target);
    this.requireUsablePath();
    const created = Range.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({ op: 'insertOoxml', span: this.#span(), location, ooxml }),
      (value) => created.hydrateAddress({ kind: 'span', span: hydratedSpan(value, target) })
    );
    return created;
  }

  /** Inline pictures fully contained within this snapshot range. */
  get inlinePictures(): InlinePictureCollection {
    this.requireUsablePath();
    return (this.#inlinePictures ??= InlinePictureCollection.of(
      this.context,
      `${this.path.label}.inlinePictures`,
      this.path,
      'span'
    ));
  }

  /**
   * Insert a bounded PNG/JPEG image. Sync before configuring the returned picture.
   *
   * Works on server, browser, and collaborative runtimes; on a collaborative runtime the
   * picture, its media part, and its relationship replicate to every participant. Insertion
   * must be the only mutation in its sync, and tracking refuses it.
   */
  insertInlinePictureFromBase64(
    base64EncodedImage: string,
    insertLocation: InsertLocation | 'Before' | 'After' | 'Start' | 'End' | 'Replace'
  ): InlinePicture {
    const target = `${this.path.label}.insertInlinePictureFromBase64`;
    if (typeof base64EncodedImage !== 'string' || base64EncodedImage.length === 0)
      fail({ code: 'InvalidArgument', target });
    const location = rangeTextLocation(insertLocation, target);
    this.requireUsablePath();
    const picture = InlinePicture.promised(this.context, target, false);
    this.commandAnswering(
      target,
      () => ({
        op: 'insertInlinePicture',
        span: this.#span(),
        base64: base64EncodedImage,
        location,
      }),
      (value) => {
        picture.hydrateAddress({ kind: 'handle', handle: hydratedHandle(value, target) });
      }
    );
    return picture;
  }

  /**
   * Line, page, and next-page section breaks are supported; other break types refuse at sync.
   * TrackMineOnly records a line break as a tracked insertion. Page and section breaks refuse
   * while tracking.
   */
  insertBreak(
    breakType:
      | BreakType
      | 'Page'
      | 'SectionNext'
      | 'Next'
      | 'Line'
      | 'SectionContinuous'
      | 'SectionEven'
      | 'SectionOdd',
    insertLocation: InsertLocation.before | InsertLocation.after | 'Before' | 'After'
  ): void {
    const target = `${this.path.label}.insertBreak`;
    if (insertLocation !== 'Before' && insertLocation !== 'After')
      fail({ code: 'InvalidArgument', target });
    const location = insertLocation;
    this.requireUsablePath();
    this.commandAnswering(
      target,
      () => ({ op: 'insertBreak', span: this.#span(), breakType, location }),
      (value) => hydratedApplied(value, target)
    );
  }

  /**
   * Insert a rectangular table before or after this range.
   * TrackMineOnly records native row/cell insertions, including initial values.
   * Sync before configuring the returned table. Nested table authoring refuses.
   */
  insertTable(
    rowCount: number,
    columnCount: number,
    insertLocation: InsertLocation.before | InsertLocation.after | 'Before' | 'After',
    values?: string[][]
  ): Table {
    const target = `${this.path.label}.insertTable`;
    if (
      !Number.isInteger(rowCount) ||
      !Number.isInteger(columnCount) ||
      rowCount < 1 ||
      columnCount < 1 ||
      !['Before', 'After'].includes(insertLocation)
    )
      fail({ code: 'InvalidArgument', target });
    if (
      values !== undefined &&
      (!Array.isArray(values) ||
        values.some((row) => !Array.isArray(row) || row.some((cell) => typeof cell !== 'string')))
    )
      fail({ code: 'InvalidArgument', target });
    const copied = values?.map((row) => [...row]);
    const table = Table.promised(this.context, target);
    this.commandAnswering(
      target,
      () => ({
        op: 'insertTable',
        span: spanRefOf(this.path, 'span'),
        location: insertLocation,
        rowCount,
        columnCount,
        ...(copied ? { values: copied } : {}),
      }),
      (answer) => {
        if (answer.kind !== 'handle') fail({ code: 'GeneralException', target });
        table.hydrateAddress({ kind: 'handle', handle: answer.handle });
      }
    );
    return table;
  }

  /** Add a paragraph before or after the one this range starts or ends in. */
  insertParagraph(
    paragraphText: string,
    insertLocation: InsertLocation.before | InsertLocation.after | 'Before' | 'After'
  ): Paragraph {
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
    // A field result has text only, so a bare `load()` asks for that and nothing else.
    const selected =
      this.path.isFieldResult && request.select.length === 0
        ? ['text']
        : this.selection(request, ['text', 'style', 'hyperlink']);
    if (selected.includes('hyperlink')) {
      this.loadTextInto('hyperlink', () => ({ op: 'getHyperlink', span: this.#span() }));
    }
    if (selected.includes('text')) {
      const label = `${this.path.label}.text`;
      this.read(
        label,
        this.path.isFieldResult
          ? fieldResultRead(this.path, this.revisionTextView())
          : () => ({ op: 'getSpanText', span: this.#span(), projection: this.revisionTextView() }),
        (value) => {
          this.setLoadedProperty('text', hydratedText(value, label));
        }
      );
    }
    if (!selected.includes('style')) return;
    const label = `${this.path.label}.style`;
    this.requireUsablePath();
    this.read(
      label,
      () => ({ op: 'getStyle', span: spanRefOf(this.path, 'span') }),
      (value) => {
        this.setLoadedProperty('style', hydratedStyle(value, label));
      }
    );
  }

  #span(): AutomationSpan {
    if (this.path.isFieldResult) refuseFieldResultMember(this.path.label);
    this.requireAddressable();
    return this.path.span();
  }
}
