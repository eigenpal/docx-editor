/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The histogram and Pareto charts (`layoutId="clusteredColumn"`, with a `paretoLine`).
//
// A `clusteredColumn` series draws one column per bin of its values (`cx:binning`), or per
// category with its values summed (`cx:aggregation`); `chartex-histogram-bins.ts` computes
// both. The columns take the series' data colour. A missing gap width leaves a third of a
// column between columns; histograms usually save a gap of 0. A data label at the default
// `outEnd` sits on top of its column.
//
// A `paretoLine` series owned by the columns makes a Pareto chart: the columns sort largest
// first, and a line in the `dataPointLine` look joins the running share of the total at each
// column centre, against a value axis on the right that runs 0% to 100% by default. Its tick
// labels sit left-aligned 6.64 pt right of the plot. With two value axes each keeps an extra
// room at the chart edge: 6.43 pt left of the left labels, 5.47 pt right of the right labels.
// The legend lists the columns only.

import type { Box } from './chart-axes.ts';
import { formatChartNumber } from './chart-number-format.ts';
import { autoValueScale, type ValueScale } from './chart-scale.ts';
import { estimateTextWidth, lineHeight, type ChartTextStyle } from './chart-text.ts';
import { layoutChartexAxes } from './chartex-axes.ts';
import {
  aggregateColumns,
  aggregates,
  cumulativeShares,
  histogramColumns,
  paretoOrder,
  readBinning,
  type HistogramColumn,
} from './chartex-histogram-bins.ts';
import type { ChartexContext, ChartexLayout, ChartexLegendEntry } from './chartex-layout.ts';
import {
  pointLabelVisibility,
  pointSpPr,
  seriesCategories,
  seriesDimension,
  seriesValues,
  type ChartexAxis,
  type ChartexSeries,
} from './chartex-model.ts';

/** The gap between columns, as a fraction of a column's width, when the axis names none. */
const DEFAULT_GAP_WIDTH = 1 / 3;
const MAX_GAP_WIDTH = 5;
/** From the plot's right edge to the right value labels, in points. */
const RIGHT_LABEL_GAP = 6.64;
/** With two value axes: extra room left of the left labels and right of the right ones. */
const PARETO_LEFT_ROOM = 6.43;
const PARETO_RIGHT_ROOM = 5.47;
/** With two value axes the plot also starts a little lower, as measured on four charts. */
const PARETO_TOP_ROOM = 0.96;
const PERCENT = '0%';

interface Parts {
  readonly columns: ChartexSeries;
  readonly line: ChartexSeries | null;
}

/** The column series and its Pareto line, or null when the series are not one chart. */
function partsOf(series: readonly ChartexSeries[]): Parts | null {
  const columns = series.filter((item) => item.layoutId === 'clusteredColumn');
  const lines = series.filter((item) => item.layoutId === 'paretoLine');
  if (columns.length !== 1 || lines.length > 1) return null;
  const owner = columns[0]!;
  const line = lines[0] ?? null;
  if (line && line.ownerIndex !== null && line.ownerIndex !== owner.index) return null;
  return { columns: owner, line };
}

/**
 * Whether the columns sum the series' categories rather than bin its values: the series asks
 * to aggregate, or it has categories and no binning.
 */
function columnsByCategory(series: ChartexSeries): boolean {
  return (
    aggregates(series) ||
    (readBinning(series.layoutPr) === null && seriesDimension(series, 'cat') !== null)
  );
}

/** The columns of the series: bins of its values, or its categories summed. */
export function seriesColumns(series: ChartexSeries, pareto: boolean): HistogramColumn[] | null {
  const read = seriesValues(series);
  if (!read) return null;
  const binning = readBinning(series.layoutPr);
  const byCategory = columnsByCategory(series);
  const columns = byCategory
    ? aggregateColumns(seriesCategories(series) ?? [], read.values)
    : histogramColumns(read.values, binning, read.formatCode);
  if (!columns) return null;
  return pareto ? paretoOrder(columns) : columns;
}

function columnColor(series: ChartexSeries, context: ChartexContext) {
  return context.look.dataColor(series.formatIndex);
}

