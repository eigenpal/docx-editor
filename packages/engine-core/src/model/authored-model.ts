// Canonical authored package model (document-engine task 2.9 / design D1 /
// lossless-package-model "Authored package state is canonical"). This is the one
// source of truth: editable stories, authored properties where `undefined` means
// OMITTED (inherit) — never a materialized resolved value — stable identities,
// content types, relationships, styles, numbering, and parts. Resolved
// styles/numbering/fields/layout live only in derived caches (sections 3, 8),
// never here.

import type { ContentTypeRecords, RelationshipRecord } from '../package/index.ts';

/** Run formatting. Every field is optional: absent = authored omission (inherit). */
export interface RunProps {
  readonly styleId?: string;
  readonly bold?: boolean; // explicit true/false is authored; undefined = omitted
  readonly italic?: boolean;
  readonly underline?: boolean;
}

export interface RunRecord {
  /** Present only where anchoring requires a stable run identity. */
  readonly id?: string;
  readonly text: string;
  readonly props?: RunProps;
}

export interface ParagraphProps {
  readonly styleId?: string;
  readonly numId?: string;
  readonly ilvl?: number;
}

export interface ParagraphRecord {
  readonly kind: 'paragraph';
  readonly id: string;
  readonly runs: readonly RunRecord[];
  readonly props?: ParagraphProps;
}

// --- Tables (task 2.7 / fidelity slice 1, ADR-S10). Structural preservation:
// rows, cells, grid/column widths, borders, shading, merges, repeated headers, and
// nested blocks survive import -> model -> serialize -> reopen. Every field is an
// authored value where present; `undefined` means OMITTED (inherit). Measured
// values keep their RAW LEXICAL string so authored distinctions never round-trip
// through a number.
//
// Preservation of unknown OOXML is NOT done by putting raw XML on these records, and
// NOT by a per-block fragment string (a fragment loses the root's namespace
// declarations, inter-block whitespace, and sibling order). Instead the COMPLETE
// original text of each source part is retained (`PackageModel.preservation`), and
// each preservable block records a character RANGE into that part plus a baseline
// semantic hash. Serialization starts from the original part text and re-emits only
// the ranges whose block's current semantic hash differs from its baseline; every
// untouched range — and all the root context, whitespace, and siblings around it — is
// emitted verbatim, so an unedited document is byte-identical. Until table/cell
// editing can reserialize a changed range, such edits MUST fail closed. ---

/** A single border edge. Applies to table edges (w:top/bottom/left/right/start/end/
 *  insideH/insideV) and cell diagonals (w:tl2br/w:tr2bl). Lexical sz/space are kept raw. */
export interface BorderEdge {
  readonly style?: string; // w:val, e.g. 'single' | 'none' | 'double'
  readonly sz?: string; // raw w:sz (eighths of a point), lexical
  readonly space?: string; // raw w:space (points), lexical
  readonly color?: string; // w:color hex 'RRGGBB' or 'auto'
  readonly themeColor?: string; // w:themeColor (theme provenance preserved)
}

export interface Borders {
  readonly top?: BorderEdge;
  readonly bottom?: BorderEdge;
  readonly left?: BorderEdge; // w:left (legacy physical)
  readonly right?: BorderEdge; // w:right (legacy physical)
  readonly start?: BorderEdge; // w:start (logical/bidi-aware)
  readonly end?: BorderEdge; // w:end (logical/bidi-aware)
  readonly insideH?: BorderEdge; // table only
  readonly insideV?: BorderEdge; // table only
  readonly tl2br?: BorderEdge; // cell diagonal, top-left to bottom-right
  readonly tr2bl?: BorderEdge; // cell diagonal, top-right to bottom-left
}

