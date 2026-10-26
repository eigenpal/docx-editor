/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Radar plots: one spoke per category, clockwise from twelve o'clock, values along each spoke
// from the centre. Gridlines are polygons through the ticks; the value labels run up the first
// spoke and the category labels sit past the spoke ends.

import {
  categoryInfo,
  extendValueRange,
  plotAxis,
  valueFormat,
  type Box,
  type ValueInfo,
} from './chart-axes.ts';
import { dataLabelBlock } from './chart-data-label.ts';
import { dataLabelFor, elementText } from './chart-labels.ts';
import { child, type ChartModel, type ChartPlot } from './chart-model.ts';
import { formatChartNumber } from './chart-number-format.ts';
import { autoValueScale } from './chart-scale.ts';
import { markerPath, markerStrokes, type ChartScene, type Point } from './chart-scene.ts';
import { seriesLook, type LookContext } from './chart-series.ts';
import { mergeStroke, readChartShapeProperties, type ChartStroke } from './chart-style.ts';
import {
  estimateTextWidth,
  lineHeight,
  type ChartLabel,
  type ChartTextStyle,
} from './chart-text.ts';

const MAX_SPOKES = 1_024;
const DEFAULT_GRID: ChartStroke = {
  hex: '000000',
  alpha: 1,
  widthPt: 0.5,
  cap: 'butt',
  dash: null,
};

export interface RadarContext {
  readonly model: ChartModel;
  readonly look: LookContext;
  readonly scene: ChartScene;
  readonly labels: ChartLabel[];
  readonly baseText: ChartTextStyle;
}

