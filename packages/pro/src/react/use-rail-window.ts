/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The part of the scroller the review rail renders cards for, over the shared
// `../review/rail-window.ts`. The twin of the Vue adapter's `vue/use-rail-window.ts`.

import { useEffect, useLayoutEffect, useState } from 'react';
import {
  UNMEASURED_RAIL_WINDOW,
  observeRailWindow,
  type RailWindow,
} from '../review/rail-window.ts';

/** The measure runs before paint in a browser; a server render has nothing to measure. */
const useBeforePaintEffect =
  typeof globalThis.document === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The visible band of the scroller, in the rail's own coordinates. Null when the rail has no
 * scroller, or when a host's rail element never reached `railRef`; null renders every card.
 *
 * Empty until the first measure, and while the rail is not mounted, so no positioned card
 * renders before the band is known: a rail that mounts with thousands of items would otherwise
 * build, measure and drop all of them in one task. The first measure runs in a layout effect,
 * before the rail is painted.
 *
 * `mounted` for the same reason as `useRailMetrics`: no rail element exists while the
 * document is absent or the rail is hidden, and the binding must re-run once one does.
 */
export function useRailWindow(
  editor: unknown,
  railRef: React.RefObject<HTMLElement | null>,
  mounted: boolean
): RailWindow | null {
  const [band, setBand] = useState<RailWindow | null>(UNMEASURED_RAIL_WINDOW);
  useBeforePaintEffect(() => {
    if (!mounted) {
      setBand(UNMEASURED_RAIL_WINDOW);
      return undefined;
    }
    // Refs are set before layout effects run, so a mounted rail without one never gets one:
    // an `asChild` host that does not forward the ref.
    const rail = railRef.current;
    const scroller = rail?.offsetParent as HTMLElement | null | undefined;
    if (!rail || !scroller) {
      setBand(null);
      return undefined;
    }
    // A re-bound observer reports its first band again: keep the same one, so it renders nothing.
    return observeRailWindow(rail, scroller, (next) =>
      setBand((previous) =>
        previous && previous.top === next.top && previous.bottom === next.bottom ? previous : next
      )
    );
  }, [editor, railRef, mounted]);
  return band;
}
