/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// How each series and data point of a chart looks: fill, outline and marker, from the
// series and point `c:spPr` over the chart style's defaults.

import { type ShapeSchemeColorResolver } from '@docx-editor.dev/core/store';
import type { ChartModel, ChartPlot, ChartSeries } from './chart-model.ts';
import {
  mergeStroke,
  readChartShapeProperties,
  styleSeriesColor,
  type ChartPaint,
  type ChartStroke,
} from './chart-style.ts';
import { child } from './chart-model.ts';

/** Automatic markers, in series order, when a line series names none. */
const AUTO_MARKERS = [
  'diamond',
  'square',
  'triangle',
  'x',
  'star',
  'circle',
  'plus',
  'dot',
  'dash',
];

export interface MarkerLook {
  readonly symbol: string;
  readonly size: number;
  readonly fill: ChartPaint | null;
  readonly line: ChartStroke | null;
}

export interface SeriesLook {
  readonly fill: ChartPaint | null;
  readonly line: ChartStroke | null;
  readonly marker: MarkerLook | null;
}

export interface LookContext {
  readonly model: ChartModel;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
  /** Series across all plots, for the colour cycle. */
  readonly seriesCount: number;
}

/** Plots whose series are strokes through points rather than filled shapes. */
export function isLineKind(plot: ChartPlot): boolean {
  return (
    plot.kind === 'line' ||
    plot.kind === 'scatter' ||
    (plot.kind === 'radar' && plot.radarStyle !== 'filled')
  );
}

/** Whether a plot colours each point of its one series by itself. */
export function variesByPoint(plot: ChartPlot): boolean {
  return (
    plot.varyColors &&
    plot.series.length === 1 &&
    (plot.kind === 'pie' ||
      plot.kind === 'doughnut' ||
      plot.kind === 'bar' ||
      plot.kind === 'ofPie')
  );
}

function markerLook(
  plot: ChartPlot,
  series: ChartSeries,
  color: ChartPaint,
  context: LookContext,
  styleIndex: number
): MarkerLook | null {
  if (!isLineKind(plot)) return null;
  const marker = series.marker;
  const scatterLinesOnly =
    plot.kind === 'scatter' && (plot.scatterStyle === 'line' || plot.scatterStyle === 'smooth');
  if (marker?.symbol === 'none') return null;
  const automatic =
    plot.kind === 'line'
      ? plot.markers
      : plot.kind === 'radar'
        ? plot.radarStyle === 'marker'
        : !scatterLinesOnly;
  if (!marker?.symbol && !automatic) return null;
  const symbol = marker?.symbol ?? AUTO_MARKERS[styleIndex % AUTO_MARKERS.length]!;
  const authored = readChartShapeProperties(marker?.spPr ?? null, context.resolveSchemeColor);
  const fill = authored.fill === undefined ? color : authored.fill;
  const line = mergeStroke(authored.line, {
    ...color,
    widthPt: 0.75,
    cap: 'round',
    dash: null,
  });
  return { symbol, size: marker?.size ?? (marker?.symbol ? 5 : 7), fill, line };
}

/** The look of `series` in `plot`; `point` names a data point with its own colour. */
export function seriesLook(
  plot: ChartPlot,
  series: ChartSeries,
  context: LookContext,
  point?: { readonly index: number; readonly count: number }
): SeriesLook {
  const styleIndex = point ? point.index : series.index;
  const count = point ? point.count : context.seriesCount;
  const color = styleSeriesColor(
    context.model.style,
    styleIndex,
    count,
    context.resolveSchemeColor
  );
  const own = readChartShapeProperties(series.spPr, context.resolveSchemeColor);
  const pointElement = point ? series.points.get(point.index) : undefined;
  const pointOwn = pointElement
    ? readChartShapeProperties(child(pointElement, 'spPr'), context.resolveSchemeColor)
    : { fill: undefined, line: undefined };
  // A point that varies by colour ignores the series fill unless it names its own.
  const seriesFill = point ? undefined : own.fill;
  const lineKind = isLineKind(plot);
  const defaultLine: ChartStroke | null = lineKind
    ? { ...color, widthPt: 2.25, cap: 'round', dash: null }
    : null;
  const fill = lineKind
    ? null
    : pointOwn.fill !== undefined
      ? pointOwn.fill
      : seriesFill !== undefined
        ? seriesFill
        : color;
  const line = mergeStroke(
    pointOwn.line !== undefined ? pointOwn.line : own.line,
    defaultLine ?? (fill ? { ...fill, widthPt: 0.75, cap: 'butt', dash: null } : null)
  );
  // Filled shapes take no outline from the style.
  const outline = lineKind || pointOwn.line !== undefined || own.line !== undefined ? line : null;
  const markerColor = (lineKind ? (outline ?? null) : fill) ?? color;
  return {
    fill,
    line: outline,
    marker: markerLook(
      plot,
      series,
      { hex: markerColor.hex, alpha: markerColor.alpha },
      context,
      styleIndex
    ),
  };
}
