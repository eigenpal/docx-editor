/**
 * Drag Auto-Scroll Hook
 *
 * When the user is drag-selecting text and moves the mouse near the
 * top or bottom edge of the scroll container, this hook auto-scrolls
 * the container and continues extending the selection.
 */

import { useCallback, useRef } from 'react';
import { findVerticalScrollParent } from '@eigenpal/docx-editor-core/utils/findVerticalScrollParent';
import {
  AUTO_SCROLL_EDGE_ZONE as EDGE_ZONE,
  computeAutoScrollDelta,
} from '@eigenpal/docx-editor-core/utils/autoScroll';

export interface DragAutoScrollOptions {
  /** Ref to the pages container (used to find the scroll parent). */
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Called during auto-scroll to extend the selection at the current mouse position. */
  onScrollExtendSelection: (clientX: number, clientY: number) => void;
}

export function useDragAutoScroll({
  pagesContainerRef,
  onScrollExtendSelection,
}: DragAutoScrollOptions) {
  const rafIdRef = useRef<number | null>(null);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const activeRef = useRef(false);
  const scrollParentRef = useRef<HTMLElement | null>(null);

  const getScrollParent = useCallback((): HTMLElement | null => {
    if (scrollParentRef.current) return scrollParentRef.current;
    const pages = pagesContainerRef.current;
    if (!pages) return null;
    scrollParentRef.current = findVerticalScrollParent(pages);
    return scrollParentRef.current;
  }, [pagesContainerRef]);

  const stopAutoScroll = useCallback(() => {
    activeRef.current = false;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    if (!activeRef.current) return;

    const container = getScrollParent();
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const { x: mx, y: my } = lastMouseRef.current;

    const scrollDelta = computeAutoScrollDelta(rect, my);

    if (scrollDelta !== 0) {
      container.scrollTop += scrollDelta;
      // After scrolling, extend the selection to the (now shifted) mouse position
      onScrollExtendSelection(mx, my);
    }

    rafIdRef.current = requestAnimationFrame(tick);
  }, [getScrollParent, onScrollExtendSelection]);

  const startAutoScroll = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    rafIdRef.current = requestAnimationFrame(tick);
  }, [tick]);

  /**
   * Call on every mousemove during drag to update the mouse position
   * and start/stop auto-scroll as needed.
   */
  const updateMousePosition = useCallback(
    (clientX: number, clientY: number) => {
      lastMouseRef.current = { x: clientX, y: clientY };
      if (!activeRef.current) {
        const container = getScrollParent();
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (clientY < rect.top + EDGE_ZONE || clientY > rect.bottom - EDGE_ZONE) {
          startAutoScroll();
        }
      }
    },
    [getScrollParent, startAutoScroll]
  );

  return { updateMousePosition, stopAutoScroll };
}
