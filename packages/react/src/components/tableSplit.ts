import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';

interface TableAnchor {
  node: PMNode;
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

export interface SplitCellDialogConfig {
  minRows: number;
  minCols: number;
  initialRows: number;
  initialCols: number;
}

interface ActiveTableCellInfo {
  table: PMNode;
  tablePos: number;
  cell: PMNode;
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

function findActiveTableCell(state: EditorState): ActiveTableCellInfo | null {
  const { $from } = state.selection;

  let table: PMNode | null = null;
  let tablePos: number | null = null;
  let cell: PMNode | null = null;
  let row = -1;
  let col = -1;

  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);

    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      cell = node;
      const rowNode = $from.node(depth - 1);
      if (rowNode?.type.name === 'tableRow') {
        let currentCol = 0;
        rowNode.forEach((child, _offset, index) => {
          if (col !== -1) return;
          if (index === $from.index(depth - 1)) {
            col = currentCol;
            return;
          }
          currentCol += child.attrs.colspan || 1;
        });
      }
    } else if (node.type.name === 'tableRow') {
      const parent = $from.node(depth - 1);
      if (parent?.type.name === 'table') {
        row = $from.index(depth - 1);
      }
    } else if (node.type.name === 'table') {
      table = node;
      tablePos = $from.before(depth);
      break;
    }
  }

  if (!table || tablePos == null || !cell || row < 0 || col < 0) return null;

  return {
    table,
    tablePos,
    cell,
    row,
    col,
    rowspan: cell.attrs.rowspan || 1,
    colspan: cell.attrs.colspan || 1,
  };
}

function collectTableAnchors(table: PMNode): { anchors: TableAnchor[]; totalCols: number } {
  const occupied: boolean[][] = [];
  const anchors: TableAnchor[] = [];
  let totalCols = 0;

  for (let row = 0; row < table.childCount; row++) {
    const rowNode = table.child(row);
    let col = 0;

    rowNode.forEach((cell) => {
      while (occupied[row]?.[col]) col++;

      const rowspan = cell.attrs.rowspan || 1;
      const colspan = cell.attrs.colspan || 1;

      anchors.push({ node: cell, row, col, rowspan, colspan });

      for (let r = row; r < row + rowspan; r++) {
        const rowSlots = occupied[r] ?? [];
        occupied[r] = rowSlots;
        for (let c = col; c < col + colspan; c++) {
          rowSlots[c] = true;
        }
      }

      col += colspan;
      totalCols = Math.max(totalCols, col);
    });
  }

  return { anchors, totalCols };
}

function sumColumnWidths(widths: number[], start: number, span: number): number {
  let total = 0;
  for (let index = start; index < start + span && index < widths.length; index++) {
    total += widths[index];
  }
  return total;
}

function splitColumnWidths(
  table: PMNode,
  totalCols: number,
  startCol: number,
  currentSpan: number,
  targetSpan: number
): number[] {
  const tableWidth = (table.attrs.width as number | null) ?? 9360;
  const existing =
    Array.isArray(table.attrs.columnWidths) && table.attrs.columnWidths.length > 0
      ? [...(table.attrs.columnWidths as number[])]
      : Array.from({ length: totalCols }, () => Math.floor(tableWidth / Math.max(totalCols, 1)));

  const sliceWidth = sumColumnWidths(existing, startCol, currentSpan);
  const nextSegmentWidth = Math.floor(sliceWidth / Math.max(targetSpan, 1));
  const remainder = sliceWidth - nextSegmentWidth * targetSpan;
  const replacement = Array.from(
    { length: targetSpan },
    (_, index) => nextSegmentWidth + (index < remainder ? 1 : 0)
  );

  return [
    ...existing.slice(0, startCol),
    ...replacement,
    ...existing.slice(startCol + currentSpan),
  ];
}

function buildCellAttrs(
  cell: PMNode,
  colStart: number,
  colspan: number,
  rowspan: number,
  columnWidths: number[]
): Record<string, unknown> {
  const attrs = { ...cell.attrs };
  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const cellWidth = sumColumnWidths(columnWidths, colStart, colspan);
  const spansChanged =
    colspan !== (cell.attrs.colspan || 1) || rowspan !== (cell.attrs.rowspan || 1);

  attrs.colspan = colspan;
  attrs.rowspan = rowspan;
  attrs.colwidth = null;
  if (totalWidth > 0) {
    attrs.width = Math.round((cellWidth / totalWidth) * 100);
    attrs.widthType = 'pct';
  }
  if (spansChanged) {
    attrs._originalFormatting = null;
  }

  return attrs;
}

function createEmptySplitCellContent(cell: PMNode): PMNode[] {
  const paragraph = cell.type.schema.nodes.paragraph.create();
  return [paragraph];
}

function findCellStartPos(
  table: PMNode,
  tablePos: number,
  rowIndex: number,
  colIndex: number
): number | null {
  let rowPos = tablePos + 1;

  for (let row = 0; row < table.childCount; row++) {
    const rowNode = table.child(row);
    let cellPos = rowPos + 1;
    let currentCol = 0;

    for (let cellIndex = 0; cellIndex < rowNode.childCount; cellIndex++) {
      const cell = rowNode.child(cellIndex);
      if (row === rowIndex && currentCol === colIndex) {
        return cellPos;
      }
      currentCol += cell.attrs.colspan || 1;
      cellPos += cell.nodeSize;
    }

    rowPos += rowNode.nodeSize;
  }

  return null;
}

