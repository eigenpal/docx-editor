import type { SemanticTableRow } from './semantic-table.ts';

/** Legacy simple side rules share the grid line with padding, rather than adding to it. */
export function withLegacyTableSideRules(
  rows: readonly SemanticTableRow[]
): readonly SemanticTableRow[] {
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      const { left, right } = cell.contentBorders ?? cell.borders;
      if (
        left.state !== 'edge' ||
        right.state !== 'edge' ||
        left.widthPt !== right.widthPt ||
        !['single', 'thick'].includes(left.style) ||
        !['single', 'thick'].includes(right.style)
      )
        return cell;
      return { ...cell, centeredSideRules: true as const };
    }),
  }));
}
