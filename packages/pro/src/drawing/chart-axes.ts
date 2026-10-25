/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Axes of a chart with categories or values along both directions: which axis each plot
// uses, the category positions, the value scales, and the tick labels with the room they take.

import type { ChartAxis, ChartModel, ChartPlot } from './chart-model.ts';
import { formatChartNumber, isDateFormatCode } from './chart-number-format.ts';
import { autoValueScale, logValueScale, scaleRatio, type ValueScale } from './chart-scale.ts';
import { estimateTextWidth, type ChartTextStyle } from './chart-text.ts';
import { seriesErrorBars, seriesTrendlines } from './chart-trendline.ts';

/** Room between the labels of a horizontal value axis, in sizes. */
const HORIZONTAL_GAP = 1;
/** Least distance between the ticks of an upright 3-D value axis, in sizes. */
const VERTICAL_GAP_3D = 1.4;

export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** The category direction shared by the plots of one chart. */
export interface CategoryInfo {
  readonly axis: ChartAxis | null;
  readonly count: number;
  readonly labels: readonly string[];
  /** Positions in base time units (days, months or years) when the axis is a date axis. */
  readonly serials: readonly number[] | null;
  /** Points sit in the middle of their slot (`between`) rather than on the ticks. */
  readonly between: boolean;
}

/** A value direction: its axis, its scale once known, and the plots drawn against it. */
export interface ValueInfo {
  readonly axis: ChartAxis | null;
  readonly id: string;
  dataMin: number;
  dataMax: number;
  percent: boolean;
  scale: ValueScale | null;
  formatCode: string | null;
}

/** The axis of `plot` with `kind`; for scatter, `x` is the horizontal value axis. */
export function plotAxis(
  model: ChartModel,
  plot: ChartPlot,
  role: 'category' | 'value' | 'x'
): ChartAxis | null {
  const axes = plot.axisIds.map((id) => model.axes.get(id)).filter((axis) => axis !== undefined);
  if (plot.kind === 'scatter' || plot.kind === 'bubble') {
    const horizontalFirst = (axis: ChartAxis) => axis.position === 'b' || axis.position === 't';
    const x = axes.find(horizontalFirst) ?? axes[0] ?? null;
    const y = axes.find((axis) => axis !== x) ?? null;
    return role === 'value' ? y : role === 'x' ? x : null;
  }
  if (role === 'value') return axes.find((axis) => axis.kind === 'value') ?? null;
  return axes.find((axis) => axis.kind === 'category' || axis.kind === 'date') ?? null;
}

/** Category count, labels and spacing for the plots that use categories. */
export function categoryInfo(
  model: ChartModel,
  plots: readonly ChartPlot[],
  labelLimit: number
): CategoryInfo {
  let count = 0;
  let labels: (string | null)[] | null = null;
  let numbers: (number | null)[] | null = null;
  let format: string | null = null;
  for (const plot of plots) {
    for (const series of plot.series) {
      count = Math.max(count, series.values.length);
      if (!labels && series.categories) {
        labels = [...series.categories];
        numbers = series.categoryNumbers ? [...series.categoryNumbers] : null;
        format = series.categoryFormat;
      }
    }
  }
  const axis = plots.length > 0 ? plotAxis(model, plots[0]!, 'category') : null;
  if (labels) count = Math.max(count, labels.length);
  count = Math.min(count, labelLimit);
  const axisFormat = axis && !axis.sourceLinked ? axis.formatCode : null;
  const code = axisFormat ?? format;
  const isDate =
    numbers !== null &&
    (axis?.kind === 'date' || (axis?.kind !== 'category' && isDateFormatCode(code))) &&
    numbers.every((value) => value !== null);
  const text: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const number = numbers?.[index];
    if (number !== undefined && number !== null && code) {
      text.push(formatChartNumber(number, code, model.date1904));
    } else {
      text.push(labels?.[index] ?? String(index + 1));
    }
  }
  const valueAxis = plots.length > 0 ? plotAxis(model, plots[0]!, 'value') : null;
  const midCat =
    valueAxis?.crossBetween === 'midCat' ||
    (valueAxis?.crossBetween === null && plots.every((plot) => plot.kind === 'area'));
  return {
    axis,
    count,
    labels: text,
    serials: isDate
      ? timeUnitPositions(numbers!.slice(0, count) as number[], axis, model.date1904)
      : null,
    between: !midCat,
  };
}

