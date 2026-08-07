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
 * `packages/editor-api/scripts/generate-conformance.mjs` reads this file
 * *read-only*, as the authored side of the conformance comparison. It never
 * writes to this file, and this file must never be (re)generated from the
 * reference fixture — that would silently turn "DocxEditor owns its types"
 * into "Microsoft's declarations, renamed".
 *
 * WHAT IS HERE IS WHAT WORKS. This file is an inventory of the implemented
 * subset, not a roadmap: a member whose engine backing does not exist is
 * de-selected from `compat/manifest.json` with a specific reason and removed
 * from here, rather than declared and left to fail. That is why the formatting
 * values appear on `Paragraph` but there is no `ParagraphFormat`, why `Font`
 * declares five members and not `highlightColor`, why `Bookmark` declares
 * `name`/`range`/`select` and not the document-wide `start`/`end` offsets, and
 * why a `Comment`'s body is readable and not assignable, and why
 * `ContentControl` declares eight members: the control's own `id` and `subtype`
 * ARE implemented, but not in upstream's types — the id as a string, because
 * `w:id` is optional and repeatable and no number can say "the file wrote
 * none", and the subtype in the schema's own vocabulary rather than Word's UI
 * enum. Neither would survive the exact-shape comparison, so both are recorded
 * omissions and the object model publishes them under its own names.
 *
 * A NULL A DECLARATION CANNOT SAY. `Font#bold`, `Paragraph#alignment` and
 * `#style` are declared with upstream's own non-nullable types, and the runtime
 * answers `null` (or `'Mixed'`/`'Unknown'` for alignment) where the characters
 * or paragraphs read disagree, or where nothing authors the value. Upstream
 * declares and behaves the same way; widening the declarations would make them
 * stop matching the reference they are measured against.
 *
 * Two support types exist purely to give a small number of return/parameter
 * positions — or, for `ClientRequestContext`, the batch callback parameter
 * every source-compat fixture actually calls — a name, with zero runtime
 * footprint (a plain string-literal union type and a declaration-only base
 * class): the *runtime* enum objects and the real queuing/flush behavior
 * Office.js ships alongside these are proxy-runtime plumbing, out of scope for
 * this task:
 *   - `SelectionMode`: Word.js's own declarations offer this position as two
 *     overloads — one keyed on an enum type, one on the equivalent
 *     string-literal union — so a same-named type must exist for the
 *     enum-typed overload to type-check at all.
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

  /**
   * Which header or footer of a section.
   *
   * A named type for the same reason `SelectionMode` is one: upstream offers the position as two
   * overloads, one keyed on an enum type and one on the equivalent string-literal union, so a
   * same-named type has to exist for the enum-typed overload to type-check at all.
   */
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
    readonly revisions: RevisionCollection;
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
    italic: boolean;
    name: string;
    size: number;
  }

  // ---------------------------------------------------------------------
  // listsAndNumbering
  // ---------------------------------------------------------------------

  // `Before`/`After` insert at the list's own first and last position, the same places `Start` and
  // `End` name: a list is a set of paragraphs rather than a region of the story, so a position
  // outside it is a position in the story, which `Paragraph#insertParagraph` addresses. The
  // divergence is recorded in `compat/manifest.json`.
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

  // `listString` and `siblingIndex` are deliberately ABSENT: both are the marker a page shows, which
  // the layout engine computes from numbering.xml as it paints. See `compat/manifest.json`.
  export class ListItem {
    level: number;
  }

  // ---------------------------------------------------------------------
  // bookmarks
  // ---------------------------------------------------------------------

  // `start`, `end` and `delete` are deliberately ABSENT: the first two are the document-wide
  // character offsets already de-selected on `Range`, and nothing in the engine removes a bookmark's
  // marker pair. See `compat/manifest.json`.
  export class Bookmark {
    readonly name: string;
    readonly range: Range;
    select(): void;
  }

  export class BookmarkCollection {
    readonly items: Bookmark[];
  }

  // ---------------------------------------------------------------------
  // sectionsAndStories
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

  export class NoteItem {
    readonly body: Body;
    readonly type: 'Footnote' | 'Endnote';
    delete(): void;
    getNext(): NoteItem;
  }

  // Upstream reaches this from `Body#footnotes`/`#endnotes`; here it hangs off the document, because
  // a note is a part of the package that only the main story may reference. See
  // `compat/manifest.json`.
  export class NoteItemCollection {
    readonly items: NoteItem[];
    getFirst(): NoteItem;
  }

  // ---------------------------------------------------------------------
  // commentsAndRevisions
  // ---------------------------------------------------------------------

  // `authorEmail` and `content` are deliberately ABSENT: an author's address is in people.xml,
  // which this subset does not read, and a comment's body is assignable upstream while nothing here
  // rewrites one. `text` is DocxEditor's own read-only way to reach the body, recorded as
  // unmeasured. See `compat/manifest.json`.
  export class Comment {
    readonly authorName: string;
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
    readonly authorName: string;
    readonly creationDate: Date;
    readonly id: string;
    delete(): void;
  }

  export class CommentReplyCollection {
    readonly items: CommentReply[];
    getFirst(): CommentReply;
  }

  // The whole upstream vocabulary is declared, and seven of its members occur: a change to a row, a
  // cell or a section is structural, and this subset reports only changes it can also accept or
  // reject. See `compat/manifest.json`.
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
    cannotDelete: boolean;
    cannotEdit: boolean;
    readonly contentControls: ContentControlCollection;
    readonly paragraphs: ParagraphCollection;
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
