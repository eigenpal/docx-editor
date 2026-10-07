import type { SemanticTableCell, SemanticTableRow, TableAlignment } from './semantic-table.ts';
import type { PreferredWidthType } from './table-widths.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

const SIMPLE_SIDE_STYLES = ['single', 'thick'];

/**
 * Mode-15 table width types that take one side-rule geometry.
 *
 * Captured left, right and centred fixed-layout controls, and centred autofit controls,
 * drawn with `w:tblW w:type="auto"` put every stroke and text edge where the matching `dxa`
 * control does. A wrapped cell line in an `auto` table confirms the reclaimed content width.
 * A `pct` table stays outside until controls cover it.
 */
const MODERN_GRID_WIDTH_TYPES: readonly PreferredWidthType[] = ['dxa', 'auto'];

/**
 * True when a cell's authored side rules are the shared-grid-line shape.
 *
 * ONE qualifying side is enough. Requiring both made the rule depend on whether the cell
 * happened to own the opposite edge, which `w:insideV` never gives the first or last column:
 * a captured control at `w:sz="24"` over columns at 72/192/312/432 shows the reference
 * centring EVERY vertical rule on its line — 70.56, 190.56, 310.56, 430.56, each exactly half
 * a width left of its boundary — while we drew the first one flush at 192.00 and only the
 * interior one centred, so a table disagreed with itself. See `.cache/pdf/claude-vrule/`.
 *
 * Both sides still have to agree when both are present; a cell whose two edges differ in
 * width is not the shared-line shape this describes.
 */
function sharesSideRuleGridLine(cell: SemanticTableCell, simpleSidesOnly = false): boolean {
  const { left, right } = cell.contentBorders ?? cell.borders;
  // Modern admission does not extend the simple-rule controls to an opposite compound rule.
  if (
    simpleSidesOnly &&
    [left, right].some((edge) => edge.state === 'edge' && !SIMPLE_SIDE_STYLES.includes(edge.style))
  )
    return false;
  const leftRule = left.state === 'edge' && SIMPLE_SIDE_STYLES.includes(left.style);
  const rightRule = right.state === 'edge' && SIMPLE_SIDE_STYLES.includes(right.style);
  if (!leftRule && !rightRule) return false;
  if (leftRule && rightRule && left.widthPt !== right.widthPt) return false;
  return true;
}

function mapCells(
  rows: readonly SemanticTableRow[],
  extend: (cell: SemanticTableCell) => SemanticTableCell,
  simpleSidesOnly = false
): readonly SemanticTableRow[] {
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) =>
      sharesSideRuleGridLine(cell, simpleSidesOnly) ? extend(cell) : cell
    ),
  }));
}

/**
 * Centre the painted stroke on the grid line, without moving the content edge.
 *
 * In the legacy modes, the same captured control drawn with `w:tblW w:type="auto"` centres
 * its rules exactly as the `dxa` one does, so the width type does not decide where the
 * reference paints. It does decide the legacy content budget: `centeredSideRules` also
 * reclaims half the stroke as padding in `table-cell-geometry.ts`, which changes line
 * breaking. Paint follows the wider rule; the content inset keeps the narrow one it was
 * measured against. Mode 15 gives `auto` the whole `dxa` geometry instead.
 */
export function withCentredSideRulePaint(
  rows: readonly SemanticTableRow[],
  simpleSidesOnly = false
): readonly SemanticTableRow[] {
  return mapCells(rows, (cell) => ({ ...cell, centeredSidePaint: true as const }), simpleSidesOnly);
}

/** Legacy simple side rules share the grid line with padding, rather than adding to it. */
export function withLegacyTableSideRules(
  rows: readonly SemanticTableRow[],
  simpleSidesOnly = false
): readonly SemanticTableRow[] {
  return mapCells(rows, (cell) => ({ ...cell, centeredSideRules: true as const }), simpleSidesOnly);
}

/** The table-level facts that decide whether its side rules share the grid line. */
export interface SideRuleTableShape {
  readonly compatibilityMode: number | undefined;
  readonly depth: number;
  readonly bidiVisual: boolean;
  readonly floating: boolean;
  readonly cellSpacingPt: number;
  readonly widthType: PreferredWidthType;
  readonly alignment: TableAlignment;
  readonly layoutFixed: boolean;
  readonly indentPt: number;
  readonly columnWidthsPt: readonly number[];
  /** Width of the box the table is aligned in. */
  readonly containerWidthPt: number;
}

