import type { SemanticTableCell, SemanticTableRow, TableAlignment } from './semantic-table.ts';
import type { PreferredWidthType } from './table-widths.ts';

const SIMPLE_SIDE_STYLES = ['single', 'thick'];

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
function sharesSideRuleGridLine(cell: SemanticTableCell): boolean {
  const { left, right } = cell.contentBorders ?? cell.borders;
  const leftRule = left.state === 'edge' && SIMPLE_SIDE_STYLES.includes(left.style);
  const rightRule = right.state === 'edge' && SIMPLE_SIDE_STYLES.includes(right.style);
  if (!leftRule && !rightRule) return false;
  if (leftRule && rightRule && left.widthPt !== right.widthPt) return false;
  return true;
}

function mapCells(
  rows: readonly SemanticTableRow[],
  extend: (cell: SemanticTableCell) => SemanticTableCell
): readonly SemanticTableRow[] {
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => (sharesSideRuleGridLine(cell) ? extend(cell) : cell)),
  }));
}

/**
 * Centre the painted stroke on the grid line, without moving the content edge.
 *
 * The same captured control drawn with `w:tblW w:type="auto"` centres its rules exactly as
 * the `dxa` one does, so the width type does not decide where the reference paints. It does
 * decide the content budget: `centeredSideRules` also reclaims half the stroke as padding in
 * `table-cell-geometry.ts`, which changes line breaking. Paint follows the wider rule;
 * the content inset keeps the narrow one it was measured against.
 */
export function withCentredSideRulePaint(
  rows: readonly SemanticTableRow[]
): readonly SemanticTableRow[] {
  return mapCells(rows, (cell) => ({ ...cell, centeredSidePaint: true as const }));
}

/** Legacy simple side rules share the grid line with padding, rather than adding to it. */
export function withLegacyTableSideRules(
  rows: readonly SemanticTableRow[]
): readonly SemanticTableRow[] {
  return mapCells(rows, (cell) => ({ ...cell, centeredSideRules: true as const }));
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
function uniformSimpleSideRuleWidth(
  rows: readonly SemanticTableRow[],
  columnCount: number
): number | undefined {
  let width: number | undefined;
  for (const row of rows) {
    const first = row.cells[0];
    const last = row.cells[row.cells.length - 1];
    if (!first || !last || first.gridColumn !== 0) return undefined;
    if (last.gridColumn + last.gridSpan !== columnCount) return undefined;
    for (const cell of row.cells) {
      // A merge continuation paints and holds nothing; its restart cell carries the rules.
      if (cell.vMergeContinue) continue;
      const { left, right } = cell.contentBorders ?? cell.borders;
      for (const edge of [left, right]) {
        if (edge.state !== 'edge' || !SIMPLE_SIDE_STYLES.includes(edge.style)) return undefined;
        if (!(edge.widthPt > 0)) return undefined;
        if (width !== undefined && edge.widthPt !== width) return undefined;
        width = edge.widthPt;
      }
    }
  }
  return width;
}

/**
 * The mode-15 left- or right-aligned table whose captured controls cover it, as the offset
 * of its grid from the aligned edge; else `undefined`.
 *
 * Captured `dxa` controls put the OUTER edge of the leading (left) or trailing (right) rule
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
  if (table.compatibilityMode !== 15 || table.widthType !== 'dxa') return undefined;
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
 * left-to-right table. Mode 15 takes it only for the shapes its captured controls cover:
 *
 * - a centred `dxa` table. Fixed-layout controls at 0.5, 1.5, 3 and 6pt strokes with 0 and
 *   5.4pt margins, and autofit controls, put text and strokes at the mode-14 positions: the
 *   stroke centred on the grid line and the margin measured from that centre.
 * - a left- or right-aligned `dxa` table with one simple rule width on every cell side. It
 *   takes the same cell geometry, and its grid moves inward by half the outer rule
 *   (`modernEdgeAlignedOffsetPt`). The two go together: the inset alone would move the text
 *   outward by half a rule.
 *
 * Other mode-15 shapes (`auto` or `pct` width, unequal or compound rules) and mode 16 keep
 * the full-stroke inset until controls cover them.
 */
export function withSharedGridLineSideRules(
  rows: readonly SemanticTableRow[],
  table: SideRuleTableShape
): SharedGridLineSideRules {
  const { compatibilityMode: mode } = table;
  if (table.depth !== 0 || table.bidiVisual || table.floating || table.cellSpacingPt !== 0)
    return { rows };
  const legacyMode = mode === undefined || [11, 12, 14].includes(mode);
  const modernCentredDxa = mode === 15 && table.widthType === 'dxa' && table.alignment === 'center';
  const outerRuleOffsetPt = legacyMode ? undefined : modernEdgeAlignedOffsetPt(rows, table);
  if (!legacyMode && !modernCentredDxa && outerRuleOffsetPt === undefined) return { rows };
  const painted = withCentredSideRulePaint(rows);
  const shared = table.widthType === 'dxa' ? withLegacyTableSideRules(painted) : painted;
  return outerRuleOffsetPt === undefined ? { rows: shared } : { rows: shared, outerRuleOffsetPt };
}
