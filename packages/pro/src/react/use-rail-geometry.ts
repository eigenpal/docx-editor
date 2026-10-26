/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The rail's geometry, measured from the DOM it hangs beside: where the rail sits
// (`useRailMetrics`, over the shared `../review/rail-metrics.ts`). Which vertical band of the
// scroller is on screen is `use-rail-window.ts`. Split out of `DocxEditorReview.tsx`, which is
// at its max-lines cap.

import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  INITIAL_REVIEW_RAIL_METRICS,
  observeReviewRailMetrics,
  sameReviewRailMetrics,
  type RenderScaleSource,
  type ReviewRailGeometry,
} from '../review/rail-metrics.ts';

export { COMPACT_CARD_WIDTH } from '../review/rail-metrics.ts';

export { RAIL_OVERSCAN } from '../review/rail-window.ts';

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
): ReviewRailGeometry {
  const [metrics, setMetrics] = useState<ReviewRailGeometry>(INITIAL_REVIEW_RAIL_METRICS);
  useEffect(() => {
    const rail = railRef.current;
    if (!editor || !rail) return undefined;
    let bound = false;
    let last: ReviewRailGeometry | null = null;
    const stop = observeReviewRailMetrics(
      rail,
      editor,
      (next) => {
        const previous = last;
        if (previous && sameReviewRailMetrics(previous, next)) return;
        last = next;
        const update = () =>
          setMetrics((current) => (sameReviewRailMetrics(current, next) ? current : next));
        // An observer reports after layout and before paint. A plain state update renders
        // after that paint, so the column stood one frame where the page used to be. Only a
        // moved column pays for the synchronous render: a scroll that moves just the compact
        // card's offset batches as before.
        const moved =
          !previous ||
          previous.left !== next.left ||
          previous.top !== next.top ||
          previous.scale !== next.scale;
        if (bound && moved) flushSync(update);
        else update();
      },
      { trackScroll }
    );
    bound = true;
    return stop;
  }, [editor, railRef, remeasure, mounted, trackScroll]);
  return metrics;
}
