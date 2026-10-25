/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The box and whisker chart (`layoutId="boxWhisker"`): the spread of the raw values cached
// for each category.
//
// The values of a series are grouped by their category text, categories in the order they
// first appear across the series. Each group draws a box from its first to its third quartile
// with a line at the median. The quartiles interpolate between the sorted values at position
// (n + 1)q (`quartileMethod="exclusive"`, the default) or (n - 1)q + 1 (`inclusive`), the
// position held to the first and last value. Whiskers reach the furthest values within one
// and a half box heights of the box, each ending in a cap three tenths of the box wide; values
// past them are outliers. The mean is an x mark 6 pt across, and a mean line joins the means
// of a series across the categories. `cx:visibility` shows the mean marker and the outliers
// unless it says otherwise, and the mean line and the inner points (the values strictly
// between the whisker ends) only when it asks for them; points are diamonds 3.12 pt across.
//
// The series of a category sit side by side in the share of the slot the gap leaves (a
// third of a box when the axis names no gap): one series fills it, several take 98 % of it,
// each box a tenth of its width apart from the next. Boxes and points take the series fill;
// their outlines, whiskers, median, mean marks and mean line take the series line, which by
// default is the data colour at eight tenths of its brightness.
//
// Value labels at the right of their marks follow `chartex-box-whisker-labels.ts`.
//
// Limit: value labels at another position, labels that name the series or the category, and
// per-point label overrides are not drawn.

import { schemaAttributeValue } from '@docx-editor.dev/core/store';
import { markerPath, markerStrokes, type Point } from './chart-scene.ts';
import {
  mergeStroke,
  readChartShapeProperties,
  type ChartPaint,
  type ChartStroke,
} from './chart-style.ts';
import { layoutChartexAxes } from './chartex-axes.ts';
import { boxLabelsDrawn, boxWhiskerLabels } from './chartex-box-whisker-labels.ts';
import type { ChartexContext, ChartexLayout, ChartexLegendEntry } from './chartex-layout.ts';
import {
  cxChild,
  cxFlag,
  seriesCategories,
  seriesValues,
  type ChartexSeries,
} from './chartex-model.ts';

/** The gap between box groups, as a fraction of a group's width, when the axis names none. */
const AUTO_GAP_WIDTH = 1 / 3;
const MAX_GAP_WIDTH = 5;
/** Several series fill this share of the room the gap leaves. */
const CLUSTER_FILL = 0.98;
/** The space between the boxes of one category, as a fraction of a box. */
const SERIES_SPACING = 0.1;
/** A whisker cap's width, as a fraction of the box. */
const CAP_SHARE = 0.3;
/** Whiskers reach this many box heights beyond the box. */
const WHISKER_REACH = 1.5;
const MEAN_MARK = 6;
const POINT_SIZE = 3.12;
/** The default line colour: the data colour at this share of its brightness. */
const LINE_SHADE = 0.8;

export type QuartileMethod = 'exclusive' | 'inclusive';

/** The statistics one box draws. */
export interface BoxWhiskerStatistics {
  readonly count: number;
  readonly firstQuartile: number;
  readonly median: number;
  readonly thirdQuartile: number;
  readonly mean: number;
  /** The whisker ends: the furthest values within reach of the box. */
  readonly whiskerLow: number;
  readonly whiskerHigh: number;
  /** Values past the whisker ends, ascending. */
  readonly outliers: readonly number[];
  /** Values strictly between the whisker ends, ascending. */
  readonly inner: readonly number[];
}

/**
 * Quantile `fraction` of ascending `sorted` values: linear interpolation at the 1-based
 * position (n + 1)q (exclusive) or (n - 1)q + 1 (inclusive), held to the first and last value.
 */
export function quartileOf(
  sorted: ArrayLike<number>,
  fraction: number,
  method: QuartileMethod
): number {
  const count = sorted.length;
  if (count === 0) return Number.NaN;
  const raw = method === 'inclusive' ? (count - 1) * fraction + 1 : (count + 1) * fraction;
  const position = Math.min(count, Math.max(1, raw));
  const below = Math.floor(position);
  const low = sorted[below - 1]!;
  if (below >= count) return low;
  return low + (position - below) * (sorted[below]! - low);
}

/** The box of `values` (non-finite ones skipped), or null when none is finite. */
export function boxWhiskerStatistics(
  values: readonly number[],
  method: QuartileMethod
): BoxWhiskerStatistics | null {
  let count = 0;
  for (const value of values) if (Number.isFinite(value)) count += 1;
  if (count === 0) return null;
  // A typed array sorts numerically; the values are bounded by the model's point limits.
  const sorted = new Float64Array(count);
  let at = 0;
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    sorted[at++] = value;
    sum += value;
  }
  sorted.sort();
  const firstQuartile = quartileOf(sorted, 0.25, method);
  const thirdQuartile = quartileOf(sorted, 0.75, method);
  const reach = WHISKER_REACH * (thirdQuartile - firstQuartile);
  const lowFence = firstQuartile - reach;
  const highFence = thirdQuartile + reach;
  let whiskerLow = Number.POSITIVE_INFINITY;
  let whiskerHigh = Number.NEGATIVE_INFINITY;
  const outliers: number[] = [];
  for (const value of sorted) {
    if (value < lowFence || value > highFence) {
      outliers.push(value);
      continue;
    }
    whiskerLow = Math.min(whiskerLow, value);
    whiskerHigh = Math.max(whiskerHigh, value);
  }
  const inner: number[] = [];
  for (const value of sorted) {
    if (value > whiskerLow && value < whiskerHigh) inner.push(value);
  }
  const mean = sum / count;
  return {
    count,
    firstQuartile,
    median: quartileOf(sorted, 0.5, method),
    thirdQuartile,
    mean: Number.isFinite(mean) ? mean : firstQuartile,
    whiskerLow,
    whiskerHigh,
    outliers,
    inner,
  };
}

