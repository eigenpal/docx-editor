/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The series of bar, line, area and scatter plots, with their markers and data labels, in
// the coordinates the axes give them.

import { categorySlot, type Box, type CategoryInfo, type ValueInfo } from './chart-axes.ts';
import type { CartesianContext } from './chart-cartesian.ts';
import { dataLabelFor, dataLabelText, elementText } from './chart-labels.ts';
import { child, childVal, type ChartPlot } from './chart-model.ts';
import {
  ellipse,
  markerPath,
  markerStrokes,
  smoothPath,
  type ChartScene,
  type Point,
} from './chart-scene.ts';
import { seriesLook, variesByPoint } from './chart-series.ts';
import {
  mergeStroke,
  readChartShapeProperties,
  type ChartPaint,
  type ChartStroke,
} from './chart-style.ts';
import { estimateTextWidth, lineHeight, textBlock, type ChartLabel } from './chart-text.ts';
import { seriesErrorBars, seriesTrendlines } from './chart-trendline.ts';

export interface SeriesMapping {
  readonly categoryAt: (index: number) => number;
  readonly valueAt: (info: ValueInfo, value: number) => number;
  readonly categories: CategoryInfo | null;
  readonly horizontal: boolean;
  readonly xInfo: ValueInfo | null;
  readonly plot: Box;
}

const WHITE: ChartPaint = { hex: 'FFFFFF', alpha: 1 };

