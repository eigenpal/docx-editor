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
// then gains a word at offset 0 no longer names "alpha", so using it fails with `StaleDocument`
// instead of reading or editing the text now at offsets 0..5. Word's own ranges do move, by
// keeping a live region in the document; this API does not have one, and pretending otherwise
// would answer text from a place the caller was not looking at.
//
// That is also why `Range#start`/`Range#end` are not here, and why they are not merely unimplemented
// either: they are document-wide character positions, a different addressing scheme from the one this
// whole lane uses (paragraph identity plus UTF-16 offset) and one whose value changes whenever any
// earlier paragraph changes length. This engine maintains no such counter, so the members were
// DE-SELECTED — removed from `compat/manifest.json`'s selection and from the authored declarations,
// with the reasons recorded as omissions there — rather than left declared for a shipped object that
// could never satisfy them. A caller who wants the ends of a range asks it for its paragraphs.

import { InsertLocation, BreakType, ContentControlType } from './editing-enums.ts';
import { Field, FieldCollection } from './fields.ts';
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
  type AutomationSpan,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { ParagraphCollection, RangeCollection, type PromisedItem } from './collections.ts';
import { BookmarkCollection } from './bookmarks.ts';
import { requireStyleName, spanRefOf } from './addressing.ts';
import { Font } from './font.ts';
import { ContentControl } from './content-controls.ts';
import {
  insertableText,
  rangeTextLocation,
  selectionMode,
  type SelectionMode,
} from './locations.ts';
import { ModelObject } from './model-object.ts';
import { Paragraph } from './paragraph.ts';
import { Comment, RevisionCollection } from './review.ts';
import { searchOptions, type SearchOptions } from './search-options.ts';
import { clientResult, type ClientResult } from '../runtime/client-result.ts';

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
   * range a tracked write returned (`edit.tracked-own-pending-change`). In a collaboration
   * session, the API refuses strikes over another author's pending insertion or deletion,
   * and edits that start inside or right after one, with `edit.tracked-foreign-revision-unsupported`. Font and paragraph
   * formatting support property revisions.
   * Empty text with `Replace` deletes the range; empty text at an insertion point is a no-op.
   * Agent tools that intend a replacement should validate non-empty model output first.
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
    const written = insertableText(text, target);
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
   * Insert PAGE, NUMPAGES, or an inert TOC field with supported switches.
   * TOC entries are not calculated. Tracked field insertion refuses.
   */
  insertField(
    insertLocation: InsertLocation | 'Before' | 'After' | 'Start' | 'End' | 'Replace',
    fieldType?: FieldType,
    text?: string,
    removeFormatting?: boolean
  ): Field;
  /**
   * Insert PAGE, NUMPAGES, or an inert TOC field with supported switches.
   * TOC entries are not calculated. Tracked field insertion refuses.
   */
  insertField(
    insertLocation: InsertLocation | 'Before' | 'After' | 'Start' | 'End' | 'Replace',
    fieldType?: FieldTypeLiteral,
    text?: string,
    removeFormatting?: boolean
  ): Field;
  /**
   * Insert PAGE, NUMPAGES, or an inert TOC field with supported switches.
   * TOC entries are not calculated. Tracked field insertion refuses.
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
    const selected = this.selection(request, ['text', 'style', 'hyperlink']);
    if (selected.includes('hyperlink')) {
      this.loadTextInto('hyperlink', () => ({ op: 'getHyperlink', span: this.#span() }));
    }
    if (selected.includes('text')) {
      const label = `${this.path.label}.text`;
      this.read(
        label,
        () => ({ op: 'getSpanText', span: this.#span(), projection: this.revisionTextView() }),
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
    this.requireAddressable();
    return this.path.span();
  }
}
