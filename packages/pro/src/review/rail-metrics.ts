/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review rail's geometry, measured from the DOM it hangs beside. Shared by the React and
// Vue rails and by the public `useReviewRailMetrics` hook and composable, so a host's own
// column places cards with the same numbers the packaged rail uses.

import { hostWindowOf, isHTMLElementNode } from '@docx-editor.dev/core/editor';

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
   * CSS pixels from the scroll container's top padding edge, in its scrolled content, to the
   * top of the first page. Content above the pages, such as a host banner inside the
   * viewport, is included. Scrolling does not change it.
   */
  readonly top: number;
  /**
   * CSS pixels from the scroll container's left padding edge, in its scrolled content, to
   * the column's left edge: one 16px gutter right of the page, or, in a right-to-left
   * interface, one 16px gutter and the column's own width left of it. `null` until there is
   * a page to measure. Keep the column hidden while it is `null`.
   */
  readonly left: number | null;
  /**
   * The page side the column stands on: `'left'` in a right-to-left interface, otherwise
   * `'right'`. On the left, give the column its width (300px for the packaged cards), because
   * `left` keeps the column's RIGHT edge one gutter off the page; and keep each card's air on
   * its left, away from the page.
   */
  readonly side: 'left' | 'right';
  /**
   * The `left` value, relative to {@link ReviewRailMetrics.left}, that puts a 300px card
   * fully inside the visible area with a 12px inset from its edge on the column's side. Use it while
   * {@link ReviewRailMetrics.compact} is true. `null` until there is a page to measure.
   */
  readonly compactCardLeft: number | null;
  /**
   * The review pane is open, but the viewport is too narrow for a full column beside the
   * page. The packaged rail then shows markers and one floating card, the active item's,
   * at `compactCardLeft`.
   */
  readonly compact: boolean;
}

/** The measured part of {@link ReviewRailMetrics}; `compact` comes from the adapter. */
export type ReviewRailGeometry = Omit<ReviewRailMetrics, 'compact'>;

/** The value before the first measurement: 100% zoom, no offset, nothing to place against. */
export const INITIAL_REVIEW_RAIL_METRICS: ReviewRailMetrics = Object.freeze({
  scale: 96 / 72,
  top: 0,
  left: null,
  side: 'right',
  compactCardLeft: null,
  compact: false,
});

/** Space between the page edge and the cards. */
export const RAIL_GUTTER = 16;
/** A compact card is one column-card wide — the width `.docx-review` gives the open rail. */
export const COMPACT_CARD_WIDTH = 300;
/** Air between a compact card's right edge and the viewport's. */
export const COMPACT_CARD_INSET = 12;

/**
 * The painted surface, never the loading placeholder: `DocxEditor.Loading` renders its own
 * `docx-paginated-surface` before the content, and a column bound to it measured a
 * placeholder that is removed when the document opens.
 */
/**
 * The scroll container's side for the column, published by the viewport as
 * `data-review-side`: `left` in a right-to-left interface, the right otherwise. The
 * container keeps a left-to-right base for its scroll offsets, so the side is physical.
 */
export function reviewRailSide(container: HTMLElement | null): 'left' | 'right' {
  return container?.getAttribute('data-review-side') === 'left' ? 'left' : 'right';
}

const SURFACE_SELECTOR = '.docx-paginated-surface:not(.docx-editor__loading-surface)';

/** The editor's painted surface inside `container`, or null while there is none. */
export function findReviewRailSurface(container: HTMLElement | null): HTMLElement | null {
  return container?.querySelector<HTMLElement>(SURFACE_SELECTOR) ?? null;
}

/**
 * Whether the open pane has only the narrow strip: the viewport reserved some gutter, but
 * less than a full column (`fullGutter`, the adapter's `REVIEW_PANE_GUTTER`).
 */
export function isCompactReviewColumn(
  paneOpen: boolean,
  reservedGutter: number,
  fullGutter: number
): boolean {
  return paneOpen && reservedGutter > 0 && reservedGutter < fullGutter;
}

