// Bounded table structure over the typed canonical tree.
//
// Reads `w:tbl`/`w:tr`/`w:tc` typed nodes plus their generic property subtrees into a plain
// bounded structure the table layout consumes. All widths leave here in POINTS — twips are
// converted once at this boundary, matching `geometryOfSection` and `paragraphIndent`.
//
// Every value below is attacker-controlled (a .docx is a zip of XML the author fully
// controls). `resolveColumnWidthsPt` bounds span and column counts before allocation and
// avoids spread over attacker-sized collections — note the claim list it consumes grows with
// the table's CELL count, not its column count, so it must never be spread or passed as
// varargs. Do not relax these limits: hostile inputs can otherwise trigger multi-gigabyte
// allocation attempts or spread-arity failures that vary by JavaScript engine.
//
// Widths resolve to a positive number or not at all. A column that no evidence settles takes
// a bounded share of what is left rather than zero, and no fit may scale a table below one
// point per column — a zero-width column is unrecoverable downstream.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core-contract/store';
import { shadingFillFromElement } from './ooxml-shading.ts';
import { revisionRemovesParagraph } from './revision-visibility.ts';
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
 * Soft ceiling on an authored `w:trHeight` (~22"). Hostile `w:val` otherwise becomes a
 * multi-page row that every pagination preflight and cell box inherits.
 */
export const MAX_TABLE_ROW_HEIGHT_PT = 31_680 / 20;

/**
 * `w:trPr/w:trHeight` (17.4.81) resolved for layout. Points leave the reader already —
 * twips convert once here, matching every other table geometry boundary.
 *
 * Word quirk (matches Form025U and Word's UI export): a present `@w:val` with an omitted
 * `@w:hRule` is treated as `atLeast`, not ECMA's `auto`. Explicit `auto` still ignores val.
 */
export type TableRowHeightRule = 'auto' | 'atLeast' | 'exact';

export type TableRowHeight =
  | { readonly rule: 'auto' }
  | { readonly rule: 'atLeast' | 'exact'; readonly valuePt: number };

/**
 * Soft ceiling on one grid column (~22", Word's widest page). `w:gridCol/@w:w` is the one
 * geometry number a file states that every cell box, row box and border stroke inherits, so
 * it is read and clamped exactly like `twipsSide` reads a margin.
 */
const MAX_COLUMN_WIDTH_PT = 31_680 / 20;

/** Highest grid column a cell may start on; keeps a row's total span bounded. */
const LAST_GRID_COLUMN = MAX_TABLE_COLUMNS - 1;

/**
 * `w:tblW` / `w:tcW` / `w:wBefore` (CT_TblWidth, 17.4.63 / 17.4.71 / 17.4.86): a PREFERRED
 * width plus the unit it is stated in. Preferred is the operative word — it is what the
 * producer asked for, not what the table resolved to.
 *
 * `pct` is stated in fiftieths of a percent (5000 = 100%) by Word, and in the `"50%"`
 * string form of `ST_Percentage` by others; both are read. `auto` and `nil` carry no width.
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

/** Points per unit for `ST_UniversalMeasure`'s suffixes (`pi` is a synonym for `pc`). */
const MEASURE_UNIT_PT: Readonly<Record<string, number>> = Object.freeze({
  mm: 72 / 25.4,
  cm: 72 / 2.54,
  in: 72,
  pt: 1,
  pc: 12,
  pi: 12,
});

/**
 * Bounded reader for `ST_MeasurementOrPercent` — the union `w:w` actually admits. Word
 * writes the plain twips form, but `ST_UniversalMeasure` (`2.5in`, `72pt`) and
 * `ST_Percentage` (`33.3%`, the form 17.4.71's own example uses) are equally valid, and
 * dropping them silently loses geometry a conformant producer stated.
 *
 * Every branch is anchored with a bounded quantifier: these run over attacker-controlled
 * attribute values and must not backtrack.
 */
function readMeasurementOrPercent(
  raw: string
):
  | { readonly kind: 'length'; readonly pt: number }
  | { readonly kind: 'percent'; readonly percent: number }
  | null {
  if (/^\d{1,9}$/.test(raw)) {
    const pt = Number(raw) / 20;
    return Number.isFinite(pt) ? { kind: 'length', pt } : null;
  }
  const percent = /^(\d{1,7}(?:\.\d{1,4})?)%$/.exec(raw);
  if (percent) {
    const value = Number(percent[1]);
    return Number.isFinite(value) ? { kind: 'percent', percent: value } : null;
  }
  const universal = /^(\d{1,9}(?:\.\d{1,4})?)(mm|cm|in|pt|pc|pi)$/.exec(raw);
  if (universal) {
    const pt = Number(universal[1]) * MEASURE_UNIT_PT[universal[2]!]!;
    return Number.isFinite(pt) ? { kind: 'length', pt } : null;
  }
  return null;
}

/**
 * Read a CT_TblWidth element, clamped exactly like `twipsSide`: every number here is
 * attacker-controlled and feeds cell box geometry.
 *
 * An absent `w:type` is `dxa` per 17.4.87 (the schema declares no default, the prose does).
 * An unrecognised type is NOT read as `dxa` — every sibling reader in this file rejects a
 * value it does not recognise rather than reinterpreting it, and reading `w:type="Pct"` as
 * an absolute measurement turns a 100% table into a 250pt one.
 *
 * 17.4.87 also settles the conflict case: where the type and the measurement `w:w` actually
 * states contradict each other, the measurement wins and the type is ignored.
 */
function readPreferredWidth(node: OoxmlElement | undefined): PreferredWidth {
  if (!node) return AUTO_PREFERRED_WIDTH;
  const rawType = attributeValue(node, 'type');
  if (rawType !== undefined && rawType !== 'pct' && rawType !== 'dxa') {
    return rawType === 'nil' ? { type: 'nil', value: 0 } : AUTO_PREFERRED_WIDTH;
  }

  const raw = attributeValue(node, 'w');
  if (raw === undefined) return AUTO_PREFERRED_WIDTH;
  const measure = readMeasurementOrPercent(raw);
  if (!measure) return AUTO_PREFERRED_WIDTH;

  // A bare number carries no unit of its own, so the type decides how to read it. A stated
  // `%` or `in` DOES carry one, and 17.4.87 says that statement overrides the type.
  const bare = /^\d{1,9}$/.test(raw);
  if (measure.kind === 'percent' || (bare && rawType === 'pct')) {
    const percent = measure.kind === 'percent' ? measure.percent : Number(raw) / 50;
    if (!Number.isFinite(percent) || percent <= 0) return AUTO_PREFERRED_WIDTH;
    return { type: 'pct', value: Math.min(percent, MAX_PREFERRED_PERCENT) };
  }
  if (!Number.isFinite(measure.pt) || measure.pt <= 0) return AUTO_PREFERRED_WIDTH;
  return { type: 'dxa', value: Math.min(measure.pt, MAX_COLUMN_WIDTH_PT) };
}

/** Distinct conditional-format combinations memoized per table; see `styleFormattingFor`. */
const MAX_CELL_CONDITION_SETS = 256;

export type CellVerticalAlign = 'top' | 'center' | 'bottom';

/** `w:tblPr/w:jc` (17.4.29, ST_JcTable): where the table sits within the text column. */
export type TableAlignment = 'left' | 'center' | 'right';

/**
 * Ceiling on `w:tblInd`, so a stated indent cannot push a table off the sheet. Read through
 * the same unsigned path as every other width here: a negative indent (Word pulls a table
 * into the margin with one) is rejected rather than applied.
 */
const MAX_TABLE_INDENT_PT = 31_680 / 20;

/** `w:tblPr/w:jc`, defaulting to left when absent or unrecognised. */
function readTableAlignment(container: OoxmlElement | undefined): TableAlignment | undefined {
  const jc = container && childNamed(container, 'jc');
  if (!jc) return undefined;
  const value = attributeValue(jc, 'val');
  // `start`/`end` are the strict-conformant spellings of `left`/`right`.
  if (value === 'center') return 'center';
  if (value === 'right' || value === 'end') return 'right';
  if (value === 'left' || value === 'start') return 'left';
  return undefined;
}

/** A CT_TblWidth read down to points, for the `dxa` geometry the placement reads use. */
function preferredLengthPt(node: OoxmlElement | undefined, limit: number): number | undefined {
  if (!node) return undefined;
  const width = readPreferredWidth(node);
  if (width.type !== 'dxa') return undefined;
  return Math.min(width.value, limit);
}

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
   * `w:tcW` — the width this cell asked for, as authored.
   *
   * Published for consumers that need the cell's own statement (a column-resize handle has
   * to write back to it). Column geometry is NOT derived from this field: the resolver works
   * from a flat claim list built in the same pass, because resolving a column means looking
   * at every cell that covers it across every row, not at one cell at a time. Read
   * `columnWidthsPt` for what the table actually laid out.
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
  /** `w:trPr/w:trHeight` — auto / atLeast floor / exact (clipped) row height. */
  readonly height: TableRowHeight;
  readonly cells: readonly SemanticTableCell[];
}