/** Serial dates as indices of the axis's base time unit, so months and years step evenly. */
export function timeUnitPositions(
  serials: readonly number[],
  axis: ChartAxis | null,
  date1904: boolean
): number[] {
  const inUnit = (unit: 'months' | 'years') =>
    serials.map((serial) => {
      const days = date1904 ? serial + 1462 : serial < 61 ? serial + 1 : serial;
      const date = new Date(Math.round((days - 25_569) * 86_400_000));
      const year = date.getUTCFullYear();
      return unit === 'years' ? year : year * 12 + date.getUTCMonth();
    });
  const unit = axis?.baseTimeUnit ?? null;
  if (unit === 'days') return [...serials];
  if (unit !== null) return inUnit(unit);
  // Automatic: the largest unit that keeps every distinct date in a unit of its own.
  const distinct = new Set(serials).size;
  for (const candidate of ['years', 'months'] as const) {
    const positions = inUnit(candidate);
    if (new Set(positions).size === distinct) return positions;
  }
  return [...serials];
}

/** Position of category `index` (or its date) along an axis from `start` to `end`. */
export function categoryPosition(
  info: CategoryInfo,
  index: number,
  start: number,
  end: number
): number {
  const length = end - start;
  if (info.serials && info.serials.length > 0) {
    const first = Math.min(...info.serials);
    const last = Math.max(...info.serials);
    const days = Math.max(1, last - first + (info.between ? 1 : 0));
    const offset = (info.serials[index] ?? first) - first + (info.between ? 0.5 : 0);
    return start + (offset / days) * length;
  }
  if (info.between) return start + ((index + 0.5) / Math.max(1, info.count)) * length;
  return info.count <= 1 ? start + length / 2 : start + (index / (info.count - 1)) * length;
}

/** Width of one category slot along an axis of `length`. */
export function categorySlot(info: CategoryInfo, length: number): number {
  if (info.serials && info.serials.length > 1) {
    const sorted = [...info.serials].sort((a, b) => a - b);
    let smallest = Infinity;
    for (let index = 1; index < sorted.length; index += 1) {
      const step = sorted[index]! - sorted[index - 1]!;
      if (step > 0) smallest = Math.min(smallest, step);
    }
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const days = Math.max(1, last - first + 1);
    return Number.isFinite(smallest) ? (smallest / days) * length : length / info.count;
  }
  return length / Math.max(1, info.between ? info.count : Math.max(1, info.count - 1));
}

