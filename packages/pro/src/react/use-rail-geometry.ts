/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The rail's geometry, measured from the DOM it hangs beside: where the rail sits
// (`useRailMetrics`, over the shared `../review/rail-metrics.ts`) and which vertical band
// of the scroller is on screen (`useRailWindow`). Split out of `DocxEditorReview.tsx`,
// which is at its max-lines cap.

import { useEffect, useState } from 'react';
import { hostWindowOf } from '@docx-editor.dev/core/editor';
import {
  INITIAL_REVIEW_RAIL_METRICS,
  observeReviewRailMetrics,
  sameReviewRailMetrics,
  type RenderScaleSource,
  type ReviewRailMetrics,
} from '../review/rail-metrics.ts';

export { COMPACT_CARD_WIDTH } from '../review/rail-metrics.ts';

/**
 * How far outside the visible scroll window a card still mounts, in pixels.
 *
 * Enough that a normal scroll or a pane toggle never shows an empty gutter, small enough
 * that a document with two hundred comments mounts a handful of cards rather than all of
 * them. Rendering every card was the toggle's lag: two hundred cards' worth of DOM, plus a
 * `top` transition on each, in one frame.
 */
export const RAIL_OVERSCAN = 600;

/**
 * Where the rail sits; the measurement itself is `measureReviewRailMetrics`.
 *
 * `remeasure` re-runs the binding whenever the queue could have moved: a new page above an
 * anchor changes where its card belongs, and zoom changes every anchor at once. `mounted`
 * must be false while the rail element does not exist (document absent, `hidden`), so a
 * binding pass that ran against the null ref runs again once there is a rail to measure.
 *
 * `trackScroll` re-measures on the scroller's own scroll; see
 * `ObserveReviewRailMetricsOptions.trackScroll`. The rail turns it on only when compact.
 */
export function useRailMetrics(
  editor: RenderScaleSource | null,
  railRef: React.RefObject<HTMLElement | null>,
  remeasure: unknown,
  mounted: boolean,
  trackScroll = false
): ReviewRailMetrics {
  const [metrics, setMetrics] = useState<ReviewRailMetrics>(INITIAL_REVIEW_RAIL_METRICS);
  useEffect(() => {
    const rail = railRef.current;
    if (!editor || !rail) return undefined;
    return observeReviewRailMetrics(
      rail,
      editor,
      (next) => setMetrics((previous) => (sameReviewRailMetrics(previous, next) ? previous : next)),
      { trackScroll }
    );
  }, [editor, railRef, remeasure, mounted, trackScroll]);
  return metrics;
}

/**
 * The visible band of the scroller, in the rail's own coordinates. Passive listener,
 * coalesced into a frame: the handler runs on every wheel tick and must do nothing but
 * record two numbers. Null until there is a scroller to measure.
 *
 * `mounted` for the same reason as `useRailMetrics`: no rail element exists while the
 * document is absent or the rail is hidden, and the binding must re-run once one does.
 */
export function useRailWindow(
  editor: unknown,
  railRef: React.RefObject<HTMLElement | null>,
  mounted: boolean
): { top: number; bottom: number } | null {
  const [window_, setWindow] = useState<{ top: number; bottom: number } | null>(null);
  useEffect(() => {
    const rail = railRef.current;
    const scroller = rail?.offsetParent as HTMLElement | null;
    if (!scroller) return undefined;
    const view = hostWindowOf(scroller);
    let frame = 0;
    const sync = (): void => {
      frame = 0;
      setWindow((previous) => {
        const top = scroller.scrollTop - RAIL_OVERSCAN;
        const bottom = scroller.scrollTop + scroller.clientHeight + RAIL_OVERSCAN;
        return previous && previous.top === top && previous.bottom === bottom
          ? previous
          : { top, bottom };
      });
    };
    // While the reader scrolls, the slots' `top` transition is suppressed (a DOM attribute
    // so no React work happens at scroll frequency). Restacks DURING a scroll come from
    // cards entering the window and correcting an estimated height to a measured one; each
    // correction shifts every card below it, and ANIMATING those shifts while the page
    // itself moves read as a second, faster scroll layered over the document.
    let settle = 0;
    const onScroll = (): void => {
      if (frame === 0) frame = view.requestAnimationFrame(sync);
      rail?.setAttribute('data-scrolling', '');
      view.clearTimeout(settle);
      settle = view.setTimeout(() => rail?.removeAttribute('data-scrolling'), 150);
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
  }, [editor, railRef, mounted]);
  return window_;
}
