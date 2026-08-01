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
  EMPTY_TABLE_FORMATTING,
  cascadeTableFormatting,
  type StyleCascadeTable,
} from './style-cascade.ts';
import { mergeCellBorders, mergeTableBorders } from './table-border-cascade.ts';
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
  /**
   * `w:trPr/w:cantSplit` — the row must stay on one page. When it cannot fit a fresh page,
   * layout fails closed rather than fragmenting or overflowing the content box.
   */
  readonly cantSplit: boolean;
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
function readMarginSides(container: OoxmlElement | undefined): Partial<CellMarginsPt> {
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
 * `w:tblLook` (17.4.56): which conditional formats of the table style are live.
 *
 * Word writes both the modern attributes (`w:firstRow="1"`) and the legacy `w:val`
 * bitmask, and older producers write only the bitmask. Both are read; an attribute wins
 * where the two disagree, because that is the newer statement.
 */
interface TableLook {
  readonly firstRow: boolean;
  readonly lastRow: boolean;
  readonly firstColumn: boolean;
  readonly lastColumn: boolean;
  readonly rowBanding: boolean;
  readonly columnBanding: boolean;
}

const DEFAULT_TABLE_LOOK: TableLook = Object.freeze({
  firstRow: false,
  lastRow: false,
  firstColumn: false,
  lastColumn: false,
  rowBanding: false,
  columnBanding: false,
});

function onOff(node: OoxmlElement, name: string): boolean | undefined {
  const raw = attributeValue(node, name);
  if (raw === undefined) return undefined;
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function readTableLook(tblPr: OoxmlElement | undefined): TableLook {
  const look = tblPr && childNamed(tblPr, 'tblLook');
  if (!look) return DEFAULT_TABLE_LOOK;
  // The legacy bitmask: 0x0020 firstRow, 0x0040 lastRow, 0x0080 firstColumn,
  // 0x0100 lastColumn, 0x0200 NO row banding, 0x0400 NO column banding.
  const rawVal = attributeValue(look, 'val');
  const mask = rawVal && /^[0-9A-Fa-f]{1,4}$/.test(rawVal) ? Number.parseInt(rawVal, 16) : 0;
  return {
    firstRow: onOff(look, 'firstRow') ?? (mask & 0x0020) !== 0,
    lastRow: onOff(look, 'lastRow') ?? (mask & 0x0040) !== 0,
    firstColumn: onOff(look, 'firstColumn') ?? (mask & 0x0080) !== 0,
    lastColumn: onOff(look, 'lastColumn') ?? (mask & 0x0100) !== 0,
    rowBanding:
      onOff(look, 'noHBand') === undefined ? (mask & 0x0200) === 0 : !onOff(look, 'noHBand'),
    columnBanding:
      onOff(look, 'noVBand') === undefined ? (mask & 0x0400) === 0 : !onOff(look, 'noVBand'),
  };
}

/** `w:cnfStyle`: the producer stating which conditions a row or cell is under. */
function readCnfStyle(container: OoxmlElement | undefined): string | undefined {
  const cnf = container && childNamed(container, 'cnfStyle');
  return cnf ? attributeValue(cnf, 'val') : undefined;
}

/** Bit positions of `w:cnfStyle/@w:val` (17.4.7), most significant first. */
const CNF_BITS = [
  'firstRow',
  'lastRow',
  'firstCol',
  'lastCol',
  'band1Vert',
  'band2Vert',
  'band1Horz',
  'band2Horz',
  'nwCell',
  'neCell',
  'swCell',
  'seCell',
] as const;

function cnfConditions(raw: string | undefined): readonly string[] {
  if (!raw || !/^[01]{1,12}$/.test(raw)) return [];
  const active: string[] = [];
  for (let index = 0; index < raw.length && index < CNF_BITS.length; index += 1) {
    if (raw[index] === '1') active.push(CNF_BITS[index]!);
  }
  return active;
}

/**
 * Which of the style's conditional formats apply to one cell, weakest first.
 *
 * Word's precedence runs banding, then column, then row, then corner — so a first-row cell
 * takes the header look over the band it happens to sit in. An explicit `w:cnfStyle`
 * replaces the derivation entirely: the producer already did it.
 */
function conditionalTypesFor(input: {
  readonly look: TableLook;
  readonly rowIndex: number;
  readonly rowCount: number;
  readonly cellIndex: number;
  readonly cellCount: number;
  readonly rowCnf: string | undefined;
  readonly cellCnf: string | undefined;
}): readonly string[] {
  const stated = [...cnfConditions(input.rowCnf), ...cnfConditions(input.cellCnf)];
  if (stated.length > 0) return stated;

  const { look, rowIndex, rowCount, cellIndex, cellCount } = input;
  const isFirstRow = look.firstRow && rowIndex === 0;
  const isLastRow = look.lastRow && rowCount > 1 && rowIndex === rowCount - 1;
  const isFirstColumn = look.firstColumn && cellIndex === 0;
  const isLastColumn = look.lastColumn && cellCount > 1 && cellIndex === cellCount - 1;

  const active: string[] = [];
  if (look.columnBanding && !isFirstColumn && !isLastColumn) {
    const band = cellIndex - (look.firstColumn ? 1 : 0);
    active.push(band % 2 === 0 ? 'band1Vert' : 'band2Vert');
  }
  if (look.rowBanding && !isFirstRow && !isLastRow) {
    const band = rowIndex - (look.firstRow ? 1 : 0);
    active.push(band % 2 === 0 ? 'band1Horz' : 'band2Horz');
  }
  if (isFirstColumn) active.push('firstCol');
  if (isLastColumn) active.push('lastCol');
  if (isFirstRow) active.push('firstRow');
  if (isLastRow) active.push('lastRow');
  if (isFirstRow && isFirstColumn) active.push('nwCell');
  if (isFirstRow && isLastColumn) active.push('neCell');
  if (isLastRow && isFirstColumn) active.push('swCell');
  if (isLastRow && isLastColumn) active.push('seCell');
  return active;
}

/**
 * Read one typed table node into a bounded structure, or null when the node is not a
 * typed table or sits beyond the nesting ceiling.
 */
export function readTableStructure(
  table: OoxmlNode,
  contentWidthPt: number,
  depth: number,
  styleCascade?: StyleCascadeTable
): SemanticTableStructure | null {
  if (depth >= MAX_TABLE_NESTING) return null;
  if (table.kind !== 'table') return null;

  const tblPr = childNamed(table, 'tblPr');
  // A table's appearance mostly lives in its STYLE. Word writes
  // `<w:tblStyle w:val="TableGrid"/>` and keeps the grid in styles.xml, so reading the
  // table's own `w:tblPr` alone draws a borderless table where Word draws a full grid.
  const styleId =
    tblPr && childNamed(tblPr, 'tblStyle')
      ? attributeValue(childNamed(tblPr, 'tblStyle')!, 'val')
      : undefined;
  const tableStyle = styleCascade
    ? cascadeTableFormatting(styleCascade, styleId)
    : EMPTY_TABLE_FORMATTING;
  const look = readTableLook(tblPr);

  let styleMargins = DEFAULT_CELL_MARGINS;
  let styleBorders = EMPTY_TABLE_BORDER_BOX;
  for (const node of tableStyle.tablePropertyNodes) {
    styleMargins = mergeMargins(styleMargins, readMarginSides(childNamed(node, 'tblCellMar')));
    styleBorders = mergeTableBorders(styleBorders, readTableBorders(node));
  }
  const defaultMargins = mergeMargins(
    styleMargins,
    readMarginSides(tblPr && childNamed(tblPr, 'tblCellMar'))
  );
  const tableBorders = mergeTableBorders(
    styleBorders,
    tblPr ? readTableBorders(tblPr) : EMPTY_TABLE_BORDER_BOX
  );

  const bodyRowIndex = new Map<string, number>();
  let bodyRows = 0;
  for (const rowNode of table.children) {
    if (rowNode.kind !== 'tableRow') continue;
    bodyRowIndex.set(rowNode.id, bodyRows);
    bodyRows += 1;
  }

  const rows: SemanticTableRow[] = [];
  for (const rowNode of table.children) {
    if (rowNode.kind !== 'tableRow') continue;
    const rowProperties = childNamed(rowNode, 'trPr');
    const rowIndex = bodyRowIndex.get(rowNode.id) ?? 0;
    let cellIndex = 0;
    let cellCount = 0;
    for (const child of rowNode.children) if (child.kind === 'tableCell') cellCount += 1;
    const cells: SemanticTableCell[] = [];
    for (const cellNode of rowNode.children) {
      if (cellNode.kind !== 'tableCell') continue;
      const cellProperties = childNamed(cellNode, 'tcPr');
      const conditions = conditionalTypesFor({
        look,
        rowIndex,
        rowCount: bodyRows,
        cellIndex,
        cellCount,
        // A producer may state the conditions itself rather than leave them to be derived.
        rowCnf: readCnfStyle(rowProperties),
        cellCnf: readCnfStyle(cellProperties),
      });
      cellIndex += 1;
      let conditionalShading: string | undefined;
      let conditionalBorders = EMPTY_CELL_BORDER_BOX;
      for (const conditionType of conditions) {
        const format = tableStyle.conditional.get(conditionType);
        if (!format) continue;
        const conditionTcPr = childNamed(format, 'tcPr');
        conditionalShading = readShading(conditionTcPr) ?? conditionalShading;
        conditionalBorders = mergeCellBorders(conditionalBorders, readCellBorders(conditionTcPr));
      }
      const shading = readShading(cellProperties) ?? conditionalShading;
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
        borders: mergeCellBorders(
          conditionalBorders,
          cellProperties ? readCellBorders(cellProperties) : EMPTY_CELL_BORDER_BOX
        ),
        ...(shading === undefined ? {} : { shading }),
        blocks,
      });
    }
    rows.push({
      id: rowNode.id,
      isHeader: readFlag(rowProperties, 'tblHeader'),
      cantSplit: readFlag(rowProperties, 'cantSplit'),
      cells,
    });
  }

  return {
    columnWidthsPt: columnWidthsPt(table, rows, contentWidthPt),
    rows,
    tableBorders,
    defaultMargins,
  };
}