export function paintSeries(
  plot: ChartPlot,
  info: ValueInfo,
  base: number,
  map: SeriesMapping,
  context: CartesianContext,
  labels: ChartLabel[]
): void {
  const { scene } = context;
  const look = context.look;
  const count = map.categories?.count ?? 0;
  const percent = plot.grouping === 'percentStacked';
  const stacked = plot.grouping === 'stacked' || percent;
  const totals: number[] = [];
  if (percent) {
    for (let index = 0; index < count; index += 1) {
      let total = 0;
      for (const series of plot.series) total += Math.abs(series.values[index] ?? 0);
      totals.push(total || 1);
    }
  }
  const scaled = (value: number, index: number) => (percent ? value / totals[index]! : value);
  const point = (category: number, value: number): Point =>
    map.horizontal
      ? { x: map.valueAt(info, value), y: map.categoryAt(category) }
      : { x: map.categoryAt(category), y: map.valueAt(info, value) };
  const labelAt = (
    series: (typeof plot.series)[number],
    index: number,
    value: number,
    anchor: Point,
    placement:
      | { readonly kind: 'bar'; readonly end: Point; readonly start: Point }
      | { readonly kind: 'point'; readonly markerHalf: number }
  ) => {
    const spec = dataLabelFor(plot, series, index);
    if (!spec) return;
    const style = elementText(context.baseText, spec.txPr, look.resolveSchemeColor);
    const category = map.categories?.labels[index] ?? null;
    const text = dataLabelText(
      spec,
      value,
      percent ? value / totals[index]! : null,
      category,
      series.name,
      series.formatCode,
      context.model.date1904
    );
    if (text === '') return;
    const block = textBlock(text, style);
    const width = block.width;
    const height = lineHeight(style) * block.lines;
    const frame = width * 1.3 + style.sizePt * 2;
    const gap = 0.48 * style.sizePt;
    let cx = anchor.x;
    let cy = anchor.y;
    if (placement.kind === 'bar') {
      const position = spec.position ?? (stacked ? 'ctr' : 'outEnd');
      const { start, end } = placement;
      const dx = Math.sign(end.x - start.x) || 1;
      const dy = Math.sign(end.y - start.y) || -1;
      if (position === 'ctr') {
        cx = (start.x + end.x) / 2;
        cy = (start.y + end.y) / 2;
      } else if (map.horizontal) {
        const along =
          position === 'inBase'
            ? start.x + dx * (gap + width / 2)
            : position === 'inEnd'
              ? end.x - dx * (gap + width / 2)
              : end.x + dx * (gap + width / 2);
        cx = along;
        cy = end.y;
      } else {
        const along =
          position === 'inBase'
            ? start.y + dy * (gap + height / 2)
            : position === 'inEnd'
              ? end.y - dy * (gap + height / 2)
              : end.y + dy * (gap + height / 2);
        cx = end.x;
        cy = along;
      }
    } else {
      const position = spec.position ?? (plot.kind === 'area' ? 'ctr' : 'r');
      const reach = placement.markerHalf + gap;
      if (position === 'r') cx = anchor.x + reach + width / 2;
      else if (position === 'l') cx = anchor.x - reach - width / 2;
      else if (position === 't') cy = anchor.y - reach - height / 2;
      else if (position === 'b') cy = anchor.y + reach + height / 2;
    }
    labels.push({
      paragraphs: [[{ text, style }]],
      align: 'ctr',
      x: cx - frame / 2,
      y: cy - height / 2,
      width: frame,
      height,
      rotation: 0,
    });
  };

  if (plot.kind === 'bar' && map.categories) {
    const along = map.horizontal ? map.plot.b - map.plot.t : map.plot.r - map.plot.l;
    const slot = categorySlot(map.categories, along);
    const gap = plot.gapWidth / 100;
    const seriesCount = stacked ? 1 : plot.series.length;
    const overlap = stacked ? 1 : plot.overlap / 100;
    const barWidth = slot / (seriesCount - (seriesCount - 1) * overlap + gap);
    const positive: number[] = [];
    const negative: number[] = [];
    for (const [seriesIndex, series] of plot.series.entries()) {
      const varied = variesByPoint(plot);
      const seriesStyle = seriesLook(plot, series, look);
      const bars: { index: number; start: Point; end: Point; value: number }[] = [];
      for (let index = 0; index < Math.min(count, series.values.length); index += 1) {
        const raw = series.values[index];
        if (raw === null || raw === undefined) continue;
        const value = scaled(raw, index);
        let from = base;
        let to = value;
        if (stacked) {
          const stack = value >= 0 ? positive : negative;
          from = stack[index] ?? 0;
          to = from + value;
          stack[index] = to;
        }
        const center = map.categoryAt(index);
        const offset =
          -slot / 2 + (gap * barWidth) / 2 + (stacked ? 0 : seriesIndex * barWidth * (1 - overlap));
        // Columns run left to right in a slot; bars run bottom to top.
        const near = map.horizontal ? center - offset : center + offset;
        const far = map.horizontal ? near - barWidth : near + barWidth;
        const startValue = map.valueAt(info, from);
        const endValue = map.valueAt(info, to);
        const lookFor =
          varied || series.points.has(index)
            ? seriesLook(plot, series, look, { index, count: series.values.length })
            : seriesStyle;
        const fill = series.invertIfNegative && value < 0 ? WHITE : lookFor.fill;
        if (map.horizontal) {
          scene.rect(
            Math.min(startValue, endValue),
            Math.min(near, far),
            Math.abs(endValue - startValue),
            barWidth,
            fill,
            lookFor.line
          );
          bars.push({
            index,
            start: { x: startValue, y: (near + far) / 2 },
            end: { x: endValue, y: (near + far) / 2 },
            value: raw,
          });
        } else {
          scene.rect(
            Math.min(near, far),
            Math.min(startValue, endValue),
            barWidth,
            Math.abs(endValue - startValue),
            fill,
            lookFor.line
          );
          bars.push({
            index,
            start: { x: (near + far) / 2, y: startValue },
            end: { x: (near + far) / 2, y: endValue },
            value: raw,
          });
        }
      }
      for (const bar of bars)
        labelAt(series, bar.index, bar.value, bar.end, {
          kind: 'bar',
          start: bar.start,
          end: bar.end,
        });
      const centres = new Map(
        bars.map((bar) => [bar.index, map.horizontal ? bar.start.y : bar.start.x])
      );
      if (!stacked) paintExtras(plot, series, info, map, context, labels, centres);
    }
    return;
  }

  if ((plot.kind === 'line' || plot.kind === 'area') && map.categories) {
    const running: number[] = [];
    let previous: Point[] | null = null;
    for (const series of plot.series) {
      const style = seriesLook(plot, series, look);
      const points: (Point | null)[] = [];
      const valuesAt: number[] = [];
      for (let index = 0; index < count; index += 1) {
        let raw = series.values[index] ?? null;
        if (raw === null && (context.blanks === 'zero' || plot.kind === 'area' || stacked)) raw = 0;
        if (raw === null) {
          points.push(null);
          valuesAt.push(0);
          continue;
        }
        let value = scaled(raw, index);
        if (stacked) {
          value += running[index] ?? 0;
          running[index] = value;
        }
        valuesAt.push(raw);
        points.push(point(index, value));
      }
      if (plot.kind === 'area') {
        const top = points.filter((item): item is Point => item !== null);
        const bottom =
          previous ??
          top.map((item) =>
            map.horizontal
              ? { x: map.valueAt(info, base), y: item.y }
              : { x: item.x, y: map.valueAt(info, base) }
          );
        if (top.length >= 2) {
          scene.path([[...top, ...[...bottom].reverse()]], true, style.fill, style.line);
        }
        if (stacked) previous = top;
      } else {
        const runs: Point[][] = [];
        let current: Point[] = [];
        for (const item of points) {
          if (item === null) {
            if (context.blanks !== 'span') {
              if (current.length) runs.push(current);
              current = [];
            }
            continue;
          }
          current.push(item);
        }
        if (current.length) runs.push(current);
        if (style.line) {
          for (const run of runs)
            scene.line(series.smooth ? smoothPath(run) : run, style.line, 'round');
        }
        paintMarkers(points, style.marker, scene);
      }
      for (const [index, item] of points.entries()) {
        if (!item) continue;
        labelAt(series, index, valuesAt[index]!, item, {
          kind: 'point',
          markerHalf: style.marker ? style.marker.size / 2 : 0,
        });
      }
    }
    if (!stacked) {
      for (const series of plot.series) paintExtras(plot, series, info, map, context, labels);
    }
    if (plot.kind === 'line') paintStockBars(plot, info, map, context);
    return;
  }

  if (plot.kind === 'bubble' && map.xInfo?.scale) {
    // Bubble areas follow their sizes; the largest is a quarter of the plot's shorter side.
    let largest = 0;
    for (const series of plot.series) {
      for (const size of series.bubbleSizes ?? []) {
        if (size !== null && Number.isFinite(size)) largest = Math.max(largest, Math.abs(size));
      }
    }
    const shorter = Math.min(map.plot.r - map.plot.l, map.plot.b - map.plot.t);
    const widest = 0.264 * shorter * (plot.bubbleScale / 100);
    for (const series of plot.series) {
      const style = seriesLook(plot, series, look);
      const bubbles: Point[][] = [];
      for (let index = 0; index < series.values.length; index += 1) {
        const y = series.values[index];
        const x = series.xValues ? series.xValues[index] : index + 1;
        const size = series.bubbleSizes?.[index];
        if (y === null || y === undefined || x === null || x === undefined) continue;
        if (size === null || size === undefined || !(size > 0) || !(largest > 0)) continue;
        const ratio = plot.bubbleArea ? Math.sqrt(size / largest) : size / largest;
        const radius = (widest * ratio) / 2;
        bubbles.push(ellipse(map.valueAt(map.xInfo, x), map.valueAt(info, y), radius, radius, 32));
      }
      if (bubbles.length > 0) scene.path(bubbles, true, style.fill, style.line);
      paintExtras(plot, series, info, map, context, labels);
    }
    return;
  }

  if (plot.kind === 'scatter' && map.xInfo?.scale) {
    for (const series of plot.series) {
      const style = seriesLook(plot, series, look);
      const points: (Point | null)[] = [];
      for (let index = 0; index < series.values.length; index += 1) {
        const y = series.values[index];
        const x = series.xValues ? series.xValues[index] : index + 1;
        if (y === null || y === undefined || x === null || x === undefined) {
          points.push(null);
          continue;
        }
        points.push({ x: map.valueAt(map.xInfo, x), y: map.valueAt(info, y) });
      }
      const drawn = points.filter((item): item is Point => item !== null);
      const linesShown =
        style.line !== null && plot.scatterStyle !== 'marker' && plot.scatterStyle !== 'none';
      if (linesShown && drawn.length >= 2) {
        const smooth =
          series.smooth || plot.scatterStyle === 'smooth' || plot.scatterStyle === 'smoothMarker';
        scene.line(smooth ? smoothPath(drawn) : drawn, style.line, 'round');
      }
      paintExtras(plot, series, info, map, context, labels);
      paintMarkers(points, style.marker, scene);
      for (const [index, item] of points.entries()) {
        if (!item) continue;
        labelAt(series, index, series.values[index]!, item, {
          kind: 'point',
          markerHalf: style.marker ? style.marker.size / 2 : 0,
        });
      }
    }
  }
}