function legendEntries(series: readonly ChartexSeries[], context: ChartexContext) {
  const parts = partsOf(series);
  if (!parts) return [];
  const color = columnColor(parts.columns, context);
  const entry: ChartexLegendEntry = {
    text: parts.columns.name ?? 'Series1',
    fill: context.look.fill('dataPoint', parts.columns.spPr, color),
    line: context.look.line('dataPoint', parts.columns.spPr, color),
  };
  return [entry];
}

/** The right value axis of a Pareto chart: the value axis the line names, else the second. */
function secondaryAxis(line: ChartexSeries, axes: readonly ChartexAxis[]): ChartexAxis | null {
  const values = axes.filter((axis) => axis.kind === 'value');
  return (
    values.find((axis) => line.axisIds.includes(axis.id)) ?? (values.length > 1 ? values[1]! : null)
  );
}

function percentScale(axis: ChartexAxis | null, length: number, style: ChartTextStyle) {
  const minInterval = lineHeight(style);
  const fitting = Math.max(1, Math.floor(length / minInterval));
  return autoValueScale({
    dataMin: 0,
    dataMax: 1,
    lengthPt: fitting * minInterval,
    minIntervalPt: minInterval,
    fixedMin: axis?.min ?? null,
    fixedMax: axis?.max ?? null,
    fixedMajor: axis?.majorUnit ?? null,
  });
}

function percentText(value: number, scale: ValueScale, format: string): string {
  return formatChartNumber(Math.abs(value) < scale.major * 1e-9 ? 0 : value, format);
}

function paint(series: readonly ChartexSeries[], box: Box, context: ChartexContext): boolean {
  const parts = partsOf(series);
  if (!parts) return false;
  const { columns: owner, line } = parts;
  const columns = seriesColumns(owner, line !== null);
  if (!columns || columns.length === 0) return false;
  const read = seriesValues(owner)!;
  // Binned columns hold counts, which never take the values' number format.
  const dataFormat = columnsByCategory(owner) ? read.formatCode : null;
  const { look, scene, labels, model } = context;

  const categoryAxis = model.axes.find((axis) => axis.kind === 'category') ?? null;
  const right = line ? secondaryAxis(line, model.axes) : null;
  const valueAxis = model.axes.find((axis) => axis.kind === 'value' && axis !== right) ?? null;
  const rightStyle = look.text('valueAxis', right?.txPr ?? null);
  const rightFormat = right?.formatCode ?? PERCENT;
  const showRight = right !== null && !right.hidden && right.tickLabels;

  const plotBox: Box = { ...box };
  if (line) {
    plotBox.l += PARETO_LEFT_ROOM;
    plotBox.t += PARETO_TOP_ROOM;
    if (showRight) {
      // The right labels' room: the widest at the height the plot will roughly have.
      const scale = percentScale(right, box.b - box.t, rightStyle);
      let widest = 0;
      for (const tick of scale.ticks) {
        widest = Math.max(
          widest,
          estimateTextWidth(percentText(tick, scale, rightFormat), rightStyle)
        );
      }
      plotBox.r -= widest + RIGHT_LABEL_GAP + PARETO_RIGHT_ROOM;
    }
  }

  let high = 0;
  for (const column of columns) high = Math.max(high, column.value);
  const axes = layoutChartexAxes(
    {
      categories: columns.map((column) => column.label),
      dataMin: 0,
      dataMax: high,
      formatCode: valueAxis?.formatCode ?? dataFormat,
      categoryAxis,
      valueAxis,
      frameBox: box,
    },
    plotBox,
    context
  );
  if (!axes) return true;
  axes.paintGrid();

  const rawGap = categoryAxis?.gapWidth ?? DEFAULT_GAP_WIDTH;
  const gap = Math.min(MAX_GAP_WIDTH, Math.max(0, rawGap));
  const barWidth = axes.slot / (1 + gap);
  const clamp = (value: number) => Math.min(axes.scale.max, Math.max(axes.scale.min, value));
  const color = columnColor(owner, context);
  const base = axes.valueAt(clamp(0));
  for (const [index, column] of columns.entries()) {
    // A point override applies to the column at its position.
    const { fill, line } = look.point('dataPoint', owner.spPr, pointSpPr(owner, index), color);
    const top = axes.valueAt(clamp(column.value));
    // An empty bin draws nothing, not even its outline.
    if (Math.abs(base - top) < 1e-6) continue;
    scene.rect(
      axes.categoryAt(index) - barWidth / 2,
      Math.min(top, base),
      barWidth,
      Math.abs(base - top),
      fill,
      line
    );
  }

  const dataLabels = owner.dataLabels;
  if (dataLabels) {
    const style = look.text('dataLabel', dataLabels.txPr);
    const height = lineHeight(style);
    const format = dataLabels.formatCode ?? dataFormat;
    for (const [index, column] of columns.entries()) {
      const shown = pointLabelVisibility(dataLabels, index);
      if (!shown) continue;
      const pieces: string[] = [];
      if (shown.seriesName && owner.name) pieces.push(owner.name);
      if (shown.categoryName) pieces.push(column.label);
      if (shown.value) pieces.push(formatChartNumber(column.value, format));
      if (pieces.length === 0) continue;
      const text = pieces.join(dataLabels.separator ?? ', ');
      const top = axes.valueAt(clamp(column.value));
      let center: number;
      switch (dataLabels.position) {
        case 'ctr':
          center = (top + base) / 2;
          break;
        case 'inEnd':
          center = top + height / 2;
          break;
        case 'inBase':
          center = base - height / 2;
          break;
        default:
          center = top - height / 2;
      }
      center = Math.min(axes.plot.b - height / 2, Math.max(axes.plot.t + height / 2, center));
      const frame = estimateTextWidth(text, style) * 1.3 + style.sizePt * 2;
      labels.push({
        paragraphs: [[{ text, style }]],
        align: 'ctr',
        x: axes.categoryAt(index) - frame / 2,
        y: center - height / 2,
        width: frame,
        height,
        rotation: 0,
      });
    }
  }

  if (line) paintParetoLine(line, right, columns, axes, context, showRight, rightStyle);
  axes.paintAxes();
  return true;
}

