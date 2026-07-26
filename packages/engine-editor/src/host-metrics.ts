// Adapter-supplied scroll/zoom metrics for client/content mapping (interactive-paginated 4.8).
// Adapters call this from EditorHost.getInteractionHostMetrics — they MUST NOT derive document
// geometry from painted DOM; only read scroll container client box, scroll offsets, and zoom.

import type { InteractionHostMetrics } from '@docx-editor.dev/core-contract/interaction';

/**
 * Measure host metrics from the element that hosts the painted page stack, plus
 * the adapter paint zoom factor.
 *
 * Pass the **pages stack**, not the scroll container. The engine publishes page
 * boxes starting at content (0, 0), so the client origin it needs is the origin
 * of that stack. A live `getBoundingClientRect()` on the stack already accounts
 * for scroll position and for the stack being centered inside a wider viewport,
 * and its own `scrollLeft`/`scrollTop` are 0 — so nothing is double-counted.
 * Measuring the scroll container instead shifts every hit test by the centering
 * offset, which lands clicks outside page geometry and rejects them.
 *
 * `transform-origin` on the stack must be its top-left corner, so scaling never
 * moves that origin and client-to-content stays a plain divide by zoom.
 */
export function measureInteractionHostMetrics(
  pagesEl: HTMLElement,
  zoom: number
): InteractionHostMetrics {
  const rect = pagesEl.getBoundingClientRect();
  return {
    clientOrigin: { x: rect.left, y: rect.top },
    scrollOffset: { x: pagesEl.scrollLeft, y: pagesEl.scrollTop },
    zoom,
  };
}