function paintMarkers(
  points: readonly (Point | null)[],
  marker: ReturnType<typeof seriesLook>['marker'],
  scene: ChartScene
): void {
  if (!marker) return;
  const size = marker.size * 0.96;
  const shapes: Point[][] = [];
  const strokes: Point[][] = [];
  for (const item of points) {
    if (!item) continue;
    for (const shape of markerPath(marker.symbol, item.x, item.y, size)) shapes.push(shape);
    for (const stroke of markerStrokes(marker.symbol, item.x, item.y, size)) strokes.push(stroke);
  }
  if (shapes.length > 0) scene.path(shapes, true, marker.fill, marker.line);
  if (strokes.length > 0) scene.path(strokes, false, null, marker.line);
}

const DEFAULT_HI_LOW: ChartStroke = {
  hex: '000000',
  alpha: 1,
  widthPt: 0.75,
  cap: 'butt',
  dash: null,
};
const UP_BAR: ChartPaint = { hex: 'FFFFFF', alpha: 1 };
const DOWN_BAR: ChartPaint = { hex: '000000', alpha: 1 };

/**
 * High-low lines from each category's lowest to highest value, and up-down bars from the
 * first series to the last: white where the last is higher, black where it is lower.
 */
function paintStockBars(
  plot: ChartPlot,
  info: ValueInfo,
  map: SeriesMapping,
  context: CartesianContext
): void {
  const categories = map.categories;
  if (!categories || plot.series.length < 2) return;
  const resolve = context.look.resolveSchemeColor;
  const at = (index: number, value: number): Point =>
    map.horizontal
      ? { x: map.valueAt(info, value), y: map.categoryAt(index) }
      : { x: map.categoryAt(index), y: map.valueAt(info, value) };
  if (plot.hiLowLines) {
    const stroke = mergeStroke(
      readChartShapeProperties(child(plot.hiLowLines, 'spPr'), resolve).line,
      DEFAULT_HI_LOW
    );
    const lines: Point[][] = [];
    for (let index = 0; index < categories.count; index += 1) {
      const values = plot.series
        .map((series) => series.values[index])
        .filter((value): value is number => value !== null && value !== undefined);
      if (values.length < 2) continue;
      lines.push([at(index, Math.min(...values)), at(index, Math.max(...values))]);
    }
    if (stroke && lines.length > 0) context.scene.path(lines, false, null, stroke);
  }
  const bars = plot.upDownBars;
  if (bars) {
    const gap = (Number(childVal(bars, 'gapWidth') ?? 150) || 150) / 100;
    const slot = categorySlot(
      categories,
      map.horizontal ? map.plot.b - map.plot.t : map.plot.r - map.plot.l
    );
    const width = slot / (1 + gap);
    const look = (name: string, fill: ChartPaint) => {
      const own = readChartShapeProperties(child(child(bars, name), 'spPr'), resolve);
      return {
        fill: own.fill === undefined ? fill : own.fill,
        line: mergeStroke(own.line, DEFAULT_HI_LOW),
      };
    };
    const up = look('upBars', UP_BAR);
    const down = look('downBars', DOWN_BAR);
    const first = plot.series[0]!;
    const last = plot.series[plot.series.length - 1]!;
    for (let index = 0; index < categories.count; index += 1) {
      const open = first.values[index];
      const close = last.values[index];
      if (open === null || open === undefined || close === null || close === undefined) continue;
      const a = at(index, open);
      const b = at(index, close);
      const style = close >= open ? up : down;
      if (map.horizontal)
        context.scene.rect(
          Math.min(a.x, b.x),
          a.y - width / 2,
          Math.abs(b.x - a.x),
          width,
          style.fill,
          style.line
        );
      else
        context.scene.rect(
          a.x - width / 2,
          Math.min(a.y, b.y),
          width,
          Math.abs(b.y - a.y),
          style.fill,
          style.line
        );
    }
  }
}

