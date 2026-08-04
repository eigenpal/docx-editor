/**
 * Shared types for the `@docx-editor.dev/core` contract. Type-only, zero runtime.
 *
 * `@docx-editor.dev/core/types` re-exports this module verbatim.
 */

// ─── Addressing ──────────────────────────────────────────────────────────────

/**
 * The LLM- and JSON-facing address for a piece of a document.
 *
 * `paraId` is the 8-hex `w14:paraId`, matched case-insensitively. `search` is a
 * phrase that must match EXACTLY ONCE inside that paragraph; ambiguous or
 * missing matches fail with `'ambiguous'` / `'notFound'` rather than falling
 * back to first-match.
 *
 * Offset-based addressing was tried and abandoned: an agent cannot compute a
 * character offset it has not seen, and offsets do not survive concurrent
 * edits. Do not reintroduce `{ blockId, offset }`.
 */
export interface DocAnchor {
  paraId: string;
  search?: string;
  /** Opt-in disambiguation. Omit to require uniqueness. */
  occurrence?: number;
}

/** Structural addressing for content the paraId map cannot reach. */
export interface DocLocation {
  container: ContainerRef;
  /** Block indices, descending into tables and content controls. */
  path: number[];
  offset?: number;
}

export type ContainerRef =
  | { part: 'body' }
  | { part: 'header' | 'footer'; rId: string }
  | { part: 'footnote' | 'endnote'; noteId: number };

export type DocTarget = DocAnchor | DocLocation | DocRange;

export interface DocRange {
  from: DocAnchor | DocLocation;
  to: DocAnchor | DocLocation;
}

// ─── Results ─────────────────────────────────────────────────────────────────

/**
 * Every write returns this rather than `boolean`.
 *
 * A bare boolean cannot distinguish "no-op" from "target not found" from
 * "content control is locked", and the editor layer already throws eight
 * distinct ContentControl error classes that a boolean would flatten.
 */
export type ExecResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: ExecErrorCode; reason: string; target?: DocTarget };

export type ExecErrorCode =
  | 'notFound'
  | 'ambiguous'
  | 'locked'
  | 'bound'
  | 'typeMismatch'
  | 'kindMismatch'
  | 'outOfBounds'
  | 'unsupported'
  | 'invalidArgs';

// ─── Document model ──────────────────────────────────────────────────────────

/**
 * A parsed .docx.
 *
 * NOT JSON-round-trippable: it holds `Map`s and `Date`s, plus an internal
 * side-table of verbatim XML used for lossless round-tripping. Use `toJSON` /
 * `fromJSON` before sending it over JSON-RPC or handing it to a model.
 */
export interface DocxDocument {
  readonly body: DocumentBody;
  readonly styles: StyleDefinitions;
  readonly theme?: Theme;
  readonly comments: readonly DocComment[];
  readonly revisions: readonly Revision[];
}

export interface DocumentBody {
  readonly content: readonly Block[];
  /**
   * Derived, not stored: recomputed on read from section-break markers and
   * section inheritance. Never treat it as a spreadable field.
   */
  readonly sections: readonly Section[];
}

/** The JSON-safe projection of a document. */
export interface DocxDocumentJSON {
  readonly [key: string]: unknown;
}

export interface Section {
  readonly properties: SectionProperties;
  readonly headers: HeaderFooterSet;
  readonly footers: HeaderFooterSet;
}

export interface HeaderFooterSet {
  readonly default?: string;
  readonly first?: string;
  readonly even?: string;
}

export type Block = Paragraph | Table | ContentControl;

export interface Paragraph {
  readonly kind: 'paragraph';
  /** `w14:paraId`. The stable handle `DocAnchor` addresses. */
  readonly paraId?: string;
  readonly runs: readonly Run[];
  readonly styleId?: string;
  readonly numbering?: NumberingRef;
}

export interface Run {
  readonly text: string;
  readonly formatting?: RunFormatting;
  readonly revisionId?: number;
}

