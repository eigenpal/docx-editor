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

/** The gap between neighbouring cells, and a cell and the table edge: twice the spacing. */
export function cellSpacingGapPt(spacingPt: number): number {
  return Number.isFinite(spacingPt) && spacingPt > 0 ? 2 * spacingPt : 0;
}

export function cellSpacingGeometry(
  columns: readonly number[],
  spacingPt: number
): CellSpacingGeometry | null {
  if (!Number.isFinite(spacingPt) || spacingPt <= 0 || columns.length === 0) return null;
  const gapPt = cellSpacingGapPt(spacingPt);
  const prefix = [0];
  for (const width of columns) prefix.push(prefix.at(-1)! + width);
  const scale = cellSpacingScale(columns, spacingPt);
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
  return Math.max(0, total - (columns.length + 1) * cellSpacingGapPt(spacingPt)) / total;
}

/** The total of a spaced table's gaps: twice the spacing at every column edge. */
export function spacingGapsPt(structure: SpacedTable): number {
  return (structure.columnWidthsPt.length + 1) * cellSpacingGapPt(structure.cellSpacingPt);
}

/** Each column's cell width: the column itself, or its share once the gaps come out. */
export function spacedCellWidths(structure: SpacedTable): readonly number[] {
  const scale = cellSpacingScale(structure.columnWidthsPt, structure.cellSpacingPt);
  return scale === 1 ? structure.columnWidthsPt : structure.columnWidthsPt.map((w) => w * scale);
}

/** Column widths whose cells, once `gaps` come out of their total, have the widths given. */
export function columnsAroundCells(cells: readonly number[], gaps: number): readonly number[] {
  let total = 0;
  for (const cell of cells) total += cell;
  if (total <= 0) return cells.map(() => gaps / Math.max(cells.length, 1));
  const grow = (total + gaps) / total;
  return cells.map((cell) => cell * grow);
}

/** What the spacing helpers read from a table. */
interface SpacedTable {
  readonly columnWidthsPt: readonly number[];
  readonly cellSpacingPt: number;
}
