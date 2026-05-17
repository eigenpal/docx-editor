/**
 * useTableResize — Vue port of React PagedEditor.tsx's table-resize logic
 * (column / row / right-edge handles).
 *
 * Ports the mouseDown branch (lines 3110-3232 in React), the mouseMove
 * delta tracking (lines 3329-3389), and the mouseUp PM-transaction
 * commit (lines 3454-3618). Same constants (1px ≈ 15 twips at 96dpi,
 * 300 twips column min, 200 twips row min). Same attribute mutations
 * (columnWidths on table node, width/widthType/colwidth on each cell,
 * height/heightRule on the row).
 *
 * Returns:
 *   - tryStartResize(e, view): returns true if the click started a
 *     resize (caller should bail early), false otherwise.
 *   - install(): wires global mousemove/mouseup listeners. Caller
 *     should invoke the returned cleanup on unmount.
 */
import type { EditorView } from 'prosemirror-view';

const PX_TO_TWIPS = 15;
const MIN_COLUMN_WIDTH_TWIPS = 300; // ~0.2"
const MIN_ROW_HEIGHT_TWIPS = 200; // ~0.14"
const TWIPS_PER_RENDERED_PX = 15;

interface ColumnResizeState {
  active: boolean;
  startX: number;
  handle: HTMLElement | null;
  columnIndex: number;
  tablePmStart: number;
  origWidths: { left: number; right: number };
}

interface RowResizeState {
  active: boolean;
  startY: number;
  handle: HTMLElement | null;
  rowIndex: number;
  isEdge: boolean;
  tablePmStart: number;
  origHeight: number;
}

interface RightEdgeResizeState {
  active: boolean;
  startX: number;
  handle: HTMLElement | null;
  columnIndex: number;
  tablePmStart: number;
  origWidth: number;
}