/** Cell/table shading (w:shd). */
export interface Shading {
  readonly val?: string; // pattern, e.g. 'clear' | 'solid'
  readonly fill?: string; // hex fill 'RRGGBB' or 'auto'
  readonly color?: string; // hex pattern color or 'auto'
  readonly themeFill?: string; // w:themeFill
  readonly themeColor?: string; // w:themeColor
}

/** A measured width (w:tblW / w:tcW / w:tblInd / w:tblCellSpacing / margins). The
 *  value is the RAW lexical w:w string; type is the raw w:type token. */
export interface TableWidth {
  readonly type?: string; // 'dxa' | 'pct' | 'auto' | 'nil' (raw, lossless)
  readonly value?: string; // raw w:w lexical, e.g. '0' | '5000' | '2.5%'
}

/** Cell margins (w:tcMar) or table default cell margins (w:tblCellMar). */
export interface CellMargins {
  readonly top?: TableWidth;
  readonly bottom?: TableWidth;
  readonly left?: TableWidth;
  readonly right?: TableWidth;
  readonly start?: TableWidth;
  readonly end?: TableWidth;
}

export interface TableProps {
  readonly styleId?: string; // w:tblStyle
  readonly width?: TableWidth; // w:tblW
  readonly alignment?: string; // w:jc
  readonly indent?: TableWidth; // w:tblInd (table indent from margin)
  readonly layout?: string; // w:tblLayout w:type ('fixed' | 'autofit')
  readonly cellSpacing?: TableWidth; // w:tblCellSpacing
  readonly cellMargins?: CellMargins; // w:tblCellMar (default cell margins)
  readonly borders?: Borders; // w:tblBorders
  readonly shading?: Shading; // w:shd
  readonly look?: string; // w:tblLook w:val
  readonly bidiVisual?: boolean; // w:bidiVisual (RTL table)
}

/** Per-row exception table properties (w:tblPrEx) — override the table defaults. */
export interface TablePropsEx {
  readonly width?: TableWidth;
  readonly indent?: TableWidth;
  readonly layout?: string;
  readonly cellSpacing?: TableWidth;
  readonly cellMargins?: CellMargins;
  readonly borders?: Borders;
  readonly shading?: Shading;
  readonly alignment?: string;
}

export interface TableRowProps {
  readonly isHeader?: boolean; // w:tblHeader — repeat this row atop each page
  readonly cantSplit?: boolean; // w:cantSplit
  readonly height?: string; // raw w:trHeight w:val (twips), lexical
  readonly heightRule?: string; // w:trHeight w:hRule ('auto' | 'atLeast' | 'exact')
  readonly gridBefore?: number; // w:gridBefore (grid columns skipped before first cell)
  readonly gridAfter?: number; // w:gridAfter (grid columns skipped after last cell)
  readonly widthBefore?: TableWidth; // w:wBefore
  readonly widthAfter?: TableWidth; // w:wAfter
  readonly cellSpacing?: TableWidth; // w:tblCellSpacing (row level)
  readonly tblPrEx?: TablePropsEx; // w:tblPrEx
}

/** Vertical-merge state (w:vMerge). The object's PRESENCE means a <w:vMerge> element
 *  exists; `val` undefined = a bare <w:vMerge/> (implicit continue), which MUST stay
 *  distinguishable from an explicit w:val="continue". */
export interface VMerge {
  readonly val?: string; // 'restart' | 'continue' | undefined (bare element)
}

export interface TableCellProps {
  readonly width?: TableWidth; // w:tcW
  readonly gridSpan?: number; // w:gridSpan — horizontal merge span
  readonly vMerge?: VMerge; // w:vMerge — vertical merge (see VMerge)
  readonly borders?: Borders; // w:tcBorders (incl. tl2br/tr2bl diagonals)
  readonly shading?: Shading; // w:shd
  readonly vAlign?: string; // w:vAlign ('top' | 'center' | 'bottom')
  readonly margins?: CellMargins; // w:tcMar
  readonly noWrap?: boolean; // w:noWrap
  readonly textDirection?: string; // w:textDirection
  readonly fitText?: boolean; // w:tcFitText
}

