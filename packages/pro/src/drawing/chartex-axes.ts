/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A chartex category axis along the bottom and a value axis on the left, for the chart types
// that plot one column per category (waterfall, histogram, Pareto, box and whisker).
//
// The automatic layout: value tick labels right-aligned 0.76 sizes left of the plot; category
// labels centred under their slot, their first line 6.6 pt below the plot. Labels too
// wide for their slot take two staggered rows (even slots on the lower row) when every label
// fits two slots, and otherwise turn 45 degrees, each cut to one slot's length at a word
// boundary with an ellipsis. The value scale is the shared automatic scale with ticks at least
// 1.6 sizes apart. Gridlines take the `gridlineMajor`/`gridlineMinor` look; both axis lines
// take the category axis line.

import type { Box } from './chart-axes.ts';
import { formatChartNumber } from './chart-number-format.ts';
import { autoValueScale, type ValueScale } from './chart-scale.ts';
import type { Point } from './chart-scene.ts';
import {
  estimateTextWidth,
  lineHeight,
  type ChartLabel,
  type ChartTextStyle,
} from './chart-text.ts';
import type { ChartexContext } from './chartex-layout.ts';
import type { ChartexAxis } from './chartex-model.ts';

/** The gap between value labels and the plot, in sizes. */
const VALUE_LABEL_GAP = 0.762;
/** From the plot's bottom edge to the top of the first row of category labels, in points. */
const CATEGORY_GAP = 6.6;
/** A category label wider than this share of its slot does not fit it. */
const CATEGORY_FILL = 0.9;
/** Turned category labels set at this share of the axis text size. */
const TURNED_SCALE = 0.8667;
/** Between the plot and the top of turned category labels, in sizes. */
const TURNED_GAP = 0.85;
const MAX_TICKS = 1_000;

export interface ChartexAxesInput {
  /** One label per category slot. */
  readonly categories: readonly string[];
  /** The data extent the value axis must show. */
  readonly dataMin: number;
  readonly dataMax: number;
  /** The tick label format: the axis's own, else the data's. */
  readonly formatCode: string | null;
  readonly categoryAxis: ChartexAxis | null;
  readonly valueAxis: ChartexAxis | null;
}

export interface ChartexAxes {
  readonly plot: Box;
  readonly scale: ValueScale;
  /** Width of one category slot. */
  readonly slot: number;
  /** Centre of category slot `index`. */
  categoryAt(index: number): number;
  /** Vertical position of `value`. */
  valueAt(value: number): number;
  /** Gridlines; paint before the data. */
  paintGrid(): void;
  /** Axis lines and tick labels; paint after the data. */
  paintAxes(): void;
}

interface CategoryBand {
  readonly rows: number;
  readonly rotated: boolean;
  /** Labels as shown: cut when turned. */
  readonly texts: readonly string[];
  /** Their text style: smaller when turned. */
  readonly style: ChartTextStyle;
  readonly height: number;
}

/** `text` cut at a word boundary to `width`, with an ellipsis when cut. */
function cutToWidth(text: string, style: ChartTextStyle, width: number): string {
  if (estimateTextWidth(text, style) <= width) return text;
  const words = text.split(/\s+/).slice(0, 64);
  let kept = '';
  for (const word of words) {
    const next = kept ? `${kept} ${word}` : word;
    if (estimateTextWidth(next, style) > width) break;
    kept = next;
  }
  if (!kept) {
    // One word longer than the room: cut it by characters.
    for (const char of text) {
      if (estimateTextWidth(kept + char, style) > width) break;
      kept += char;
    }
  }
  return `${kept}…`;
}

function categoryBand(texts: readonly string[], style: ChartTextStyle, slot: number): CategoryBand {
  const size = style.sizePt;
  let widest = 0;
  for (const text of texts) widest = Math.max(widest, estimateTextWidth(text, style));
  const line = CATEGORY_GAP + lineHeight(style);
  if (texts.length <= 1 || widest <= CATEGORY_FILL * slot) {
    return { rows: 1, rotated: false, texts, style, height: line };
  }
  if (widest <= 2 * CATEGORY_FILL * slot) {
    return { rows: 2, rotated: false, texts, style, height: line + lineHeight(style) };
  }
  const turned = { ...style, sizePt: style.sizePt * TURNED_SCALE };
  const cut = texts.map((text) => cutToWidth(text, turned, slot));
  let longest = 0;
  for (const text of cut) longest = Math.max(longest, estimateTextWidth(text, turned));
  const diagonal = Math.SQRT1_2 * (longest + lineHeight(turned));
  return {
    rows: 1,
    rotated: true,
    texts: cut,
    style: turned,
    height: diagonal + TURNED_GAP * size,
  };
}

