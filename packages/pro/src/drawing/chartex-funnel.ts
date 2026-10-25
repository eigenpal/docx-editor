/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The funnel chart (`layoutId="funnel"`): one horizontal bar per category, top to bottom in
// point order, centred on the plot, its width the share of the largest value.
//
// The automatic layout, in chart points: each category takes an equal slot of the plot
// height, and its bar is the slot over one plus the gap width (`cx:catScaling gapWidth`, 0.34
// when unset or `auto`), centred in the slot. The largest value spans the plot width; a zero,
// negative or missing value draws no bar. Category labels sit right-aligned 6.6 pt left of
// the plot, centred on their slot. The widest label sets the plot's left edge; a label wider
// than a third of the room is cut at a word boundary with an ellipsis. When slots are closer
// than 1.2 text sizes, only every n-th label shows, from the first. The category axis line
// runs down the plot's left edge. Data labels sit at the centre of their bar whatever their
// position, in the light text colour unless the labels name their own text, and only when
// the text fits inside the bar, across and up. All bars share the series colour; a `cx:dataPt` names
// its own fill. The legend lists the series. A hidden category axis draws no labels and no
// line. A chart without a category axis element shows both.

import { formatChartNumber } from './chart-number-format.ts';
import { themeColor, type ChartPaint } from './chart-style.ts';
import {
  estimateTextWidth,
  lineHeight,
  type ChartLabel,
  type ChartTextStyle,
} from './chart-text.ts';
import type { Box } from './chart-axes.ts';
import type { ChartexContext, ChartexLayout, ChartexLegendEntry } from './chartex-layout.ts';
import {
  cxChild,
  pointLabelVisibility,
  seriesCategories,
  seriesValues,
  type ChartexAxis,
  type ChartexSeries,
} from './chartex-model.ts';

/** The gap between bars, as a fraction of a bar's height, when the axis names none. */
export const FUNNEL_DEFAULT_GAP_WIDTH = 0.34;
const MAX_GAP_WIDTH = 5;
/** Between the right edge of a category label and the plot. */
const CATEGORY_LABEL_GAP = 6.6;
/**
 * The plot's left edge from the widest category label: a fixed room plus the label measured
 * a little wide, as the labels' own layout measures it.
 */
const CATEGORY_ROOM = 6.18;
const CATEGORY_WIDTH_SCALE = 1.0103;
/** Category labels keep this many text sizes apart. */
const CATEGORY_LABEL_PITCH = 1.2;
/** A category label is cut to this share of the room beside the plot. */
const CATEGORY_LABEL_SHARE = 1 / 3;
/**
 * The room the frame keeps above every plot for a value label reaching above it. A funnel
 * draws no label above its plot, so it gives this room back.
 */
const FRAME_PLOT_TOP_ROOM = 5.41;
/** The plot inside the frame's box: top and bottom insets, with and without an axis line. */
const INSET_TOP = 0.98;
const INSET_BOTTOM = 1.22;
const INSET_TOP_BARE = 0.38;
const INSET_BOTTOM_BARE = 0.62;
const INSET_LEFT_BARE = 0.38;
const INSET_RIGHT = 0.24;
/** Without an axis line the plot reaches a little past the frame's box on the right. */
const INSET_RIGHT_BARE = -0.48;
const MAX_WORDS = 64;

/** One bar of a funnel, in plot fractions: `share` of the plot width, slot `index`. */
export interface FunnelBar {
  readonly index: number;
  readonly value: number;
  /** The bar's width over the plot's width, in (0, 1]. */
  readonly share: number;
}

/**
 * The bars of a funnel: one per positive value, its width the share of the largest value.
 * A zero, negative, missing or non-finite value draws no bar.
 */
