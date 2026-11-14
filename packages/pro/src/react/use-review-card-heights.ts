/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Review-card height reporting for React. The observation itself is the shared
// `../review/slot-sizing.ts`; this hook owns its lifetime and the heights state.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createReviewSlotSizer, withoutKeys } from '../review/slot-sizing.ts';

/**
 * What {@link useReviewCardHeights} returns.
 *
 * @public
 */
export interface UseReviewCardHeightsReturn {
  /**
   * Measured card heights in CSS pixels, by item key. Pass it to
   * `useStackedReviewPositions`. The map is a new object only when it changes. A key keeps
   * its last height after its card unmounts, so a card that scrolls out of view and back does
   * not move the cards around it. The height goes when its key leaves `items`.
   */
  readonly heights: ReadonlyMap<string, number>;
  /**
   * The ref callback for a card's outer element, by item key. It returns the same function
   * for a key while the card stays mounted, so React attaches the element once. Use it as
   * `ref={cardRef(item.key)}`.
   */
  readonly cardRef: (key: string) => (node: HTMLElement | null) => void;
}

/**
 * Measure your own review cards for `useStackedReviewPositions`.
 *
 * Each card is observed in its own window, so a rail in a pop-out window works too. A height
 * is recorded only when it changes, and a zero height (an element without layout) is never
 * recorded.
 *
 * Pass the full item list, not only the cards on screen, so the heights of deleted items are
 * dropped and off-screen cards keep theirs. Without `items`,
 * every height stays until the component unmounts.
 *
 * @param items - Every item you can render a card for, such as `useReview().items`.
 *
 * @example
 * ```tsx
 * const { items } = useReview();
 * const metrics = useReviewRailMetrics();
 * const { heights, cardRef } = useReviewCardHeights(items);
 * const positions = useStackedReviewPositions(items, heights, { scale: metrics.scale });
 * return items.map((item) => <div key={item.key} ref={cardRef(item.key)}>{item.text}</div>);
 * ```
 *
 * @public
 */
export function useReviewCardHeights(
  items?: readonly { readonly key: string }[]
): UseReviewCardHeightsReturn {
  const { heights, cardRef } = useCardSizer(items);
  return useMemo(() => ({ heights, cardRef }), [heights, cardRef]);
}

/** The hook's state and sizer, shared with the packaged rail. @internal */
export function useCardSizer(
  items?: readonly { readonly key: string }[]
): UseReviewCardHeightsReturn {
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const record = useCallback((key: string, height: number) => {
    setHeights((previous) =>
      previous.get(key) === height ? previous : new Map(previous).set(key, height)
    );
  }, []);
  const [sizer] = useState(() => createReviewSlotSizer(record));
  // StrictMode runs this cleanup and the effect again without detaching the card refs.
  useEffect(() => {
    sizer.reconnect();
    return sizer.disconnect;
  }, [sizer]);
  // After the commit, so a card removed with its item has detached by now.
  useEffect(() => {
    if (!items) return;
    const forgotten = sizer.retain(new Set(items.map((item) => item.key)));
    if (forgotten.length > 0) setHeights((previous) => withoutKeys(previous, forgotten));
  }, [items, sizer]);
  return { heights, cardRef: sizer.slotRef };
}
