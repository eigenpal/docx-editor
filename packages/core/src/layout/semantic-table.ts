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
  EMPTY_TABLE_CELL_STYLE_FORMATTING,
  EMPTY_TABLE_FORMATTING,
  cascadeTableFormatting,
  tableCellStyleFormatting,
  type StyleCascadeTable,
  type TableCellStyleFormatting,
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

/**
 * Soft ceiling on one grid column (~22", Word's widest page). `w:gridCol/@w:w` is the one
 * geometry number a file states that every cell box, row box and border stroke inherits, so
 * it is read and clamped exactly like `twipsSide` reads a margin.
 */
const MAX_COLUMN_WIDTH_PT = 31_680 / 20;

/** Highest grid column a cell may start on; keeps a row's total span bounded. */
const LAST_GRID_COLUMN = MAX_TABLE_COLUMNS - 1;

/** Distinct conditional-format combinations memoized per table; see `styleFormattingFor`. */
const MAX_CELL_CONDITION_SETS = 256;

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
  /**
   * Absolute grid column this cell starts on, after `w:gridBefore` and every preceding
   * span. Structural conditional formats and cell geometry both key on this, never on the
   * cell's position in the row: one `gridSpan` cell otherwise shifts firstCol/lastCol and
   * the vertical bands for every cell after it.
   */
  readonly gridColumn: number;
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
  /**
   * What the table style says about this cell's paragraphs and runs (17.7.6.6) — a header
   * row's bold and centring live here, not in the cell's own properties.
   */
  readonly styleFormatting: TableCellStyleFormatting;
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