export interface RunFormatting {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly color?: ColorValue;
  readonly highlight?: string;
  readonly fontFamily?: string;
  readonly fontSizePt?: number;
  // ── Selection-level additions (additive, all optional) ─────────────────────────────
  // `EditorSnapshot.formatting` and `getSelectionFormatting` carry the FULL derivable
  // shape through this one type, so a toolbar reads alignment, style and script state
  // from the same object as bold/italic. On a `Run` these stay absent: a run has no
  // alignment or paragraph style of its own.
  readonly superscript?: boolean;
  readonly subscript?: boolean;
  /** Paragraph alignment at the selection. `both` is OOXML's spelling of justify. */
  readonly alignment?: 'left' | 'center' | 'right' | 'both';
  /** Paragraph style id (`w:pStyle`) at the selection. */
  readonly styleId?: string;
  /**
   * Line spacing at the selection, in the unit its rule implies — LINES for `multiple`,
   * points for `exact` and `atLeast`. The same vocabulary `setLineSpacing` takes, so a
   * control can show what it reads and send back what it shows. Absent when the
   * selection's paragraphs disagree or state no line spacing.
   */
  readonly lineSpacing?: {
    readonly rule: 'multiple' | 'exact' | 'atLeast';
    readonly value: number;
  };
  /** Space above and below the paragraph at the selection, in points. */
  readonly spaceBeforePt?: number;
  readonly spaceAfterPt?: number;
  /**
   * The EFFECTIVE paragraph indent at the selection — cascade and numbering merge
   * included, so a numbered item that authors no `w:ind` reports the indent its list
   * definition gives it. Absent when nothing is loaded, or when the selection is inside a
   * table (see {@link IndentFormatting}).
   */
  readonly indent?: IndentFormatting;
}

/**
 * Indent at the selection, in twips.
 *
 * Unlike every other field here, this does NOT go absent when the selection's paragraphs
 * disagree. A ruler has to draw its handles somewhere, and Word draws them at the FIRST
 * selected paragraph's values — Select All is the commonest indent gesture, and hiding the
 * handles for it would be worse than showing one paragraph's truth. The values are
 * therefore always the first touched paragraph's, and {@link mixed} records per field
 * whether the rest agree.
 *
 * `firstLine` is ONE SIGNED offset: negative is a hanging indent. OOXML spells it as two
 * mutually exclusive attributes and this collapses them hanging-wins (§17.3.1.12), which
 * is the model Word itself keeps.
 *
 * Absent inside a table. The value would be correct there, but it is measured from the
 * cell's content edge while a ruler is drawn against the page's margin, and the ruler does
 * not know the cell.
 */
export interface IndentFormatting {
  /** Left indent, signed. Negative pulls text into the margin, as Word allows. */
  readonly left: number;
  /** Right indent, signed. */
  readonly right: number;
  /** First-line offset from {@link left}, signed. Negative is a hanging indent. */
  readonly firstLine: number;
  /** Per field, whether the selection's paragraphs disagree about it. */
  readonly mixed: {
    readonly left: boolean;
    readonly right: boolean;
    readonly firstLine: boolean;
  };
}

export interface Table {
  readonly kind: 'table';
  readonly rows: readonly TableRow[];
  readonly styleId?: string;
}

export interface TableRow {
  readonly cells: readonly TableCell[];
}

export interface TableCell {
  readonly content: readonly Block[];
  readonly rowSpan?: number;
  readonly colSpan?: number;
}

/** Structured document tag (`w:sdt`). */
export interface ContentControl {
  readonly kind: 'contentControl';
  readonly id: string;
  readonly tag?: string;
  readonly alias?: string;
  readonly controlType: ContentControlType;
  readonly locked?: boolean;
  readonly content: readonly Block[];
}

export type ContentControlType =
  | 'richText'
  | 'plainText'
  | 'checkbox'
  | 'dropdown'
  | 'comboBox'
  | 'date'
  | 'picture'
  | 'repeatingSection';

export interface ContentControlFilter {
  readonly tag?: string;
  readonly alias?: string;
  readonly controlType?: ContentControlType;
}

/**
 * A position in one story: a paragraph and a UTF-16 offset inside it.
 *
 * The same offset space the ops and the caret use, so an anchor read here can be handed
 * straight back to a selection without re-deriving anything.
 */
export interface DocAnchorRange {
  /** Canonical part name of the story the range lives in, e.g. `/word/document.xml`. */
  readonly part: string;
  readonly startParagraphId: string;
  readonly startOffset: number;
  /** May sit in a later paragraph: the range markers are independent elements. */
  readonly endParagraphId: string;
  readonly endOffset: number;
}