/** The values of each series grouped by category text, categories in first-seen order. */
export function boxWhiskerGroups(
  series: readonly {
    readonly categories: readonly (string | null)[] | null;
    readonly values: readonly (number | null)[];
  }[]
): { readonly categories: readonly string[]; readonly values: readonly (readonly number[][])[] } {
  // A Map keys the groups, so a category named `__proto__` is an ordinary group.
  const slots = new Map<string, number>();
  const categories: string[] = [];
  const grouped: number[][][] = [];
  for (const item of series) {
    const groups: number[][] = [];
    for (const [index, value] of item.values.entries()) {
      if (value === null || !Number.isFinite(value)) continue;
      const name = item.categories?.[index] ?? '';
      let slot = slots.get(name);
      if (slot === undefined) {
        slot = categories.length;
        slots.set(name, slot);
        categories.push(name);
      }
      (groups[slot] ??= []).push(value);
    }
    grouped.push(groups);
  }
  return { categories, values: grouped };
}

interface SeriesSettings {
  readonly method: QuartileMethod;
  readonly meanLine: boolean;
  readonly meanMarker: boolean;
  readonly inner: boolean;
  readonly outliers: boolean;
}

function settingsOf(series: ChartexSeries): SeriesSettings {
  const visibility = cxChild(series.layoutPr, 'visibility');
  const statistics = cxChild(series.layoutPr, 'statistics');
  const method = statistics
    ? schemaAttributeValue(statistics.attributes, 'quartileMethod')
    : undefined;
  return {
    method: method === 'inclusive' ? 'inclusive' : 'exclusive',
    meanLine: cxFlag(visibility, 'meanLine', false),
    meanMarker: cxFlag(visibility, 'meanMarker', true),
    inner: cxFlag(visibility, 'nonoutliers', false),
    outliers: cxFlag(visibility, 'outliers', true),
  };
}

/** `color` at `share` of its brightness. */
function darker(color: ChartPaint, share: number): ChartPaint {
  const channel = (offset: number) =>
    Math.round(Number.parseInt(color.hex.slice(offset, offset + 2), 16) * share)
      .toString(16)
      .padStart(2, '0');
  return { hex: `${channel(0)}${channel(2)}${channel(4)}`.toUpperCase(), alpha: color.alpha };
}

interface SeriesLook {
  readonly fill: ChartPaint | null;
  readonly line: ChartStroke | null;
}

function seriesLook(series: ChartexSeries, context: ChartexContext): SeriesLook {
  const { look } = context;
  const color = look.dataColor(series.formatIndex, 1);
  const shade = /^[0-9A-Fa-f]{6}$/.test(color.hex) ? darker(color, LINE_SHADE) : color;
  // The series' own outline wins; a style without one still outlines in the shaded colour.
  const styled = look.line('dataPoint', null, shade) ?? {
    ...shade,
    widthPt: 0.75,
    cap: 'butt' as const,
    dash: null,
  };
  const own = readChartShapeProperties(series.spPr, look.resolveSchemeColor).line;
  return { fill: look.fill('dataPoint', series.spPr, color), line: mergeStroke(own, styled) };
}

function legendEntries(series: readonly ChartexSeries[], context: ChartexContext) {
  const entries: ChartexLegendEntry[] = [];
  for (const item of series) {
    const { fill, line } = seriesLook(item, context);
    entries.push({ text: item.name ?? `Series${item.index + 1}`, fill, line });
  }
  return entries;
}

interface Drawn {
  readonly series: ChartexSeries;
  readonly settings: SeriesSettings;
  readonly boxes: readonly (BoxWhiskerStatistics | null)[];
}

