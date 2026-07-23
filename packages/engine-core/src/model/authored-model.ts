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
// Preservation of unknown OOXML is NOT done by putting raw XML on these records
// (neither scattered `preserved` strings nor a whole-subtree string): a semantic
// record cannot reliably restore the original position/namespace context of unknown
// children that way. Instead each record carries an opaque `source: SourceRef` into
// the ORIGINAL token tree, which is retained SEPARATELY (populated by the parser,
// task 3.1). On save, untouched (non-dirty) ranges are reused verbatim from that
// tree and only owned/edited ranges are patched. The retained-tree container and
// patch-on-save land with the parser/serializer step. ---

/** Opaque, stable reference from a semantic record to its origin in the separately
 *  retained original OOXML token tree. Lets serialization reuse untouched source
 *  ranges verbatim and patch only owned regions. Assigned by the parser. */
export interface SourceRef {
  readonly part: string; // owning part name, e.g. '/word/document.xml'
  readonly path: readonly number[]; // child-index path to the origin node in that part's tree
}

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
  readonly source?: SourceRef; // origin in the retained tree (cell-granular reuse)
}

export interface TableRowRecord {
  readonly id: string;
  readonly cells: readonly TableCellRecord[];
  readonly props?: TableRowProps;
  readonly source?: SourceRef; // origin in the retained tree (row-granular reuse)
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
  /** Origin of this table in the separately-retained original token tree. While the
   *  table is not dirty, serialize reuses that source range verbatim (lossless). */
  readonly source?: SourceRef;
  /** Set once an edit mutates the table; a dirty table reserializes from the fields. */
  readonly dirty?: boolean;
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