export function useTableResize() {
  const col: ColumnResizeState = {
    active: false,
    startX: 0,
    handle: null,
    columnIndex: 0,
    tablePmStart: 0,
    origWidths: { left: 0, right: 0 },
  };
  const row: RowResizeState = {
    active: false,
    startY: 0,
    handle: null,
    rowIndex: 0,
    isEdge: false,
    tablePmStart: 0,
    origHeight: 0,
  };
  const edge: RightEdgeResizeState = {
    active: false,
    startX: 0,
    handle: null,
    columnIndex: 0,
    tablePmStart: 0,
    origWidth: 0,
  };

  let viewRef: EditorView | null = null;

  function isResizing(): boolean {
    return col.active || row.active || edge.active;
  }

  function tryStartResize(e: MouseEvent, view: EditorView): boolean {
    const target = e.target as HTMLElement;
    if (!target?.classList) return false;

    if (target.classList.contains('layout-table-resize-handle')) {
      e.preventDefault();
      e.stopPropagation();
      viewRef = view;
      col.active = true;
      col.startX = e.clientX;
      col.handle = target;
      target.classList.add('dragging');
      col.columnIndex = parseInt(target.dataset.columnIndex ?? '0', 10);
      col.tablePmStart = parseInt(target.dataset.tablePmStart ?? '0', 10);
      readColumnWidths(view, col);
      return true;
    }

    if (
      target.classList.contains('layout-table-row-resize-handle') ||
      target.classList.contains('layout-table-edge-handle-bottom')
    ) {
      e.preventDefault();
      e.stopPropagation();
      viewRef = view;
      row.active = true;
      row.startY = e.clientY;
      row.handle = target;
      row.isEdge = target.dataset.isEdge === 'bottom';
      target.classList.add('dragging');
      row.rowIndex = parseInt(target.dataset.rowIndex ?? '0', 10);
      row.tablePmStart = parseInt(target.dataset.tablePmStart ?? '0', 10);
      readRowHeight(view, row, target);
      return true;
    }

    if (target.classList.contains('layout-table-edge-handle-right')) {
      e.preventDefault();
      e.stopPropagation();
      viewRef = view;
      edge.active = true;
      edge.startX = e.clientX;
      edge.handle = target;
      target.classList.add('dragging');
      edge.columnIndex = parseInt(target.dataset.columnIndex ?? '0', 10);
      edge.tablePmStart = parseInt(target.dataset.tablePmStart ?? '0', 10);
      readRightEdgeWidth(view, edge);
      return true;
    }

    return false;
  }

  function handleMove(e: MouseEvent) {
    if (col.active && col.handle) {
      e.preventDefault();
      const delta = e.clientX - col.startX;
      const origLeft = parseFloat(col.handle.style.left);
      col.handle.style.left = `${origLeft + delta}px`;
      col.startX = e.clientX;
      const deltaTwips = Math.round(delta * PX_TO_TWIPS);
      const newLeft = col.origWidths.left + deltaTwips;
      const newRight = col.origWidths.right - deltaTwips;
      if (newLeft >= MIN_COLUMN_WIDTH_TWIPS && newRight >= MIN_COLUMN_WIDTH_TWIPS) {
        col.origWidths = { left: newLeft, right: newRight };
      }
      return;
    }

    if (row.active && row.handle) {
      e.preventDefault();
      const delta = e.clientY - row.startY;
      const origTop = parseFloat(row.handle.style.top);
      row.handle.style.top = `${origTop + delta}px`;
      row.startY = e.clientY;
      const deltaTwips = Math.round(delta * PX_TO_TWIPS);
      const newHeight = row.origHeight + deltaTwips;
      if (newHeight >= MIN_ROW_HEIGHT_TWIPS) {
        row.origHeight = newHeight;
      }
      return;
    }

    if (edge.active && edge.handle) {
      e.preventDefault();
      const delta = e.clientX - edge.startX;
      const origLeft = parseFloat(edge.handle.style.left);
      edge.handle.style.left = `${origLeft + delta}px`;
      edge.startX = e.clientX;
      const deltaTwips = Math.round(delta * PX_TO_TWIPS);
      const newWidth = edge.origWidth + deltaTwips;
      if (newWidth >= MIN_COLUMN_WIDTH_TWIPS) {
        edge.origWidth = newWidth;
      }
    }
  }

  function handleUp(_e: MouseEvent) {
    if (col.active) {
      col.active = false;
      col.handle?.classList.remove('dragging');
      if (viewRef) commitColumnResize(viewRef, col);
      col.handle = null;
      return;
    }
    if (row.active) {
      row.active = false;
      row.handle?.classList.remove('dragging');
      if (viewRef) commitRowResize(viewRef, row);
      row.handle = null;
      return;
    }
    if (edge.active) {
      edge.active = false;
      edge.handle?.classList.remove('dragging');
      if (viewRef) commitRightEdgeResize(viewRef, edge);
      edge.handle = null;
    }
  }

  function install(): () => void {
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }

  return { tryStartResize, install, isResizing };
}

// ─── PM doc readers ────────────────────────────────────────────────────────

function readColumnWidths(view: EditorView, col: ColumnResizeState) {
  const $pos = view.state.doc.resolve(col.tablePmStart + 1);
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'table') {
      const widths = node.attrs.columnWidths as number[] | null;
      if (
        widths &&
        widths[col.columnIndex] !== undefined &&
        widths[col.columnIndex + 1] !== undefined
      ) {
        col.origWidths = {
          left: widths[col.columnIndex],
          right: widths[col.columnIndex + 1],
        };
      }
      return;
    }
  }
}

function readRowHeight(view: EditorView, row: RowResizeState, target: HTMLElement) {
  const $pos = view.state.doc.resolve(row.tablePmStart + 1);
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'table') {
      let rowNode: ReturnType<typeof node.child> | null = null;
      let idx = 0;
      node.forEach((child) => {
        if (idx === row.rowIndex) rowNode = child;
        idx++;
      });
      if (rowNode) {
        const stored = (rowNode as ReturnType<typeof node.child>).attrs.height as number | null;
        if (stored) {
          row.origHeight = stored;
        } else {
          // Estimate from rendered height when row.height is null
          const tableEl = target.closest('.layout-table');
          const rowEl = tableEl?.querySelector(`[data-row-index="${row.rowIndex}"]`);
          const renderedHeight = rowEl ? (rowEl as HTMLElement).getBoundingClientRect().height : 30;
          row.origHeight = Math.round(renderedHeight * TWIPS_PER_RENDERED_PX);
        }
      }
      return;
    }
  }
}

