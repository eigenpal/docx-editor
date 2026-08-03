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

/**
 * `w:tblW` / `w:tcW` (CT_TblWidth, 17.4.87): a PREFERRED width plus the unit it is stated
 * in. Preferred is the operative word — it is what the producer asked for, not what the
 * table resolved to. `w:tblGrid` carries the resolved grid, and where the two disagree the
 * grid wins for any table that has one.
 *
 * `pct` is stated in fiftieths of a percent (5000 = 100%), and older producers write the
 * `"50%"` string form instead; both are read. `auto` and `nil` carry no width.
 */
export type PreferredWidthType = 'dxa' | 'pct' | 'auto' | 'nil';

export interface PreferredWidth {
  readonly type: PreferredWidthType;
  /** POINTS for `dxa`, PERCENT (0–100) for `pct`, 0 for `auto`/`nil`. */
  readonly value: number;
}

export const AUTO_PREFERRED_WIDTH: PreferredWidth = Object.freeze({ type: 'auto', value: 0 });

/** Widest a `pct` preference may resolve to, so `w:w="999999"` cannot inflate a table. */
const MAX_PREFERRED_PERCENT = 100;

/**
 * Read a CT_TblWidth element. Digits-only and clamped exactly like `twipsSide`: every
 * number here is attacker-controlled and feeds cell box geometry.
 *
 * A missing `w:type` means `dxa` per the schema default, but a missing `w:w` means the
 * element states nothing at all, which is `auto`.
 */
function readPreferredWidth(node: OoxmlElement | undefined): PreferredWidth {
  if (!node) return AUTO_PREFERRED_WIDTH;
  const rawType = attributeValue(node, 'type');
  const type: PreferredWidthType =
    rawType === 'pct' || rawType === 'auto' || rawType === 'nil' || rawType === 'dxa'
      ? rawType
      : 'dxa';
  if (type === 'auto' || type === 'nil') return { type, value: 0 };

  const raw = attributeValue(node, 'w');
  if (raw === undefined) return AUTO_PREFERRED_WIDTH;

  if (type === 'pct') {
    // `"50%"` (string form) or `2500` (fiftieths of a percent).
    const asString = /^(\d{1,7})%$/.exec(raw);
    const percent = asString
      ? Number(asString[1])
      : /^\d{1,7}$/.test(raw)
        ? Number(raw) / 50
        : Number.NaN;
    if (!Number.isFinite(percent) || percent <= 0) return AUTO_PREFERRED_WIDTH;
    return { type: 'pct', value: Math.min(percent, MAX_PREFERRED_PERCENT) };
  }

  if (!/^\d{1,9}$/.test(raw)) return AUTO_PREFERRED_WIDTH;
  const pt = Number(raw) / 20;
  if (!Number.isFinite(pt) || pt <= 0) return AUTO_PREFERRED_WIDTH;
  return { type: 'dxa', value: Math.min(pt, MAX_COLUMN_WIDTH_PT) };
}

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
   * `w:tcW` — the width this cell ASKED for. Only consulted where `w:tblGrid` cannot
   * settle the geometry (absent or degenerate grid); a table that states a grid has already
   * resolved its columns and the grid wins. See `resolveColumnWidthsPt`.
   */
  readonly preferredWidth: PreferredWidth;
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
  /** `w:tblPr/w:tblW` — the width the table asked for. */
  readonly tableWidth: PreferredWidth;
  /**
   * `w:tblPr/w:tblLayout/@w:type="fixed"` (17.4.53). Fixed layout takes the grid as final;
   * anything else is autofit, which in Word never renders wider than the text column.
   */
  readonly layoutFixed: boolean;
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
 * Column widths from `w:tblGrid` alone, or null when the grid cannot settle them.
 *
 * Digits only and clamped, exactly like `twipsSide`: `w="999999999"` otherwise becomes a
 * ~50,000,000pt column that every cell box and border stroke inherits. A single unreadable
 * `w:gridCol` no longer poisons one column with an even-split guess — the whole grid is
 * rejected and the caller falls back to the authored `w:tcW` preferences instead, which is
 * the better evidence about what the producer meant.
 */
