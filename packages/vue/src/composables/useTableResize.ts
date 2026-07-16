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
import {
  readColumnWidths,
  readRowHeight,
  readColumnWidthAt,
  commitColumnResize,
  commitRowResize,
  commitRightEdgeResize,
  TWIPS_PER_PIXEL,
  MIN_CELL_WIDTH_TWIPS,
  MIN_ROW_HEIGHT_TWIPS,
} from '@docx-editor.dev/core/prosemirror/tableResize';

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

export interface UseTableResizeReturn {
  tryStartResize: (e: MouseEvent, view: EditorView) => boolean;
  install: () => () => void;
  isResizing: () => boolean;
}

export function useTableResize(): UseTableResizeReturn {
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
      seedColumnWidths(view, col);
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
      seedRowHeight(view, row, target);
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
      seedRightEdgeWidth(view, edge);
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
      const deltaTwips = Math.round(delta * TWIPS_PER_PIXEL);
      const newLeft = col.origWidths.left + deltaTwips;
      const newRight = col.origWidths.right - deltaTwips;
      if (newLeft >= MIN_CELL_WIDTH_TWIPS && newRight >= MIN_CELL_WIDTH_TWIPS) {
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
      const deltaTwips = Math.round(delta * TWIPS_PER_PIXEL);
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
      const deltaTwips = Math.round(delta * TWIPS_PER_PIXEL);
      const newWidth = edge.origWidth + deltaTwips;
      if (newWidth >= MIN_CELL_WIDTH_TWIPS) {
        edge.origWidth = newWidth;
      }
    }
  }

  function handleUp(_e: MouseEvent) {
    if (col.active) {
      col.active = false;
      col.handle?.classList.remove('dragging');
      if (viewRef)
        commitColumnResize(viewRef, {
          docFrom: col.tablePmStart,
          colIdx: col.columnIndex,
          newLeft: col.origWidths.left,
          newRight: col.origWidths.right,
        });
      col.handle = null;
      return;
    }
    if (row.active) {
      row.active = false;
      row.handle?.classList.remove('dragging');
      if (viewRef)
        commitRowResize(viewRef, {
          docFrom: row.tablePmStart,
          rowIdx: row.rowIndex,
          newHeight: row.origHeight,
        });
      row.handle = null;
      return;
    }
    if (edge.active) {
      edge.active = false;
      edge.handle?.classList.remove('dragging');
      if (viewRef)
        commitRightEdgeResize(viewRef, {
          docFrom: edge.tablePmStart,
          colIdx: edge.columnIndex,
          newWidth: edge.origWidth,
        });
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

// ─── FSM-state ⇆ core adapters ─────────────────────────────────────────────
// The pure PM readers/commits live in core (shared with React). These thin
// wrappers translate between Vue's FSM-state objects and core's explicit
// param shape, and own the DOM row-height estimate when the row has no
// stored height (matching React's FSM).

function seedColumnWidths(view: EditorView, col: ColumnResizeState) {
  const w = readColumnWidths(view, col.tablePmStart, col.columnIndex);
  if (w) col.origWidths = w;
}

function seedRowHeight(view: EditorView, row: RowResizeState, target: HTMLElement) {
  const stored = readRowHeight(view, row.tablePmStart, row.rowIndex);
  if (stored != null) {
    row.origHeight = stored;
    return;
  }
  // Estimate from rendered height when the row has no explicit height.
  const tableEl = target.closest('.layout-table');
  const rowEl = tableEl?.querySelector(`[data-row-index="${row.rowIndex}"]`);
  const renderedHeight = rowEl ? (rowEl as HTMLElement).getBoundingClientRect().height : 30;
  row.origHeight = Math.round(renderedHeight * TWIPS_PER_PIXEL);
}

function seedRightEdgeWidth(view: EditorView, edge: RightEdgeResizeState) {
  const w = readColumnWidthAt(view, edge.tablePmStart, edge.columnIndex);
  if (w != null) edge.origWidth = w;
}