export interface SemanticTableStructure {
  readonly columnWidthsPt: readonly number[];
  readonly rows: readonly SemanticTableRow[];
  /** `w:tblPr/w:tblW` — the width the table asked for. */
  readonly tableWidth: PreferredWidth;
  /**
   * `w:tblInd` (17.4.50) in points — "this indentation should shift the table into the text
   * margin by the specified amount". Applies to a left-aligned table; `w:jc` decides the
   * placement outright for the other two.
   */
  readonly indentPt: number;
  /** `w:tblPr/w:jc` (17.4.29) — where the table sits in the text column. */
  readonly alignment: TableAlignment;
  /**
   * `w:tblCellSpacing` (17.4.45) in points: the gap between adjacent cell edges. Applied as
   * a half-gap inset on each side of every cell, so cells separate visually without the grid
   * itself moving. Word ALSO grows the table's overall width by the spacing it adds around
   * the outside; that part is not modelled, so a spaced table is laid out on the same grid
   * its file states rather than a wider one.
   */
  readonly cellSpacingPt: number;
  /**
   * `w:tblPr/w:tblLayout/@w:type="fixed"` (17.4.52 — 17.4.53 is the `w:tblPrEx` exception
   * variant, not this element). Fixed layout takes the grid as final;
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

const AUTO_ROW_HEIGHT: TableRowHeight = Object.freeze({ rule: 'auto' });

/**
 * Read `w:trHeight` (17.4.81). Hostile / unreadable values demote to auto so layout still
 * sizes from content rather than inventing geometry.
 */
function readRowHeight(rowProperties: OoxmlElement | undefined): TableRowHeight {
  const node = rowProperties && childNamed(rowProperties, 'trHeight');
  if (!node) return AUTO_ROW_HEIGHT;
  const rawRule = attributeValue(node, 'hRule');
  const rule: TableRowHeightRule | undefined =
    rawRule === 'auto' || rawRule === 'exact' || rawRule === 'atLeast' ? rawRule : undefined;
  if (rule === 'auto') return AUTO_ROW_HEIGHT;

  const rawVal = attributeValue(node, 'val');
  if (rawVal === undefined || !/^\d{1,9}$/.test(rawVal)) return AUTO_ROW_HEIGHT;
  const twips = Number(rawVal);
  if (!Number.isFinite(twips) || twips <= 0) return AUTO_ROW_HEIGHT;
  const valuePt = Math.min(twips / 20, MAX_TABLE_ROW_HEIGHT_PT);
  if (!(valuePt > 0)) return AUTO_ROW_HEIGHT;

  // Omitted hRule + present val → atLeast (Word), not ECMA's auto-with-ignored-val.
  const effective: 'atLeast' | 'exact' = rule === 'exact' ? 'exact' : 'atLeast';
  return { rule: effective, valuePt };
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
 * The INITIAL width of each grid column, or undefined for a column `w:tblGrid` does not
 * settle. 17.4.48 calls these the table's "default widths" and 17.4.16 is explicit that they
 * "determine the initial width of each grid column, which can then be overridden by ... the
 * preferred widths of specific cells" — so this is a seed, not the answer.
 *
 * Values are clamped exactly like `twipsSide`: `w="999999999"` otherwise becomes a
 * ~50,000,000pt column that every cell box and border stroke inherits. A column at or past
 * that ceiling is not geometry anyone authored — `MAX_COLUMN_WIDTH_PT` is wider than any
 * legal page — so it is dropped to undefined rather than kept as a 22-inch column that then
 * has to be exempted from every later fit. One unreadable column costs that column only; the
 * rest of the authored grid survives.
 */
function gridColumnWidthsPt(cols: readonly OoxmlElement[]): readonly (number | undefined)[] {
  const widths: (number | undefined)[] = [];
  for (const col of cols) {
    const raw = attributeValue(col, 'w');
    const measure = raw === undefined ? null : readMeasurementOrPercent(raw);
    if (!measure || measure.kind !== 'length' || !Number.isFinite(measure.pt) || measure.pt <= 0) {
      widths.push(undefined);
      continue;
    }
    widths.push(measure.pt > MAX_COLUMN_WIDTH_PT ? undefined : measure.pt);
  }
  return widths;
}

/** One cell's grid footprint and stated width preference. */
interface CellWidthClaim {
  readonly start: number;
  readonly span: number;
  readonly preferred: PreferredWidth;
}

/** Floor for a column nothing states, so a resolved grid never contains a zero column. */
const MIN_DERIVED_COLUMN_PT = 1;

/** Rounding slack when comparing a resolved table width against the content box. */
const WIDTH_EPSILON_PT = 0.001;

/**
 * Lay the authored `w:tcW` preferences over the seed grid.
 *
 * 17.18.87 describes exactly this reconciliation: a cell's `tcW` sets the width of the grid
 * columns its `gridSpan` covers, and "for each subsequent row ... each grid column is
 * adjusted to be the MAXIMUM value of the requested widths (if the widths do not agree)".
 * So a later row asking for more wins, and a narrower footprint is authoritative over a
 * spanning one — a span states the total across its columns, not any one column's width.
 *
 * Claims are applied narrowest-span-first so single-column statements land before the spans
 * that contain them; a span then distributes only the width its settled columns have not
 * already accounted for.
 */
function applyWidthClaims(
  seed: readonly (number | undefined)[],
  claims: readonly CellWidthClaim[],
  columnCount: number,
  tableWidthPt: number
): (number | undefined)[] {
  const settled: (number | undefined)[] = [];
  for (let index = 0; index < columnCount; index += 1) settled.push(seed[index]);

  // `.filter` already returns a fresh array, so this never mutates the caller's claims and
  // needs no spread — `claims` grows with the table's cell count and is attacker-sized.
  const ordered = claims
    .filter(
      (claim) =>
        claim.start < columnCount &&
        (claim.preferred.type === 'dxa' || (claim.preferred.type === 'pct' && tableWidthPt > 0))
    )
    .sort((a, b) => a.span - b.span);

  for (const claim of ordered) {
    const last = Math.min(claim.start + claim.span, columnCount);
    if (last <= claim.start) continue;
    // 17.4.71: a `pct` cell width is relative to the overall width of the TABLE.
    const stated =
      claim.preferred.type === 'pct'
        ? (tableWidthPt * claim.preferred.value) / 100
        : claim.preferred.value;
    if (!Number.isFinite(stated) || stated <= 0) continue;

    if (last - claim.start === 1) {
      // A single-column claim states that column outright; maximum wins across rows.
      const current = settled[claim.start];
      settled[claim.start] = current === undefined ? stated : Math.max(current, stated);
      continue;
    }
    // A span only gets to state the columns nothing narrower has settled, and only with
    // whatever of its total those settled columns leave over.
    const open: number[] = [];
    let remaining = stated;
    for (let index = claim.start; index < last; index += 1) {
      const current = settled[index];
      if (current === undefined) open.push(index);
      else remaining -= current;
    }
    if (open.length === 0 || remaining <= 0) continue;
    const each = remaining / open.length;
    for (const index of open) settled[index] = each;
  }
  return settled;
}

/**
 * The table's resolved column widths, in points.
 *
 * `w:tblGrid` seeds the columns, the authored `w:tcW`/`w:wBefore` preferences are laid over
 * it (see {@link applyWidthClaims}), and anything still unstated shares what the content
 * width has left. Columns never resolve to zero.
 *
 * Fit is then applied per 17.18.87. The table's total is measured against `w:tblW`, and
 * "if at any stage, the preferred width requested for the cells exceeds the preferred width
 * of the table, then each grid column is proportionally reduced in size to fit" — that
 * reduction belongs to BOTH layout algorithms, so a fixed table is still held to a stated
 * `w:tblW`. What is autofit-only is the PAGE clamp: 17.18.87 ends the autofit override chain
 * with "override the preferred table width until the table reaches the page width", and says
 * nothing of the sort for fixed. A fixed table with no `w:tblW` therefore renders past the
 * right margin, which is what Word does; an autofit table never exceeds the text column.
 *
 * A `pct` table width is a two-way instruction — it is Word's "AutoFit to Window", so a
 * table narrower than its stated percentage is stretched up to it as well as shrunk down.
 * An absolute or absent width only ever shrinks: a narrow autofit table is already showing
 * what Word shows, and stretching it would invent geometry no one authored.
 */
function resolveColumnWidthsPt(input: {
  readonly gridCols: readonly OoxmlElement[];
  readonly claims: readonly CellWidthClaim[];
  readonly columnCount: number;
  readonly contentWidthPt: number;
  readonly tableWidth: PreferredWidth;
  readonly layoutFixed: boolean;
}): readonly number[] {
  const { columnCount, tableWidth } = input;
  // A caller with a degenerate or non-finite content box has told us nothing about the page.
  // The authored grid is still perfectly good evidence on its own, so resolve from it and
  // skip the page clamp rather than scaling the table down to a sliver of a width that was
  // never a real measurement.
  const hasPage = Number.isFinite(input.contentWidthPt) && input.contentWidthPt > 0;
  const available = hasPage ? input.contentWidthPt : MIN_DERIVED_COLUMN_PT;

  // 17.4.63: a `pct` TABLE width is relative to the page's text extents, unlike `tcW`'s
  // basis, which is the table itself.
  const statedTableWidth =
    tableWidth.type === 'dxa'
      ? tableWidth.value
      : tableWidth.type === 'pct'
        ? (available * tableWidth.value) / 100
        : 0;

  const seed = gridColumnWidthsPt(input.gridCols);
  const settled = applyWidthClaims(seed, input.claims, columnCount, statedTableWidth);

  let stated = 0;
  let unsettled = 0;
  for (const width of settled) {
    if (width === undefined) unsettled += 1;
    else stated += width;
  }
  const resolved: number[] = [];
  if (unsettled > 0) {
    // Nothing states these columns. Give them what the content width has left over, capped
    // at the mean of the stated columns so a `w:gridBefore` band or one unstated column
    // cannot swallow the whole page, and floored so none collapses.
    const mean =
      stated > 0 ? stated / Math.max(columnCount - unsettled, 1) : available / columnCount;
    const leftover = Math.max(available - stated, 0) / unsettled;
    const each = Math.max(Math.min(leftover, mean), MIN_DERIVED_COLUMN_PT);
    for (const width of settled) resolved.push(width ?? each);
  } else {
    for (const width of settled) resolved.push(width!);
  }

  const total = resolved.reduce((sum, width) => sum + width, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return new Array<number>(columnCount).fill(available / columnCount);
  }

  // Never let a stated width crush the table to nothing. `w:tblW w:w="1"` is a hostile
  // instruction rather than a layout request, and a nested table inside a degenerate cell
  // would otherwise be scaled below the hairline `preferredColumnWidthsPt` guarantees. The
  // floor wins over the clamp: overflowing a 3pt cell is recoverable, a zero-width column is
  // not.
  const floor = columnCount * MIN_DERIVED_COLUMN_PT;
  const pageCap = input.layoutFixed || !hasPage ? Number.POSITIVE_INFINITY : available;
  const target = Math.max(
    statedTableWidth > 0 ? Math.min(statedTableWidth, pageCap) : Math.min(total, pageCap),
    floor
  );

  // Only a `pct` table width stretches a narrow table up to its target.
  const stretches = tableWidth.type === 'pct' && statedTableWidth > 0;
  if (total <= target + WIDTH_EPSILON_PT && !stretches) return resolved;
  if (Math.abs(total - target) <= WIDTH_EPSILON_PT) return resolved;
  const scale = target / total;
  return resolved.map((width) => width * scale);
}

/**
 * Where a table's left edge sits inside the box that contains it.
 *
 * 17.4.50 puts a left-aligned table at `w:tblInd` from the leading margin. 17.4.29's other
 * two placements are stated relative to the containing box instead, so the indent does not
 * also apply to them — Word centres a centred table in the text column whatever indent the
 * file carries. A table wider than its container starts flush so its leading edge stays on
 * the page rather than being centred off it.
 */
export function tableOriginX(structure: SemanticTableStructure, containerWidthPt: number): number {
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  const slack = containerWidthPt - width;
  if (!Number.isFinite(slack) || slack <= 0) return 0;
  if (structure.alignment === 'center') return slack / 2;
  if (structure.alignment === 'right') return slack;
  return Math.min(structure.indentPt, slack);
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
    const gridBefore = Math.min(readGridSkip(properties, 'gridBefore'), LAST_GRID_COLUMN);
    // 17.18.87: "the initial number of grid units before the row starts is skipped. The
    // width of the skipped grid columns is set using the wBefore property." Without this the
    // skipped band is a column nothing states, and it absorbs the leftover as a phantom
    // gutter wider than the cells it precedes.
    if (gridBefore > 0) {
      claims.push({
        start: 0,
        span: gridBefore,
        preferred: readPreferredWidth(properties && childNamed(properties, 'wBefore')),
      });
    }
    let cursor = gridBefore;
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
    const gridAfter = readGridSkip(properties, 'gridAfter');
    const gridColumns = Math.min(cursor + gridAfter, MAX_TABLE_COLUMNS);
    // 17.4.85, the trailing counterpart of `w:wBefore`.
    if (gridAfter > 0 && cursor < MAX_TABLE_COLUMNS) {
      claims.push({
        start: cursor,
        span: Math.min(gridAfter, MAX_TABLE_COLUMNS - cursor),
        preferred: readPreferredWidth(properties && childNamed(properties, 'wAfter')),
      });
    }
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
      // Read alongside its siblings, before `cellIndex` moves on — the plan loop and this
      // one skip the same non-cell children, and the indices must stay in lockstep.
      const preferredWidth = plan.preferred[cellIndex] ?? AUTO_PREFERRED_WIDTH;
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
        // A paragraph a tracked revision has removed claims a full line box while rendering
        // nothing; a cell of them is a stack of blank lines that pushes the rest of the table
        // down the page.
        if (child.kind === 'paragraph' && revisionRemovesParagraph(child)) continue;
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
        preferredWidth,
        styleFormatting: styleFormattingFor(conditions),
        blocks,
      });
    }
    rows.push({
      id: rowNode.id,
      isHeader: readFlag(rowProperties, 'tblHeader'),
      cantSplit: readFlag(rowProperties, 'cantSplit'),
      height: readRowHeight(rowProperties),
      cells,
    });
  }

  // `w:tblW` and `w:tblLayout` both live in CT_TblPrBase, which is what a table STYLE's
  // `w:tblPr` carries — the same reason `tblCellMar` and `tblBorders` cascade above. A style
  // that states "AutoFit to Window" or fixed layout is stating it for every table that names
  // it. 17.4.52: an absent `w:tblLayout` means autofit.
  let styleTableWidth = AUTO_PREFERRED_WIDTH;
  let styleLayoutFixed: boolean | undefined;
  let styleIndentPt: number | undefined;
  let styleAlignment: TableAlignment | undefined;
  let styleCellSpacingPt: number | undefined;
  for (const node of tableStyle.tablePropertyNodes) {
    const styleW = childNamed(node, 'tblW');
    if (styleW) styleTableWidth = readPreferredWidth(styleW);
    const styleLayout = childNamed(node, 'tblLayout');
    if (styleLayout) styleLayoutFixed = attributeValue(styleLayout, 'type') === 'fixed';
    styleIndentPt =
      preferredLengthPt(childNamed(node, 'tblInd'), MAX_TABLE_INDENT_PT) ?? styleIndentPt;
    styleAlignment = readTableAlignment(node) ?? styleAlignment;
    styleCellSpacingPt =
      preferredLengthPt(childNamed(node, 'tblCellSpacing'), MAX_CELL_MARGIN_PT) ??
      styleCellSpacingPt;
  }
  const ownTblW = tblPr && childNamed(tblPr, 'tblW');
  const tableWidth = ownTblW ? readPreferredWidth(ownTblW) : styleTableWidth;
  const tblLayout = tblPr && childNamed(tblPr, 'tblLayout');
  const layoutFixed = tblLayout
    ? attributeValue(tblLayout, 'type') === 'fixed'
    : (styleLayoutFixed ?? false);
  const indentPt =
    preferredLengthPt(tblPr && childNamed(tblPr, 'tblInd'), MAX_TABLE_INDENT_PT) ??
    styleIndentPt ??
    0;
  const alignment = readTableAlignment(tblPr) ?? styleAlignment ?? 'left';
  const cellSpacingPt =
    preferredLengthPt(tblPr && childNamed(tblPr, 'tblCellSpacing'), MAX_CELL_MARGIN_PT) ??
    styleCellSpacingPt ??
    0;

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
    indentPt,
    alignment,
    cellSpacingPt,
    tableBorders,
    defaultMargins,
  };
}