function gridColumnWidthsPt(
  cols: readonly OoxmlElement[]
): { readonly widths: readonly number[]; readonly clamped: boolean } | null {
  if (cols.length === 0) return null;
  const widths: number[] = [];
  let clamped = false;
  for (const col of cols) {
    const raw = attributeValue(col, 'w');
    if (raw === undefined || !/^\d{1,9}$/.test(raw)) return null;
    const pt = Number(raw) / 20;
    if (!Number.isFinite(pt) || pt <= 0) return null;
    if (pt > MAX_COLUMN_WIDTH_PT) {
      clamped = true;
      widths.push(MAX_COLUMN_WIDTH_PT);
    } else {
      widths.push(pt);
    }
  }
  return { widths, clamped };
}

/** One cell's grid footprint and stated width preference, for the no-grid fallback. */
interface CellWidthClaim {
  readonly start: number;
  readonly span: number;
  readonly preferred: PreferredWidth;
}

/**
 * Column widths derived from `w:tcW` when there is no usable `w:tblGrid`.
 *
 * Producers that omit `w:tblGrid` state their geometry entirely in `w:tcW`, and an even
 * split over the column count throws all of it away. Each column takes the first definite
 * `dxa` claim covering it, narrowest footprint first so a `gridSpan` cell never overwrites
 * a column some single-column cell already stated. A spanning claim splits evenly across
 * the columns it covers that nothing else has settled. Columns still unclaimed share
 * whatever is left of the content width, and never go to zero.
 */
function preferredColumnWidthsPt(
  claims: readonly CellWidthClaim[],
  columnCount: number,
  contentWidthPt: number
): readonly number[] | null {
  const settled = new Array<number>(columnCount).fill(0);
  const ordered = [...claims]
    .filter((claim) => claim.preferred.type === 'dxa' && claim.start < columnCount)
    .sort((a, b) => a.span - b.span);
  if (ordered.length === 0) return null;

  for (const claim of ordered) {
    const last = Math.min(claim.start + claim.span, columnCount);
    const open: number[] = [];
    for (let index = claim.start; index < last; index += 1)
      if (settled[index] === 0) open.push(index);
    if (open.length === 0) continue;
    // A spanning cell states the width of its whole footprint, so only the part not already
    // accounted for by narrower claims is what these columns get to share.
    let remaining = claim.preferred.value;
    for (let index = claim.start; index < last; index += 1) remaining -= settled[index]!;
    if (remaining <= 0) continue;
    const each = remaining / open.length;
    for (const index of open) settled[index] = each;
  }

  const stated = settled.reduce((total, width) => total + width, 0);
  if (stated <= 0) return null;
  const unsettled = settled.filter((width) => width === 0).length;
  if (unsettled === 0) return settled;
  // Nothing stated these columns. Give them what the content width has left over, or a
  // hairline when the stated columns already fill it, so no column collapses to zero.
  const leftover = Math.max(contentWidthPt - stated, unsettled * MIN_DERIVED_COLUMN_PT);
  const each = leftover / unsettled;
  return settled.map((width) => (width === 0 ? each : width));
}

/** Floor for a column nothing states, so a derived grid never contains a zero column. */
const MIN_DERIVED_COLUMN_PT = 1;

/** Rounding slack when comparing a resolved table width against the content box. */
const WIDTH_EPSILON_PT = 0.001;

/**
 * The table's resolved column widths, in points.
 *
 * Order of evidence: `w:tblGrid` (the producer's own resolved grid) beats `w:tcW` (what
 * cells asked for) beats an even split. The grid is the resolved answer for any table that
 * has one, so reading `w:tcW` does NOT mean overriding a stated grid with it — for a
 * well-formed file the two agree, and where they disagree the grid is the later statement.
 *
 * Fit is then applied per 17.4.53. A `w:tblLayout w:type="fixed"` table takes its grid as
 * final and is left alone: Word genuinely renders a fixed table past the right margin
 * rather than shrinking it, so clamping one here would DIVERGE from Word. Every other
 * table is autofit, which in Word never renders wider than the text column, so an autofit
 * grid wider than the content box is scaled down proportionally.
 *
 * Scaling only ever shrinks. Stretching a narrow table up to `w:tblW` is a separate
 * question with its own compatibility surface, and an autofit table that is narrower than
 * the page is already showing what Word shows.
 */