/** `w:gridBefore` / `w:gridAfter` (17.4.14 / 17.4.13): grid columns the row leaves empty. */
function readGridSkip(rowProperties: OoxmlElement | undefined, localName: string): number {
  const raw = rowProperties && childNamed(rowProperties, localName);
  const value = raw && attributeValue(raw, 'val');
  if (!value || !/^\d{1,7}$/.test(value)) return 0;
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? Math.min(count, MAX_TABLE_COLUMNS) : 0;
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

/** Declared `w:gridCol` elements, bounded before anything is allocated from them. */
function gridColumnElements(table: OoxmlElement): readonly OoxmlElement[] {
  const grid = childNamed(table, 'tblGrid');
  if (!grid) return [];
  const cols: OoxmlElement[] = [];
  for (const child of grid.children) {
    if (child.kind !== 'textValue' && child.localName === 'gridCol') {
      cols.push(child);
      if (cols.length >= MAX_TABLE_COLUMNS) break;
    }
  }
  return cols;
}

/**
 * Column widths in points: from `w:tblGrid` when present, else an even split over the
 * hardened column count. The no-grid path is the security-sensitive one — see header.
 */
function columnWidthsPt(
  cols: readonly OoxmlElement[],
  columnCount: number,
  contentWidthPt: number
): readonly number[] {
  if (cols.length > 0) {
    return cols.map((col) => {
      // Digits only and clamped, exactly like `twipsSide`: `w="999999999"` otherwise
      // becomes a ~50,000,000pt column that every cell box and border stroke inherits.
      const raw = attributeValue(col, 'w');
      if (raw === undefined || !/^\d{1,9}$/.test(raw)) return contentWidthPt / cols.length;
      const pt = Number(raw) / 20;
      if (!Number.isFinite(pt) || pt <= 0) return contentWidthPt / cols.length;
      return pt > MAX_COLUMN_WIDTH_PT ? MAX_COLUMN_WIDTH_PT : pt;
    });
  }
  const width = contentWidthPt / columnCount;
  const widths: number[] = [];
  for (let index = 0; index < columnCount; index += 1) widths.push(width);
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

/**
 * No `w:tblLook` at all says exactly what an empty `<w:tblLook/>` says. `noHBand`/`noVBand`
 * are NEGATIVE flags and the legacy bitmask defaults to `0000`, so 17.4.56's default is to
 * apply row and column banding but neither the first/last row nor the first/last column
 * format. Reading the absent element as "nothing is live" made the same semantic state
 * render two different ways depending on whether the producer wrote the empty tag.
 */
const DEFAULT_TABLE_LOOK: TableLook = Object.freeze({
  firstRow: false,
  lastRow: false,
  firstColumn: false,
  lastColumn: false,
  rowBanding: true,
  columnBanding: true,
});

function onOff(node: OoxmlElement, name: string): boolean | undefined {
  const raw = attributeValue(node, name);
  if (raw === undefined) return undefined;
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

/**
 * `w:tblLook` is read from the TABLE's own `w:tblPr` only, never cascaded from the style it
 * names. The schema admits `w:tblLook` inside a table style's `w:tblPr`, but the look is
 * Word's per-table "Table Style Options" checkbox set — a property of this table's use of
 * the style, not of the style — and Word writes one on every table it creates.
 */
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

/** Bit positions of `w:cnfStyle/@w:val` (17.4.7 row, 17.4.8 cell), most significant first. */
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

/** The same twelve conditions as named `w:cnfStyle` attributes (CT_Cnf), in bit order. */
const CNF_ATTRIBUTES = [
  'firstRow',
  'lastRow',
  'firstColumn',
  'lastColumn',
  'oddVBand',
  'evenVBand',
  'oddHBand',
  'evenHBand',
  'firstRowFirstColumn',
  'firstRowLastColumn',
  'lastRowFirstColumn',
  'lastRowLastColumn',
] as const;

/**
 * `w:cnfStyle`: the producer stating which conditions a row or cell is under.
 *
 * Read like `w:tblLook`, from both encodings — the legacy `w:val` bitmask and the named
 * attributes, which are all a strict-conformant producer writes.
 */
function readCnfStyle(container: OoxmlElement | undefined, into: Set<string>): void {
  const cnf = container && childNamed(container, 'cnfStyle');
  if (!cnf) return;
  const raw = attributeValue(cnf, 'val');
  if (raw && /^[01]{1,12}$/.test(raw)) {
    for (let index = 0; index < raw.length && index < CNF_BITS.length; index += 1) {
      if (raw[index] === '1') into.add(CNF_BITS[index]!);
    }
  }
  for (let index = 0; index < CNF_ATTRIBUTES.length; index += 1) {
    if (onOff(cnf, CNF_ATTRIBUTES[index]!) === true) into.add(CNF_BITS[index]!);
  }
}

/**
 * Word layers a table style's conditional formats weakest first: the whole table, then the
 * bands, then first/last column, then first/last row, then the four corners (17.7.6). Both
 * the derived and the stated conditions emit through this one order — `w:cnfStyle` lists
 * its conditions in BIT order, which puts the bands last and let a banding fill overwrite
 * the shading of a styled header row.
 */
const CONDITION_PRECEDENCE = [
  'band1Vert',
  'band2Vert',
  'band1Horz',
  'band2Horz',
  'firstCol',
  'lastCol',
  'firstRow',
  'lastRow',
  'nwCell',
  'neCell',
  'swCell',
  'seCell',
] as const;

/**
 * Which of the style's conditional formats apply to one cell, weakest first.
 *
 * A `w:cnfStyle` is added to the derivation rather than replacing it: it is a cache the
 * producer wrote, and a row that states "I am the header" is still in whichever column and
 * band the grid puts it in. Structural conditions key on the GRID COLUMN the cell occupies,
 * so a `gridSpan` or a `w:gridBefore` earlier in the row cannot shift them.
 */
function conditionalTypesFor(input: {
  readonly look: TableLook;
  readonly rowIndex: number;
  readonly rowCount: number;
  readonly gridColumn: number;
  readonly gridSpan: number;
  readonly columnCount: number;
  readonly rowProperties: OoxmlElement | undefined;
  readonly cellProperties: OoxmlElement | undefined;
}): readonly string[] {
  const active = new Set<string>();
  readCnfStyle(input.rowProperties, active);
  readCnfStyle(input.cellProperties, active);

  const { look, rowIndex, rowCount, gridColumn, gridSpan, columnCount } = input;
  const isFirstRow = active.has('firstRow') || (look.firstRow && rowIndex === 0);
  const isLastRow = active.has('lastRow') || (look.lastRow && rowIndex === rowCount - 1);
  const isFirstColumn = active.has('firstCol') || (look.firstColumn && gridColumn === 0);
  const isLastColumn =
    active.has('lastCol') || (look.lastColumn && gridColumn + gridSpan >= columnCount);

  const statedVBand = active.has('band1Vert') || active.has('band2Vert');
  if (!statedVBand && look.columnBanding && !isFirstColumn && !isLastColumn) {
    const band = gridColumn - (look.firstColumn ? 1 : 0);
    active.add(band % 2 === 0 ? 'band1Vert' : 'band2Vert');
  }
  const statedHBand = active.has('band1Horz') || active.has('band2Horz');
  if (!statedHBand && look.rowBanding && !isFirstRow && !isLastRow) {
    const band = rowIndex - (look.firstRow ? 1 : 0);
    active.add(band % 2 === 0 ? 'band1Horz' : 'band2Horz');
  }
  if (isFirstColumn) active.add('firstCol');
  if (isLastColumn) active.add('lastCol');
  if (isFirstRow) active.add('firstRow');
  if (isLastRow) active.add('lastRow');
  if (isFirstRow && isFirstColumn) active.add('nwCell');
  if (isFirstRow && isLastColumn) active.add('neCell');
  if (isLastRow && isFirstColumn) active.add('swCell');
  if (isLastRow && isLastColumn) active.add('seCell');

  const ordered: string[] = [];
  for (const condition of CONDITION_PRECEDENCE) if (active.has(condition)) ordered.push(condition);
  return ordered;
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

  // Cells under the same conditions resolve to the same paragraph/run material, and a table
  // has few distinct condition sets. Memoized per table so a 10k-cell table flattens the
  // style chain a handful of times, not once per cell. A hostile `w:cnfStyle` can still name
  // up to 4096 distinct sets, so the memo stops growing at the ceiling and later cells simply
  // resolve unmemoized — same bounded per-cell work either way.
  const styleByConditions = new Map<string, TableCellStyleFormatting>();
  const styleFormattingFor = (conditions: readonly string[]): TableCellStyleFormatting => {
    if (tableStyle === EMPTY_TABLE_FORMATTING) return EMPTY_TABLE_CELL_STYLE_FORMATTING;
    const key = conditions.join('|');
    const cached = styleByConditions.get(key);
    if (cached) return cached;
    const resolved = tableCellStyleFormatting(tableStyle, conditions);
    if (styleByConditions.size < MAX_CELL_CONDITION_SETS) styleByConditions.set(key, resolved);
    return resolved;
  };

  // Grid pass. Every cell's absolute grid column, and the table's column count, are settled
  // before any conditional format is derived — both key on the grid, not on cell order. A
  // cell may start no later than the last column and may not span past it, which is what
  // bounds a ROW's total span: per-cell `w:gridSpan` is already clamped, but a row of
  // thousands of maximum-span cells would otherwise walk millions of grid intervals in the
  // border pass. Fails closed like the ownership and vMerge budgets: the overflow cells
  // pile onto the last column instead of extending the grid.
  interface RowPlan {
    readonly node: OoxmlElement;
    readonly properties: OoxmlElement | undefined;
    readonly starts: readonly number[];
    readonly spans: readonly number[];
    readonly gridColumns: number;
  }
  const plans: RowPlan[] = [];
  let derivedColumns = 1;
  for (const rowNode of table.children) {
    if (rowNode.kind !== 'tableRow') continue;
    const properties = childNamed(rowNode, 'trPr');
    const starts: number[] = [];
    const spans: number[] = [];
    let cursor = Math.min(readGridSkip(properties, 'gridBefore'), LAST_GRID_COLUMN);
    for (const cellNode of rowNode.children) {
      if (cellNode.kind !== 'tableCell') continue;
      const start = Math.min(cursor, LAST_GRID_COLUMN);
      const span = Math.min(
        readGridSpan(childNamed(cellNode, 'tcPr')),
        MAX_TABLE_COLUMNS - start // ≥ 1: `start` never exceeds the last column
      );
      starts.push(start);
      spans.push(span);
      cursor = start + span;
    }
    const gridColumns = Math.min(cursor + readGridSkip(properties, 'gridAfter'), MAX_TABLE_COLUMNS);
    if (gridColumns > derivedColumns) derivedColumns = gridColumns;
    plans.push({ node: rowNode, properties, starts, spans, gridColumns });
  }

  const gridCols = gridColumnElements(table);
  const columnCount = gridCols.length > 0 ? gridCols.length : derivedColumns;
  const bodyRows = plans.length;

  const rows: SemanticTableRow[] = [];
  for (let rowIndex = 0; rowIndex < plans.length; rowIndex += 1) {
    const plan = plans[rowIndex]!;
    const rowNode = plan.node;
    const rowProperties = plan.properties;
    let cellIndex = 0;
    const cells: SemanticTableCell[] = [];
    for (const cellNode of rowNode.children) {
      if (cellNode.kind !== 'tableCell') continue;
      const cellProperties = childNamed(cellNode, 'tcPr');
      const gridColumn = plan.starts[cellIndex]!;
      const gridSpan = plan.spans[cellIndex]!;
      const conditions = conditionalTypesFor({
        look,
        rowIndex,
        rowCount: bodyRows,
        gridColumn,
        gridSpan,
        columnCount,
        // A producer may state the conditions itself rather than leave them to be derived.
        rowProperties,
        cellProperties,
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
        gridSpan,
        gridColumn,
        vMergeContinue: readVMergeContinue(cellProperties),
        vAlign: readVAlign(cellProperties),
        margins: cellMargins,
        borders: mergeCellBorders(
          conditionalBorders,
          cellProperties ? readCellBorders(cellProperties) : EMPTY_CELL_BORDER_BOX
        ),
        ...(shading === undefined ? {} : { shading }),
        styleFormatting: styleFormattingFor(conditions),
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
    columnWidthsPt: columnWidthsPt(gridCols, columnCount, contentWidthPt),
    rows,
    tableBorders,
    defaultMargins,
  };
}
