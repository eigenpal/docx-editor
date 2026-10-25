/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The chartex chart types the renderer paints, by series `layoutId`. A chart whose series
// name a layout id outside this list keeps its labelled placeholder.
//
// To add a chart type: write `chartex-<type>.ts` exporting a `ChartexLayout`
// (`chartex-layout.ts`), and add it to `CHARTEX_LAYOUTS` below.

import { BOX_WHISKER_LAYOUT } from './chartex-box-whisker.ts';
import { FUNNEL_LAYOUT } from './chartex-funnel.ts';
import { HISTOGRAM_LAYOUT } from './chartex-histogram.ts';
import type { ChartexLayout } from './chartex-layout.ts';
import { WATERFALL_LAYOUT } from './chartex-waterfall.ts';

export const CHARTEX_LAYOUTS: readonly ChartexLayout[] = Object.freeze([
  WATERFALL_LAYOUT,
  FUNNEL_LAYOUT,
  BOX_WHISKER_LAYOUT,
  HISTOGRAM_LAYOUT,
]);

// A Map, so a file-supplied layout id of `__proto__` or `constructor` answers undefined.
// Every layout id a layout paints names it; the first layout to claim an id keeps it.
const BY_LAYOUT_ID: ReadonlyMap<string, ChartexLayout> = (() => {
  const map = new Map<string, ChartexLayout>();
  for (const layout of CHARTEX_LAYOUTS) {
    for (const id of layout.layoutIds) if (!map.has(id)) map.set(id, layout);
  }
  return map;
})();

/** The layout that paints series of `layoutId`, or null. */
export function chartexLayoutFor(layoutId: string): ChartexLayout | null {
  return BY_LAYOUT_ID.get(layoutId) ?? null;
}
