/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The waterfall chart (`layoutId="waterfall"`): a running total drawn as floating columns.
//
// Each point moves the running total by its value, drawn as a column from the total before
// it to the total after it. A subtotal point (`cx:subtotals/cx:idx`) is a column from zero to
// its own value, and the running total continues from that value. Increases take data colour
// 0, decreases data colour 1 and totals data colour 2. The series' `cx:spPr` paints every
// column, its connector lines and its legend keys; a `cx:dataPt` paints one column over it,
// and keeps the series outline unless it names its own. Connector lines (on unless
// `cx:visibility connectorLines="0"`) join the end of each column to the start of the next,
// in the `seriesLine` look under the series outline. A data label at the default
// `outEnd` position sits against the end the column grows to: above an increase or positive
// total, below a decrease or negative total, kept inside the plot; a label the plot's edge
// pushes onto its own column turns light. The legend lists Increase, Decrease and Total.

import { formatChartNumber } from './chart-number-format.ts';
import { themeColor } from './chart-style.ts';
import { estimateTextWidth, lineHeight } from './chart-text.ts';
import { layoutChartexAxes } from './chartex-axes.ts';
import type { ChartexContext, ChartexLayout, ChartexLegendEntry } from './chartex-layout.ts';
import { namesTextColor } from './chartex-style.ts';
import {
  CHARTEX_LIMITS,
  cxChild,
  cxChildren,
  cxFlag,
  pointLabelVisibility,
  pointSpPr,
  seriesCategories,
  seriesValues,
  type ChartexSeries,
} from './chartex-model.ts';

/** The gap between columns, as a fraction of a column's width, when the axis names none. */
const DEFAULT_GAP_WIDTH = 0.5;
const MAX_GAP_WIDTH = 5;

export type WaterfallKind = 'increase' | 'decrease' | 'total';

/** One column of a waterfall: from `from` to `to` on the value axis. */
export interface WaterfallStep {
  readonly index: number;
  readonly kind: WaterfallKind;
  readonly value: number;
  readonly from: number;
  readonly to: number;
}

/** The subtotal point indexes of a waterfall series. */
export function waterfallSubtotals(series: ChartexSeries): Set<number> {
  const subtotals = new Set<number>();
  const list = cxChildren(
    cxChild(series.layoutPr, 'subtotals'),
    'idx',
    CHARTEX_LIMITS.pointsPerLevel
  );
  for (const element of list ?? []) {
    const raw = element.attributes.find((attribute) => attribute.localName === 'val')?.value;
    if (raw !== undefined && /^\d{1,9}$/.test(raw)) subtotals.add(Number(raw));
  }
  return subtotals;
}

/**
 * The columns of a waterfall: a running total over `values`, reset to the value of each
 * subtotal. A point without a cached value draws nothing and leaves the total as it is.
 */
export function waterfallSteps(
  values: readonly (number | null)[],
  subtotals: ReadonlySet<number>
): (WaterfallStep | null)[] {
  const steps: (WaterfallStep | null)[] = [];
  let total = 0;
  for (const [index, value] of values.entries()) {
    if (value === null) {
      steps.push(null);
      continue;
    }
    if (subtotals.has(index)) {
      steps.push({ index, kind: 'total', value, from: 0, to: value });
      total = value;
      continue;
    }
    steps.push({
      index,
      kind: value < 0 ? 'decrease' : 'increase',
      value,
      from: total,
      to: total + value,
    });
    total += value;
  }
  return steps;
}

const KIND_COLOR: Record<WaterfallKind, number> = { increase: 0, decrease: 1, total: 2 };

function legendEntries(series: readonly ChartexSeries[], context: ChartexContext) {
  const entries: ChartexLegendEntry[] = [];
  const spPr = series[0]?.spPr ?? null;
  for (const [text, kind] of [
    ['Increase', 'increase'],
    ['Decrease', 'decrease'],
    ['Total', 'total'],
  ] as const) {
    const color = context.look.dataColor(KIND_COLOR[kind], 3);
    entries.push({
      text,
      fill: context.look.fill('dataPoint', spPr, color),
      line: context.look.line('dataPoint', spPr, color),
    });
  }
  return entries;
}

