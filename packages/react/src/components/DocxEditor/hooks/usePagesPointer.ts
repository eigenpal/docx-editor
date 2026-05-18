/**
 * Pointer-routing hook for PagedEditor.
 *
 * Owns every mouse path that lands on the visible pages: cursor placement,
 * drag-to-select (with cell-selection promotion when the drag crosses a
 * table boundary), table column / row / right-edge resize handles, the
 * floating "+" row/column insert button, image clicks, hyperlink and
 * header/footer double-clicks, word and paragraph multi-click selection,
 * and the right-click → host context-menu callback.
 *
 * Lots of state. Most lives in refs because the handlers run from window
 * listeners (handleMouseMove, handleMouseUp) where stale-closure traps
 * would be lethal — refs are read at event time, not capture time.
 *
 * `dragExtendRef` is the trampoline that lets `useDragAutoScroll`'s
 * auto-extend callback reach `getPositionFromMouse` without the two
 * forming a closure cycle. The trampoline is assigned after the hook's
 * `useCallback`s so the wire-up sees the latest `getPositionFromMouse`
 * identity on every render.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeSelection, TextSelection } from 'prosemirror-state';

import type { CaretPosition, SelectionBox } from '@eigenpal/docx-editor-core/layout-bridge';
import {
  pointerToDocPos,
  resolveDomPosition,
  detectTableInsertHover,
  resolveFragmentHit,
  resolveTableCellHit,
  TABLE_INSERT_HIDE_DELAY_MS as TABLE_INSERT_HIDE_DELAY,
} from '@eigenpal/docx-editor-core/layout-bridge';
import type { FlowBlock, Layout, Measure } from '@eigenpal/docx-editor-core/layout-engine';
import { addColumnRight, addRowBelow } from '@eigenpal/docx-editor-core/prosemirror';
import {
  captureInlinePositionEmu,
  findImageElement as coreFindImageElement,
  pointerHitResolveImage,
} from '@eigenpal/docx-editor-core/layout-painter';
import type { WrapType } from '@eigenpal/docx-editor-core/docx/wrapTypes';
import { findWordBoundaries } from '@eigenpal/docx-editor-core/utils';

import type { OffscreenEditorHostRef } from '../OffscreenEditorHost';
import type { ImageSelectionInfo } from '../overlays/ImageSelectionOverlay';
import { useDragAutoScroll } from '../../../hooks/useDragAutoScroll';
import { useTableResizeState } from './useTableResizeState';

const CELL_SELECT_OVERFLOW_PX = 5;

interface TableInsertButtonState {
  type: 'row' | 'column';
  /** Pixel position relative to viewport container */
  x: number;
  y: number;
  /** PM position inside target cell (to set selection before dispatching) */
  cellPmPos: number;
}

interface ImageInfo {
  pos: number;
  wrapType: WrapType;
  cssFloat?: 'left' | 'right' | 'none' | null;
  inlinePositionEmu?: { horizontalEmu: number; verticalEmu: number };
}

export interface UsePagesPointerOptions {
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  hiddenPMRef: React.RefObject<OffscreenEditorHostRef | null>;
  layout: Layout | null;
  blocks: FlowBlock[];
  measures: Measure[];
  zoom: number;
  readOnly: boolean;
  hfEditMode?: 'header' | 'footer' | null;
  onBodyClick?: () => void;
  onContextMenu?: (data: {
    x: number;
    y: number;
    hasSelection: boolean;
    image?: ImageInfo | null;
  }) => void;
  onHyperlinkClick?: (data: {
    href: string;
    displayText: string;
    tooltip?: string;
    position: { top: number; left: number };
  }) => void;
  onHeaderFooterDoubleClick?: (position: 'header' | 'footer', pageNumber?: number) => void;
  setSelectedImageInfo: React.Dispatch<React.SetStateAction<ImageSelectionInfo | null>>;
  setSelectionGeometry: React.Dispatch<React.SetStateAction<SelectionBox[]>>;
  setCaretPosition: React.Dispatch<React.SetStateAction<CaretPosition | null>>;
  buildImageSelectionInfo: (el: HTMLElement, pmPos: number) => ImageSelectionInfo;
  setIsFocused: React.Dispatch<React.SetStateAction<boolean>>;
  scrollToPositionImpl: (pmPos: number, forParaIdScroll?: boolean) => void;
}

