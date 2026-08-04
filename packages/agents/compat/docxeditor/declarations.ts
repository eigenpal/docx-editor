/**
 * DocxEditor's own public Word-compatibility interfaces.
 *
 * DocxEditor owns every type declared here. Names and call-shape
 * compatibility deliberately mirror the Microsoft Word JavaScript API
 * subset frozen in `compat/manifest.json` / `compat/reference/word.reference.json`
 * (renamed `Word` -> `DocxEditor`, per the task-1 brief), but nothing here is
 * vendored, copied, or generated from `@types/office-js` — it is
 * hand-authored, declaration-only (no runtime behavior; the proxy runtime
 * and automation host that back these types are a later task), and
 * organized however this repository chooses to organize it.
 *
 * `packages/agents/scripts/generate-conformance.mjs` reads this file
 * *read-only*, as the authored side of the conformance comparison. It never
 * writes to this file, and this file must never be (re)generated from the
 * reference fixture — that would silently turn "DocxEditor owns its types"
 * into "Microsoft's declarations, renamed".
 *
 * Three support types exist purely to give a small number of
 * return/parameter positions — or, for `ClientRequestContext`, the batch
 * callback parameter every source-compat fixture actually calls — a name,
 * with zero runtime footprint (plain string-literal union types and a
 * declaration-only base class): the *runtime* enum objects and the real
 * queuing/flush behavior Office.js ships alongside these are proxy-runtime
 * plumbing, out of scope for this task:
 *   - `SelectionMode`, `HeaderFooterType`: Word.js's own declarations offer
 *     these positions as two overloads — one keyed on an enum type, one on
 *     the equivalent string-literal union — so a same-named type must exist
 *     for the enum-typed overload to type-check at all.
 *   - `ClientRequestContext`: the generic, Word-agnostic base type that
 *     `ClientObject#context` returns upstream (`Word.RequestContext`
 *     extends it, adding `document`). Upstream's own `sync` is generic and
 *     pass-through (`sync<T>(passThroughValue?: T): Promise<T>`) — batching
 *     semantics that are this task's proxy-runtime successor's job (Task 3),
 *     not this contract-freeze task's. Rather than selecting and exactly
 *     matching that shape, this file independently authors a deliberately
 *     simplified, declaration-only `sync(): Promise<void>` — the
 *     zero-argument call every real Office.js sample actually makes — purely
 *     so representative source-compat fixtures in `compat/fixtures/` can end
 *     a batch with `await context.sync()`, same as real Office.js samples
 *     do. See the `OfficeExtension.ClientRequestContext#sync` entry in
 *     `compat/manifest.json`'s `omissions`: this member is intentionally
 *     *not* selected for exact conformance against the reference, precisely
 *     because it is a deliberate simplification, not a faithful mirror.
 */
export declare namespace DocxEditor {
  export type SelectionMode = 'Select' | 'Start' | 'End';
  export type HeaderFooterType = 'Primary' | 'FirstPage' | 'EvenPages';

  /** Base request-context handle; see the file header for why only `sync` is declared here. */
  export class ClientRequestContext {
    sync(): Promise<void>;
  }

  // ---------------------------------------------------------------------
  // core: RequestContext, ClientObject, Document, Body, Range, Paragraph
  // ---------------------------------------------------------------------

  export class RequestContext extends ClientRequestContext {
    readonly document: Document;
  }

  export class ClientObject {
    context: ClientRequestContext;
    isNullObject: boolean;
  }

  export class Document {
    readonly body: Body;
    readonly comments: CommentCollection;
    readonly contentControls: ContentControlCollection;
    readonly paragraphs: ParagraphCollection;
    readonly sections: SectionCollection;
  }

  export class Body {
    readonly contentControls: ContentControlCollection;
    readonly font: Font;
    readonly lists: ListCollection;
    readonly paragraphs: ParagraphCollection;
    style: string;
    readonly text: string;
    clear(): void;
    getComments(): CommentCollection;
    insertParagraph(paragraphText: string, insertLocation: 'Start' | 'End'): Paragraph;
    insertText(text: string, insertLocation: 'Replace' | 'Start' | 'End'): Range;
    search(searchText: string, searchOptions?: SearchOptions): RangeCollection;
  }