function paint(
  series: readonly ChartexSeries[],
  box: { l: number; t: number; r: number; b: number },
  context: ChartexContext
): boolean {
  if (series.length === 0) return false;
  const reads: {
    categories: readonly (string | null)[] | null;
    values: readonly (number | null)[];
  }[] = [];
  let formatCode: string | null = null;
  for (const item of series) {
    const read = seriesValues(item);
    if (!read) return false;
    formatCode ??= read.formatCode;
    reads.push({ categories: seriesCategories(item), values: read.values });
  }
  const groups = boxWhiskerGroups(reads);
  if (groups.categories.length === 0) return false;
  const drawn: Drawn[] = series.map((item, index) => {
    const settings = settingsOf(item);
    const lists = groups.values[index]!;
    return {
      series: item,
      settings,
      boxes: groups.categories.map((_, slot) =>
        lists[slot] ? boxWhiskerStatistics(lists[slot], settings.method) : null
      ),
    };
  });

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  const extend = (value: number) => {
    low = Math.min(low, value);
    high = Math.max(high, value);
  };
  for (const { settings, boxes } of drawn) {
    for (const stats of boxes) {
      if (!stats) continue;
      extend(stats.whiskerLow);
      extend(stats.whiskerHigh);
      if (settings.meanLine || settings.meanMarker) extend(stats.mean);
      if (settings.outliers) for (const value of stats.outliers) extend(value);
    }
  }
  const categoryAxis = context.model.axes.find((axis) => axis.kind === 'category') ?? null;
  const valueAxis = context.model.axes.find((axis) => axis.kind === 'value') ?? null;
  const axes = layoutChartexAxes(
    {
      categories: groups.categories,
      dataMin: low,
      dataMax: high,
      formatCode: valueAxis?.formatCode ?? formatCode,
      categoryAxis,
      valueAxis,
    },
    box,
    context
  );
  if (!axes) return true;
  axes.paintGrid();

  const { scene } = context;
  const rawGap = categoryAxis?.gapWidth ?? AUTO_GAP_WIDTH;
  const gap = Math.min(MAX_GAP_WIDTH, Math.max(0, rawGap));
  const room = axes.slot / (1 + gap);
  const count = drawn.length;
  const width = count === 1 ? room : (CLUSTER_FILL * room) / (count + SERIES_SPACING * (count - 1));
  const pitch = width * (1 + SERIES_SPACING);
  const clamp = (value: number) => Math.min(axes.scale.max, Math.max(axes.scale.min, value));
  const inside = (value: number) => value >= axes.scale.min && value <= axes.scale.max;
  const y = (value: number) => axes.valueAt(clamp(value));

  const plotBottom = axes.valueAt(axes.scale.min);
  for (const [order, { series: item, settings, boxes }] of drawn.entries()) {
    const { fill, line } = seriesLook(item, context);
    const means: Point[] = [];
    const dataLabels = item.dataLabels;
    const labelStyle =
      dataLabels && dataLabels.visibility.value && boxLabelsDrawn(dataLabels.position)
        ? context.look.text('dataLabel', dataLabels.txPr)
        : null;
    for (const [slot, stats] of boxes.entries()) {
      if (!stats) continue;
      const left = axes.categoryAt(slot) - room / 2 + order * pitch;
      const center = left + width / 2;
      const cap = (CAP_SHARE * width) / 2;
      const whiskers: Point[][] = [];
      for (const [end, edge] of [
        [stats.whiskerLow, stats.firstQuartile],
        [stats.whiskerHigh, stats.thirdQuartile],
      ] as const) {
        whiskers.push([
          { x: center - cap, y: y(end) },
          { x: center + cap, y: y(end) },
        ]);
        if (end !== edge) {
          whiskers.push([
            { x: center, y: y(end) },
            { x: center, y: y(edge) },
          ]);
        }
      }
      scene.path(whiskers, false, null, line);
      const top = y(stats.thirdQuartile);
      const bottom = y(stats.firstQuartile);
      scene.rect(left, top, width, bottom - top, fill, line);
      scene.line(
        [
          { x: left, y: y(stats.median) },
          { x: left + width, y: y(stats.median) },
        ],
        line
      );
      const points = [
        ...(settings.inner ? stats.inner : []),
        ...(settings.outliers ? stats.outliers : []),
      ];
      for (const value of points) {
        if (!inside(value)) continue;
        scene.path(markerPath('diamond', center, y(value), POINT_SIZE), true, fill, line);
      }
      if (settings.meanMarker && inside(stats.mean)) {
        scene.path(markerStrokes('x', center, y(stats.mean), MEAN_MARK), false, null, line);
      }
      means.push({ x: center, y: y(stats.mean) });
      if (labelStyle) {
        const values = {
          box: [stats.firstQuartile, stats.median, stats.thirdQuartile].filter(inside),
          whiskers: [stats.whiskerLow, stats.whiskerHigh].filter(inside),
          points: points.filter(inside),
          mean: settings.meanMarker && inside(stats.mean) ? stats.mean : null,
        };
        const marks = {
          boxRight: left + width,
          capRight: center + cap,
          center,
          pointHalf: POINT_SIZE / 2,
          meanHalf: MEAN_MARK / 2,
        };
        const format = item.dataLabels!.formatCode ?? formatCode;
        for (const label of boxWhiskerLabels(values, marks, y, plotBottom, labelStyle, format)) {
          context.labels.push(label);
        }
      }
    }
    if (settings.meanLine && means.length > 1) scene.line(means, line);
  }
  axes.paintAxes();
  return true;
}

export const BOX_WHISKER_LAYOUT: ChartexLayout = Object.freeze({
  layoutIds: Object.freeze(['boxWhisker']),
  roomAbovePlot: true,
  legendEntries,
  paint,
});
