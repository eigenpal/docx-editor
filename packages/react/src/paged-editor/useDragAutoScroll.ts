/**
 * Drag Auto-Scroll Hook
 *
 * When the user is drag-selecting text and moves the mouse near the
 * top or bottom edge of the scroll container, this hook auto-scrolls
 * the container and continues extending the selection.
 */

import { useCallback, useRef } from 'react';

/** Pixel distance from container edge where auto-scroll activates. */
const EDGE_ZONE = 40;
/** Maximum scroll speed in pixels per frame (~60fps). */
const MAX_SPEED = 12;

export interface DragAutoScrollOptions {
  /** Ref to the pages container (used to find the scroll parent). */
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Called during auto-scroll to extend the selection at the current mouse position. */
  onScrollExtendSelection: (clientX: number, clientY: number) => void;
}

/**
 * Find the nearest scrollable ancestor.
 */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent && parent !== document.documentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
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
    scrollParentRef.current = findScrollParent(pages);
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

    let scrollDelta = 0;

    if (my < rect.top + EDGE_ZONE) {
      // Near top edge — scroll up
      const proximity = Math.max(0, rect.top + EDGE_ZONE - my);
      scrollDelta = -Math.min(MAX_SPEED, (proximity / EDGE_ZONE) * MAX_SPEED);
    } else if (my > rect.bottom - EDGE_ZONE) {
      // Near bottom edge — scroll down
      const proximity = Math.max(0, my - (rect.bottom - EDGE_ZONE));
      scrollDelta = Math.min(MAX_SPEED, (proximity / EDGE_ZONE) * MAX_SPEED);
    }

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
