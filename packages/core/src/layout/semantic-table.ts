// Bounded table structure over the typed canonical tree.
//
// Reads `w:tbl`/`w:tr`/`w:tc` typed nodes plus their generic property subtrees into a plain
// bounded structure the table layout consumes. All widths leave here in POINTS — twips are
// converted once at this boundary, matching `geometryOfSection` and `paragraphIndent`.
//
// Every value below is attacker-controlled (a .docx is a zip of XML the author fully
// controls). `columnWidthsPt` bounds span and column counts before allocation and avoids
// spread over attacker-sized collections. Do not relax these limits: hostile inputs can
// otherwise trigger multi-gigabyte allocation attempts or spread-arity failures that vary
// by JavaScript engine.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core-contract/store';
import { shadingFillFromElement } from './ooxml-shading.ts';
import {
  EMPTY_CELL_BORDER_BOX,
  EMPTY_TABLE_BORDER_BOX,
  readCellBorders,
  readTableBorders,
  type CellBorderBox,
  type TableBorderBox,
} from './table-borders.ts';

/** Far above anything Word authors (its UI caps at 63) while keeping allocation bounded. */
export const MAX_TABLE_COLUMNS = 1024;

/**
 * Layout-time nesting ceiling. Parse-time depth (MAX_DEPTH = 256 XML levels) alone still
 * admits ~80 levels of `w:tbl` recursion into the layout walk; deeper tables render as an
 * empty cell box rather than recursing.
 */
export const MAX_TABLE_NESTING = 16;

/**
 * Fallback cell padding in points (60 twips) when neither `tblCellMar` nor `tcMar` authors
 * a side. Matches the historical uniform `CELL_PAD` inset.
 */
export const CELL_PAD = 3;

/** Soft ceiling on a single margin side (~22"). */
const MAX_CELL_MARGIN_PT = 31_680 / 20;

export type CellVerticalAlign = 'top' | 'center' | 'bottom';