export function getSplitCellDialogConfig(state: EditorState): SplitCellDialogConfig | null {
  const activeCell = findActiveTableCell(state);
  if (!activeCell) return null;

  const initialRows = activeCell.rowspan;
  const initialCols =
    activeCell.rowspan > 1 || activeCell.colspan > 1 ? activeCell.colspan : activeCell.colspan + 1;

  return {
    minRows: activeCell.rowspan,
    minCols: activeCell.colspan,
    initialRows,
    initialCols,
  };
}

export function splitActiveTableCell(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  rows: number,
  cols: number
): boolean {
  const activeCell = findActiveTableCell(state);
  if (!activeCell || !dispatch) return false;
  if (rows < activeCell.rowspan || cols < activeCell.colspan) return false;
  if (rows === 1 && cols === 1) return false;

  const { anchors, totalCols } = collectTableAnchors(activeCell.table);
  const totalRows = activeCell.table.childCount;
  const deltaRows = rows - activeCell.rowspan;
  const deltaCols = cols - activeCell.colspan;
  const newRowCount = totalRows + deltaRows;
  const newColumnWidths = splitColumnWidths(
    activeCell.table,
    totalCols,
    activeCell.col,
    activeCell.colspan,
    cols
  );

  const target = anchors.find(
    (anchor) => anchor.row === activeCell.row && anchor.col === activeCell.col
  );
  if (!target) return false;

  const nextAnchors: TableAnchor[] = [];
  const targetRowEnd = activeCell.row + activeCell.rowspan;
  const targetColEnd = activeCell.col + activeCell.colspan;

  for (const anchor of anchors) {
    if (anchor === target) continue;

    const rowEnd = anchor.row + anchor.rowspan;
    const colEnd = anchor.col + anchor.colspan;
    const rowIntersectsBand = anchor.row < targetRowEnd && rowEnd > activeCell.row;
    const colIntersectsBand = anchor.col < targetColEnd && colEnd > activeCell.col;

    nextAnchors.push({
      node: anchor.node,
      row: anchor.row >= targetRowEnd ? anchor.row + deltaRows : anchor.row,
      col: anchor.col >= targetColEnd ? anchor.col + deltaCols : anchor.col,
      rowspan:
        anchor.rowspan + (deltaRows > 0 && rowIntersectsBand && !colIntersectsBand ? deltaRows : 0),
      colspan:
        anchor.colspan + (deltaCols > 0 && colIntersectsBand && !rowIntersectsBand ? deltaCols : 0),
    });
  }

  for (let rowOffset = 0; rowOffset < rows; rowOffset++) {
    for (let colOffset = 0; colOffset < cols; colOffset++) {
      const content =
        rowOffset === 0 && colOffset === 0
          ? target.node.content
          : createEmptySplitCellContent(target.node);
      const attrs = buildCellAttrs(target.node, activeCell.col + colOffset, 1, 1, newColumnWidths);
      nextAnchors.push({
        node: target.node.type.create(attrs, content),
        row: activeCell.row + rowOffset,
        col: activeCell.col + colOffset,
        rowspan: 1,
        colspan: 1,
      });
    }
  }

  const rowAttrs = Array.from({ length: newRowCount }, (_, rowIndex) => {
    if (rowIndex < targetRowEnd) {
      return { ...(activeCell.table.child(rowIndex)?.attrs ?? {}) };
    }
    if (rowIndex < activeCell.row + rows) {
      return { ...(activeCell.table.child(targetRowEnd - 1)?.attrs ?? {}) };
    }
    return { ...(activeCell.table.child(rowIndex - deltaRows)?.attrs ?? {}) };
  });

  const rowChildren = Array.from({ length: newRowCount }, () => [] as PMNode[]);
  nextAnchors
    .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row))
    .forEach((anchor) => {
      const attrs = buildCellAttrs(
        anchor.node,
        anchor.col,
        anchor.colspan,
        anchor.rowspan,
        newColumnWidths
      );
      rowChildren[anchor.row].push(anchor.node.type.create(attrs, anchor.node.content));
    });

  const rowNodes = rowChildren.map((cells, rowIndex) =>
    activeCell.table.type.schema.nodes.tableRow.create(rowAttrs[rowIndex], cells)
  );

  const newTable = activeCell.table.type.create(
    {
      ...activeCell.table.attrs,
      columnWidths: newColumnWidths,
    },
    rowNodes
  );

  let tr = state.tr.replaceWith(
    activeCell.tablePos,
    activeCell.tablePos + activeCell.table.nodeSize,
    newTable
  );

  const replacedTable = tr.doc.nodeAt(activeCell.tablePos);
  if (replacedTable) {
    const selectionCellPos = findCellStartPos(
      replacedTable,
      activeCell.tablePos,
      activeCell.row,
      activeCell.col
    );
    if (selectionCellPos != null) {
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(selectionCellPos + 2)));
    }
  }

  dispatch(tr.scrollIntoView());
  return true;
}