/** Cells with their side-rule geometry, and where the grid sits against the aligned edge. */
export interface SharedGridLineSideRules {
  readonly rows: readonly SemanticTableRow[];
  /** See `SemanticTableStructure.outerRuleOffsetPt`. */
  readonly outerRuleOffsetPt?: number;
}

/**
 * The one side-rule width of a table whose every cell has a simple rule of that width on
 * both sides, and whose rows each cover the whole grid (no `w:gridBefore`/`w:gridAfter`);
 * else `undefined`.
 */
const uniformRows = new WeakMap<
  SemanticTableRow,
  { columns: number; value: number | null | undefined }
>();
const uniformTables = new WeakMap<
  readonly SemanticTableRow[],
  { columns: number; value: number | undefined }
>();
function uniformRowRule(row: SemanticTableRow, columnCount: number): number | null | undefined {
  const known = uniformRows.get(row);
  if (known?.columns === columnCount) return known.value;
  const read = (): number | null | undefined => {
    const first = row.cells[0],
      last = row.cells.at(-1);
    if (
      !first ||
      !last ||
      first.gridColumn !== 0 ||
      last.gridColumn + last.gridSpan !== columnCount
    )
      return null;
    let width: number | undefined;
    for (const cell of row.cells) {
      if (cell.vMergeContinue) continue;
      const { left, right } = cell.contentBorders ?? cell.borders;
      for (const edge of [left, right]) {
        if (
          edge.state !== 'edge' ||
          !SIMPLE_SIDE_STYLES.includes(edge.style) ||
          !(edge.widthPt > 0)
        )
          return null;
        if (width !== undefined && edge.widthPt !== width) return null;
        width = edge.widthPt;
      }
    }
    return width;
  };
  const value = read();
  uniformRows.set(row, { columns: columnCount, value });
  return value;
}
function uniformSimpleSideRuleWidth(
  rows: readonly SemanticTableRow[],
  columnCount: number
): number | undefined {
  const known = uniformTables.get(rows);
  if (known?.columns === columnCount) return known.value;
  let width: number | undefined;
  for (const row of rows) {
    const value = uniformRowRule(row, columnCount);
    if (value === null || (value !== undefined && width !== undefined && value !== width)) {
      uniformTables.set(rows, { columns: columnCount, value: undefined });
      return undefined;
    }
    if (value !== undefined) width = value;
  }
  uniformTables.set(rows, { columns: columnCount, value: width });
  return width;
}

/**
 * The mode-15 left- or right-aligned table whose captured controls cover it, as the offset
 * of its grid from the aligned edge; else `undefined`.
 *
 * Captured `dxa` and `auto` controls put the OUTER edge of the leading (left) or trailing (right) rule
 * on the aligned edge, so the grid moves inward by half the rule. Every rule is centred on
 * its grid line and the margin is measured from that centre, as in the centred shape. The
 * controls cover 0.5 to 6pt single rules, 3pt thick rules, 0 to 10.8pt margins, indents,
 * fixed and autofit layout, and one to three columns. A fixed left table keeps the offset
 * when its outer box overflows the container: a full-width control and an over-indented
 * one both put the outer rule edge on the indent. An overflowing right-aligned or autofit
 * table, and a table whose side rules differ, keep the full-stroke inset and the unshifted
 * grid until controls cover them.
 */
function modernEdgeAlignedOffsetPt(
  rows: readonly SemanticTableRow[],
  table: SideRuleTableShape
): number | undefined {
  if (
    !hasCompatibilityRule(table.compatibilityMode, 'modernGridLineSideRules') ||
    !MODERN_GRID_WIDTH_TYPES.includes(table.widthType)
  )
    return undefined;
  if (table.alignment === 'center') return undefined;
  const rule = uniformSimpleSideRuleWidth(rows, table.columnWidthsPt.length);
  if (rule === undefined) return undefined;
  let gridWidth = 0;
  for (const column of table.columnWidthsPt) gridWidth += column;
  const left = table.alignment === 'left';
  const fits = (left ? table.indentPt : 0) + gridWidth + rule <= table.containerWidthPt + 1e-6;
  if (!fits && !(left && table.layoutFixed)) return undefined;
  return left ? rule / 2 : -rule / 2;
}

