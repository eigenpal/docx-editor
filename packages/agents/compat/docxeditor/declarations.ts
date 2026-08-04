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
 * WHAT IS HERE IS WHAT WORKS. This file is an inventory of the implemented
 * subset, not a roadmap: a member whose engine backing does not exist is
 * de-selected from `compat/manifest.json` with a specific reason and removed
 * from here, rather than declared and left to fail. That is why the formatting
 * values appear on `Paragraph` but there is no `ParagraphFormat`, why `Font`
 * declares five members and not `highlightColor`, and why lists, bookmarks,
 * hyperlinks, sections, page setup, note bodies, comments and revisions are
 * absent. `ContentControl` is the one exception, and a scheduled one: the plan
 * completes it as its own step, and its members are declared here from that
 * contract freeze.
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
    readonly contentControls: ContentControlCollection;
    readonly paragraphs: ParagraphCollection;
  }

  export class Body {
    readonly contentControls: ContentControlCollection;
    readonly font: Font;
    readonly paragraphs: ParagraphCollection;
    style: string;
    readonly text: string;
    clear(): void;
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
    readonly contentControls: ContentControlCollection;
    readonly font: Font;
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
