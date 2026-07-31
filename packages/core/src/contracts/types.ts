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

export interface DocComment {
  readonly id: string;
  readonly author: string;
  readonly date: string;
  readonly text: string;
  readonly parentId?: string;
  readonly resolved?: boolean;
}

export interface Revision {
  /** Numeric, and unique only WITHIN a part. Pair with `part` to address one. */
  readonly id: number;
  readonly type: 'insert' | 'delete' | 'format';
  readonly author: string;
  readonly date: string;
  readonly part?: 'body' | 'footnote' | 'endnote';
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