/** Paint the radar plots inside `box`. */
export function paintRadar(plots: readonly ChartPlot[], box: Box, context: RadarContext): void {
  const { model, scene } = context;
  const resolve = context.look.resolveSchemeColor;
  const categories = categoryInfo(model, plots, MAX_SPOKES);
  const count = categories.count;
  if (count < 1) return;
  const valueAxis = plotAxis(model, plots[0]!, 'value');
  const categoryAxis = categories.axis;
  const info: ValueInfo = {
    axis: valueAxis,
    id: valueAxis?.id ?? '',
    dataMin: Infinity,
    dataMax: -Infinity,
    percent: false,
    scale: null,
    formatCode: null,
  };
  for (const plot of plots) extendValueRange(info, plot);
  info.formatCode = valueFormat(
    info,
    plots[0]!.series.find((s) => s.formatCode)?.formatCode ?? null
  );
  const valueStyle = elementText(context.baseText, valueAxis?.txPr ?? null, resolve);
  const categoryStyle = elementText(context.baseText, categoryAxis?.txPr ?? null, resolve);
  const categoryLine = lineHeight(categoryStyle);
  const widest = Math.max(
    0,
    ...categories.labels.map((label) => estimateTextWidth(label, categoryStyle))
  );
  const labelled =
    categoryAxis !== null && !categoryAxis.deleted && categoryAxis.tickLabelPosition !== 'none';
  const radius = Math.max(
    1,
    Math.min(
      (box.b - box.t) / 2 - (labelled ? categoryLine / 2 + 3 : 0),
      (box.r - box.l) / 2 - (labelled ? widest + 3.5 : 0)
    )
  );
  const cx = (box.l + box.r) / 2;
  const cy = (box.t + box.b) / 2;
  const empty = info.dataMin > info.dataMax;
  const scale = autoValueScale({
    dataMin: empty ? 0 : info.dataMin,
    dataMax: empty ? 1 : info.dataMax,
    lengthPt: radius,
    minIntervalPt: 1.6 * valueStyle.sizePt,
    fixedMin: valueAxis?.min ?? null,
    fixedMax: valueAxis?.max ?? null,
    fixedMajor: valueAxis?.majorUnit ?? null,
    noHeadroom: true,
  });
  const span = scale.max - scale.min || 1;
  const at = (index: number, value: number): Point => {
    const angle = (index / count) * Math.PI * 2;
    const distance = ((value - scale.min) / span) * radius;
    return { x: cx + distance * Math.sin(angle), y: cy - distance * Math.cos(angle) };
  };

  // Gridlines: a polygon through each tick, then the spokes.
  const grid = (element: ReturnType<typeof child>) =>
    element
      ? mergeStroke(readChartShapeProperties(child(element, 'spPr'), resolve).line, DEFAULT_GRID)
      : null;
  const valueGrid = grid(valueAxis?.majorGridlines ?? null);
  if (valueGrid) {
    const rings: Point[][] = [];
    for (const tick of scale.ticks) {
      if (tick <= scale.min) continue;
      const ring: Point[] = [];
      for (let index = 0; index < count; index += 1) ring.push(at(index, tick));
      rings.push(ring);
    }
    scene.path(rings, true, null, valueGrid);
  }
  const spokes = grid(categoryAxis?.majorGridlines ?? null);
  if (spokes) {
    const lines: Point[][] = [];
    for (let index = 0; index < count; index += 1)
      lines.push([{ x: cx, y: cy }, at(index, scale.max)]);
    scene.path(lines, false, null, spokes);
  }

  // Series.
  const pending: ChartLabel[] = [];
  for (const plot of plots) {
    const filled = plot.radarStyle === 'filled';
    for (const series of plot.series) {
      const look = seriesLook(plot, series, context.look);
      const points: (Point | null)[] = [];
      for (let index = 0; index < count; index += 1) {
        const value = series.values[index];
        points.push(value === null || value === undefined ? null : at(index, value));
      }
      const drawn = points.filter((point): point is Point => point !== null);
      if (filled) {
        if (drawn.length >= 3) scene.path([drawn], true, look.fill, look.line);
      } else if (look.line && drawn.length >= 2) {
        scene.path([drawn], drawn.length === count && drawn.length >= 3, null, look.line, 'round');
      }
      const marker = filled ? null : look.marker;
      if (marker) {
        const size = marker.size * 0.96;
        const shapes: Point[][] = [];
        const strokes: Point[][] = [];
        for (const point of drawn) {
          for (const shape of markerPath(marker.symbol, point.x, point.y, size)) shapes.push(shape);
          for (const stroke of markerStrokes(marker.symbol, point.x, point.y, size))
            strokes.push(stroke);
        }
        if (shapes.length) scene.path(shapes, true, marker.fill, marker.line);
        if (strokes.length) scene.path(strokes, false, null, marker.line);
      }
      for (const [index, point] of points.entries()) {
        const spec = point ? dataLabelFor(plot, series, index) : null;
        if (!spec || !point) continue;
        const style = elementText(context.baseText, spec.txPr, resolve);
        const values = {
          value: series.values[index]!,
          percent: null,
          category: categories.labels[index] ?? null,
          seriesName: series.name,
          seriesFormat: series.formatCode,
          date1904: model.date1904,
          cell: series.labelRange?.[index] ?? null,
        };
        const block = dataLabelBlock(spec, values, style, null, resolve);
        const height = block.height;
        const frame = block.frame;
        pending.push({
          paragraphs: block.paragraphs,
          align: 'ctr',
          x: point.x - frame / 2,
          y: point.y - height - 2,
          width: frame,
          height,
          rotation: 0,
        });
      }
    }
  }

  // Value labels up the first spoke, right-aligned against it.
  if (valueAxis && !valueAxis.deleted && valueAxis.tickLabelPosition !== 'none') {
    const height = lineHeight(valueStyle);
    for (const tick of scale.ticks) {
      const text = formatChartNumber(tick, info.formatCode, model.date1904);
      const frame = estimateTextWidth(text, valueStyle) * 1.3 + valueStyle.sizePt * 2;
      const point = at(0, tick);
      context.labels.push({
        paragraphs: [[{ text, style: valueStyle }]],
        align: 'r',
        x: point.x - 0.91 * valueStyle.sizePt - frame,
        y: point.y - height / 2,
        width: frame,
        height,
        rotation: 0,
      });
    }
  }
  // Category labels past the spoke ends, pushed out along each spoke.
  if (labelled) {
    for (let index = 0; index < count; index += 1) {
      const text = categories.labels[index]!;
      const angle = (index / count) * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const end = at(index, scale.max);
      const width = estimateTextWidth(text, categoryStyle);
      const centerX = end.x + 3.5 * sin + (width / 2) * sin;
      const centerY = end.y - 3.5 * cos - (categoryLine / 2) * cos;
      const frame = width * 1.3 + categoryStyle.sizePt * 2;
      context.labels.push({
        paragraphs: [[{ text, style: categoryStyle }]],
        align: 'ctr',
        x: centerX - frame / 2,
        y: centerY - categoryLine / 2,
        width: frame,
        height: categoryLine,
        rotation: 0,
      });
    }
  }
  for (const label of pending) context.labels.push(label);
}