function readRightEdgeWidth(view: EditorView, edge: RightEdgeResizeState) {
  const $pos = view.state.doc.resolve(edge.tablePmStart + 1);
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'table') {
      const widths = node.attrs.columnWidths as number[] | null;
      if (widths && widths[edge.columnIndex] !== undefined) {
        edge.origWidth = widths[edge.columnIndex];
      }
      return;
    }
  }
}

// ─── PM transactions ──────────────────────────────────────────────────────

function commitColumnResize(view: EditorView, col: ColumnResizeState) {
  const $pos = view.state.doc.resolve(col.tablePmStart + 1);
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (node.type.name !== 'table') continue;

    const tablePos = $pos.before(d);
    const tr = view.state.tr;
    const widths = [...((node.attrs.columnWidths as number[]) || [])];
    widths[col.columnIndex] = col.origWidths.left;
    widths[col.columnIndex + 1] = col.origWidths.right;

    tr.setNodeMarkup(tablePos, undefined, {
      ...node.attrs,
      columnWidths: widths,
    });

    let rowOffset = tablePos + 1;
    node.forEach((rowNode) => {
      let cellOffset = rowOffset + 1;
      let cellColIdx = 0;
      rowNode.forEach((cell) => {
        const colspan = (cell.attrs.colspan as number) || 1;
        if (cellColIdx === col.columnIndex || cellColIdx === col.columnIndex + 1) {
          const newWidth =
            cellColIdx === col.columnIndex ? col.origWidths.left : col.origWidths.right;
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
      rowOffset += rowNode.nodeSize;
    });

    view.dispatch(tr);
    return;
  }
}

function commitRowResize(view: EditorView, row: RowResizeState) {
  const $pos = view.state.doc.resolve(row.tablePmStart + 1);
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (node.type.name !== 'table') continue;

    const tablePos = $pos.before(d);
    const tr = view.state.tr;
    let rowOffset = tablePos + 1;
    let idx = 0;
    node.forEach((rowNode) => {
      if (idx === row.rowIndex) {
        tr.setNodeMarkup(tr.mapping.map(rowOffset), undefined, {
          ...rowNode.attrs,
          height: row.origHeight,
          heightRule: 'atLeast',
        });
      }
      rowOffset += rowNode.nodeSize;
      idx++;
    });
    view.dispatch(tr);
    return;
  }
}

function commitRightEdgeResize(view: EditorView, edge: RightEdgeResizeState) {
  const $pos = view.state.doc.resolve(edge.tablePmStart + 1);
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (node.type.name !== 'table') continue;

    const tablePos = $pos.before(d);
    const tr = view.state.tr;
    const widths = [...((node.attrs.columnWidths as number[]) || [])];
    widths[edge.columnIndex] = edge.origWidth;

    tr.setNodeMarkup(tablePos, undefined, {
      ...node.attrs,
      columnWidths: widths,
    });

    let rowOffset = tablePos + 1;
    node.forEach((rowNode) => {
      let cellOffset = rowOffset + 1;
      let cellColIdx = 0;
      rowNode.forEach((cell) => {
        const colspan = (cell.attrs.colspan as number) || 1;
        if (cellColIdx === edge.columnIndex) {
          tr.setNodeMarkup(tr.mapping.map(cellOffset), undefined, {
            ...cell.attrs,
            width: edge.origWidth,
            widthType: 'dxa',
            colwidth: null,
          });
        }
        cellOffset += cell.nodeSize;
        cellColIdx += colspan;
      });
      rowOffset += rowNode.nodeSize;
    });
    view.dispatch(tr);
    return;
  }
}