function resolveColumnWidthsPt(input: {
  readonly gridCols: readonly OoxmlElement[];
  readonly claims: readonly CellWidthClaim[];
  readonly columnCount: number;
  readonly contentWidthPt: number;
  readonly tableWidth: PreferredWidth;
  readonly layoutFixed: boolean;
}): readonly number[] {
  const { columnCount, contentWidthPt } = input;
  const available = Math.max(contentWidthPt, MIN_DERIVED_COLUMN_PT);

  const grid = gridColumnWidthsPt(input.gridCols);
  const resolved =
    grid?.widths ??
    preferredColumnWidthsPt(input.claims, columnCount, available) ??
    new Array<number>(columnCount).fill(available / columnCount);

  const total = resolved.reduce((sum, width) => sum + width, 0);
  if (total <= 0) return new Array<number>(columnCount).fill(available / columnCount);
  // Fixed layout states that the grid IS the geometry, overflow included.
  if (input.layoutFixed) return resolved;
  // A column so wide it had to be clamped is not geometry anyone authored, and a fit
  // derived from it would let one hostile `w:gridCol` shrink every legitimate column in the
  // table. The clamp already bounds the damage to that one column; leave its siblings be.
  if (grid?.clamped === true) return resolved;

  const target =
    input.tableWidth.type === 'dxa'
      ? Math.min(input.tableWidth.value, available)
      : input.tableWidth.type === 'pct'
        ? Math.min((available * input.tableWidth.value) / 100, available)
        : available;
  if (total <= target + WIDTH_EPSILON_PT) return resolved;
  const scale = target / total;
  return resolved.map((width) => width * scale);
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
    readonly preferred: readonly PreferredWidth[];
    readonly gridColumns: number;
  }
  const plans: RowPlan[] = [];
  const claims: CellWidthClaim[] = [];
  let derivedColumns = 1;
  for (const rowNode of table.children) {
    if (rowNode.kind !== 'tableRow') continue;
    const properties = childNamed(rowNode, 'trPr');
    const starts: number[] = [];
    const spans: number[] = [];
    const preferred: PreferredWidth[] = [];
    let cursor = Math.min(readGridSkip(properties, 'gridBefore'), LAST_GRID_COLUMN);
    for (const cellNode of rowNode.children) {
      if (cellNode.kind !== 'tableCell') continue;
      const cellPr = childNamed(cellNode, 'tcPr');
      const start = Math.min(cursor, LAST_GRID_COLUMN);
      const span = Math.min(
        readGridSpan(cellPr),
        MAX_TABLE_COLUMNS - start // ≥ 1: `start` never exceeds the last column
      );
      const width = readPreferredWidth(cellPr && childNamed(cellPr, 'tcW'));
      starts.push(start);
      spans.push(span);
      preferred.push(width);
      claims.push({ start, span, preferred: width });
      cursor = start + span;
    }
    const gridColumns = Math.min(cursor + readGridSkip(properties, 'gridAfter'), MAX_TABLE_COLUMNS);
    if (gridColumns > derivedColumns) derivedColumns = gridColumns;
    plans.push({ node: rowNode, properties, starts, spans, preferred, gridColumns });
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
        preferredWidth: plan.preferred[cellIndex - 1] ?? AUTO_PREFERRED_WIDTH,
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

  const tableWidth = readPreferredWidth(tblPr && childNamed(tblPr, 'tblW'));
  const tblLayout = tblPr && childNamed(tblPr, 'tblLayout');
  const layoutFixed = tblLayout ? attributeValue(tblLayout, 'type') === 'fixed' : false;

  return {
    columnWidthsPt: resolveColumnWidthsPt({
      gridCols,
      claims,
      columnCount,
      contentWidthPt,
      tableWidth,
      layoutFixed,
    }),
    rows,
    tableWidth,
    layoutFixed,
    tableBorders,
    defaultMargins,
  };
}
