// Adapter-supplied scroll/zoom metrics for client/content mapping (interactive-paginated 4.8).
// Adapters call this from EditorHost.getInteractionHostMetrics — they MUST NOT derive document
// geometry from painted DOM; only read scroll container client box, scroll offsets, and zoom.

import type { InteractionHostMetrics } from '@docx-editor.dev/core-contract/interaction';

/** Measure host metrics from a scroll container and the adapter paint zoom factor. */
export function measureInteractionHostMetrics(scrollEl: HTMLElement, zoom: number): InteractionHostMetrics {
  const rect = scrollEl.getBoundingClientRect();
  return {
    clientOrigin: { x: rect.left, y: rect.top },
    scrollOffset: { x: scrollEl.scrollLeft, y: scrollEl.scrollTop },
    zoom,
  };
}