export interface UsePagesPointerReturn {
  handlePagesMouseDown: (e: React.MouseEvent) => void;
  handlePagesMouseMove: (e: React.MouseEvent) => void;
  handlePagesClick: (e: React.MouseEvent) => void;
  handlePagesContextMenu: (e: React.MouseEvent) => void;
  handleTableInsertClick: (e: React.MouseEvent) => void;
  tableInsertButton: TableInsertButtonState | null;
  /** Cancel a pending delayed-hide so hovering the button keeps it visible. */
  clearTableInsertTimer: () => void;
  /** Hide the button immediately (used by the button's onMouseLeave). */
  hideTableInsertButton: () => void;
  getPositionFromMouse: (clientX: number, clientY: number) => number | null;
}

export function usePagesPointer(opts: UsePagesPointerOptions): UsePagesPointerReturn {
  const {
    pagesContainerRef,
    hiddenPMRef,
    layout,
    blocks,
    measures,
    zoom,
    readOnly,
    hfEditMode,
    onBodyClick,
    onContextMenu,
    onHyperlinkClick,
    onHeaderFooterDoubleClick,
    setSelectedImageInfo,
    setSelectionGeometry,
    setCaretPosition,
    buildImageSelectionInfo,
    setIsFocused,
    scrollToPositionImpl,
  } = opts;

  // Drag selection state
  const isDraggingRef = useRef(false);
  const dragAnchorRef = useRef<number | null>(null);

  // Table resize state machine (column-between, row, right-edge handles).
  const tableResize = useTableResizeState({ hiddenPMRef });

  // Cell selection drag state
  const isCellDraggingRef = useRef(false);
  const cellDragAnchorPosRef = useRef<number | null>(null);
  const cellDragLastPmPosRef = useRef<number | null>(null);
  const cellDragOverflowXRef = useRef<number | null>(null);

  // Table insert button state + delayed-hide timer
  const [tableInsertButton, setTableInsertButton] = useState<TableInsertButtonState | null>(null);
  const tableInsertHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTableInsertTimer = useCallback(() => {
    if (tableInsertHideTimerRef.current) {
      clearTimeout(tableInsertHideTimerRef.current);
      tableInsertHideTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (tableInsertHideTimerRef.current) clearTimeout(tableInsertHideTimerRef.current);
    };
  }, []);

  // Trampoline so useDragAutoScroll's callback can reach getPositionFromMouse
  // without forming a closure cycle. Assigned every render below.
  const dragExtendRef = useRef<(cx: number, cy: number) => void>(() => {});

  const dragAutoScrollCallbackRef = useCallback((cx: number, cy: number) => {
    dragExtendRef.current(cx, cy);
  }, []);
  const { updateMousePosition: updateDragScroll, stopAutoScroll: stopDragAutoScroll } =
    useDragAutoScroll({
      pagesContainerRef,
      onScrollExtendSelection: dragAutoScrollCallbackRef,
    });

  /**
   * Convert mouse coords to a PM position. DOM-based mapping first
   * (handles transforms, zoom, line-wraps); falls back to geometry hit
   * tests when the DOM doesn't resolve (e.g. clicks above/below content).
   */
  const getPositionFromMouse = useCallback(
    (clientX: number, clientY: number): number | null => {
      if (!pagesContainerRef.current || !layout) return null;

      const domPos = resolveDomPosition(pagesContainerRef.current, clientX, clientY, zoom);
      if (domPos !== null) return domPos;

      const pageElements = pagesContainerRef.current.querySelectorAll('.layout-page');
      let clickedPageIndex = -1;
      let pageRect: DOMRect | null = null;

      for (let i = 0; i < pageElements.length; i++) {
        const pageEl = pageElements[i];
        const rect = pageEl.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          clickedPageIndex = i;
          pageRect = rect;
          break;
        }
      }

      if (clickedPageIndex < 0 || !pageRect) return null;

      const pageX = (clientX - pageRect.left) / zoom;
      const pageY = (clientY - pageRect.top) / zoom;
      const page = layout.pages[clickedPageIndex];
      if (!page) return null;

      const pageHit = { pageIndex: clickedPageIndex, page, pageY };
      const fragmentHit = resolveFragmentHit(pageHit, blocks, measures, { x: pageX, y: pageY });
      if (!fragmentHit) return null;

      if (fragmentHit.fragment.kind === 'table') {
        const tableCellHit = resolveTableCellHit(pageHit, blocks, measures, {
          x: pageX,
          y: pageY,
        });
        return pointerToDocPos(fragmentHit, tableCellHit);
      }
      return pointerToDocPos(fragmentHit);
    },
    [layout, blocks, measures, zoom, pagesContainerRef]
  );

  /**
   * Walk up from a PM position to find the enclosing tableCell / tableHeader.
   * Returns the cell's `before(d)` so CellSelection.create can resolve via
   * cellAround() internally.
   */
  const findCellPosFromPmPos = useCallback(
    (pmPos: number): number | null => {
      const view = hiddenPMRef.current?.getView();
      if (!view) return null;
      try {
        const $pos = view.state.doc.resolve(pmPos);
        for (let d = $pos.depth; d > 0; d--) {
          const node = $pos.node(d);
          if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
            return $pos.before(d);
          }
        }
      } catch {
        // Stale PM position.
      }
      return null;
    },
    [hiddenPMRef]
  );

  const handlePagesMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!hiddenPMRef.current) return;

      // Right-click: stop Firefox from resetting selection, but skip our routing.
      if (e.button === 2) {
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;

      // Any mousedown hides the floating table-insert button.
      setTableInsertButton(null);
      clearTableInsertTimer();

      // Prevent native hyperlink navigation but let the rest of the handler
      // run so cursor placement / drag-selection still work. The popup is
      // shown on click (mouseup) instead.
      const anchorEl = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (anchorEl) e.preventDefault();

      if (readOnly) return;

      // HF edit mode: clicks outside header/footer area close the HF editor.
      if (hfEditMode && onBodyClick) {
        const target = e.target as HTMLElement;
        const isInHfArea =
          target.closest('.layout-page-header') ||
          target.closest('.layout-page-footer') ||
          target.closest('.hf-inline-editor');
        if (!isInHfArea) {
          e.preventDefault();
          e.stopPropagation();
          onBodyClick();
          return;
        }
      }

      // Normal mode: clicks in H/F area place cursor at start of body content
      // (matches Word + Google Docs behavior).
      if (!hfEditMode) {
        const target = e.target as HTMLElement;
        const isInHfArea =
          target.closest('.layout-page-header') || target.closest('.layout-page-footer');
        if (isInHfArea) {
          e.preventDefault();
          hiddenPMRef.current.setSelection(0);
          hiddenPMRef.current.focus();
          setIsFocused(true);
          return;
        }
      }

      const target = e.target as HTMLElement;

      // Table resize handles (column-between, row, right-edge).
      if (tableResize.tryStartFromMouseDown(target, e)) return;

      // Image click → NodeSelection on the image, suppress text overlay.
      const imageEl = coreFindImageElement(target);
      if (imageEl) {
        e.preventDefault();
        e.stopPropagation();
        const docFrom = imageEl.dataset.docFrom;
        if (docFrom !== undefined) {
          const pos = parseInt(docFrom, 10);
          hiddenPMRef.current.setNodeSelection(pos);
          setSelectedImageInfo(buildImageSelectionInfo(imageEl, pos));
          setSelectionGeometry([]);
          setCaretPosition(null);
        }
        hiddenPMRef.current.focus();
        setIsFocused(true);
        return;
      }

      // Click outside an image clears the image selection.
      setSelectedImageInfo(null);
      e.preventDefault();

      const pmPos = getPositionFromMouse(e.clientX, e.clientY);
      if (pmPos !== null) {
        // Track for potential text-drag → cell-drag promotion.
        const cellPos = findCellPosFromPmPos(pmPos);
        cellDragAnchorPosRef.current = cellPos;
        isCellDraggingRef.current = false;
        cellDragLastPmPosRef.current = null;
        cellDragOverflowXRef.current = null;
        isDraggingRef.current = true;
        dragAnchorRef.current = pmPos;
        hiddenPMRef.current.setSelection(pmPos);
      } else {
        // Click outside content — move cursor to end.
        cellDragAnchorPosRef.current = null;
        isCellDraggingRef.current = false;
        const view = hiddenPMRef.current.getView();
        if (view) {
          const endPos = Math.max(0, view.state.doc.content.size - 1);
          hiddenPMRef.current.setSelection(endPos);
          dragAnchorRef.current = endPos;
          isDraggingRef.current = true;
        }
      }

      hiddenPMRef.current.focus();
      setIsFocused(true);
    },
    [
      hiddenPMRef,
      readOnly,
      hfEditMode,
      onBodyClick,
      getPositionFromMouse,
      findCellPosFromPmPos,
      clearTableInsertTimer,
      setSelectedImageInfo,
      setSelectionGeometry,
      setCaretPosition,
      buildImageSelectionInfo,
      setIsFocused,
    ]
  );

  // Re-wire the drag trampoline every render so it sees the latest
  // `getPositionFromMouse` closure.
  dragExtendRef.current = (cx: number, cy: number) => {
    if (!isDraggingRef.current || dragAnchorRef.current === null) return;
    if (!hiddenPMRef.current) return;
    const pmPos = getPositionFromMouse(cx, cy);
    if (pmPos === null) return;
    hiddenPMRef.current.setSelection(dragAnchorRef.current, pmPos);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      // Table resize drag — one of column / row / right-edge updates the
      // visual handle and the tentative width / height.
      if (tableResize.handleMouseMoveUpdate(e)) return;

      if (!isDraggingRef.current || dragAnchorRef.current === null) return;
      if (!hiddenPMRef.current || !pagesContainerRef.current) return;

      updateDragScroll(e.clientX, e.clientY);

      const pmPos = getPositionFromMouse(e.clientX, e.clientY);
      if (pmPos === null) return;

      // Drag started inside a table cell — promote to CellSelection when the
      // drag crosses the cell boundary, otherwise stay in text selection.
      if (cellDragAnchorPosRef.current !== null) {
        if (isCellDraggingRef.current) {
          const currentCellPos = findCellPosFromPmPos(pmPos);
          if (currentCellPos !== null) {
            hiddenPMRef.current.setCellSelection(cellDragAnchorPosRef.current, currentCellPos);
            return;
          }
        }

        const currentCellPos = findCellPosFromPmPos(pmPos);
        if (currentCellPos !== null && currentCellPos !== cellDragAnchorPosRef.current) {
          isCellDraggingRef.current = true;
          hiddenPMRef.current.setCellSelection(cellDragAnchorPosRef.current, currentCellPos);
          cellDragOverflowXRef.current = null;
          return;
        }

        // Text selection has maxed out within the cell: if pmPos stops changing
        // while the mouse keeps moving, the user has dragged past content. Once
        // the overflow threshold is reached, promote to a full-cell selection.
        if (cellDragLastPmPosRef.current !== null && pmPos === cellDragLastPmPosRef.current) {
          if (cellDragOverflowXRef.current === null) {
            cellDragOverflowXRef.current = e.clientX;
          } else if (
            Math.abs(e.clientX - cellDragOverflowXRef.current) >= CELL_SELECT_OVERFLOW_PX
          ) {
            isCellDraggingRef.current = true;
            hiddenPMRef.current.setCellSelection(
              cellDragAnchorPosRef.current,
              cellDragAnchorPosRef.current
            );
            cellDragOverflowXRef.current = null;
            return;
          }
        } else {
          cellDragOverflowXRef.current = null;
          cellDragLastPmPosRef.current = pmPos;
        }
      }

      // Regular text-selection drag (outside tables, or inside a single cell).
      const anchor = dragAnchorRef.current;
      hiddenPMRef.current.setSelection(anchor, pmPos);
    },
    [getPositionFromMouse, findCellPosFromPmPos, updateDragScroll, hiddenPMRef, pagesContainerRef]
  );

  const handleMouseUp = useCallback(() => {
    // Resize commit (column / row / right-edge) takes priority.
    if (tableResize.tryCommit()) return;

    isDraggingRef.current = false;
    isCellDraggingRef.current = false;
    cellDragLastPmPosRef.current = null;
    cellDragOverflowXRef.current = null;
    stopDragAutoScroll();
    // Keep dragAnchorRef for potential shift-click extension.
  }, [stopDragAutoScroll, tableResize]);

  // Global mousemove / mouseup listeners — drag selection escapes the
  // pagesContainer once you mouse out of it, so the listeners must live on
  // window.
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handlePagesMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Skip during drags / resizes.
      if (
        readOnly ||
        isDraggingRef.current ||
        isCellDraggingRef.current ||
        tableResize.isAnyResizeActive()
      )
        return;

      const pagesEl = pagesContainerRef.current;
      if (!pagesEl) return;

      const hit = detectTableInsertHover({
        mouseX: e.clientX,
        mouseY: e.clientY,
        pagesContainer: pagesEl,
        target: e.target as HTMLElement,
        hfEditMode: hfEditMode ?? null,
      });

      if (!hit) {
        // Brief moves between cells flicker the button; schedule a delayed
        // hide instead of clearing immediately. detectTableInsertHover
        // returns null for both "no nearby table" and "near table but not
        // over a row/column"; both deserve the same delayed-hide UX.
        if (!tableInsertHideTimerRef.current) {
          tableInsertHideTimerRef.current = setTimeout(() => {
            setTableInsertButton(null);
            tableInsertHideTimerRef.current = null;
          }, TABLE_INSERT_HIDE_DELAY);
        }
        return;
      }

      const viewportEl = pagesEl.parentElement;
      if (!viewportEl) return;
      const viewportRect = viewportEl.getBoundingClientRect();
      setTableInsertButton({
        type: hit.type,
        x: hit.clientX - viewportRect.left,
        y: hit.clientY - viewportRect.top,
        cellPmPos: hit.cellPmPos,
      });
      clearTableInsertTimer();
    },
    [readOnly, clearTableInsertTimer, hfEditMode, pagesContainerRef]
  );

  const handleTableInsertClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!tableInsertButton || !hiddenPMRef.current) return;
      const view = hiddenPMRef.current.getView();
      if (!view) return;

      const { type, cellPmPos } = tableInsertButton;
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPmPos + 1));
      view.dispatch(tr);

      if (type === 'row') {
        addRowBelow(view.state, view.dispatch);
      } else {
        addColumnRight(view.state, view.dispatch);
      }

      setTableInsertButton(null);
      hiddenPMRef.current.focus();
    },
    [tableInsertButton, hiddenPMRef]
  );

  const handlePagesClick = useCallback(
    (e: React.MouseEvent) => {
      // Hyperlink: bookmark anchor (#name) or external href.
      const anchorEl = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (anchorEl) {
        e.preventDefault();
        const href = anchorEl.getAttribute('href') || '';
        if (href.startsWith('#')) {
          const bookmarkName = href.substring(1);
          if (bookmarkName && hiddenPMRef.current) {
            const view = hiddenPMRef.current.getView();
            if (view) {
              let targetPos: number | null = null;
              view.state.doc.descendants((node, pos) => {
                if (targetPos !== null) return false;
                if (node.type.name === 'paragraph') {
                  const bookmarks = node.attrs.bookmarks as
                    | Array<{ id: number; name: string }>
                    | undefined;
                  if (bookmarks?.some((b) => b.name === bookmarkName)) {
                    targetPos = pos;
                    return false;
                  }
                }
              });
              if (targetPos !== null) {
                scrollToPositionImpl(targetPos);
                hiddenPMRef.current.setSelection(targetPos + 1);
              }
            }
          }
        } else if (onHyperlinkClick) {
          // External hyperlink — show popup unless this is a drag-to-select.
          const view = hiddenPMRef.current?.getView();
          const hasRangeSelection = view && view.state.selection.from !== view.state.selection.to;
          if (!hasRangeSelection) {
            const displayText = anchorEl.textContent || '';
            const tooltip = anchorEl.getAttribute('title') || undefined;
            // Compute the popup position in the PagedEditor root container's
            // coordinate space. The popup renders inside that container with
            // `position: absolute`, so the browser handles repositioning on
            // scroll for free — no JS listener needed.
            const root = anchorEl.closest('.ep-root.paged-editor') as HTMLElement | null;
            if (root) {
              const rootRect = root.getBoundingClientRect();
              const linkRect = anchorEl.getBoundingClientRect();
              const position = {
                top: linkRect.bottom - rootRect.top + 4,
                left: linkRect.left - rootRect.left,
              };
              onHyperlinkClick({ href, displayText, tooltip, position });
            }
          }
        }
        return;
      }

      // Double-click on header/footer area → enter HF editing mode.
      if (e.detail === 2 && onHeaderFooterDoubleClick) {
        const target = e.target as HTMLElement;
        const headerEl = target.closest('.layout-page-header');
        const footerEl = target.closest('.layout-page-footer');
        if (headerEl || footerEl) {
          const pageEl = target.closest('[data-page-number]') as HTMLElement | null;
          const pageNum = pageEl ? Number(pageEl.dataset.pageNumber) : 1;
          if (headerEl) {
            e.preventDefault();
            e.stopPropagation();
            onHeaderFooterDoubleClick('header', pageNum);
            return;
          }
          if (footerEl) {
            e.preventDefault();
            e.stopPropagation();
            onHeaderFooterDoubleClick('footer', pageNum);
            return;
          }
        }
      }

      // Double-click: cell selection if inside a table, otherwise word selection.
      if (e.detail === 2 && hiddenPMRef.current) {
        const pmPos = getPositionFromMouse(e.clientX, e.clientY);
        if (pmPos !== null) {
          const cellPos = findCellPosFromPmPos(pmPos);
          if (cellPos !== null) {
            e.preventDefault();
            e.stopPropagation();
            hiddenPMRef.current.setCellSelection(cellPos, cellPos);
            return;
          }

          const view = hiddenPMRef.current.getView();
          if (view) {
            const { doc } = view.state;
            const $pos = doc.resolve(pmPos);
            const parent = $pos.parent;
            if (parent.isTextblock) {
              const text = parent.textContent;
              const offset = $pos.parentOffset;
              const [start, end] = findWordBoundaries(text, offset);
              const absStart = $pos.start() + start;
              const absEnd = $pos.start() + end;
              if (absStart < absEnd) {
                hiddenPMRef.current.setSelection(absStart, absEnd);
              }
            }
          }
        }
      }

      // Triple-click: paragraph selection.
      if (e.detail === 3 && hiddenPMRef.current) {
        const pmPos = getPositionFromMouse(e.clientX, e.clientY);
        if (pmPos !== null) {
          const view = hiddenPMRef.current.getView();
          if (view) {
            const { doc } = view.state;
            const $pos = doc.resolve(pmPos);
            const paragraphStart = $pos.start($pos.depth);
            const paragraphEnd = $pos.end($pos.depth);
            hiddenPMRef.current.setSelection(paragraphStart, paragraphEnd);
          }
        }
      }
    },
    [
      getPositionFromMouse,
      onHeaderFooterDoubleClick,
      onHyperlinkClick,
      hiddenPMRef,
      findCellPosFromPmPos,
      scrollToPositionImpl,
    ]
  );

  const handlePagesContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!onContextMenu) return;
      e.preventDefault();

      const view = hiddenPMRef.current?.getView();
      if (!view) return;

      // Two routes land here. The cheap one — right-clicking a non-selected
      // image — surfaces the image element as e.target and we walk up. The
      // harder one is when PM already has a NodeSelection on the image
      // (because the user clicked it once first): PM mounts a selection
      // overlay that swallows pointer events, so e.target lands on the
      // overlay, not on .layout-page-floating-image etc. Fall through to
      // the current selection in that case.
      const readImageNodeAt = (pos: number): ImageInfo | null => {
        const node = view.state.doc.nodeAt(pos);
        if (!node || node.type.name !== 'image') return null;
        const wrapType = (node.attrs.wrapType as WrapType | undefined) ?? 'inline';
        const cssFloat = node.attrs.cssFloat as ImageInfo['cssFloat'];
        return { pos, wrapType, cssFloat };
      };

      let imageInfo: ImageInfo | null = null;
      const hit = pointerHitResolveImage(e.target);
      if (hit) {
        imageInfo = readImageNodeAt(hit.pos);
        if (imageInfo) {
          imageInfo.inlinePositionEmu = captureInlinePositionEmu(hit.imageEl, zoom);
        }
      }
      if (!imageInfo) {
        const sel = view.state.selection;
        if (sel instanceof NodeSelection && sel.node.type.name === 'image') {
          imageInfo = readImageNodeAt(sel.from);
          if (imageInfo) {
            const inlineEl = pagesContainerRef.current?.querySelector(
              `.layout-run-image[data-doc-from="${sel.from}"]`
            ) as HTMLElement | null;
            if (inlineEl) {
              imageInfo.inlinePositionEmu = captureInlinePositionEmu(inlineEl, zoom);
            }
          }
        }
      }

      const { from, to } = view.state.selection;
      const pmPos = getPositionFromMouse(e.clientX, e.clientY);

      // Right-click inside an existing range keeps the selection; otherwise
      // move cursor to the right-click position.
      if (pmPos !== null && (from === to || pmPos < from || pmPos > to)) {
        hiddenPMRef.current?.setSelection(pmPos);
        hiddenPMRef.current?.focus();
        setIsFocused(true);
      }

      const updatedState = hiddenPMRef.current?.getState();
      const hasSelection = updatedState
        ? updatedState.selection.from !== updatedState.selection.to
        : false;

      onContextMenu({ x: e.clientX, y: e.clientY, hasSelection, image: imageInfo });
    },
    // `zoom` is read inside captureInlinePositionEmu to convert post-
    // transform px deltas back to authored space. List it explicitly even
    // though getPositionFromMouse already invalidates on zoom — the dep is
    // direct, not transitive, so it survives a refactor of the sibling.
    [onContextMenu, getPositionFromMouse, zoom, hiddenPMRef, pagesContainerRef, setIsFocused]
  );

  const hideTableInsertButton = useCallback(() => setTableInsertButton(null), []);

  return {
    handlePagesMouseDown,
    handlePagesMouseMove,
    handlePagesClick,
    handlePagesContextMenu,
    handleTableInsertClick,
    tableInsertButton,
    clearTableInsertTimer,
    hideTableInsertButton,
    getPositionFromMouse,
  };
}
