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
}

/**
 * Admit simple collapsed side rules to the shared-grid-line geometry.
 *
 * Modes 11, 12 and 14 (and an absent mode) take it for every top-level, collapsed, unpositioned
 * left-to-right table. Mode 15 takes it only for the shape its captured controls cover: a
 * centred `dxa` table. Fixed-layout controls at 0.5, 1.5, 3 and 6pt strokes with 0 and 5.4pt
 * margins, and one measured autofit table, put text and strokes at the mode-14 positions:
 * the stroke centred on the grid line and the margin measured from that centre. Other
 * mode-15 shapes (left or right aligned, `auto` or `pct` width) and mode 16 keep the
 * full-stroke inset until controls cover them.
 */
export function withSharedGridLineSideRules(
  rows: readonly SemanticTableRow[],
  table: SideRuleTableShape
): readonly SemanticTableRow[] {
  const { compatibilityMode: mode } = table;
  if (table.depth !== 0 || table.bidiVisual || table.floating || table.cellSpacingPt !== 0)
    return rows;
  const legacyMode = mode === undefined || [11, 12, 14].includes(mode);
  const modernCentredDxa = mode === 15 && table.widthType === 'dxa' && table.alignment === 'center';
  if (!legacyMode && !modernCentredDxa) return rows;
  const painted = withCentredSideRulePaint(rows);
  return table.widthType === 'dxa' ? withLegacyTableSideRules(painted) : painted;
}
