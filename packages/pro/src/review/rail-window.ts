/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The part of the scroller the review rail renders cards for. Shared by the React and Vue rails
// (`useRailWindow` in each adapter), which only decide when to observe.

import { hostWindowOf } from '@docx-editor.dev/core/editor';

/**
 * How far outside the visible scroll window a card still mounts, in pixels.
 *
 * Enough that a normal scroll or a pane toggle never shows an empty gutter, small enough
 * that a document with two hundred comments mounts a handful of cards rather than all of
 * them. Rendering every card was the toggle's lag: two hundred cards' worth of DOM, plus a
 * `top` transition on each, in one frame.
 */
export const RAIL_OVERSCAN = 600;

/** A band of the scroller, in the rail's own coordinates. Cards outside it do not render. */
export interface RailWindow {
  readonly top: number;
  readonly bottom: number;
}

/**
 * The band before the rail has measured its scroller: empty, so no positioned card renders.
 * A null band renders every card, which a rail mounting beside thousands of changes would
 * build, measure and drop again.
 */
export const UNMEASURED_RAIL_WINDOW: RailWindow = Object.freeze({
  top: Number.POSITIVE_INFINITY,
  bottom: Number.NEGATIVE_INFINITY,
});

/**
 * Report the visible band of `scroller` to `onBand`: once now, then after each scroll or
 * resize, coalesced into a frame, and only when it changed. The handler runs on every wheel
 * tick and records two numbers; it reads them in the scroll event, while layout is clean,
 * because by the frame the editor has built the pages scrolled into view and reading there
 * forced a layout of the document. While the reader scrolls, `rail` carries
 * `data-scrolling`, which suppresses the cards' `top` transition. Answers the stop function.
 */
export function observeRailWindow(
  rail: HTMLElement,
  scroller: HTMLElement,
  onBand: (band: RailWindow) => void
): () => void {
  const view = hostWindowOf(scroller);
  const read = (): RailWindow => ({
    top: scroller.scrollTop - RAIL_OVERSCAN,
    bottom: scroller.scrollTop + scroller.clientHeight + RAIL_OVERSCAN,
  });
  let last: RailWindow | null = null;
  let pending: RailWindow | null = null;
  let frame = 0;
  const sync = (): void => {
    frame = 0;
    const next = pending ?? read();
    pending = null;
    if (last && last.top === next.top && last.bottom === next.bottom) return;
    last = next;
    onBand(next);
  };
  let settle = 0;
  const onScroll = (): void => {
    pending = read();
    if (frame === 0) frame = view.requestAnimationFrame(sync);
    rail.setAttribute('data-scrolling', '');
    view.clearTimeout(settle);
    settle = view.setTimeout(() => rail.removeAttribute('data-scrolling'), 150);
  };
  sync();
  scroller.addEventListener('scroll', onScroll, { passive: true });
  const observer = new view.ResizeObserver(onScroll);
  observer.observe(scroller);
  return () => {
    if (frame !== 0) view.cancelAnimationFrame(frame);
    view.clearTimeout(settle);
    scroller.removeEventListener('scroll', onScroll);
    observer.disconnect();
  };
}
