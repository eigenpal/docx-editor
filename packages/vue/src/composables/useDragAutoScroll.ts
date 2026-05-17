/**
 * Vue port of packages/react/src/paged-editor/useDragAutoScroll.ts.
 *
 * When the user is drag-selecting text and moves the mouse near the
 * top or bottom edge of the scroll container, this composable
 * auto-scrolls the container and continues extending the selection.
 *
 * Same numeric constants (40px edge zone, 12px/frame max speed) as
 * the React hook so the two adapters feel identical under drag.
 */
import { onBeforeUnmount, type Ref } from 'vue';
import { findVerticalScrollParent } from '@eigenpal/docx-editor-core/utils/findVerticalScrollParent';

const EDGE_ZONE = 40;
const MAX_SPEED = 12;

export interface DragAutoScrollOptions {
  pagesContainer: Ref<HTMLElement | null>;
  /** Called during auto-scroll to extend the selection at the current mouse position. */
  onScrollExtendSelection: (clientX: number, clientY: number) => void;
}

export function useDragAutoScroll({
  pagesContainer,
  onScrollExtendSelection,
}: DragAutoScrollOptions) {
  let rafId: number | null = null;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let active = false;
  let scrollParent: HTMLElement | null = null;

  function getScrollParent(): HTMLElement | null {
    if (scrollParent) return scrollParent;
    const pages = pagesContainer.value;
    if (!pages) return null;
    scrollParent = findVerticalScrollParent(pages);
    return scrollParent;
  }

  function stopAutoScroll() {
    active = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function tick() {
    if (!active) return;
    const container = getScrollParent();
    if (!container) return;

    const rect = container.getBoundingClientRect();
    let scrollDelta = 0;
    if (lastMouseY < rect.top + EDGE_ZONE) {
      const proximity = Math.max(0, rect.top + EDGE_ZONE - lastMouseY);
      scrollDelta = -Math.min(MAX_SPEED, (proximity / EDGE_ZONE) * MAX_SPEED);
    } else if (lastMouseY > rect.bottom - EDGE_ZONE) {
      const proximity = Math.max(0, lastMouseY - (rect.bottom - EDGE_ZONE));
      scrollDelta = Math.min(MAX_SPEED, (proximity / EDGE_ZONE) * MAX_SPEED);
    }

    if (scrollDelta !== 0) {
      container.scrollTop += scrollDelta;
      onScrollExtendSelection(lastMouseX, lastMouseY);
    }
    rafId = requestAnimationFrame(tick);
  }

  function startAutoScroll() {
    if (active) return;
    active = true;
    rafId = requestAnimationFrame(tick);
  }

  /**
   * Call on every mousemove during drag.
   */
  function updateMousePosition(clientX: number, clientY: number) {
    lastMouseX = clientX;
    lastMouseY = clientY;
    if (!active) {
      const container = getScrollParent();
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (clientY < rect.top + EDGE_ZONE || clientY > rect.bottom - EDGE_ZONE) {
        startAutoScroll();
      }
    }
  }

  onBeforeUnmount(() => stopAutoScroll());

  return { updateMousePosition, stopAutoScroll };
}
