/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The contract between the shared chartex frame and one chart type.
//
// The frame (`chartex-render.ts`) paints the chart area, the title and the legend, and hands
// the rest of the chart to the layout its series name by `layoutId`. A layout lists its
// legend entries and paints its plot inside the box the frame leaves, from the typed model
// (`chartex-model.ts`) and the chart's look (`chartex-style.ts`), with the shared painters:
// `ChartScene` for shapes, `ChartLabel`s for text, and `chartex-axes.ts` for category and
// value axes. A new chart type is one module exporting a `ChartexLayout` and one entry in
// `chartex-registry.ts`.

import type { Box } from './chart-axes.ts';
import type { ChartScene } from './chart-scene.ts';
import type { ChartPaint, ChartStroke } from './chart-style.ts';
import type { ChartLabel } from './chart-text.ts';
import type { ChartexModel, ChartexSeries } from './chartex-model.ts';
import type { ChartexLook } from './chartex-style.ts';

/** One legend entry: a filled square key (or a line key) and its text. */
export interface ChartexLegendEntry {
  readonly text: string;
  readonly fill: ChartPaint | null;
  readonly line: ChartStroke | null;
  /** A line key (a Pareto line) rather than a square. */
  readonly lineKey?: boolean;
}

/** What a layout paints with. */
export interface ChartexContext {
  readonly model: ChartexModel;
  readonly look: ChartexLook;
  readonly scene: ChartScene;
  /** Labels in paint order; the projection sets each as a read-only story. */
  readonly labels: ChartLabel[];
  readonly chartWidth: number;
  readonly chartHeight: number;
}

/**
 * The room the frame keeps above the plot of a layout that asks for it, for the half of the
 * top value label (9 pt) that reaches above the plot.
 */
export const CHARTEX_PLOT_TOP_ROOM = 5.41;

/** One chartex chart type. */
export interface ChartexLayout {
  /**
   * The series layout ids this layout paints. The first one names the layout; the others
   * may join it in one chart (a Pareto line joins its clustered columns).
   */
  readonly layoutIds: readonly string[];
  /**
   * Whether the frame keeps `CHARTEX_PLOT_TOP_ROOM` above the plot. A layout with a value
   * axis beside the plot asks for it; one without (a funnel) paints its plot from the top of
   * the box.
   */
  readonly roomAbovePlot: boolean;
  /** The legend entries, in legend order. */
  legendEntries(series: readonly ChartexSeries[], context: ChartexContext): ChartexLegendEntry[];
  /**
   * Paint the plot inside `box` (chart points, after the title and legend took their room).
   * False when the chart is outside what the layout paints: the drawing then keeps its
   * labelled placeholder.
   */
  paint(series: readonly ChartexSeries[], box: Box, context: ChartexContext): boolean;
}
