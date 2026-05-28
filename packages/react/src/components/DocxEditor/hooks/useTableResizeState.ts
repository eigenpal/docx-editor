/**
 * Table resize state machine for PagedEditor.
 *
 * Owns the three resize modes (column-between, row, table right edge)
 * and exposes them as three boolean-returning callbacks the parent
 * mousedown / mousemove / mouseup handlers route through:
 *
 *   - `tryStartFromMouseDown(target, e)` returns true if the click landed
 *     on a resize handle (and seeds the appropriate ref cluster from the
 *     PM doc's current column-widths / row-height).
 *   - `handleMouseMoveUpdate(e)` returns true if an active resize updated
 *     its visual handle position + tentative width/height.
 *   - `tryCommit()` returns true if a resize was active and just got
 *     baked into the PM doc.
 *
 * Plus `isAnyResizeActive()` so the table-insert-button hover skip can
 * back off cheaply during a resize gesture.
 *
 * Conversion factor: 1px ≈ 15 twips at 96dpi (20 twips/pt × 72pt/in ÷ 96px/in).
 * Min cell width / row height: 300 / 200 twips (~0.2 × 0.14 in).
 */

import { useCallback, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';

import type { OffscreenEditorHostRef } from '../OffscreenEditorHost';
import {
  commitColumnResize,
  commitRightEdgeResize,
  commitRowResize,
  readColumnWidths,
  readLastColumnWidth,
  readRowHeight,
} from '../internals/tableResize';

const TWIPS_PER_PIXEL = 15;
const MIN_CELL_WIDTH_TWIPS = 300;
const MIN_ROW_HEIGHT_TWIPS = 200;

export interface UseTableResizeStateOptions {
  hiddenPMRef: React.RefObject<OffscreenEditorHostRef | null>;
  /**
   * Resolve the HF EditorView the user is currently editing, if any.
   * When the resize handle the user grabbed lives inside `.layout-page-header`
   * or `.layout-page-footer`, the table cells belong to the HF doc and the
   * commit transaction MUST dispatch on this view — not on the body PM, or
   * the body doc gets a stray colWidth change at an out-of-range position.
   */
  getActiveHfView?: () => EditorView | null;
}

export interface UseTableResizeStateReturn {
  tryStartFromMouseDown: (target: HTMLElement, e: React.MouseEvent) => boolean;
  handleMouseMoveUpdate: (e: MouseEvent) => boolean;
  tryCommit: () => boolean;
  isAnyResizeActive: () => boolean;
}

export function useTableResizeState(opts: UseTableResizeStateOptions): UseTableResizeStateReturn {
  const { hiddenPMRef, getActiveHfView } = opts;

  // Captured at tryStart and consulted by mouseup commit — guarantees the
  // resize transaction lands on the view that owns the table even if the
  // user toggles HF mode mid-drag (or focus moves around).
  const resizeTargetViewRef = useRef<EditorView | null>(null);
  function pickViewForHandle(target: HTMLElement): EditorView | null {
    if (target.closest('.layout-page-header') || target.closest('.layout-page-footer')) {
      return getActiveHfView?.() ?? hiddenPMRef.current?.getView() ?? null;
    }
    return hiddenPMRef.current?.getView() ?? null;
  }

  // Column-between resize
  const isResizingColumnRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeColumnIndexRef = useRef(0);
  const resizeTablePmStartRef = useRef(0);
  const resizeOrigWidthsRef = useRef<{ left: number; right: number }>({ left: 0, right: 0 });
  const resizeHandleRef = useRef<HTMLElement | null>(null);

  // Row resize / bottom-edge handle
  const isResizingRowRef = useRef(false);
  const resizeStartYRef = useRef(0);
  const resizeRowIndexRef = useRef(0);
  const resizeRowTablePmStartRef = useRef(0);
  const resizeRowOrigHeightRef = useRef(0);
  const resizeRowHandleRef = useRef<HTMLElement | null>(null);
  const resizeRowIsEdgeRef = useRef(false);

  // Right-edge resize — grows last column only
  const isResizingRightEdgeRef = useRef(false);
  const resizeRightEdgeStartXRef = useRef(0);
  const resizeRightEdgeColIndexRef = useRef(0);
  const resizeRightEdgePmStartRef = useRef(0);
  const resizeRightEdgeOrigWidthRef = useRef(0);
  const resizeRightEdgeHandleRef = useRef<HTMLElement | null>(null);

  const tryStartFromMouseDown = useCallback(
    (target: HTMLElement, e: React.MouseEvent): boolean => {
      // Pick the EditorView that owns the table this handle lives in.
      // Header/footer handles must dispatch on the HF view; body handles on
      // the body PM.
      const view = pickViewForHandle(target);
      if (!view) return false;

      // Column-between resize
      if (target.classList.contains('layout-table-resize-handle')) {
        e.preventDefault();
        e.stopPropagation();
        isResizingColumnRef.current = true;
        resizeStartXRef.current = e.clientX;
        resizeHandleRef.current = target;
        resizeTargetViewRef.current = view;
        target.classList.add('dragging');
        const colIndex = parseInt(target.dataset.columnIndex ?? '0', 10);
        resizeColumnIndexRef.current = colIndex;
        resizeTablePmStartRef.current = parseInt(target.dataset.tablePmStart ?? '0', 10);
        const widths = readColumnWidths(view, resizeTablePmStartRef.current, colIndex);
        if (widths) resizeOrigWidthsRef.current = widths;
        return true;
      }

      // Row resize / bottom-edge handle
      if (
        target.classList.contains('layout-table-row-resize-handle') ||
        target.classList.contains('layout-table-edge-handle-bottom')
      ) {
        e.preventDefault();
        e.stopPropagation();
        isResizingRowRef.current = true;
        resizeStartYRef.current = e.clientY;
        resizeRowHandleRef.current = target;
        resizeRowIsEdgeRef.current = target.dataset.isEdge === 'bottom';
        resizeTargetViewRef.current = view;
        target.classList.add('dragging');
        const rowIndex = parseInt(target.dataset.rowIndex ?? '0', 10);
        resizeRowIndexRef.current = rowIndex;
        resizeRowTablePmStartRef.current = parseInt(target.dataset.tablePmStart ?? '0', 10);
        const height = readRowHeight(view, resizeRowTablePmStartRef.current, rowIndex);
        if (height != null) {
          resizeRowOrigHeightRef.current = height;
        } else {
          // No explicit height — estimate from rendered DOM.
          const tableEl = target.closest('.layout-table');
          const rowEl = tableEl?.querySelector(`[data-row-index="${rowIndex}"]`);
          const renderedHeight = rowEl ? (rowEl as HTMLElement).getBoundingClientRect().height : 30;
          resizeRowOrigHeightRef.current = Math.round(renderedHeight * TWIPS_PER_PIXEL);
        }
        return true;
      }

      // Right-edge resize handle
      if (target.classList.contains('layout-table-edge-handle-right')) {
        e.preventDefault();
        e.stopPropagation();
        isResizingRightEdgeRef.current = true;
        resizeRightEdgeStartXRef.current = e.clientX;
        resizeRightEdgeHandleRef.current = target;
        resizeTargetViewRef.current = view;
        target.classList.add('dragging');
        const colIndex = parseInt(target.dataset.columnIndex ?? '0', 10);
        resizeRightEdgeColIndexRef.current = colIndex;
        resizeRightEdgePmStartRef.current = parseInt(target.dataset.tablePmStart ?? '0', 10);
        const w = readLastColumnWidth(view, resizeRightEdgePmStartRef.current, colIndex);
        if (w != null) resizeRightEdgeOrigWidthRef.current = w;
        return true;
      }

      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pickViewForHandle closes over refs.
    [hiddenPMRef, getActiveHfView]
  );

  const handleMouseMoveUpdate = useCallback((e: MouseEvent): boolean => {
    if (isResizingColumnRef.current) {
      e.preventDefault();
      const delta = e.clientX - resizeStartXRef.current;
      if (resizeHandleRef.current) {
        const origLeft = parseFloat(resizeHandleRef.current.style.left);
        resizeHandleRef.current.style.left = `${origLeft + delta}px`;
        resizeStartXRef.current = e.clientX;
        const deltaTwips = Math.round(delta * TWIPS_PER_PIXEL);
        const newLeft = resizeOrigWidthsRef.current.left + deltaTwips;
        const newRight = resizeOrigWidthsRef.current.right - deltaTwips;
        if (newLeft >= MIN_CELL_WIDTH_TWIPS && newRight >= MIN_CELL_WIDTH_TWIPS) {
          resizeOrigWidthsRef.current = { left: newLeft, right: newRight };
        }
      }
      return true;
    }

    if (isResizingRowRef.current) {
      e.preventDefault();
      const delta = e.clientY - resizeStartYRef.current;
      if (resizeRowHandleRef.current) {
        const origTop = parseFloat(resizeRowHandleRef.current.style.top);
        resizeRowHandleRef.current.style.top = `${origTop + delta}px`;
        resizeStartYRef.current = e.clientY;
        const deltaTwips = Math.round(delta * TWIPS_PER_PIXEL);
        const newHeight = resizeRowOrigHeightRef.current + deltaTwips;
        if (newHeight >= MIN_ROW_HEIGHT_TWIPS) {
          resizeRowOrigHeightRef.current = newHeight;
        }
      }
      return true;
    }

    if (isResizingRightEdgeRef.current) {
      e.preventDefault();
      const delta = e.clientX - resizeRightEdgeStartXRef.current;
      if (resizeRightEdgeHandleRef.current) {
        const origLeft = parseFloat(resizeRightEdgeHandleRef.current.style.left);
        resizeRightEdgeHandleRef.current.style.left = `${origLeft + delta}px`;
        resizeRightEdgeStartXRef.current = e.clientX;
        const deltaTwips = Math.round(delta * TWIPS_PER_PIXEL);
        const newWidth = resizeRightEdgeOrigWidthRef.current + deltaTwips;
        if (newWidth >= MIN_CELL_WIDTH_TWIPS) {
          resizeRightEdgeOrigWidthRef.current = newWidth;
        }
      }
      return true;
    }

    return false;
  }, []);

  const tryCommit = useCallback((): boolean => {
    // Use the view captured at drag-start, NOT a fresh body PM lookup —
    // for header tables this is the HF view, for body tables it's body.
    const view = resizeTargetViewRef.current;

    if (isResizingColumnRef.current) {
      isResizingColumnRef.current = false;
      if (resizeHandleRef.current) {
        resizeHandleRef.current.classList.remove('dragging');
        resizeHandleRef.current = null;
      }
      if (view) {
        const { left: newLeft, right: newRight } = resizeOrigWidthsRef.current;
        commitColumnResize(view, {
          docFrom: resizeTablePmStartRef.current,
          colIdx: resizeColumnIndexRef.current,
          newLeft,
          newRight,
        });
      }
      resizeTargetViewRef.current = null;
      return true;
    }

    if (isResizingRowRef.current) {
      isResizingRowRef.current = false;
      if (resizeRowHandleRef.current) {
        resizeRowHandleRef.current.classList.remove('dragging');
        resizeRowHandleRef.current = null;
      }
      if (view) {
        commitRowResize(view, {
          docFrom: resizeRowTablePmStartRef.current,
          rowIdx: resizeRowIndexRef.current,
          newHeight: resizeRowOrigHeightRef.current,
        });
      }
      resizeTargetViewRef.current = null;
      return true;
    }

    if (isResizingRightEdgeRef.current) {
      isResizingRightEdgeRef.current = false;
      if (resizeRightEdgeHandleRef.current) {
        resizeRightEdgeHandleRef.current.classList.remove('dragging');
        resizeRightEdgeHandleRef.current = null;
      }
      if (view) {
        commitRightEdgeResize(view, {
          docFrom: resizeRightEdgePmStartRef.current,
          colIdx: resizeRightEdgeColIndexRef.current,
          newWidth: resizeRightEdgeOrigWidthRef.current,
        });
      }
      resizeTargetViewRef.current = null;
      return true;
    }

    return false;
  }, []);

  const isAnyResizeActive = useCallback(
    () => isResizingColumnRef.current || isResizingRowRef.current || isResizingRightEdgeRef.current,
    []
  );

  return { tryStartFromMouseDown, handleMouseMoveUpdate, tryCommit, isAnyResizeActive };
}
