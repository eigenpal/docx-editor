/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The part of the scroller the review rail renders cards for, over the shared
// `../review/rail-window.ts`. The twin of the React adapter's `react/use-rail-window.ts`.

import { nextTick, onMounted, onUnmounted, shallowRef, watch, type Ref } from 'vue';
import {
  UNMEASURED_RAIL_WINDOW,
  observeRailWindow,
  type RailWindow,
} from '../review/rail-window.ts';

export type { RailWindow };

/**
 * The visible band of the scroller, in the rail's own coordinates. Null when the rail has no
 * scroller, or when no element reached `railRef`; null renders every card.
 *
 * Empty until the first measure, and while the rail is not active, so no positioned card
 * renders before the band is known: a rail that mounts with thousands of items would otherwise
 * build, measure and drop all of them in one flush. The first measure runs after the patch
 * that mounts the rail, in the same flush, before the rail is painted.
 */
export function useRailWindow(
  editor: Readonly<Ref<unknown>>,
  railRef: Readonly<Ref<HTMLElement | null>>,
  active: () => boolean
): Readonly<Ref<RailWindow | null>> {
  const band = shallowRef<RailWindow | null>(UNMEASURED_RAIL_WINDOW);
  let stop: (() => void) | undefined;
  // The rail element arrives from a vnode hook, which can run after this watcher in the flush
  // that activates the rail. Only an element still missing once that flush is done never comes
  // (an `asChild` child that renders no element); the rail then renders every card.
  const renderAllIfMissing = (): void => {
    void nextTick(() => {
      if (!railRef.value && active()) band.value = null;
    });
  };
  watch(
    [editor, active, railRef],
    () => {
      stop?.();
      stop = undefined;
      const rail = railRef.value;
      if (!active()) {
        band.value = UNMEASURED_RAIL_WINDOW;
        return;
      }
      if (!rail) {
        renderAllIfMissing();
        return;
      }
      const scroller = rail.offsetParent as HTMLElement | null;
      if (!scroller) {
        band.value = null;
        return;
      }
      // A re-bound observer reports its first band again: keep the same one, so it renders nothing.
      stop = observeRailWindow(rail, scroller, (next) => {
        const previous = band.value;
        if (previous && previous.top === next.top && previous.bottom === next.bottom) return;
        band.value = next;
      });
    },
    { flush: 'post' }
  );
  onMounted(renderAllIfMissing);
  onUnmounted(() => stop?.());
  return band;
}
