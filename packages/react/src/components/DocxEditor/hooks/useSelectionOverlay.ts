/**
 * Selection-overlay hook for PagedEditor.
 *
 * Owns the painted selection geometry — caret position, selection rects,
 * selected-image info — plus the DOM-walk that produces them from PM
 * state. Also drives the container `ResizeObserver` and the post-layout
 * recompute, since both routes invalidate the same overlay state.
 *
 * `onSelectionChange` consumers fire only on real PM state changes
 * (immutable reference identity), not on geometry-only redraws — regression
 * #268 traced the sidebar expand → resize → re-fire → collapse loop to
 * this exact distinction.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeSelection } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';

import {
  findBodyPmAnchor,
  getCaretPosition,
  resetImeCaretAnchor,
  rectsForSelection,
  syncImeCaretAnchor,
  type CaretPosition,
  type SelectionBox,
} from '@docx-editor.dev/core/flow-model';
import type {
  ContentNode,
  LayoutMetrics,
  PageLayout,
} from '@docx-editor.dev/core/pagination-model';
import { enclosingSdtGroupIds, applySdtFocus } from '@docx-editor.dev/core/painter-model';

import type { OffscreenEditorHostRef } from '../OffscreenEditorHost';
import type { ImageSelectionInfo } from '../overlays/ImageSelectionOverlay';
import {
  applyCellSelectionHighlight,
  computeSelectionGeometryFromDom,
  getCaretFromDom,
} from '../internals/domSelection';

export interface UseSelectionOverlayOptions {
  pageLayout: PageLayout | null;
  nodes: ContentNode[];
  metrics: LayoutMetrics[];
  zoom: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  hiddenPMRef: React.RefObject<OffscreenEditorHostRef | null>;
  isImageInteractingRef: React.MutableRefObject<boolean>;
  onSelectionChangeRef: React.MutableRefObject<((from: number, to: number) => void) | undefined>;
  requestOverlayRefresh: () => void;
}

export interface UseSelectionOverlayReturn {
  selectionGeometry: SelectionBox[];
  caretPosition: CaretPosition | null;
  selectedImageInfo: ImageSelectionInfo | null;
  setSelectionGeometry: React.Dispatch<React.SetStateAction<SelectionBox[]>>;
  setCaretPosition: React.Dispatch<React.SetStateAction<CaretPosition | null>>;
  setSelectedImageInfo: React.Dispatch<React.SetStateAction<ImageSelectionInfo | null>>;
  buildImageSelectionInfo: (el: HTMLElement, pmPos: number) => ImageSelectionInfo;
  updateSelectionOverlay: (state: EditorState) => void;
  handleSelectionChange: (state: EditorState) => void;
}

export function useSelectionOverlay(opts: UseSelectionOverlayOptions): UseSelectionOverlayReturn {
  const {
    pageLayout,
    nodes,
    metrics,
    zoom,
    containerRef,
    pagesContainerRef,
    hiddenPMRef,
    isImageInteractingRef,
    onSelectionChangeRef,
    requestOverlayRefresh,
  } = opts;

  const [selectionGeometry, setSelectionGeometry] = useState<SelectionBox[]>([]);
  const [caretPosition, setCaretPosition] = useState<CaretPosition | null>(null);
  const [selectedImageInfo, setSelectedImageInfo] = useState<ImageSelectionInfo | null>(null);

  // Last PM state we invoked onSelectionChange for. updateSelectionOverlay
  // runs from ResizeObserver / layout / font-load paths too, not only on real
  // state changes — firing the callback in those cases caused the sidebar
  // expand → resize → re-fire → collapse feedback loop (regression #268).
  const lastNotifiedStateRef = useRef<EditorState | null>(null);

  const buildImageSelectionInfo = useCallback(
    (el: HTMLElement, pmPos: number): ImageSelectionInfo => {
      const imgTag = el.tagName === 'IMG' ? el : el.querySelector('img');
      const rect = (imgTag ?? el).getBoundingClientRect();
      return {
        element: (imgTag ?? el) as HTMLElement,
        pmPos,
        width: Math.round(rect.width / zoom),
        height: Math.round(rect.height / zoom),
      };
    },
    [zoom]
  );

  const updateSelectionOverlay = useCallback(
    (state: EditorState) => {
      const { from, to } = state.selection;

      // Notify consumers only on real PM state changes (see regression #268).
      if (lastNotifiedStateRef.current !== state) {
        lastNotifiedStateRef.current = state;
        onSelectionChangeRef.current?.(from, to);
      }

      const pagesEl = pagesContainerRef.current;
      if (pagesEl) {
        applyCellSelectionHighlight(pagesEl, state);
        // Keep a content control's boundary visible while the caret is inside
        // it (Word-style focus), in addition to the painter's hover reveal.
        applySdtFocus(pagesEl, enclosingSdtGroupIds(state.doc, from, to));
      }

      if (!pageLayout || nodes.length === 0) {
        resetImeCaretAnchor(hiddenPMRef.current?.getHostElement());
        return;
      }

      if (from === to) {
        // Collapsed selection — show caret.
        const domCaret = pagesEl ? getCaretFromDom(pagesEl, from, zoom) : null;
        if (domCaret) {
          setCaretPosition(domCaret);
          const overlay = pagesEl?.parentElement?.querySelector(
            '[data-testid="selection-overlay"]'
          );
          const overlayRect = overlay?.getBoundingClientRect();
          syncImeCaretAnchor({
            hiddenHost: hiddenPMRef.current?.getHostElement(),
            editorView: hiddenPMRef.current?.getView(),
            visibleCaret: overlayRect
              ? {
                  left: overlayRect.left + domCaret.x * zoom,
                  top: overlayRect.top + domCaret.y * zoom,
                }
              : null,
          });
        } else {
          // Fallback to layout-based math when the DOM isn't painted yet.
          const overlay = pagesContainerRef.current?.parentElement?.querySelector(
            '[data-testid="selection-overlay"]'
          );
          const firstPage = pagesContainerRef.current?.querySelector('.layout-page');
          if (overlay && firstPage) {
            const overlayRect = overlay.getBoundingClientRect();
            const pageRect = firstPage.getBoundingClientRect();
            const caret = getCaretPosition(pageLayout, nodes, metrics, from);
            if (caret) {
              const fallbackCaret = {
                ...caret,
                x: caret.x + (pageRect.left - overlayRect.left) / zoom,
                y: caret.y + (pageRect.top - overlayRect.top) / zoom,
              };
              setCaretPosition(fallbackCaret);
              syncImeCaretAnchor({
                hiddenHost: hiddenPMRef.current?.getHostElement(),
                editorView: hiddenPMRef.current?.getView(),
                visibleCaret: {
                  left: overlayRect.left + fallbackCaret.x * zoom,
                  top: overlayRect.top + fallbackCaret.y * zoom,
                },
              });
            } else {
              setCaretPosition(null);
              if (!hiddenPMRef.current?.getView()?.composing) {
                resetImeCaretAnchor(hiddenPMRef.current?.getHostElement());
              }
            }
          } else {
            setCaretPosition(null);
            if (!hiddenPMRef.current?.getView()?.composing) {
              resetImeCaretAnchor(hiddenPMRef.current?.getHostElement());
            }
          }
        }
        setSelectionGeometry([]);
      } else {
        if (!hiddenPMRef.current?.getView()?.composing) {
          resetImeCaretAnchor(hiddenPMRef.current?.getHostElement());
        }
        // Range selection — DOM-walk preferred; fall back to layout math.
        const overlay = pagesContainerRef.current?.parentElement?.querySelector(
          '[data-testid="selection-overlay"]'
        );
        if (overlay && pagesContainerRef.current) {
          const overlayRect = overlay.getBoundingClientRect();
          const domRects = computeSelectionGeometryFromDom(
            pagesContainerRef.current,
            overlayRect,
            from,
            to,
            zoom
          );
          if (domRects.length > 0) {
            setSelectionGeometry(domRects);
          } else {
            const firstPage = pagesContainerRef.current.querySelector('.layout-page');
            if (firstPage) {
              const pageRect = firstPage.getBoundingClientRect();
              const pageOffsetX = (pageRect.left - overlayRect.left) / zoom;
              const pageOffsetY = (pageRect.top - overlayRect.top) / zoom;
              const rects = rectsForSelection(pageLayout, nodes, metrics, from, to);
              const adjustedRects = rects.map((rect) => ({
                ...rect,
                x: rect.x + pageOffsetX,
                y: rect.y + pageOffsetY,
              }));
              setSelectionGeometry(adjustedRects);
            } else {
              setSelectionGeometry([]);
            }
          }
        } else {
          setSelectionGeometry([]);
        }
        setCaretPosition(null);
      }
    },
    [pageLayout, nodes, metrics, zoom, onSelectionChangeRef, pagesContainerRef, hiddenPMRef]
  );

  const handleSelectionChange = useCallback(
    (state: EditorState) => {
      const { selection } = state;
      if (selection instanceof NodeSelection && selection.node.type.name === 'image') {
        // Image NodeSelection suppresses text overlay so the image overlay is the
        // only thing painted over the selection.
        setSelectionGeometry([]);
        setCaretPosition(null);
        resetImeCaretAnchor(hiddenPMRef.current?.getHostElement());
      } else {
        updateSelectionOverlay(state);
      }

      // The readiness guard calls this only after current pages are painted,
      // so image anchors can be resolved synchronously without leaving a
      // deferred DOM read that a newer transaction could overtake.
      const view = hiddenPMRef.current?.getView();
      if (!view) {
        setSelectedImageInfo(null);
        return;
      }
      const { selection: sel } = view.state;
      if (sel instanceof NodeSelection && sel.node.type.name === 'image') {
        const pmPos = sel.from;
        const imgEl = pagesContainerRef.current
          ? findBodyPmAnchor(pagesContainerRef.current, pmPos)
          : null;
        if (imgEl) {
          setSelectedImageInfo(buildImageSelectionInfo(imgEl, pmPos));
          return;
        }
      }
      if (!isImageInteractingRef.current) {
        setSelectedImageInfo(null);
      }
    },
    [
      updateSelectionOverlay,
      buildImageSelectionInfo,
      hiddenPMRef,
      isImageInteractingRef,
      pagesContainerRef,
    ]
  );

  // Re-compute selection overlay when the container resizes (window resize,
  // scrollbar toggle, sidebar open/close). Page elements shift and caret
  // coordinates become stale.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const state = hiddenPMRef.current?.getState();
      if (state) {
        requestOverlayRefresh();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [requestOverlayRefresh, containerRef, hiddenPMRef]);

  return {
    selectionGeometry,
    caretPosition,
    selectedImageInfo,
    setSelectionGeometry,
    setCaretPosition,
    setSelectedImageInfo,
    buildImageSelectionInfo,
    updateSelectionOverlay,
    handleSelectionChange,
  };
}