const DEFAULT_ERROR_BAR: ChartStroke = {
  hex: '000000',
  alpha: 1,
  widthPt: 0.75,
  cap: 'butt',
  dash: null,
};
const ERROR_CAP = 3.75;

/** Trendlines, their equation labels, and error bars of one series. */
function paintExtras(
  plot: ChartPlot,
  series: ChartPlot['series'][number],
  info: ValueInfo,
  map: SeriesMapping,
  context: CartesianContext,
  labels: ChartLabel[],
  centres?: ReadonlyMap<number, number>
): void {
  if (series.trendlines.length === 0 && series.errorBars.length === 0) return;
  const resolve = context.look.resolveSchemeColor;
  const xy = plot.kind === 'scatter' || plot.kind === 'bubble';
  const category = (x: number): number => {
    const index = x - 1;
    if (centres && Number.isInteger(index) && centres.has(index)) return centres.get(index)!;
    const step = map.categoryAt(1) - map.categoryAt(0);
    return map.categoryAt(0) + index * (Number.isFinite(step) ? step : 0);
  };
  const at = (x: number, y: number): Point =>
    xy && map.xInfo?.scale
      ? { x: map.valueAt(map.xInfo, x), y: map.valueAt(info, y) }
      : map.horizontal
        ? { x: map.valueAt(info, y), y: category(x) }
        : { x: category(x), y: map.valueAt(info, y) };
  const color = seriesLook(plot, series, context.look);
  const tint =
    color.line ??
    ((color.fill ?? color.marker?.fill)
      ? { ...(color.fill ?? color.marker!.fill!), widthPt: 1.5, cap: 'round' as const, dash: null }
      : null);
  for (const trend of seriesTrendlines(plot, series)) {
    const own = readChartShapeProperties(child(trend.element, 'spPr'), resolve);
    const stroke = mergeStroke(own.line, tint ? { ...tint, widthPt: 1.5, dash: [1, 1] } : null);
    const points = trend.points.map((point) => at(point.x, point.y));
    if (stroke && points.length >= 2) context.scene.line(points, stroke, 'round');
    if (trend.label.length > 0 && points.length > 0) {
      const lbl = child(trend.element, 'trendlineLbl');
      const style = elementText(context.baseText, child(lbl, 'txPr'), resolve);
      const end = points[points.length - 1]!;
      const width = Math.max(...trend.label.map((line) => estimateTextWidth(line, style)));
      const height = lineHeight(style) * trend.label.length;
      const frame = width * 1.3 + style.sizePt * 2;
      labels.push({
        paragraphs: [[{ text: trend.label.join('\n'), style }]],
        align: 'ctr',
        // The label ends a little left of the curve's last point, centred on it.
        x: end.x - width / 2 - 8 - frame / 2,
        y: end.y - height / 2,
        width: frame,
        height,
        rotation: 0,
      });
    }
  }
  const segments: Point[][] = [];
  let stroke: ChartStroke | null = null;
  for (const bar of seriesErrorBars(plot, series)) {
    stroke ??= mergeStroke(
      readChartShapeProperties(child(bar.element, 'spPr'), resolve).line,
      DEFAULT_ERROR_BAR
    );
    const vertical = (bar.direction === 'y') !== map.horizontal;
    const from = bar.direction === 'y' ? at(bar.at.x, bar.from) : at(bar.from, bar.at.y);
    const to = bar.direction === 'y' ? at(bar.at.x, bar.to) : at(bar.to, bar.at.y);
    segments.push([from, to]);
    if (!bar.caps) continue;
    for (const end of [from, to]) {
      segments.push(
        vertical
          ? [
              { x: end.x - ERROR_CAP, y: end.y },
              { x: end.x + ERROR_CAP, y: end.y },
            ]
          : [
              { x: end.x, y: end.y - ERROR_CAP },
              { x: end.x, y: end.y + ERROR_CAP },
            ]
      );
    }
  }
  if (stroke && segments.length > 0) context.scene.path(segments, false, null, stroke);
}
