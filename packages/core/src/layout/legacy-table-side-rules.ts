import type { SemanticTableRow } from './semantic-table.ts';

const SIMPLE_SIDE_STYLES = ['single', 'thick'];

/**
 * Legacy simple side rules share the grid line with padding, rather than adding to it.
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
export function withLegacyTableSideRules(
  rows: readonly SemanticTableRow[]
): readonly SemanticTableRow[] {
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      const { left, right } = cell.contentBorders ?? cell.borders;
      const leftRule = left.state === 'edge' && SIMPLE_SIDE_STYLES.includes(left.style);
      const rightRule = right.state === 'edge' && SIMPLE_SIDE_STYLES.includes(right.style);
      if (!leftRule && !rightRule) return cell;
      if (leftRule && rightRule && left.widthPt !== right.widthPt) return cell;
      return { ...cell, centeredSideRules: true as const };
    }),
  }));
}
