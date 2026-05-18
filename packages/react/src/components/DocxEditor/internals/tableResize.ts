/**
 * Table resize commit + width-read helpers for PagedEditor.
 *
 * Pulled out of PagedEditor's mousedown / mouseup branches so the pointer
 * hook can stay focused on event routing. The mousedown path needs the
 * current column / row dimensions to seed the drag; the mouseup path
 * dispatches the final PM transaction that bakes the new widths into the
 * table node + its row/cell attrs.
 *
 * Widths and heights are stored in twips (1/20 of a point) on the PM doc,
 * matching OOXML's `w:tblGrid` and `w:tcW` units.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

interface FoundTable {
  node: PMNode;
  /** PM doc position of the table node (its `before(d)`) */
  tablePos: number;
}

/** Walk up from `docFrom + 1` to find the enclosing table node. */
function findTableAt(view: EditorView, docFrom: number): FoundTable | null {
  try {
    const $pos = view.state.doc.resolve(docFrom + 1);
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d);
      if (node.type.name === 'table') {
        return { node, tablePos: $pos.before(d) };
      }
    }
  } catch {
    // Resolution failed (stale pos after edit).
  }
  return null;
}

/** Read the [left, right] column widths at `colIndex` in the table starting at `docFrom`. */
export function readColumnWidths(
  view: EditorView,
  docFrom: number,
  colIndex: number
): { left: number; right: number } | null {
  const found = findTableAt(view, docFrom);
  if (!found) return null;
  const widths = found.node.attrs.columnWidths as number[] | null;
  if (!widths) return null;
  if (widths[colIndex] === undefined || widths[colIndex + 1] === undefined) return null;
  return { left: widths[colIndex], right: widths[colIndex + 1] };
}

/**
 * Read the row height (in twips) for `rowIndex` in the table starting at
 * `docFrom`. Returns null if the row has no explicit height — the caller
 * can fall back to measuring the rendered DOM cell.
 */
export function readRowHeight(view: EditorView, docFrom: number, rowIndex: number): number | null {
  const found = findTableAt(view, docFrom);
  if (!found) return null;
  let rowHeight: number | null = null;
  let idx = 0;
  found.node.forEach((child) => {
    if (idx === rowIndex) {
      const h = child.attrs.height as number | null;
      if (h) rowHeight = h;
    }
    idx++;
  });
  return rowHeight;
}

/** Read the last-column width (the one being resized from the table's right edge). */
export function readLastColumnWidth(
  view: EditorView,
  docFrom: number,
  colIndex: number
): number | null {
  const found = findTableAt(view, docFrom);
  if (!found) return null;
  const widths = found.node.attrs.columnWidths as number[] | null;
  if (!widths || widths[colIndex] === undefined) return null;
  return widths[colIndex];
}

/**
 * Bake a column-resize into the PM doc: update the table's `columnWidths`
 * attr and every cell at `colIdx` / `colIdx + 1` in every row.
 */
export function commitColumnResize(
  view: EditorView,
  opts: { docFrom: number; colIdx: number; newLeft: number; newRight: number }
): void {
  const { docFrom, colIdx, newLeft, newRight } = opts;
  const found = findTableAt(view, docFrom);
  if (!found) return;
  const { node, tablePos } = found;

  const tr = view.state.tr;
  const widths = [...((node.attrs.columnWidths as number[]) ?? [])];
  widths[colIdx] = newLeft;
  widths[colIdx + 1] = newRight;
  tr.setNodeMarkup(tablePos, undefined, { ...node.attrs, columnWidths: widths });

  let rowOffset = tablePos + 1;
  node.forEach((row) => {
    let cellOffset = rowOffset + 1;
    let cellColIdx = 0;
    row.forEach((cell) => {
      const colspan = (cell.attrs.colspan as number) || 1;
      if (cellColIdx === colIdx || cellColIdx === colIdx + 1) {
        const newWidth = cellColIdx === colIdx ? newLeft : newRight;
        tr.setNodeMarkup(tr.mapping.map(cellOffset), undefined, {
          ...cell.attrs,
          width: newWidth,
          widthType: 'dxa',
          colwidth: null,
        });
      }
      cellOffset += cell.nodeSize;
      cellColIdx += colspan;
    });
    rowOffset += row.nodeSize;
  });

  view.dispatch(tr);
}

/** Bake a row-resize into the PM doc: update the target row's `height` + `heightRule`. */
export function commitRowResize(
  view: EditorView,
  opts: { docFrom: number; rowIdx: number; newHeight: number }
): void {
  const { docFrom, rowIdx, newHeight } = opts;
  const found = findTableAt(view, docFrom);
  if (!found) return;
  const { node, tablePos } = found;

  const tr = view.state.tr;
  let rowOffset = tablePos + 1;
  let idx = 0;
  node.forEach((row) => {
    if (idx === rowIdx) {
      tr.setNodeMarkup(tr.mapping.map(rowOffset), undefined, {
        ...row.attrs,
        height: newHeight,
        heightRule: 'atLeast',
      });
    }
    rowOffset += row.nodeSize;
    idx++;
  });

  view.dispatch(tr);
}

/**
 * Bake a right-edge resize into the PM doc: grow only the last column.
 * Updates `columnWidths[colIdx]` and the cell at `colIdx` in every row.
 */
export function commitRightEdgeResize(
  view: EditorView,
  opts: { docFrom: number; colIdx: number; newWidth: number }
): void {
  const { docFrom, colIdx, newWidth } = opts;
  const found = findTableAt(view, docFrom);
  if (!found) return;
  const { node, tablePos } = found;

  const tr = view.state.tr;
  const widths = [...((node.attrs.columnWidths as number[]) ?? [])];
  widths[colIdx] = newWidth;
  tr.setNodeMarkup(tablePos, undefined, { ...node.attrs, columnWidths: widths });

  let rowOffset = tablePos + 1;
  node.forEach((row) => {
    let cellOffset = rowOffset + 1;
    let cellColIdx = 0;
    row.forEach((cell) => {
      const colspan = (cell.attrs.colspan as number) || 1;
      if (cellColIdx === colIdx) {
        tr.setNodeMarkup(tr.mapping.map(cellOffset), undefined, {
          ...cell.attrs,
          width: newWidth,
          widthType: 'dxa',
          colwidth: null,
        });
      }
      cellOffset += cell.nodeSize;
      cellColIdx += colspan;
    });
    rowOffset += row.nodeSize;
  });

  view.dispatch(tr);
}
