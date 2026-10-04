/**
 * Where the cells of a table with `w:tblCellSpacing` sit along its row, in points from the
 * table's left edge.
 *
 * The spacing (17.4.45) is the space on each side of every cell, so two neighbouring cells,
 * and a cell and the table edge, sit twice that apart. Those gaps come out of the table's own
 * width: every column gives up its share in proportion to its width.
 */
export interface CellSpacingGeometry {
  /** The gap between neighbouring cells, and between a cell and the table edge. */
  readonly gapPt: number;
  /** The left edge of the cell starting at grid column `column`. */
  cellLeft(column: number): number;
  /** The width of a cell spanning `span` columns from `column`, gaps it covers included. */
  cellWidth(column: number, span: number): number;
}

export function cellSpacingGeometry(
  columns: readonly number[],
  spacingPt: number
): CellSpacingGeometry | null {
  if (!Number.isFinite(spacingPt) || spacingPt <= 0 || columns.length === 0) return null;
  const gapPt = 2 * spacingPt;
  const prefix = [0];
  for (const width of columns) prefix.push(prefix.at(-1)! + width);
  const total = prefix.at(-1)!;
  const scale = total > 0 ? Math.max(0, total - (columns.length + 1) * gapPt) / total : 0;
  const at = (column: number): number => prefix[Math.max(0, Math.min(column, columns.length))]!;
  return {
    gapPt,
    cellLeft: (column) => gapPt * (column + 1) + at(column) * scale,
    cellWidth: (column, span) =>
      (at(column + span) - at(column)) * scale + gapPt * Math.max(0, span - 1),
  };
}

/**
 * The factor a column's width is scaled by to give its cell's width, after the spacing gaps
 * come out of the table: 1 with no spacing.
 */
export function cellSpacingScale(columns: readonly number[], spacingPt: number): number {
  if (!Number.isFinite(spacingPt) || spacingPt <= 0 || columns.length === 0) return 1;
  let total = 0;
  for (const width of columns) total += width;
  if (total <= 0) return 1;
  return Math.max(0, total - (columns.length + 1) * 2 * spacingPt) / total;
}