/** Widen a value range by the values of one plot, stacked as the plot stacks them. */
export function extendValueRange(info: ValueInfo, plot: ChartPlot, scatterX = false): void {
  const stacked = plot.grouping === 'stacked' || plot.grouping === 'percentStacked';
  if (plot.grouping === 'percentStacked' && plot.kind !== 'scatter' && plot.kind !== 'bubble') {
    info.percent = true;
    let negative = false;
    for (const series of plot.series)
      for (const value of series.values) if (value !== null && value < 0) negative = true;
    info.dataMin = Math.min(info.dataMin, negative ? -1 : 0);
    info.dataMax = Math.max(info.dataMax, 1);
    return;
  }
  if (stacked && plot.kind !== 'scatter' && plot.kind !== 'bubble') {
    const count = Math.max(0, ...plot.series.map((series) => series.values.length));
    for (let index = 0; index < count; index += 1) {
      let positive = 0;
      let negative = 0;
      let running = 0;
      for (const series of plot.series) {
        const value = series.values[index] ?? 0;
        if (plot.kind === 'bar') {
          if (value >= 0) positive += value;
          else negative += value;
        } else {
          running += value;
          positive = Math.max(positive, running);
          negative = Math.min(negative, running);
        }
      }
      info.dataMin = Math.min(info.dataMin, negative);
      info.dataMax = Math.max(info.dataMax, positive);
    }
    return;
  }
  for (const series of plot.series) {
    const values = scatterX
      ? (series.xValues ?? series.values.map((_, index) => index + 1))
      : series.values;
    for (const value of values) {
      if (value === null || !Number.isFinite(value)) continue;
      info.dataMin = Math.min(info.dataMin, value);
      info.dataMax = Math.max(info.dataMax, value);
    }
  }
  // Trendlines and error bars widen the range they are drawn in.
  for (const series of plot.series) {
    for (const trend of seriesTrendlines(plot, series)) {
      for (const point of trend.points) {
        const value = scatterX ? point.x : point.y;
        if (!Number.isFinite(value)) continue;
        info.dataMin = Math.min(info.dataMin, value);
        info.dataMax = Math.max(info.dataMax, value);
      }
    }
    for (const bar of seriesErrorBars(plot, series)) {
      if ((bar.direction === 'x') !== scatterX) continue;
      info.dataMin = Math.min(info.dataMin, bar.from, bar.to);
      info.dataMax = Math.max(info.dataMax, bar.from, bar.to);
    }
  }
  // Bubbles reach past their centres: the horizontal range leaves a tenth more room.
  if (plot.kind === 'bubble' && scatterX && info.dataMax > info.dataMin) {
    info.dataMax += (info.dataMax - info.dataMin) * 0.2;
  }
}

/** The format the tick labels of a value axis use. */
export function valueFormat(info: ValueInfo, firstSeriesFormat: string | null): string | null {
  const axis = info.axis;
  if (axis && !axis.sourceLinked && axis.formatCode) return axis.formatCode;
  if (info.percent) return '0%';
  return firstSeriesFormat ?? axis?.formatCode ?? null;
}

/** Scale a value direction for an axis of `length` points. */
export function scaleValues(
  info: ValueInfo,
  length: number,
  vertical: boolean,
  style: ChartTextStyle,
  date1904: boolean,
  threeD = false
): ValueScale {
  const empty = info.dataMin > info.dataMax;
  const dataMin = empty ? 0 : info.dataMin;
  const dataMax = empty ? 1 : info.dataMax;
  const axis = info.axis;
  const percentFixed = info.percent;
  const estimateLabel = formatChartNumber(
    Math.max(Math.abs(dataMin), Math.abs(dataMax)),
    info.formatCode,
    date1904
  );
  const labelWidth = estimateTextWidth(estimateLabel, style);
  if (axis?.logBase && !percentFixed) {
    return logValueScale(dataMin, dataMax, axis.logBase, axis.min, axis.max);
  }
  // A vertical axis keeps more than a label's height between ticks; a horizontal one keeps
  // its widest label clear of the next by one size. A fixed percent range
  // takes one tick more.
  const minInterval = vertical
    ? (threeD ? VERTICAL_GAP_3D : 1.6) * style.sizePt
    : labelWidth + HORIZONTAL_GAP * style.sizePt;
  const fitting = Math.floor(length / minInterval) + (percentFixed ? 1 : 0);
  return autoValueScale({
    dataMin,
    dataMax,
    lengthPt: Math.max(1, fitting) * minInterval,
    minIntervalPt: minInterval,
    fixedMin: axis?.min ?? (percentFixed ? (dataMin < 0 ? -1 : 0) : null),
    fixedMax: axis?.max ?? (percentFixed ? 1 : null),
    fixedMajor: axis?.majorUnit ?? null,
    noHeadroom: threeD,
    roomOnly: threeD,
  });
}

/** Map a value to a coordinate between `low` (axis minimum) and `high` (axis maximum). */
export function valuePosition(
  scale: ValueScale,
  value: number,
  low: number,
  high: number,
  reversed: boolean
): number {
  const ratio = scaleRatio(scale, value);
  return reversed ? high + (low - high) * ratio : low + (high - low) * ratio;
}