export function funnelBars(values: readonly (number | null)[]): FunnelBar[] {
  let largest = 0;
  for (const value of values) {
    if (value !== null && Number.isFinite(value) && value > largest) largest = value;
  }
  if (!(largest > 0)) return [];
  const bars: FunnelBar[] = [];
  for (const [index, value] of values.entries()) {
    if (value === null || !Number.isFinite(value) || !(value > 0)) continue;
    bars.push({ index, value, share: value / largest });
  }
  return bars;
}

/** The gap width a funnel's category axis asks for, bounded. */
export function funnelGapWidth(axis: ChartexAxis | null): number {
  const raw = axis?.gapWidth ?? FUNNEL_DEFAULT_GAP_WIDTH;
  return Number.isFinite(raw)
    ? Math.min(MAX_GAP_WIDTH, Math.max(0, raw))
    : FUNNEL_DEFAULT_GAP_WIDTH;
}

/** Every `step`-th category label shows, so labels keep one line of text apart. */
export function funnelLabelStep(slot: number, line: number, count: number): number {
  if (!(slot > 0)) return Math.max(1, count);
  return Math.min(Math.max(1, count), Math.max(1, Math.ceil(line / slot - 1e-9)));
}

/** `text` cut at a word boundary to `width`, with an ellipsis when cut. */
function cutToWidth(text: string, style: ChartTextStyle, width: number): string {
  if (estimateTextWidth(text, style) <= width) return text;
  const room = width - estimateTextWidth('…', style);
  let kept = '';
  for (const word of text.split(/\s+/).slice(0, MAX_WORDS)) {
    const next = kept ? `${kept} ${word}` : word;
    if (estimateTextWidth(next, style) > room) break;
    kept = next;
  }
  if (!kept) {
    let units = 0;
    for (const char of text) {
      if (++units > 1_024 || estimateTextWidth(kept + char, style) > room) break;
      kept += char;
    }
  }
  return `${kept}…`;
}

function seriesPaint(item: ChartexSeries, context: ChartexContext) {
  const color = context.look.dataColor(item.formatIndex);
  return {
    color,
    fill: context.look.fill('dataPoint', item.spPr, color),
    line: context.look.line('dataPoint', item.spPr, color),
  };
}

function legendEntries(series: readonly ChartexSeries[], context: ChartexContext) {
  const entries: ChartexLegendEntry[] = [];
  for (const item of series) {
    const { fill, line } = seriesPaint(item, context);
    entries.push({ text: item.name ?? `Series${item.index + 1}`, fill, line });
  }
  return entries;
}

function label(
  text: string,
  style: ChartTextStyle,
  align: 'l' | 'ctr' | 'r',
  x: number,
  y: number
) {
  const height = lineHeight(style);
  const frame = estimateTextWidth(text, style) * 1.3 + style.sizePt * 2;
  const left = align === 'ctr' ? x - frame / 2 : align === 'r' ? x - frame : x;
  const out: ChartLabel = {
    paragraphs: [[{ text, style }]],
    align,
    x: left,
    y: y - height / 2,
    width: frame,
    height,
    rotation: 0,
  };
  return out;
}

