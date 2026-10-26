/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Pie-of-pie and bar-of-pie plots: some points leave the main pie for a second pie or a
// stacked bar beside it, and one combined slice stands for them in the main pie, centred at
// three o'clock. Series lines join that slice to the second plot.

import { categoryLabel } from './chart-number-format.ts';
import type { Box } from './chart-axes.ts';
import { dataLabelBlock } from './chart-data-label.ts';
import { dataLabelFor, elementText, type DataLabelValues } from './chart-labels.ts';
import { children, childVal, type ChartPlot } from './chart-model.ts';
import type { PieContext } from './chart-pie.ts';
import { slice, type Point } from './chart-scene.ts';
import { seriesLook, variesByPoint } from './chart-series.ts';
import {
  mergeStroke,
  readChartShapeProperties,
  styleSeriesColor,
  type ChartStroke,
} from './chart-style.ts';
import { child } from './chart-model.ts';

const DEFAULT_SERIES_LINE: ChartStroke = {
  hex: 'A6A6A6',
  alpha: 1,
  widthPt: 0.75,
  cap: 'butt',
  dash: null,
};

/** Which points move to the second plot. */
function secondPoints(plot: ChartPlot, values: readonly (number | null)[]): Set<number> {
  const of = plot.ofPie!;
  const out = new Set<number>();
  const count = values.length;
  const total = values.reduce<number>(
    (sum, value) => sum + (value !== null && value > 0 ? value : 0),
    0
  );
  if (of.splitType === 'cust') {
    for (const point of children(child(plot.element, 'custSplit'), 'secondPiePt')) {
      const raw = childVal(point, 'val');
      if (raw !== undefined && /^\d{1,6}$/.test(raw) && Number(raw) < count) out.add(Number(raw));
    }
    return out;
  }
  if (of.splitType === 'val' || of.splitType === 'percent') {
    const limit = of.splitPos ?? 0;
    for (const [index, value] of values.entries()) {
      if (value === null || !(value > 0)) continue;
      const measure = of.splitType === 'percent' ? (value / (total || 1)) * 100 : value;
      if (measure < limit) out.add(index);
    }
    return out;
  }
  // By position: the last points, three when nothing says how many.
  const last = Math.max(
    0,
    Math.min(count - 1, Math.round(of.splitType === 'pos' ? (of.splitPos ?? 2) : 3))
  );
  for (let index = count - last; index < count; index += 1) out.add(index);
  return out;
}

