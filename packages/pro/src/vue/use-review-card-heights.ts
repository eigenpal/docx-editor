/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Review-card height reporting for Vue. The observation itself is the shared
// `../review/slot-sizing.ts`; this composable owns its lifetime and the heights state.

import {
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef,
} from 'vue';
import { createReviewSlotSizer, withoutKeys, type ReviewSlotSizer } from '../review/slot-sizing.ts';

/**
 * What {@link useReviewCardHeights} returns.
 *
 * @public
 */
export interface UseReviewCardHeightsReturn {
  /**
   * Measured card heights in CSS pixels, by item key. Pass it to
   * `useStackedReviewPositions`. The map is replaced only when it changes. A key keeps its
   * last height after its card unmounts, so a card that scrolls out of view and back does not
   * move the cards around it. The height goes when its key leaves `items`.
   */
  readonly heights: Readonly<ShallowRef<ReadonlyMap<string, number>>>;
  /**
   * The function ref for a card, by item key. It returns the same function for a key while
   * the card stays mounted. Use it as `:ref="cardRef(item.key)"` on an element, or on a
   * component with one root element that does not change.
   */
  readonly cardRef: (key: string) => (el: unknown) => void;
}

/**
 * Measure your own review cards for `useStackedReviewPositions`.
 *
 * Each card is observed in its own window, so a rail in a pop-out window works too. A height
 * is recorded only when it changes, and a zero height (an element without layout) is never
 * recorded. Observation stops with the calling component's scope.
 *
 * Pass the full item list, not only the cards on screen, so the heights of deleted items are
 * dropped and off-screen cards keep theirs. Without `items`,
 * every height stays until the scope stops.
 *
 * @param items - Every item you can render a card for, such as `useReview().items`.
 *
 * @example
 * ```ts
 * const { items } = useReview();
 * const { metrics } = useReviewRailMetrics();
 * const { heights, cardRef } = useReviewCardHeights(items);
 * const positions = useStackedReviewPositions(items, heights, () => ({
 *   scale: metrics.value.scale,
 * }));
 * ```
 *
 * @public
 */
export function useReviewCardHeights(
  items?: MaybeRefOrGetter<readonly { readonly key: string }[]>
): UseReviewCardHeightsReturn {
  const { heights, cardRef } = useCardSizer(items);
  return { heights, cardRef };
}

/** The composable plus the sizer's `observe`, which the packaged rail's context carries. @internal */
export function useCardSizer(
  items?: MaybeRefOrGetter<readonly { readonly key: string }[]>
): UseReviewCardHeightsReturn & {
  readonly observe: ReviewSlotSizer['observe'];
} {
  const heights = shallowRef<ReadonlyMap<string, number>>(new Map());
  const sizer = createReviewSlotSizer((key, height) => {
    if (heights.value.get(key) === height) return;
    heights.value = new Map(heights.value).set(key, height);
  });
  onScopeDispose(sizer.disconnect);
  if (items !== undefined) {
    // After the patch, so a card removed with its item has detached by now.
    watch(
      () => toValue(items),
      (list) => {
        const forgotten = sizer.retain(new Set(list.map((item) => item.key)));
        if (forgotten.length > 0) heights.value = withoutKeys(heights.value, forgotten);
      },
      { flush: 'post' }
    );
  }
  return { heights, cardRef: sizer.slotRef, observe: sizer.observe };
}
