/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review rail's geometry, measured from the DOM it hangs beside. Shared by the React and
// Vue rails and by the public `useReviewRailMetrics` hook and composable, so a host's own
// column places cards with the same numbers the packaged rail uses.

import { hostWindowOf } from '@docx-editor.dev/core/editor';

/**
 * Where a review column sits, in the coordinates of the editor's scroll container.
 *
 * Review anchors (`item.anchorY`) and stacked positions (`useStackedReviewPositions`) are in
 * layout points from the top of the first page. These values convert them to CSS pixels.
 *
 * @example Position a card at its stacked anchor
 * ```ts
 * const top = metrics.top + positions.get(item.key)! * metrics.scale;
 * ```
 *
 * @public
 */
export interface ReviewRailMetrics {
  /** CSS pixels per layout point, zoom included. */
  readonly scale: number;
  /**
   * CSS pixels from the top of the scroll container's content to the top of the first page.
   * Content above the pages, such as a host banner, is included. Scrolling does not change it.
   */
  readonly top: number;
  /**
   * CSS pixels from the scroll container's left content edge to the column's left edge: one
   * 16px gutter right of the page. `null` until there is a page to measure.
   */
  readonly left: number | null;
  /**
   * The `left` value, relative to {@link ReviewRailMetrics.left}, that puts a 300px card
   * fully inside the visible area with a 12px inset from its right edge. Use it when the
   * viewport is too narrow for a full column. `null` until there is a page to measure.
   */
  readonly compactCardLeft: number | null;
}

/** The value before the first measurement: 100% zoom, no offset, nothing to place against. */
export const INITIAL_REVIEW_RAIL_METRICS: ReviewRailMetrics = Object.freeze({
  scale: 96 / 72,
  top: 0,
  left: null,
  compactCardLeft: null,
});

/** Space between the page edge and the cards. */
export const RAIL_GUTTER = 16;
/** A compact card is one column-card wide — the width `.docx-review` gives the open rail. */
export const COMPACT_CARD_WIDTH = 300;
/** Air between a compact card's right edge and the viewport's. */
export const COMPACT_CARD_INSET = 12;

/** The one engine read the measurement needs. */
export interface RenderScaleSource {
  getRenderScale(): number;
}

/** The scroll container the rail is positioned in, and the painted surface inside it. */
function railFrame(rail: HTMLElement): { parent: HTMLElement | null; surface: HTMLElement | null } {
  const parent = rail.offsetParent as HTMLElement | null;
  const surface = parent?.querySelector<HTMLElement>('.docx-paginated-surface') ?? null;
  return { parent, surface };
}

/**
 * Where the rail sits, measured from the PAINTED SURFACE rather than from the viewport.
 *
 * Both halves matter. Vertically, the surface's own offset inside the scroll container is
 * whatever chrome the host put above the pages — without it every card is drawn that far
 * too high. Horizontally, the page is centred in a viewport that is usually much wider, so
 * a rail pinned to the right edge floats away from the page it annotates; it belongs one
 * gutter to the right of the sheet.
 *
 * Client rects, not `offsetLeft`/`offsetTop`: those are relative to each element's own
 * `offsetParent`, and a host that positions its page wrapper makes the surface report
 * `offsetLeft: 0` — landing the rail a page-width left, on top of the document. `scrollTop`
 * and `clientTop` put the rects back into the container's content space.
 *
 * `scale` is the engine's own points-to-pixels factor, zoom included. Deriving it from the
 * zoom alone drops the 96/72 and puts every card at three quarters height.
 */
export function measureReviewRailMetrics(rail: HTMLElement, scale: number): ReviewRailMetrics {
  const { parent, surface } = railFrame(rail);
  const box = surface && parent ? surface.getBoundingClientRect() : null;
  const frame = box && parent ? parent.getBoundingClientRect() : null;
  if (!box || !frame || !parent) return { scale, top: 0, left: null, compactCardLeft: null };
  const left = box.right - frame.left - parent.clientLeft + parent.scrollLeft + RAIL_GUTTER;
  return {
    scale,
    top: box.top - frame.top - parent.clientTop + parent.scrollTop,
    left,
    // The viewport's right edge in rail-local coordinates, minus a card and its inset.
    compactCardLeft:
      parent.scrollLeft + parent.clientWidth - left - COMPACT_CARD_WIDTH - COMPACT_CARD_INSET,
  };
}

/** Whether two measurements place every card identically. */
export function sameReviewRailMetrics(a: ReviewRailMetrics, b: ReviewRailMetrics): boolean {
  return (
    a.scale === b.scale &&
    a.top === b.top &&
    a.left === b.left &&
    a.compactCardLeft === b.compactCardLeft
  );
}

/** How {@link observeReviewRailMetrics} keeps the measurement current. */
export interface ObserveReviewRailMetricsOptions {
  /**
   * Re-measure on the container's scroll, coalesced into one frame. `top` and `left` are
   * scroll-invariant, but `compactCardLeft` follows the visible right edge, which moves when
   * a page wider than the viewport scrolls horizontally. Off by default, so ordinary
   * scrolling costs no rect reads.
   */
  readonly trackScroll?: boolean;
  /** Runs before each measurement with the container, for adapter-only reads. */
  readonly beforeMeasure?: (container: HTMLElement | null) => void;
}

/**
 * Measure `rail` now and again whenever its geometry can move, calling `onMeasure` with each
 * result. Returns the cleanup.
 *
 * The observers come from the rail's own window, so a rail in a pop-out window or an iframe
 * observes there. Triggers: a resize of the container or the surface (zoom, new pages,
 * window resize), a `style` change on the container (the viewport reserving or releasing the
 * review gutter moves the page without resizing it), and, with `trackScroll`, scrolling.
 */
export function observeReviewRailMetrics(
  rail: HTMLElement,
  source: RenderScaleSource,
  onMeasure: (metrics: ReviewRailMetrics) => void,
  options: ObserveReviewRailMetricsOptions = {}
): () => void {
  const { parent, surface } = railFrame(rail);
  const sync = (): void => {
    options.beforeMeasure?.(parent);
    onMeasure(measureReviewRailMetrics(rail, source.getRenderScale()));
  };
  sync();
  const view = hostWindowOf(rail);
  const cleanups: Array<() => void> = [];
  if (typeof view.ResizeObserver === 'function') {
    const observer = new view.ResizeObserver(sync);
    if (parent) observer.observe(parent);
    if (surface) observer.observe(surface);
    cleanups.push(() => observer.disconnect());
  }
  if (parent && typeof view.MutationObserver === 'function') {
    const mutations = new view.MutationObserver(sync);
    mutations.observe(parent, { attributes: true, attributeFilter: ['style'] });
    cleanups.push(() => mutations.disconnect());
  }
  if (options.trackScroll && parent) {
    let frame = 0;
    const onScroll = (): void => {
      if (frame !== 0) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };
    parent.addEventListener('scroll', onScroll, { passive: true });
    cleanups.push(() => {
      if (frame !== 0) view.cancelAnimationFrame(frame);
      parent.removeEventListener('scroll', onScroll);
    });
  }
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
