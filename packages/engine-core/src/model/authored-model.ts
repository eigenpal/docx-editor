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
// authored value where present; `undefined` means OMITTED (inherit). Unmodeled
// OOXML children are kept verbatim in `preserved` so round-trip is lossless. ---

/** A single border edge (w:top/left/bottom/right/insideH/insideV, w:tcBorders...). */
export interface BorderEdge {
  readonly style?: string; // w:val, e.g. 'single' | 'none' | 'double'
  readonly sz?: number; // width in eighths of a point
  readonly space?: number; // padding in points
  readonly color?: string; // hex 'RRGGBB' or 'auto'
}

export interface Borders {
  readonly top?: BorderEdge;
  readonly left?: BorderEdge;
  readonly bottom?: BorderEdge;
  readonly right?: BorderEdge;
  readonly insideH?: BorderEdge;
  readonly insideV?: BorderEdge;
}

/** Cell/table shading (w:shd). */
export interface Shading {
  readonly val?: string; // pattern, e.g. 'clear' | 'solid'
  readonly fill?: string; // hex fill 'RRGGBB' or 'auto'
  readonly color?: string; // hex pattern color or 'auto'
}

/** A measured width (w:tblW / w:tcW): a value plus its unit. */
export interface TableWidth {
  readonly value?: number;
  readonly type?: 'dxa' | 'pct' | 'auto' | 'nil';
}

export interface TableProps {
  readonly styleId?: string; // w:tblStyle
  readonly width?: TableWidth; // w:tblW
  readonly alignment?: string; // w:jc
  readonly borders?: Borders; // w:tblBorders
  readonly shading?: Shading; // w:shd
  readonly look?: string; // w:tblLook w:val
  /** Verbatim XML of unmodeled w:tblPr children, preserved for lossless round-trip. */
  readonly preserved?: readonly string[];
}

export interface TableRowProps {
  readonly isHeader?: boolean; // w:tblHeader — repeat this row atop each page
  readonly cantSplit?: boolean; // w:cantSplit
  readonly height?: number; // w:trHeight w:val (twips)
  readonly heightRule?: string; // w:trHeight w:hRule ('auto' | 'atLeast' | 'exact')
  readonly preserved?: readonly string[]; // verbatim unmodeled w:trPr children
}

export interface TableCellProps {
  readonly width?: TableWidth; // w:tcW
  readonly gridSpan?: number; // w:gridSpan — horizontal merge span
  readonly vMerge?: 'restart' | 'continue'; // w:vMerge — vertical merge
  readonly borders?: Borders; // w:tcBorders
  readonly shading?: Shading; // w:shd
  readonly vAlign?: string; // w:vAlign ('top' | 'center' | 'bottom')
  readonly preserved?: readonly string[]; // verbatim unmodeled w:tcPr children
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

export interface TableRecord {
  readonly kind: 'table';
  readonly id: string;
  readonly rows: readonly TableRowRecord[];
  /** w:tblGrid column widths in twips (drives column layout). */
  readonly grid?: readonly number[];
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