export interface DocComment {
  readonly id: string;
  readonly author: string;
  /**
   * OPTIONAL, because `CT_Comment` makes `@w:date` optional and files omit it. A comment
   * with no date is a comment, not a defect, and fabricating one is a content change.
   */
  readonly date?: string;
  readonly text: string;
  readonly parentId?: string;
  readonly resolved?: boolean;
  /**
   * Where the comment is anchored, absent when the file gave it no usable range.
   *
   * A comment lives in `comments.xml` and is placed by markers in a STORY, so the story is
   * part of the address: a comment anchored in a header belongs to a part the body never saw.
   */
  readonly anchor?: DocAnchorRange;
  /**
   * True when the file gave this comment no usable range — a reference with no markers, or a
   * start with no end. Reported rather than dropped: a reviewer's remark vanishing silently
   * is worse than one that says it lost its text.
   */
  readonly orphaned?: boolean;
}

/**
 * What kind of decision a revision represents.
 *
 * Wider than insert/delete/format, and it has to be. `w:moveFrom`/`w:moveTo` are not a
 * deletion and an insertion — resolving one half alone duplicates or loses the content;
 * `w:pPr/w:rPr/w:ins|w:del` decorates no characters at all and merges paragraphs when
 * resolved; a row or cell revision is structural. A reviewer shown only three kinds is a
 * reviewer who never learns about the rest.
 */
export type RevisionType =
  | 'insert'
  | 'delete'
  /** A deletion and an insertion that are one edit: text typed over a selection. */
  | 'replace'
  | 'moveFrom'
  | 'moveTo'
  /** `w:rPrChange` / `w:pPrChange` — the words are unchanged, their formatting is not. */
  | 'format'
  /** `w:pPr/w:rPr/w:ins|w:del` — a paragraph split or merge. */
  | 'paragraphMark'
  /** A row, cell, section or grid revision. */
  | 'structural';

export interface Revision {
  /** Numeric, and unique only WITHIN a part. Pair with `part` to address one. */
  readonly id: number;
  readonly type: RevisionType;
  readonly author: string;
  /**
   * OPTIONAL. `CT_TrackChange` requires `@w:id` and `@w:author` and makes `@w:date`
   * optional, and producers that omit it are ordinary. Requiring it here forced either a
   * fabricated date — a content change — or dropping the revision from the list.
   */
  readonly date?: string;
  /**
   * REQUIRED, and a canonical PART NAME rather than a three-value enum.
   *
   * `@w:id` is unique only within a part, so an address without one names two revisions in a
   * package that has both. The enum could not express the parts revisions actually occur in:
   * `header3.xml`, `footer1.xml`, `comments.xml`, and `styles.xml`, which carries
   * `w:pPrChange` inside style definitions with ids that collide with `document.xml`.
   */
  readonly part: string;
}

export interface SectionProperties {
  readonly pageSize: { widthTwips: number; heightTwips: number };
  readonly margins: PageMargins;
  readonly columns?: { count: number; gapTwips: number };
  readonly titlePage?: boolean;
}

export interface PageMargins {
  readonly topTwips: number;
  readonly rightTwips: number;
  readonly bottomTwips: number;
  readonly leftTwips: number;
}

export interface StyleDefinitions {
  readonly paragraph: ReadonlyMap<string, StyleDefinition>;
  readonly character: ReadonlyMap<string, StyleDefinition>;
  readonly table: ReadonlyMap<string, StyleDefinition>;
}

export interface StyleDefinition {
  readonly id: string;
  readonly name: string;
  readonly basedOn?: string;
}

export interface NumberingRef {
  readonly numId: string;
  readonly level: number;
}

export type ColorValue =
  | { readonly kind: 'hex'; readonly value: string }
  | {
      readonly kind: 'theme';
      readonly slot: string;
      readonly tint?: number;
      readonly shade?: number;
    }
  | { readonly kind: 'auto' };

export interface Theme {
  readonly colorScheme: ThemeColorScheme;
  readonly fontScheme?: Record<string, string>;
}

export type ThemeColorScheme = Readonly<Record<string, string>>;

export interface Watermark {
  readonly text?: string;
  readonly imageData?: Uint8Array;
}

export interface Extent {
  readonly widthEmu: number;
  readonly heightEmu: number;
}

export interface FontDefinition {
  readonly family: string;
  readonly embedded: boolean;
}

// ─── Geometry primitives ─────────────────────────────────────────────────────

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type JSONSchema = Readonly<Record<string, unknown>>;

/** An editor extension. Declared here so `core/editor` can type its config
 * without importing `core/plugin`, which imports `core/editor`. */
export interface Extension {
  readonly name: string;
}

export type Unsubscribe = () => void;