function paintParetoLine(
  line: ChartexSeries,
  axis: ChartexAxis | null,
  columns: readonly HistogramColumn[],
  axes: NonNullable<ReturnType<typeof layoutChartexAxes>>,
  context: ChartexContext,
  showLabels: boolean,
  style: ChartTextStyle
) {
  const { look, scene, labels } = context;
  const { plot } = axes;
  const scale = percentScale(axis, plot.b - plot.t, style);
  const span = scale.max - scale.min || 1;
  const at = (value: number) => {
    const clamped = Math.min(scale.max, Math.max(scale.min, value));
    return plot.b - ((clamped - scale.min) / span) * (plot.b - plot.t);
  };
  const shares = cumulativeShares(columns);
  const stroke = look.line('dataPointLine', line.spPr, look.dataColor(line.formatIndex));
  if (stroke && shares.length > 0) {
    scene.line(
      shares.map((share, index) => ({ x: axes.categoryAt(index), y: at(share) })),
      stroke,
      'round'
    );
  }
  if (axis && !axis.hidden) {
    const axisLine = look.line('valueAxis', axis.spPr) ?? look.line('categoryAxis', null);
    if (axisLine) {
      scene.line(
        [
          { x: plot.r, y: plot.b },
          { x: plot.r, y: plot.t },
        ],
        axisLine
      );
    }
  }
  if (!showLabels) return;
  const format = axis?.formatCode ?? PERCENT;
  const height = lineHeight(style);
  for (const tick of scale.ticks) {
    const text = percentText(tick, scale, format);
    labels.push({
      paragraphs: [[{ text, style }]],
      align: 'l',
      x: plot.r + RIGHT_LABEL_GAP,
      y: at(tick) - height / 2,
      width: estimateTextWidth(text, style) * 1.3 + style.sizePt * 2,
      height,
      rotation: 0,
    });
  }
}

export const HISTOGRAM_LAYOUT: ChartexLayout = Object.freeze({
  layoutIds: Object.freeze(['clusteredColumn', 'paretoLine']),
  roomAbovePlot: true,
  legendEntries,
  paint,
});