  // `start` and `end` are deliberately ABSENT. Upstream declares them as document-wide character
  // offsets; DocxEditor addresses every position as a paragraph identity plus a UTF-16 offset in
  // that paragraph, which is the vocabulary its ops validate against, and it maintains no
  // document-wide counter for a range to report. Declaring the members and never implementing them
  // would make this file a roadmap rather than an inventory. The recorded reasons are the
  // `Word.Range#start` / `Word.Range#end` entries in `compat/manifest.json`'s omissions.
  export class Range {
    readonly bookmarks: BookmarkCollection;
    readonly contentControls: ContentControlCollection;
    readonly font: Font;
    hyperlink: string;
    readonly paragraphs: ParagraphCollection;
    style: string;
    readonly text: string;
    insertParagraph(paragraphText: string, insertLocation: 'Before' | 'After'): Paragraph;
    insertText(
      text: string,
      insertLocation: 'Replace' | 'Start' | 'End' | 'Before' | 'After'
    ): Range;
    search(searchText: string, searchOptions?: SearchOptions): RangeCollection;
    select(selectionMode?: SelectionMode): void;
    select(selectionMode?: 'Select' | 'Start' | 'End'): void;
  }

  export class Paragraph {
    alignment: 'Mixed' | 'Unknown' | 'Left' | 'Centered' | 'Right' | 'Justified';
    readonly contentControls: ContentControlCollection;
    firstLineIndent: number;
    readonly font: Font;
    leftIndent: number;
    lineSpacing: number;
    readonly list: List;
    readonly listItem: ListItem;
    rightIndent: number;
    spaceAfter: number;
    spaceBefore: number;
    style: string;
    readonly text: string;
    clear(): void;
    delete(): void;
    insertParagraph(paragraphText: string, insertLocation: 'Before' | 'After'): Paragraph;
    insertText(text: string, insertLocation: 'Replace' | 'Start' | 'End'): Range;
    split(delimiters: string[], trimDelimiters?: boolean, trimSpacing?: boolean): RangeCollection;
  }

  // ---------------------------------------------------------------------
  // collectionsAndSearch
  // ---------------------------------------------------------------------

  export class ParagraphCollection {
    readonly items: Paragraph[];
    getFirst(): Paragraph;
    getLast(): Paragraph;
  }

  export class RangeCollection {
    readonly items: Range[];
    getFirst(): Range;
  }

  export class SearchOptions {
    ignorePunct: boolean;
    ignoreSpace: boolean;
    matchCase: boolean;
    matchWholeWord: boolean;
    matchWildcards: boolean;
  }

  // ---------------------------------------------------------------------
  // fontAndParagraphFormatting
  // ---------------------------------------------------------------------

  export class Font {
    bold: boolean;
    color: string;
    highlightColor: string;
    italic: boolean;
    name: string;
    size: number;
  }

  export class ParagraphFormat {
    alignment: 'Mixed' | 'Unknown' | 'Left' | 'Centered' | 'Right' | 'Justified';
    firstLineIndent: number;
    leftIndent: number;
    lineSpacing: number;
    rightIndent: number;
    spaceAfter: number;
    spaceBefore: number;
    widowControl: boolean;
  }

  // ---------------------------------------------------------------------
  // lists
  // ---------------------------------------------------------------------

  export class List {
    readonly id: number;
    readonly paragraphs: ParagraphCollection;
    getLevelParagraphs(level: number): ParagraphCollection;
    insertParagraph(
      paragraphText: string,
      insertLocation: 'Start' | 'End' | 'Before' | 'After'
    ): Paragraph;
  }

  export class ListCollection {
    readonly items: List[];
    getById(id: number): List;
    getFirst(): List;
  }

  export class ListItem {
    level: number;
    readonly listString: string;
    readonly siblingIndex: number;
  }

  // ---------------------------------------------------------------------
  // hyperlinksAndBookmarks
  // ---------------------------------------------------------------------

  export class Bookmark {
    end: number;
    readonly name: string;
    readonly range: Range;
    start: number;
    delete(): void;
    select(): void;
  }

  export class BookmarkCollection {
    readonly items: Bookmark[];
  }

  // ---------------------------------------------------------------------
  // sectionsAndPageSetup
  // ---------------------------------------------------------------------

  export class Section {
    readonly body: Body;
    readonly pageSetup: PageSetup;
    getFooter(type: HeaderFooterType): Body;
    getFooter(type: 'Primary' | 'FirstPage' | 'EvenPages'): Body;
    getHeader(type: HeaderFooterType): Body;
    getHeader(type: 'Primary' | 'FirstPage' | 'EvenPages'): Body;
    getNext(): Section;
  }