/** Lay out the axes of a column chart inside `box`; null when no room is left. */
export function layoutChartexAxes(
  input: ChartexAxesInput,
  box: Box,
  context: ChartexContext
): ChartexAxes | null {
  const { look } = context;
  const categoryAxis = input.categoryAxis;
  const valueAxis = input.valueAxis;
  const categoryStyle = look.text('categoryAxis', categoryAxis?.txPr ?? null);
  const valueStyle = look.text('valueAxis', valueAxis?.txPr ?? null);
  const showValueLabels = valueAxis !== null && !valueAxis.hidden && valueAxis.tickLabels;
  const showCategoryLabels =
    categoryAxis !== null && !categoryAxis.hidden && categoryAxis.tickLabels;
  const count = Math.max(1, input.categories.length);
  const format = (value: number, scale: ValueScale) =>
    formatChartNumber(Math.abs(value) < scale.major * 1e-9 ? 0 : value, input.formatCode);

  const scaleFor = (length: number): ValueScale => {
    // Ticks keep at least one line of label text apart.
    const minInterval = lineHeight(valueStyle);
    const fitting = Math.max(1, Math.floor(length / minInterval));
    return autoValueScale({
      dataMin: input.dataMin,
      dataMax: input.dataMax,
      lengthPt: fitting * minInterval,
      minIntervalPt: minInterval,
      fixedMin: valueAxis?.min ?? null,
      fixedMax: valueAxis?.max ?? null,
      fixedMajor: valueAxis?.majorUnit ?? null,
    });
  };
  const layout = (scale: ValueScale | null) => {
    let left = box.l;
    if (showValueLabels && scale) {
      let widest = 0;
      for (const tick of scale.ticks) {
        widest = Math.max(widest, estimateTextWidth(format(tick, scale), valueStyle));
      }
      left += widest + VALUE_LABEL_GAP * valueStyle.sizePt;
    }
    const slot = (box.r - left) / count;
    const band = showCategoryLabels
      ? categoryBand(input.categories, categoryStyle, slot)
      : { rows: 1, rotated: false, texts: input.categories, style: categoryStyle, height: 0 };
    return { plot: { l: left, t: box.t, r: box.r, b: box.b - band.height }, band, slot };
  };
  let placed = layout(null);
  let scale = scaleFor(placed.plot.b - placed.plot.t);
  placed = layout(scale);
  scale = scaleFor(placed.plot.b - placed.plot.t);
  placed = layout(scale);
  const { plot, band, slot } = placed;
  if (!(plot.r - plot.l > 1) || !(plot.b - plot.t > 1)) return null;

  const span = scale.max - scale.min || 1;
  const valueAt = (value: number) => plot.b - ((value - scale.min) / span) * (plot.b - plot.t);
  const categoryAt = (index: number) => plot.l + slot * (index + 0.5);
  const axisLine = look.line('categoryAxis', categoryAxis?.spPr ?? null);

  const gridlines = (element: unknown, entry: string, step: number) => {
    if (!element || !(step > 0)) return;
    const stroke = look.line(entry, null);
    if (!stroke) return;
    const lines: Point[][] = [];
    for (let index = 0; index <= MAX_TICKS; index += 1) {
      const value = scale.min + index * step;
      if (value > scale.max + step * 1e-9) break;
      const at = valueAt(value);
      lines.push([
        { x: plot.l, y: at },
        { x: plot.r, y: at },
      ]);
    }
    if (lines.length > 0) context.scene.path(lines, false, null, stroke);
  };

  return {
    plot,
    scale,
    slot,
    categoryAt,
    valueAt,
    paintGrid() {
      if (!valueAxis) return;
      const minorStep = valueAxis.minorUnit ?? scale.major / 5;
      gridlines(valueAxis.minorGridlines, 'gridlineMinor', minorStep);
      gridlines(valueAxis.majorGridlines, 'gridlineMajor', scale.major);
    },
    paintAxes() {
      const { scene, labels } = context;
      if (categoryAxis && !categoryAxis.hidden && axisLine) {
        scene.line(
          [
            { x: plot.l, y: plot.b },
            { x: plot.r, y: plot.b },
          ],
          axisLine
        );
      }
      if (valueAxis && !valueAxis.hidden && axisLine) {
        scene.line(
          [
            { x: plot.l, y: plot.b },
            { x: plot.l, y: plot.t },
          ],
          look.line('valueAxis', valueAxis.spPr) ?? axisLine
        );
      }
      if (showCategoryLabels) {
        const labelStyle = band.style;
        const size = categoryStyle.sizePt;
        const height = lineHeight(labelStyle);
        for (const [index, text] of band.texts.entries()) {
          if (!text) continue;
          const width = estimateTextWidth(text, labelStyle);
          const frame = width * 1.3 + size * 2;
          const row = band.rows === 2 && index % 2 === 0 ? 1 : 0;
          const center = plot.b + CATEGORY_GAP + (row + 0.5) * height;
          if (band.rotated) {
            // A turned label ends at its slot centre: the frame's right middle on the anchor.
            const half = frame / 2;
            const anchorY = plot.b + TURNED_GAP * size + (Math.SQRT1_2 * height) / 2;
            const cx = categoryAt(index) - half * Math.SQRT1_2;
            const cy = anchorY + half * Math.SQRT1_2;
            labels.push({
              paragraphs: [[{ text, style: labelStyle }]],
              align: 'r',
              x: cx - half,
              y: cy - height / 2,
              width: frame,
              height,
              rotation: -45,
            });
            continue;
          }
          labels.push({
            paragraphs: [[{ text, style: labelStyle }]],
            align: 'ctr',
            x: categoryAt(index) - frame / 2,
            y: center - height / 2,
            width: frame,
            height,
            rotation: 0,
          });
        }
      }
      if (showValueLabels) {
        const size = valueStyle.sizePt;
        const height = lineHeight(valueStyle);
        for (const tick of scale.ticks) {
          const text = format(tick, scale);
          const frame = estimateTextWidth(text, valueStyle) * 1.3 + size * 2;
          const label: ChartLabel = {
            paragraphs: [[{ text, style: valueStyle }]],
            align: 'r',
            x: plot.l - VALUE_LABEL_GAP * size - frame,
            y: valueAt(tick) - height / 2,
            width: frame,
            height,
            rotation: 0,
          };
          labels.push(label);
        }
      }
    },
  };
}