export interface TableCellRecord {
  readonly id: string;
  /** Nested block content — paragraphs and, recursively, tables. */
  readonly blocks: readonly Block[];
  readonly props?: TableCellProps;
}

export interface TableRowRecord {
  readonly id: string;
  readonly cells: readonly TableCellRecord[];
  readonly props?: TableRowProps;
}

/** A grid column (w:gridCol). `w` is the RAW lexical width, optional. */
export interface GridColumn {
  readonly w?: string;
}

export interface TableRecord {
  readonly kind: 'table';
  readonly id: string;
  readonly rows: readonly TableRowRecord[];
  readonly grid?: readonly GridColumn[]; // w:tblGrid
  readonly props?: TableProps;
}

// SDT and other block kinds still land later; the union stays open.
export type Block = ParagraphRecord | TableRecord;

export type StoryKind = 'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'comment' | 'textbox';

export interface Story {
  readonly id: string;
  readonly kind: StoryKind;
  readonly blocks: readonly Block[];
}

export interface StyleRecord {
  readonly id: string;
  readonly name: string;
  readonly type: 'paragraph' | 'character' | 'table' | 'numbering';
  readonly isDefault?: boolean;
}

export interface NumberingRecord {
  readonly numId: string;
  readonly abstractId: string;
}

export type PartRecord =
  | { readonly kind: 'xml'; readonly partName: string; readonly storyId?: string }
  | { readonly kind: 'media'; readonly partName: string; readonly bytesRef?: string };

/** Serializable allocator cursors — part of the model so IDs are stable across reopen. */
export interface IdentityState {
  readonly cursors: Readonly<Record<string, number>>;
}

export interface PackageModel {
  readonly contentTypes: ContentTypeRecords;
  readonly relationships: readonly RelationshipRecord[];
  readonly stories: ReadonlyMap<string, Story>;
  readonly styles: readonly StyleRecord[];
  readonly numbering: readonly NumberingRecord[];
  readonly parts: ReadonlyMap<string, PartRecord>;
  readonly identity: IdentityState;
  /** Original-part text plus per-block source ranges for lossless re-emit (see below). */
  readonly preservation?: PreservationState;
}

/** Source range of one preservable block within a retained original part. */
export interface BlockRange {
  readonly partName: string; // key into PreservationState.originalParts
  readonly start: number; // inclusive character offset in the original part text
  readonly end: number; // exclusive character offset
  /** Semantic hash of the block at parse time; a differing current hash = edited,
   *  so the range must be reserialized rather than reused verbatim (invalidation). */
  readonly baselineHash: string;
}

/**
 * Snapshot-owned lossless-preservation state. `originalParts` holds each source
 * part's COMPLETE original text verbatim (namespaces, whitespace, sibling order
 * intact); `blockRanges` maps a preservable block id to its character range in that
 * text plus a baseline hash. Serialization starts from the original part and patches
 * only ranges whose block hash changed.
 */
export interface PreservationState {
  readonly originalParts: ReadonlyMap<string, string>;
  readonly blockRanges: ReadonlyMap<string, BlockRange>;
  /**
   * Verbatim bytes of EVERY original package part (canonical part name -> bytes),
   * retained so `writeDocx` can re-emit the whole package losslessly — the main
   * document part is patched from `originalParts`/`blockRanges`, every other part
   * (styles, rels, media, headers, ...) is re-emitted byte-for-byte.
   */
  readonly packageParts?: ReadonlyMap<string, Uint8Array>;
}

// Standard OOXML/OPC relationship type URIs used by create-from-scratch.
export const REL_TYPES = {
  officeDocument:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
} as const;

export const CONTENT_TYPES = {
  relationships: 'application/vnd.openxmlformats-package.relationships+xml',
  xml: 'application/xml',
  documentMain: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  styles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
} as const;