  export class SectionCollection {
    readonly items: Section[];
    getFirst(): Section;
  }

  export class PageSetup {
    bottomMargin: number;
    leftMargin: number;
    orientation: 'Portrait' | 'Landscape';
    pageHeight: number;
    pageWidth: number;
    rightMargin: number;
    topMargin: number;
  }

  // ---------------------------------------------------------------------
  // headerFooterAndNoteBodies
  // ---------------------------------------------------------------------

  export class NoteItem {
    readonly body: Body;
    readonly type: 'Footnote' | 'Endnote';
    delete(): void;
    getNext(): NoteItem;
  }

  // ---------------------------------------------------------------------
  // commentsAndRevisions
  // ---------------------------------------------------------------------

  export class Comment {
    readonly authorEmail: string;
    readonly authorName: string;
    content: string;
    readonly creationDate: Date;
    readonly id: string;
    readonly replies: CommentReplyCollection;
    resolved: boolean;
    delete(): void;
    getRange(): Range;
    reply(replyText: string): CommentReply;
  }

  export class CommentCollection {
    readonly items: Comment[];
    getFirst(): Comment;
  }

  export class CommentReply {
    readonly authorEmail: string;
    readonly authorName: string;
    content: string;
    readonly creationDate: Date;
    readonly id: string;
    delete(): void;
  }

  export class CommentReplyCollection {
    readonly items: CommentReply[];
    getFirst(): CommentReply;
  }

  export class Revision {
    readonly author: string;
    readonly date: Date;
    readonly range: Range;
    readonly type:
      | 'None'
      | 'Insert'
      | 'Delete'
      | 'Property'
      | 'ParagraphNumber'
      | 'DisplayField'
      | 'Reconcile'
      | 'Conflict'
      | 'Style'
      | 'Replace'
      | 'ParagraphProperty'
      | 'TableProperty'
      | 'SectionProperty'
      | 'StyleDefinition'
      | 'MovedFrom'
      | 'MovedTo'
      | 'CellInsertion'
      | 'CellDeletion'
      | 'CellMerge'
      | 'CellSplit'
      | 'ConflictInsert'
      | 'ConflictDelete';
    accept(): void;
    reject(): void;
  }

  export class RevisionCollection {
    readonly items: Revision[];
    acceptAll(): void;
    rejectAll(): void;
  }

  // ---------------------------------------------------------------------
  // contentControls
  // ---------------------------------------------------------------------

  export class ContentControl {
    appearance: 'BoundingBox' | 'Tags' | 'Hidden';
    cannotDelete: boolean;
    cannotEdit: boolean;
    color: string;
    readonly contentControls: ContentControlCollection;
    readonly id: number;
    readonly paragraphs: ParagraphCollection;
    placeholderText: string;
    readonly subtype:
      | 'Unknown'
      | 'RichTextInline'
      | 'RichTextParagraphs'
      | 'RichTextTableCell'
      | 'RichTextTableRow'
      | 'RichTextTable'
      | 'PlainTextInline'
      | 'PlainTextParagraph'
      | 'Picture'
      | 'BuildingBlockGallery'
      | 'CheckBox'
      | 'ComboBox'
      | 'DropDownList'
      | 'DatePicker'
      | 'RepeatingSection'
      | 'RichText'
      | 'PlainText'
      | 'Group';
    tag: string;
    readonly text: string;
    title: string;
    delete(keepContent: boolean): void;
    getRange(rangeLocation?: 'Whole' | 'Start' | 'End' | 'Before' | 'After' | 'Content'): Range;
    insertText(text: string, insertLocation: 'Replace' | 'Start' | 'End'): Range;
  }

  export class ContentControlCollection {
    readonly items: ContentControl[];
    getById(id: number): ContentControl;
  }

  // ---------------------------------------------------------------------
  // top-level entry point
  // ---------------------------------------------------------------------

  export function run<T>(batch: (context: RequestContext) => Promise<T>): Promise<T>;
  export function run<T>(
    object: ClientObject,
    batch: (context: RequestContext) => Promise<T>
  ): Promise<T>;
  export function run<T>(
    objects: ClientObject[],
    batch: (context: RequestContext) => Promise<T>
  ): Promise<T>;
}
