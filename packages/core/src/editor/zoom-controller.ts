// Keeping a fit mode fitted: measure the room, ask `zoom-fit.ts` for the scale, apply it.
//
// Split out of `docx-editor.ts` because that file is already near its max-lines cap and this
// is the DOM half of the feature — a `ResizeObserver`, a computed-style read and a frame
// callback. The arithmetic lives next door and is testable without any of it.
//
// THE MEASUREMENT IS THE CONTENT BOX, not the width. `clientWidth` includes padding, and
// padding on the scroll container is exactly how the chrome around the page reserves room:
// the comments rail sets `padding-right`, the docked navigation pane sets
// `padding-inline-start`. Subtracting both leaves the room the page actually has, which is
// why "opening comments shrinks the document" needs no wiring — the observer fires on the
// content-box change and the next fit is simply smaller.

import type { ZoomMode } from '../contracts/editor.ts';
import { surfaceScroller } from './surface-pages.ts';
import { fitZoom, isFitMode } from './zoom-fit.ts';

/** What the controller needs from the editor it serves. */
export interface ZoomControllerHost {
  /** The element the surface mounted into, or null while detached. */
  container(): HTMLElement | null;
  /** The active mode. Read every time — a `setZoomMode` must take effect without a re-install. */
  mode(): ZoomMode;
  /** One page's width at 100%, in CSS pixels, or null before the first layout. */
  pageWidthPx(): number | null;
  /** The scale in force right now. */
  zoom(): number;
  /** Apply a fitted scale. The editor routes this through the same path as `setZoom`. */
  applyZoom(zoom: number): void;
}

export interface ZoomController {
  /** Start observing. Safe to call again; the previous observation is dropped first. */
  attach(): void;
  /** Recompute now — after a load, a page-setup change, or a mode change. */
  refit(): void;
  /** Stop observing and cancel any pending frame. */
  detach(): void;
}

/** The scroller's content box, or null when it cannot be measured. */
function availableWidth(container: HTMLElement): number | null {
  const scroller = surfaceScroller(container);
  if (!scroller) return null;
  const width = scroller.clientWidth;
  if (!Number.isFinite(width) || width <= 0) return null;
  const style = scroller.ownerDocument.defaultView?.getComputedStyle(scroller);
  if (!style) return width;
  // PHYSICAL, not logical. `clientWidth` is content + padding in physical terms, so these are
  // the two that reduce it whichever way the text runs — and the chrome above uses both
  // spellings (the comments rail sets `padding-right`, the navigation pane sets
  // `padding-inline-start`), which computed style resolves into these regardless.
  //
  // NaN from a value that is not px (a stylesheet that has not applied, a DOM that reports '')
  // means "no reservation known", not "give up" — hence `|| 0` rather than bailing out, which
  // would leave the fit permanently stale.
  const left = Number.parseFloat(style.paddingLeft) || 0;
  const right = Number.parseFloat(style.paddingRight) || 0;
  return Math.max(width - left - right, 0);
}

/**
 * Drive one editor's fit.
 *
 * COALESCED TO A FRAME. A `ResizeObserver` on a dragged window delivers a callback per frame
 * and a fit re-lays out the document, so an uncoalesced controller would re-paginate sixty
 * times a second. One pending frame at a time; the last measurement wins.
 *
 * IDEMPOTENT AT THE APPLY. `fitZoom` quantizes to whole percent, and a recomputation equal to
 * the scale already in force applies nothing. That is what breaks the scrollbar loop: fitting
 * can remove a vertical scrollbar, which widens the content box, which would fit larger and
 * bring the scrollbar back. With the quantum and `scrollbar-gutter: stable` on the viewport,
 * the second pass lands on the same percent and stops.
 */
export function createZoomController(host: ZoomControllerHost): ZoomController {
  let observer: ResizeObserver | null = null;
  let observed: HTMLElement | null = null;
  let frame: number | null = null;

  function cancelFrame(): void {
    if (frame === null) return;
    const view = observed?.ownerDocument.defaultView;
    view?.cancelAnimationFrame(frame);
    frame = null;
  }

  function refit(): void {
    const mode = host.mode();
    if (!isFitMode(mode)) return;
    const container = host.container();
    if (!container) return;
    const width = availableWidth(container);
    if (width === null) return;
    const pageWidthPx = host.pageWidthPx();
    if (pageWidthPx === null) return;

    const next = fitZoom({
      availableWidthPx: width,
      pageWidthPx,
      ...(mode.minZoom !== undefined ? { minZoom: mode.minZoom } : {}),
      ...(mode.maxZoom !== undefined ? { maxZoom: mode.maxZoom } : {}),
    });
    if (next === null || next === host.zoom()) return;
    host.applyZoom(next);
  }

  function schedule(): void {
    const view = observed?.ownerDocument.defaultView;
    // No rAF (headless, a detached document) means measure now. Losing the coalescing is a
    // performance cost; losing the fit is a correctness one.
    if (!view?.requestAnimationFrame) {
      refit();
      return;
    }
    if (frame !== null) return;
    frame = view.requestAnimationFrame(() => {
      frame = null;
      refit();
    });
  }

  return {
    attach(): void {
      this.detach();
      const container = host.container();
      if (!container) return;
      const scroller = surfaceScroller(container);
      if (!scroller) return;
      observed = scroller;
      // Absent in a headless host. The editor still fits on attach, load and mode change; it
      // just does not track a resize nobody can perform.
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(schedule);
        observer.observe(scroller);
      }
      refit();
    },
    refit,
    detach(): void {
      cancelFrame();
      observer?.disconnect();
      observer = null;
      observed = null;
    },
  };
}