/** Paint a pie-of-pie or bar-of-pie plot inside `box`. */
export function paintOfPie(plot: ChartPlot, box: Box, context: PieContext): void {
  const series = plot.series[0];
  if (!series || !plot.ofPie) return;
  const values = series.values;
  const count = values.length;
  const second = secondPoints(plot, values);
  const positive = (value: number | null | undefined): value is number =>
    value !== null && value !== undefined && value > 0;
  const total = values.reduce<number>((sum, value) => sum + (positive(value) ? value : 0), 0);
  if (!Number.isFinite(total)) {
    context.scene.ok = false;
    return;
  }
  const otherTotal = [...second].reduce(
    (sum, index) => sum + (positive(values[index]) ? values[index]! : 0),
    0
  );
  if (!(total > 0)) return;
  const labelStyle = elementText(context.baseText, null);
  const anyLabels = values.some((_, index) => dataLabelFor(plot, series, index) !== null);
  const room = anyLabels ? 2 * 1.38 * labelStyle.sizePt : 0;
  const bar = plot.ofPie.type === 'bar';
  const secondScale = plot.ofPie.secondSize / 100;
  const height = box.b - box.t;
  const widthLimit = box.r - box.l;
  // Main diameter d, second plot width w2 = d * scale (pie) or d * scale / 2 (bar), and a gap
  // of two thirds of the second plot's width per 100 percent of gap width.
  const secondWidthRatio = bar ? secondScale / 2 : secondScale;
  const gapRatio = 0.65 * secondWidthRatio * (plot.gapWidth / 100);
  const diameter = Math.max(
    1,
    Math.min(height - room, (widthLimit - room) / (1 + gapRatio + secondWidthRatio))
  );
  const radius = diameter / 2;
  const groupWidth = diameter * (1 + gapRatio + secondWidthRatio);
  const left = (box.l + box.r) / 2 - groupWidth / 2;
  const cx = left + radius;
  const cy = (box.t + box.b) / 2;
  const secondWidth = diameter * secondWidthRatio;
  const secondLeft = left + diameter * (1 + gapRatio);
  const resolve = context.look.resolveSchemeColor;

  // The combined slice (index `count`) is "Other" and has no cell of its own.
  const valuesOf = (index: number, value: number): DataLabelValues => ({
    value,
    percent: value / total,
    category: index < count ? categoryLabel(series, index, context.date1904) : 'Other',
    seriesName: series.name,
    seriesFormat: series.formatCode,
    date1904: context.date1904,
    cell: index < count ? (series.labelRange?.[index] ?? null) : null,
  });
  const label = (index: number, value: number, x: number, y: number, align: 'ctr' | 'l') => {
    const spec = dataLabelFor(plot, series, index);
    if (!spec) return;
    const style = elementText(context.baseText, spec.txPr, resolve);
    const block = dataLabelBlock(spec, valuesOf(index, value), style, null, resolve);
    const lineBox = block.height;
    const frame = block.frame;
    context.labels.push({
      paragraphs: block.paragraphs,
      align,
      x: align === 'ctr' ? x - frame / 2 : x,
      y: y - lineBox / 2,
      width: frame,
      height: lineBox,
      rotation: 0,
    });
  };
  const insideLabel = (
    index: number,
    value: number,
    middle: number,
    centerX: number,
    centerY: number,
    r: number
  ) => {
    const spec = dataLabelFor(plot, series, index);
    if (!spec) return;
    const radians = (middle * Math.PI) / 180;
    const style = elementText(context.baseText, spec.txPr, resolve);
    // Measured from the text the label paints.
    const block = dataLabelBlock(spec, valuesOf(index, value), style, null, resolve);
    const extent =
      (block.width / 2) * Math.abs(Math.sin(radians)) +
      (block.height / 2) * Math.abs(Math.cos(radians));
    const distance = Math.max(r * 0.3, r - extent - 4);
    label(
      index,
      value,
      centerX + distance * Math.sin(radians),
      centerY - distance * Math.cos(radians),
      'ctr'
    );
  };
  const lookOf = (index: number) =>
    seriesLook(
      plot,
      series,
      context.look,
      variesByPoint(plot) || series.points.has(index) ? { index, count: count + 1 } : undefined
    );

  // The main pie: kept points from just past three o'clock, then the combined slice.
  const otherSweep = (otherTotal / total) * 360;
  let angle = 90 + otherSweep / 2;
  for (let index = 0; index < count; index += 1) {
    const value = values[index];
    if (second.has(index) || !positive(value)) continue;
    const sweep = (value / total) * 360;
    const look = lookOf(index);
    context.scene.path(
      [slice(cx, cy, radius, 0, angle, angle + sweep)],
      true,
      look.fill,
      look.line,
      'round'
    );
    insideLabel(index, value, angle + sweep / 2, cx, cy, radius);
    angle += sweep;
  }
  if (otherTotal > 0) {
    const look = lookOf(count);
    const fill =
      series.points.has(count) || variesByPoint(plot)
        ? look.fill
        : styleSeriesColor(context.look.model.style, count, count + 1, resolve);
    context.scene.path(
      [slice(cx, cy, radius, 0, 90 - otherSweep / 2, 90 + otherSweep / 2)],
      true,
      fill,
      look.line,
      'round'
    );
    insideLabel(count, otherTotal, 90, cx, cy, radius);
  }

  // The second plot.
  const top: Point = {
    x: cx + radius * Math.sin(((90 - otherSweep / 2) * Math.PI) / 180),
    y: cy - radius * Math.cos(((90 - otherSweep / 2) * Math.PI) / 180),
  };
  const bottom: Point = { x: top.x, y: 2 * cy - top.y };
  let secondTop: Point;
  let secondBottom: Point;
  if (bar) {
    const barHeight = diameter * secondScale;
    let y = cy - barHeight / 2;
    for (const index of second) {
      const value = values[index];
      if (!positive(value) || !(otherTotal > 0)) continue;
      const segment = (value / otherTotal) * barHeight;
      const look = lookOf(index);
      context.scene.rect(secondLeft, y, secondWidth, segment, look.fill, look.line);
      label(index, value, secondLeft + secondWidth + 6, y + segment / 2, 'l');
      y += segment;
    }
    secondTop = { x: secondLeft, y: cy - barHeight / 2 };
    secondBottom = { x: secondLeft, y: cy + barHeight / 2 };
  } else {
    const r2 = secondWidth / 2;
    const cx2 = secondLeft + r2;
    let start = 90;
    for (const index of second) {
      const value = values[index];
      if (!positive(value) || !(otherTotal > 0)) continue;
      const sweep = (value / otherTotal) * 360;
      const look = lookOf(index);
      context.scene.path(
        [slice(cx2, cy, r2, 0, start, start + sweep)],
        true,
        look.fill,
        look.line,
        'round'
      );
      insideLabel(index, value, start + sweep / 2, cx2, cy, r2);
      start += sweep;
    }
    secondTop = { x: cx2, y: cy - r2 };
    secondBottom = { x: cx2, y: cy + r2 };
  }
  const lines = plot.ofPie.serLines;
  if (lines && otherTotal > 0) {
    const stroke = mergeStroke(
      readChartShapeProperties(child(lines, 'spPr'), resolve).line,
      DEFAULT_SERIES_LINE
    );
    if (stroke) {
      context.scene.path(
        [
          [top, secondTop],
          [bottom, secondBottom],
        ],
        false,
        null,
        stroke
      );
    }
  }
}