/**
 * Admit simple collapsed side rules to the shared-grid-line geometry.
 *
 * Modes 11, 12 and 14 (and an absent mode) take it for every top-level, collapsed, unpositioned
 * left-to-right table. Mode 15 takes it only for the shapes its captured controls cover, with
 * a `dxa` or `auto` width (`MODERN_GRID_WIDTH_TYPES`):
 *
 * - a centred table. Fixed-layout controls at 0.5, 1.5, 3 and 6pt strokes with 0 and
 *   5.4pt margins, and autofit controls, put text and strokes at the mode-14 positions: the
 *   stroke centred on the grid line and the margin measured from that centre.
 * - a left- or right-aligned table with one simple rule width on every cell side. It
 *   takes the same cell geometry, and its grid moves inward by half the outer rule
 *   (`modernEdgeAlignedOffsetPt`). The two go together: the inset alone would move the text
 *   outward by half a rule.
 *
 * Other mode-15 shapes (`pct` width, unequal or compound rules) and mode 16 keep
 * the full-stroke inset until controls cover them.
 */
function sharedGridLineDecision(
  rows: readonly SemanticTableRow[],
  table: SideRuleTableShape
): { legacyMode: boolean; modernGridWidth: boolean; outerRuleOffsetPt?: number } | null {
  const { compatibilityMode: mode } = table;
  if (table.depth !== 0 || table.bidiVisual || table.floating || table.cellSpacingPt !== 0)
    return null;
  const legacyMode = hasCompatibilityRule(mode, 'legacySharedGridLineSideRules');
  const modernGridWidth =
    hasCompatibilityRule(mode, 'modernGridLineSideRules') &&
    MODERN_GRID_WIDTH_TYPES.includes(table.widthType);
  const modernCentred = modernGridWidth && table.alignment === 'center';
  const outerRuleOffsetPt = legacyMode ? undefined : modernEdgeAlignedOffsetPt(rows, table);
  if (!legacyMode && !modernCentred && outerRuleOffsetPt === undefined) return null;
  return { legacyMode, modernGridWidth, outerRuleOffsetPt };
}

const rowsWithoutSharedSides = new WeakMap<SemanticTableRow, SemanticTableRow>();
function withoutSharedSides(row: SemanticTableRow): SemanticTableRow {
  const known = rowsWithoutSharedSides.get(row);
  if (known) return known;
  let changed = false;
  const cells = row.cells.map((cell) => {
    if (!cell.centeredSideRules && !cell.centeredSidePaint) return cell;
    changed = true;
    const { centeredSideRules: _rules, centeredSidePaint: _paint, ...plain } = cell;
    return plain;
  });
  const result = changed ? { ...row, cells } : row;
  rowsWithoutSharedSides.set(row, result);
  return result;
}

/** Reapply only the width-dependent side rules; authored cell material stays unchanged. */
export function retargetSharedGridLineSideRules(
  rows: readonly SemanticTableRow[],
  before: SideRuleTableShape,
  widths: readonly number[]
): SharedGridLineSideRules {
  const old = sharedGridLineDecision(rows, before);
  const shape = { ...before, columnWidthsPt: widths };
  const next = sharedGridLineDecision(rows, shape);
  if (
    old === next ||
    (old &&
      next &&
      old.legacyMode === next.legacyMode &&
      old.modernGridWidth === next.modernGridWidth &&
      old.outerRuleOffsetPt === next.outerRuleOffsetPt)
  )
    return {
      rows,
      ...(next?.outerRuleOffsetPt === undefined
        ? {}
        : { outerRuleOffsetPt: next.outerRuleOffsetPt }),
    };
  return withSharedGridLineSideRules(rows.map(withoutSharedSides), shape);
}

export function withSharedGridLineSideRules(
  rows: readonly SemanticTableRow[],
  table: SideRuleTableShape
): SharedGridLineSideRules {
  const decision = sharedGridLineDecision(rows, table);
  if (!decision) return { rows };
  const { legacyMode, modernGridWidth, outerRuleOffsetPt } = decision;
  const painted = withCentredSideRulePaint(rows, !legacyMode);
  const shared =
    table.widthType === 'dxa' || modernGridWidth
      ? withLegacyTableSideRules(painted, !legacyMode)
      : painted;
  return outerRuleOffsetPt === undefined ? { rows: shared } : { rows: shared, outerRuleOffsetPt };
}