function paint(
  series: readonly ChartexSeries[],
  box: { l: number; t: number; r: number; b: number },
  context: ChartexContext
): boolean {
  if (series.length !== 1) return false;
  const item = series[0]!;
  const read = seriesValues(item);
  if (!read || read.values.length === 0) return false;
  const steps = waterfallSteps(read.values, waterfallSubtotals(item));
  const names = seriesCategories(item);
  const categories = steps.map((_, index) => names?.[index] ?? String(index + 1));
  let low = 0;
  let high = 0;
  for (const step of steps) {
    if (!step) continue;
    low = Math.min(low, step.from, step.to);
    high = Math.max(high, step.from, step.to);
  }
  const categoryAxis = context.model.axes.find((axis) => axis.kind === 'category') ?? null;
  const valueAxis = context.model.axes.find((axis) => axis.kind === 'value') ?? null;
  const axes = layoutChartexAxes(
    {
      categories,
      dataMin: low,
      dataMax: high,
      formatCode: valueAxis?.formatCode ?? read.formatCode,
      categoryAxis,
      valueAxis,
    },
    box,
    context
  );
  if (!axes) return true;
  axes.paintGrid();

  const { look, scene, labels } = context;
  const rawGap = categoryAxis?.gapWidth ?? DEFAULT_GAP_WIDTH;
  const gap = Math.min(MAX_GAP_WIDTH, Math.max(0, rawGap));
  const barWidth = axes.slot / (1 + gap);
  const clamp = (value: number) => Math.min(axes.scale.max, Math.max(axes.scale.min, value));
  for (const step of steps) {
    if (!step) continue;
    const color = look.dataColor(KIND_COLOR[step.kind], 3);
    const { fill, line } = look.point('dataPoint', item.spPr, pointSpPr(item, step.index), color);
    const center = axes.categoryAt(step.index);
    const top = axes.valueAt(clamp(Math.max(step.from, step.to)));
    const bottom = axes.valueAt(clamp(Math.min(step.from, step.to)));
    scene.rect(center - barWidth / 2, top, barWidth, bottom - top, fill, line);
  }

  const connectors = cxFlag(cxChild(item.layoutPr, 'visibility'), 'connectorLines', true);
  const connector = connectors ? look.line('seriesLine', item.spPr) : null;
  if (connector) {
    const segments: { x: number; y: number }[][] = [];
    let previous: (typeof steps)[number] = null;
    for (const step of steps) {
      if (!step) continue;
      if (previous) {
        const y = axes.valueAt(clamp(previous.to));
        segments.push([
          { x: axes.categoryAt(previous.index) + barWidth / 2, y },
          { x: axes.categoryAt(step.index) - barWidth / 2, y },
        ]);
      }
      previous = step;
    }
    if (segments.length > 0) scene.path(segments, false, null, connector);
  }

  const dataLabels = item.dataLabels;
  if (dataLabels) {
    const style = look.text('dataLabel', dataLabels.txPr);
    const height = lineHeight(style);
    const format = dataLabels.formatCode ?? read.formatCode;
    for (const step of steps) {
      if (!step) continue;
      const shown = pointLabelVisibility(dataLabels, step.index);
      if (!shown) continue;
      const parts: string[] = [];
      if (shown.seriesName && item.name) parts.push(item.name);
      if (shown.categoryName) parts.push(categories[step.index]!);
      if (shown.value) parts.push(formatChartNumber(step.value, format));
      if (parts.length === 0) continue;
      const text = parts.join(dataLabels.separator ?? ', ');
      const up = step.to >= step.from;
      const end = axes.valueAt(clamp(step.to));
      const base = axes.valueAt(clamp(step.from));
      let center: number;
      switch (dataLabels.position) {
        case 'ctr':
          center = (end + base) / 2;
          break;
        case 'inEnd':
          center = up ? end + height / 2 : end - height / 2;
          break;
        case 'inBase':
          center = up ? base - height / 2 : base + height / 2;
          break;
        default:
          center = up ? end - height / 2 : end + height / 2;
      }
      // A label stays inside the plot. One pushed onto its own column takes the light text
      // colour, unless the labels name their own colour.
      center = Math.min(axes.plot.b - height / 2, Math.max(axes.plot.t + height / 2, center));
      const onColumn =
        center > Math.min(end, base) &&
        center < Math.max(end, base) &&
        !namesTextColor(dataLabels.txPr);
      const light = onColumn ? themeColor('lt1', '', look.resolveSchemeColor) : null;
      const frame = estimateTextWidth(text, style) * 1.3 + style.sizePt * 2;
      labels.push({
        paragraphs: [[{ text, style: light ? { ...style, colorHex: light.hex } : style }]],
        align: 'ctr',
        x: axes.categoryAt(step.index) - frame / 2,
        y: center - height / 2,
        width: frame,
        height,
        rotation: 0,
      });
    }
  }
  axes.paintAxes();
  return true;
}

export const WATERFALL_LAYOUT: ChartexLayout = Object.freeze({
  layoutIds: Object.freeze(['waterfall']),
  roomAbovePlot: true,
  legendEntries,
  paint,
});