export interface CellMarginsPt {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const DEFAULT_CELL_MARGINS: CellMarginsPt = {
  top: CELL_PAD,
  right: CELL_PAD,
  bottom: CELL_PAD,
  left: CELL_PAD,
};

export interface SemanticTableCell {
  readonly id: string;
  /** Clamped to [1, MAX_TABLE_COLUMNS] at read time; layout never re-derives it. */
  readonly gridSpan: number;
  /** A vMerge cell that is not the restart continues the cell above: box, no content. */
  readonly vMergeContinue: boolean;
  /** `w:vAlign` — defaults to top when omitted/unrecognised. */
  readonly vAlign: CellVerticalAlign;
  /** Resolved per-side margins (tcMar over tblCellMar over CELL_PAD). */
  readonly margins: CellMarginsPt;
  /** Three-state authored `tcBorders` (omitted / none / edge). */
  readonly borders: CellBorderBox;
  /** Validated 6-hex shading fill, absent for none/auto. */
  readonly shading?: string;
  /** Block children in reading order: `paragraph` and `table` typed nodes only. */
  readonly blocks: readonly OoxmlElement[];
}

export interface SemanticTableRow {
  readonly id: string;
  /** `w:trPr/w:tblHeader` — the row repeats atop each page the table continues onto. */
  readonly isHeader: boolean;
  readonly cells: readonly SemanticTableCell[];
}

export interface SemanticTableStructure {
  readonly columnWidthsPt: readonly number[];
  readonly rows: readonly SemanticTableRow[];
  /** Table-level `tblBorders` (three-state, including insideH/insideV). */
  readonly tableBorders: TableBorderBox;
  /** Table-level `tblCellMar` defaults (per-side, CELL_PAD when a side is omitted). */
  readonly defaultMargins: CellMarginsPt;
}

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function readGridSpan(cellProperties: OoxmlElement | undefined): number {
  const raw = cellProperties && childNamed(cellProperties, 'gridSpan');
  const value = raw && attributeValue(raw, 'val');
  if (!value || !/^\d{1,7}$/.test(value)) return 1;
  const span = Number(value);
  return Number.isInteger(span) && span > 1 ? Math.min(span, MAX_TABLE_COLUMNS) : 1;
}

function readVMergeContinue(cellProperties: OoxmlElement | undefined): boolean {
  const vMerge = cellProperties && childNamed(cellProperties, 'vMerge');
  if (!vMerge) return false;
  // Explicit "continue" or a bare <w:vMerge/> continues; only "restart" starts a cell.
  return attributeValue(vMerge, 'val') !== 'restart';
}

function readVAlign(cellProperties: OoxmlElement | undefined): CellVerticalAlign {
  const node = cellProperties && childNamed(cellProperties, 'vAlign');
  const value = node && attributeValue(node, 'val');
  if (value === 'center') return 'center';
  if (value === 'bottom') return 'bottom';
  return 'top';
}

function readShading(cellProperties: OoxmlElement | undefined): string | undefined {
  return shadingFillFromElement(cellProperties && childNamed(cellProperties, 'shd'));
}

function readFlag(container: OoxmlElement | undefined, localName: string): boolean {
  const flag = container && childNamed(container, localName);
  if (!flag) return false;
  const value = attributeValue(flag, 'val');
  return value !== '0' && value !== 'false';
}

function twipsSide(node: OoxmlElement | undefined): number | undefined {
  if (!node) return undefined;
  const raw = attributeValue(node, 'w');
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return undefined;
  const twips = Number(raw);
  if (!Number.isFinite(twips) || twips < 0) return undefined;
  const pt = twips / 20;
  return pt > MAX_CELL_MARGIN_PT ? MAX_CELL_MARGIN_PT : pt;
}

/**
 * Read `tblCellMar` / `tcMar`. Each omitted side stays undefined so callers can fall back
 * per-side (tcMar → tblCellMar → CELL_PAD).
 */
function readMarginSides(
  container: OoxmlElement | undefined
): Partial<CellMarginsPt> {
  if (!container) return {};
  const top = twipsSide(childNamed(container, 'top'));
  const left = twipsSide(childNamed(container, 'left'));
  const bottom = twipsSide(childNamed(container, 'bottom'));
  const right = twipsSide(childNamed(container, 'right'));
  return {
    ...(top === undefined ? {} : { top }),
    ...(left === undefined ? {} : { left }),
    ...(bottom === undefined ? {} : { bottom }),
    ...(right === undefined ? {} : { right }),
  };
}

function mergeMargins(
  tableDefaults: CellMarginsPt,
  cellOverride: Partial<CellMarginsPt>
): CellMarginsPt {
  return {
    top: cellOverride.top ?? tableDefaults.top,
    right: cellOverride.right ?? tableDefaults.right,
    bottom: cellOverride.bottom ?? tableDefaults.bottom,
    left: cellOverride.left ?? tableDefaults.left,
  };
}

function readDefaultMargins(tblPr: OoxmlElement | undefined): CellMarginsPt {
  const authored = readMarginSides(tblPr && childNamed(tblPr, 'tblCellMar'));
  return mergeMargins(DEFAULT_CELL_MARGINS, authored);
}

/**
 * Column widths in points: from `w:tblGrid` when present, else an even split over the
 * hardened column count. The no-grid path is the security-sensitive one — see header.
 */
function columnWidthsPt(
  table: OoxmlElement,
  rows: readonly SemanticTableRow[],
  contentWidthPt: number
): readonly number[] {
  const grid = childNamed(table, 'tblGrid');
  if (grid) {
    const cols: OoxmlElement[] = [];
    for (const child of grid.children) {
      if (child.kind !== 'textValue' && child.localName === 'gridCol') cols.push(child);
    }
    if (cols.length > 0) {
      const bounded = cols.slice(0, MAX_TABLE_COLUMNS);
      return bounded.map((col) => {
        const raw = attributeValue(col, 'w');
        const twips = raw !== undefined ? Number(raw) : NaN;
        return Number.isFinite(twips) && twips > 0 ? twips / 20 : contentWidthPt / bounded.length;
      });
    }
  }
  // Fold, never spread; per-cell span clamped BEFORE it is summed; total clamped.
  let colCount = 1;
  for (const row of rows) {
    let rowCols = 0;
    for (const cell of row.cells) {
      rowCols += cell.gridSpan; // already clamped by readGridSpan
      if (rowCols >= MAX_TABLE_COLUMNS) break;
    }
    if (rowCols > colCount) colCount = rowCols;
    if (colCount >= MAX_TABLE_COLUMNS) {
      colCount = MAX_TABLE_COLUMNS;
      break;
    }
  }
  const width = contentWidthPt / colCount;
  const widths: number[] = [];
  for (let index = 0; index < colCount; index += 1) widths.push(width);
  return widths;
}

/**
 * Read one typed table node into a bounded structure, or null when the node is not a
 * typed table or sits beyond the nesting ceiling.
 */
export function readTableStructure(
  table: OoxmlNode,
  contentWidthPt: number,
  depth: number
): SemanticTableStructure | null {
  if (depth >= MAX_TABLE_NESTING) return null;
  if (table.kind !== 'table') return null;

  const tblPr = childNamed(table, 'tblPr');
  const defaultMargins = readDefaultMargins(tblPr);
  const tableBorders = tblPr ? readTableBorders(tblPr) : EMPTY_TABLE_BORDER_BOX;

  const rows: SemanticTableRow[] = [];
  for (const rowNode of table.children) {
    if (rowNode.kind !== 'tableRow') continue;
    const rowProperties = childNamed(rowNode, 'trPr');
    const cells: SemanticTableCell[] = [];
    for (const cellNode of rowNode.children) {
      if (cellNode.kind !== 'tableCell') continue;
      const cellProperties = childNamed(cellNode, 'tcPr');
      const shading = readShading(cellProperties);
      const cellMargins = mergeMargins(
        defaultMargins,
        readMarginSides(cellProperties && childNamed(cellProperties, 'tcMar'))
      );
      const blocks: OoxmlElement[] = [];
      for (const child of cellNode.children) {
        if (child.kind === 'paragraph' || child.kind === 'table') blocks.push(child);
      }
      cells.push({
        id: cellNode.id,
        gridSpan: readGridSpan(cellProperties),
        vMergeContinue: readVMergeContinue(cellProperties),
        vAlign: readVAlign(cellProperties),
        margins: cellMargins,
        borders: cellProperties ? readCellBorders(cellProperties) : EMPTY_CELL_BORDER_BOX,
        ...(shading === undefined ? {} : { shading }),
        blocks,
      });
    }
    rows.push({ id: rowNode.id, isHeader: readFlag(rowProperties, 'tblHeader'), cells });
  }

  return {
    columnWidthsPt: columnWidthsPt(table, rows, contentWidthPt),
    rows,
    tableBorders,
    defaultMargins,
  };
}