/** The one engine read the measurement needs. */
export interface RenderScaleSource {
  getRenderScale(): number;
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
export function measureReviewRailMetrics(rail: HTMLElement, scale: number): ReviewRailGeometry {
  const parent = rail.offsetParent as HTMLElement | null;
  const surface = findReviewRailSurface(parent);
  const box = surface && parent ? surface.getBoundingClientRect() : null;
  const frame = box && parent ? parent.getBoundingClientRect() : null;
  const side = reviewRailSide(parent);
  if (!box || !frame || !parent) {
    return { scale, top: 0, left: null, side, compactCardLeft: null };
  }
  const origin = parent.scrollLeft - frame.left - parent.clientLeft;
  const top = box.top - frame.top - parent.clientTop + parent.scrollTop;
  if (side === 'left') {
    // The column's own width, open or closed, so its right edge keeps one gutter off the page.
    const left = box.left + origin - RAIL_GUTTER - rail.offsetWidth;
    // The viewport's left edge in rail-local coordinates, plus the inset.
    return {
      scale,
      top,
      left,
      side,
      compactCardLeft: parent.scrollLeft + COMPACT_CARD_INSET - left,
    };
  }
  const left = box.right + origin + RAIL_GUTTER;
  return {
    scale,
    top,
    left,
    side,
    // The viewport's right edge in rail-local coordinates, minus a card and its inset.
    compactCardLeft:
      parent.scrollLeft + parent.clientWidth - left - COMPACT_CARD_WIDTH - COMPACT_CARD_INSET,
  };
}

/** Whether two measurements place every card identically. */
export function sameReviewRailMetrics(a: ReviewRailGeometry, b: ReviewRailGeometry): boolean {
  return (
    a.scale === b.scale &&
    a.top === b.top &&
    a.left === b.left &&
    a.side === b.side &&
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
 * observes there. Triggers:
 * - a resize of the container, of each of its other children (a host banner above the
 *   pages), or of the surface and its ancestors (zoom, new pages, window resize);
 * - a child added to or removed from the container (the loading placeholder giving way to
 *   the document, a banner appearing), which also re-resolves the surface;
 * - a `style` change on the container (the viewport reserving or releasing the review
 *   gutter moves the page without resizing it);
 * - with `trackScroll`, scrolling.
 *
 * The surface's own subtree is NOT observed for mutations: the pages repaint on every
 * keystroke, and none of those repaints moves the surface without resizing it.
 */
export function observeReviewRailMetrics(
  rail: HTMLElement,
  source: RenderScaleSource,
  onMeasure: (metrics: ReviewRailGeometry) => void,
  options: ObserveReviewRailMetricsOptions = {}
): () => void {
  const parent = rail.offsetParent as HTMLElement | null;
  const view = hostWindowOf(rail);
  let surface: HTMLElement | null = null;
  let resize: ResizeObserver | null = null;

  const measure = (): void => {
    options.beforeMeasure?.(parent);
    onMeasure(measureReviewRailMetrics(rail, source.getRenderScale()));
  };
  // Every element whose size can move the first page inside the container.
  const bind = (): void => {
    surface = findReviewRailSurface(parent);
    resize?.disconnect();
    resize = null;
    if (!parent || typeof view.ResizeObserver !== 'function') return;
    const targets = new Set<Element>([parent]);
    for (const child of Array.from(parent.children)) {
      if (child !== rail && isHTMLElementNode(child)) targets.add(child);
    }
    // The rail itself only on the left side, where its own width (which opening the pane
    // changes) places it.
    if (reviewRailSide(parent) === 'left') targets.add(rail);
    for (let node = surface; node && node !== parent; node = node.parentElement) {
      targets.add(node);
    }
    resize = new view.ResizeObserver(sync);
    for (const target of targets) resize.observe(target);
  };
  function sync(): void {
    if (findReviewRailSurface(parent) !== surface) bind();
    measure();
  }

  bind();
  measure();
  const cleanups: Array<() => void> = [() => resize?.disconnect()];
  if (parent && typeof view.MutationObserver === 'function') {
    const mutations = new view.MutationObserver((records) => {
      if (
        records.some(
          (record) => record.type === 'childList' || record.attributeName === 'data-review-side'
        )
      ) {
        bind();
      }
      measure();
    });
    mutations.observe(parent, {
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'data-review-side'],
    });
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

/**
 * Why a host's column cannot be placed from these metrics, or null when it can. The rule:
 * the column is absolutely positioned, and its offset parent is the scroll container that
 * holds the editor's pages — that is, it is rendered inside `DocxEditor.Viewport` with no
 * positioned element in between.
 */
export function reviewRailPlacementProblem(rail: HTMLElement): string | null {
  const parent = rail.offsetParent as HTMLElement | null;
  if (!parent) {
    return (
      'the column element has no offset parent. Render it inside DocxEditor.Viewport, and ' +
      'hide it with visibility: hidden rather than display: none while metrics.left is null.'
    );
  }
  if (hostWindowOf(rail).getComputedStyle(rail).position !== 'absolute') {
    return 'the column element is not absolutely positioned. Give it position: absolute.';
  }
  if (!findReviewRailSurface(parent)) {
    return (
      "the column element's offset parent does not contain the editor's pages. Render it " +
      'directly inside DocxEditor.Viewport, with no positioned element in between.'
    );
  }
  return null;
}

const printed = new Set<string>();

/** Print a placement warning once per page, in development builds only. */
export function warnReviewRailMetrics(message: string): void {
  if (!isDevelopment() || printed.has(message)) return;
  printed.add(message);
  console.warn(`[docx-editor] useReviewRailMetrics: ${message}`);
}

/**
 * A development build, by the same rule as each adapter's private `lib/is-development.ts`
 * (no package that both adapters and this one share exports it). A boolean
 * `import.meta.env.DEV` decides first. Otherwise a `process` global decides: any
 * `NODE_ENV` other than `production`, unset included, is development. With neither, the
 * build counts as production. `process.env.NODE_ENV` is spelled exactly, so a bundler can
 * replace it.
 */
function isDevelopment(): boolean {
  let dev: unknown;
  try {
    dev = (import.meta as { readonly env?: { readonly DEV?: unknown } }).env?.DEV;
  } catch {
    dev = undefined;
  }
  if (typeof dev === 'boolean') return dev;
  return typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
}