function paint(series: readonly ChartexSeries[], box: Box, context: ChartexContext): boolean {
  if (series.length !== 1) return false;
  const item = series[0]!;
  const read = seriesValues(item);
  if (!read || read.values.length === 0) return false;
  const count = read.values.length;
  const names = seriesCategories(item);
  const categories = read.values.map((_, index) => names?.[index] ?? String(index + 1));
  const bars = funnelBars(read.values);

  const { look, scene, labels } = context;
  const declared = context.model.axes.find((axis) => axis.kind === 'category') ?? null;
  // Without an axis element the category axis shows, labels and line.
  const axisShown = declared === null || !declared.hidden;
  const labelsShown = declared === null ? true : !declared.hidden && declared.tickLabels;
  const axisStyle = look.text('categoryAxis', declared?.txPr ?? null);

  const top = box.t - FRAME_PLOT_TOP_ROOM + (axisShown ? INSET_TOP : INSET_TOP_BARE);
  const bottom = box.b - (axisShown ? INSET_BOTTOM : INSET_BOTTOM_BARE);
  let left = box.l + (axisShown ? 0 : INSET_LEFT_BARE);
  const right = box.r - (axisShown ? INSET_RIGHT : INSET_RIGHT_BARE);
  const room = Math.max(0, (right - box.l) * CATEGORY_LABEL_SHARE);
  if (labelsShown) {
    // A cut label takes the whole room.
    let widest = 0;
    for (const text of categories) widest = Math.max(widest, estimateTextWidth(text, axisStyle));
    left = box.l + Math.min(room, widest * CATEGORY_WIDTH_SCALE) + CATEGORY_ROOM;
  }
  if (!(right - left > 1) || !(bottom - top > 1)) return true;
  const plot = { l: left, t: top, r: right, b: bottom };
  const slot = (plot.b - plot.t) / count;
  const barHeight = slot / (1 + funnelGapWidth(declared));
  const center = (plot.l + plot.r) / 2;
  const width = plot.r - plot.l;
  const slotCenter = (index: number) => plot.t + slot * (index + 0.5);

  const { color, fill, line: outline } = seriesPaint(item, context);
  for (const bar of bars) {
    // A `cx:dataPt` paints with its own `cx:spPr` over the series look.
    const own = cxChild(item.points.get(bar.index), 'spPr');
    const barWidth = width * bar.share;
    scene.rect(
      center - barWidth / 2,
      slotCenter(bar.index) - barHeight / 2,
      barWidth,
      barHeight,
      own ? look.fill('dataPoint', own, color) : fill,
      own ? look.line('dataPoint', own, color) : outline
    );
  }

  const dataLabels = item.dataLabels;
  if (dataLabels) {
    const base = look.text('dataLabel', dataLabels.txPr);
    // Labels sit on their bar: the light text colour, unless they name their own text.
    const light: ChartPaint | null = dataLabels.txPr
      ? null
      : themeColor('lt1', '', look.resolveSchemeColor);
    const style = light ? { ...base, colorHex: light.hex } : base;
    const height = lineHeight(style);
    const format = dataLabels.formatCode ?? read.formatCode;
    for (const bar of bars) {
      if (height > barHeight) break;
      const shown = pointLabelVisibility(dataLabels, bar.index);
      if (!shown) continue;
      const parts: string[] = [];
      if (shown.seriesName && item.name) parts.push(item.name);
      if (shown.categoryName) parts.push(categories[bar.index]!);
      if (shown.value) parts.push(formatChartNumber(bar.value, format));
      if (parts.length === 0) continue;
      const text = parts.join(dataLabels.separator ?? ', ');
      // A label shows only when it fits inside its bar.
      if (estimateTextWidth(text, style) > width * bar.share) continue;
      labels.push(label(text, style, 'ctr', center, slotCenter(bar.index)));
    }
  }

  if (axisShown) {
    const axisLine = look.line('categoryAxis', declared?.spPr ?? null);
    if (axisLine) {
      scene.line(
        [
          { x: plot.l, y: plot.t },
          { x: plot.l, y: plot.b },
        ],
        axisLine
      );
    }
  }
  if (labelsShown) {
    const step = funnelLabelStep(slot, CATEGORY_LABEL_PITCH * axisStyle.sizePt, count);
    // Only the labels that show are cut: at most one per line of the plot.
    for (let index = 0; index < count; index += step) {
      const text = cutToWidth(categories[index]!, axisStyle, room);
      if (!text) continue;
      labels.push(label(text, axisStyle, 'r', plot.l - CATEGORY_LABEL_GAP, slotCenter(index)));
    }
  }
  return true;
}

export const FUNNEL_LAYOUT: ChartexLayout = Object.freeze({
  layoutIds: Object.freeze(['funnel']),
  legendEntries,
  paint,
});
