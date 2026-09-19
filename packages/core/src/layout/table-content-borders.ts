// Table-level edges participate in measurement even when tcBorders omits them.
// Keep authored borders separate: conflict resolution still needs their provenance.
import {
  resolveTableCellBorderGrid,
  type CellBorderBox,
  type TableBorderBox,
  type TableBorderSide,
  type ResolvedTableBorderEdge,
} from './table-borders.ts';
import { borderContentInset } from './table-cell-geometry.ts';
import type { SemanticTableRow, SemanticTableCell } from './semantic-table.ts';
import { buildColumnOwnershipIndexes, ownerAt } from './table-border-ownership.ts';
import { resolveVMergeSpans } from './table-vmerge.ts';

/** Resolve physical coordinates without reversing the stored cell traversal order. */
export function physicalTableRows(
  rows: readonly SemanticTableRow[],
  columns: number,
  bidiVisual: boolean
): readonly SemanticTableRow[] {
  return bidiVisual
    ? rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          margins: { ...cell.margins, left: cell.margins.right, right: cell.margins.left },
          borders: { ...cell.borders, left: cell.borders.right, right: cell.borders.left },
          logicalGridColumn: cell.gridColumn,
          gridColumn: Math.max(0, columns - cell.gridColumn - cell.gridSpan),
        })),
      }))
    : rows;
}

/** Resolve the same winners as paint before their clearance affects wrapping and row height. */
export function withTableContentBorders(
  rows: readonly SemanticTableRow[],
  table: TableBorderBox,
  columns: number,
  collapsed = true
): readonly SemanticTableRow[] {
  const merged = resolveVMergeSpans(rows);
  if (!collapsed) return separatedContentBorders(rows, table, columns, merged);
  const grid = rows.map((row) =>
    row.cells.map((cell) => ({
      ...cell,
      mergeRowSpan: merged.get(cell.id) ?? 1,
    }))
  );
  const ownership = buildColumnOwnershipIndexes(grid, columns);
  const resolved = resolveTableCellBorderGrid(grid, table, columns);
  // Continuation cells have no content of their own. A shared edge beside one must
  // clear the merged head's content box, even when it occurs below the head row.
  const headById = new Map<string, SemanticTableCell>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (const cell of rows[rowIndex]!.cells) {
      if (cell.vMergeContinue) continue;
      headById.set(cell.id, cell);
      const end = rowIndex + (merged.get(cell.id) ?? 1);
      for (let r = rowIndex + 1; r < end; r++) {
        const owner = ownerAt(ownership, r, cell.gridColumn);
        const continuation = owner && rows[r]?.cells[owner.cellIndex];
        if (continuation?.vMergeContinue) headById.set(continuation.id, cell);
      }
    }
  }
  const boxes = new Map<string, CellBorderBox>();
  for (const row of rows)
    for (const cell of row.cells) {
      const empty = (edge: TableBorderSide): TableBorderSide =>
        edge.state === 'none' ? edge : { state: 'omitted' };
      boxes.set(cell.id, {
        top: empty(cell.borders.top),
        bottom: empty(cell.borders.bottom),
        left: empty(cell.borders.left),
        right: empty(cell.borders.right),
      });
    }
  const include = (
    cell: SemanticTableCell,
    side: keyof CellBorderBox,
    edge: ResolvedTableBorderEdge
  ) => {
    const head = headById.get(cell.id) ?? cell;
    const box = boxes.get(head.id)!;
    const candidate: TableBorderSide = { state: 'edge', ...edge };
    const shared = side === 'top' || side === 'bottom';
    // One content rectangle must clear every incident interval, not just the interval
    // whose border has the largest conflict weight (compound rules can extend farther).
    if (
      box[side].state !== 'edge' ||
      borderContentInset(head.margins[side], candidate, shared) >
        borderContentInset(head.margins[side], box[side], shared)
    ) {
      boxes.set(head.id, { ...box, [side]: candidate });
    }
  };
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r]!.cells.length; c++) {
      const cell = rows[r]!.cells[c]!;
      for (const segment of resolved[r]![c]!.edgeSegments ?? []) {
        include(cell, segment.side, segment.edge);
        if (segment.side === 'right') {
          const column = cell.gridColumn + cell.gridSpan;
          for (let neighborRow = segment.gridStart; neighborRow < segment.gridEnd; neighborRow++) {
            const owner = ownerAt(ownership, neighborRow, column);
            const neighbor = owner && rows[neighborRow]?.cells[owner.cellIndex];
            if (neighbor) include(neighbor, 'left', segment.edge);
          }
        } else if (segment.side === 'bottom') {
          const neighborRow = r + (merged.get(cell.id) ?? 1);
          for (let column = segment.gridStart; column < segment.gridEnd; column++) {
            const owner = ownerAt(ownership, neighborRow, column);
            const neighbor = owner && rows[neighborRow]?.cells[owner.cellIndex];
            if (neighbor) include(neighbor, 'top', segment.edge);
          }
        }
      }
    }
  }
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) =>
      cell.vMergeContinue ? cell : { ...cell, contentBorders: boxes.get(cell.id)! }
    ),
  }));
}

function separatedContentBorders(
  rows: readonly SemanticTableRow[],
  table: TableBorderBox,
  columns: number,
  merged: ReadonlyMap<string, number>
): readonly SemanticTableRow[] {
  const side = (own: TableBorderSide, inherited: TableBorderSide) =>
    own.state === 'omitted' && inherited.state === 'edge' ? inherited : own;
  return rows.map((row, index) => ({
    ...row,
    cells: row.cells.map((cell) => ({
      ...cell,
      contentBorders: {
        top: side(cell.borders.top, index === 0 ? table.top : table.insideH),
        bottom: side(
          cell.borders.bottom,
          index + (merged.get(cell.id) ?? 1) === rows.length ? table.bottom : table.insideH
        ),
        left: side(cell.borders.left, cell.gridColumn === 0 ? table.left : table.insideV),
        right: side(
          cell.borders.right,
          cell.gridColumn + cell.gridSpan === columns ? table.right : table.insideV
        ),
      },
    })),
  }));
}
