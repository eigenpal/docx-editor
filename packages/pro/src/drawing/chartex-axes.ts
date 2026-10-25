/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A chartex category axis along the bottom and a value axis on the left, for the chart types
// that plot one column per category (waterfall, histogram, Pareto, box and whisker).
//
// The automatic layout, in chart points. Value tick labels end 6.49 pt left of the plot,
// whatever their size. The plot's top keeps room for the half of the top value label that
// reaches above it, less 0.08 pt; without value labels it keeps 0.98 pt.
//
// Each category label sits in a box as wide as its text, but at most a third of the height
// of the box the frame leaves (its room above the plot included). Text wider than that is
// cut at a word boundary (inside the word when the first word is too wide) with an ellipsis.
// The arrangement, against the slot width:
// - one row, centred under each slot 6.6 pt below the plot, when the widest text is at least
//   1.51 pt narrower than the slot; the labels then show whole;
// - two staggered rows (even slots on the lower row): tried when the widest box is at most
//   1.335 slots, and kept when it is at most 1.293 slots once the plot narrowed for them;
// - otherwise turned up to the right by the first of 30 and 60 degrees whose footprint along
//   the axis (widest box times the cosine, plus line height times the sine) is at most 1.671
//   slots before the plot moves for it and 1.58 slots after, else by 90 degrees. A turned
//   label keeps its size, ends at its slot centre, and its box starts 6.9 pt below the plot.
// Staggered and turned labels stay inside the box: the plot narrows so the last label ends at
// most 0.94 pt past the box's right edge, and moves right so the first label starts at the
// box's left edge. A rejected try still moves the plot once, from the slot before the move,
// and the next try starts from there: turned labels that follow a rejected 30 degree try keep
// part of its move to the right. A try whose first check fails moves nothing. The value scale
// is the shared automatic scale, fitted to the plot as it is without value labels, with ticks
// at least 1.094 label text sizes apart. The value labels show only when their ticks, on the
// plot that makes room for them, are at least 1.16 text sizes apart; otherwise no value label
// shows, and the plot keeps its bare layout 6.26 pt right of the box. Gridlines take the `gridlineMajor`/`gridlineMinor`
// look; both axis lines take the category axis line.
//
// When the value labels' room changes the category label arrangement (a narrow chart whose
// labels stagger only beside the value labels), the scale instead fits the labelled plot
// with ticks a line apart, and the labels show.
//
// Limits: after a rejected staggered try the plot can end up to 2 pt narrower than the
// one-move rule gives. Near the spacing thresholds, a chart whose category labels change
// arrangement, and a value axis with text under 8 pt, can pick the other scale.

import type { Box } from './chart-axes.ts';
import { formatChartNumber } from './chart-number-format.ts';
import { autoValueScale, type ValueScale } from './chart-scale.ts';
import type { Point } from './chart-scene.ts';
import {
  CHART_LINE_HEIGHT,
  estimateTextWidth,
  lineHeight,
  type ChartLabel,
  type ChartTextStyle,
} from './chart-text.ts';
import { CHARTEX_PLOT_TOP_ROOM, type ChartexContext } from './chartex-layout.ts';
import type { ChartexAxis } from './chartex-model.ts';

/** From the right end of the value labels to the plot. */
const VALUE_LABEL_GAP = 6.49;
/** Above the plot for the top value label: half its line, less this. */
const VALUE_TOP_INSET = 0.08;
/** Above the plot without value labels. */
const BARE_TOP_ROOM = 0.98;
/** Ticks keep this many value label text sizes apart on the plot without value labels. */
const TICK_DENSITY = 1.094;
/** Ticks a line of label text apart, in text sizes. */
const LINE_DENSITY = CHART_LINE_HEIGHT;
/** Value labels show when their ticks keep this many text sizes apart. */
const LABEL_SPACING = 1.16;
/** Left of the plot when the value labels are left out for their spacing. */
const HIDDEN_LABEL_ROOM = 6.26;
/** From the plot's bottom edge to the top of the first row of category labels. */
const CATEGORY_GAP = 6.6;
/** From the plot's bottom edge to the top of turned category label boxes. */
const TURNED_GAP = 6.9;
/** A category label box is at most this share of the frame's box height. */
const CATEGORY_HEIGHT_SHARE = 1 / 3;
/** One row needs the widest label text this much narrower than a slot. */
const ONE_ROW_ROOM = 1.51;
/** Two staggered rows are tried when the widest box is at most this many unnarrowed slots. */
const STAGGER_TRY = 1.335;
/** Two staggered rows hold label boxes up to this many slots wide, once the plot narrowed. */
const STAGGER_FILL = 1.293;
/** An angle is tried when its footprint is at most this many slots, before the plot moves. */
const TURNED_TRY = 1.671;
/** A turned arrangement holds footprints up to this many slots wide, once the plot moved. */
const TURNED_FILL = 1.58;
const TURN_ANGLES: readonly number[] = [30, 60, 90];
/** Category labels may end this far past the box's right edge. */
const CATEGORY_RIGHT_REACH = 0.94;
const MAX_TICKS = 1_000;
const MAX_WORDS = 64;
const MAX_CHARS = 1_024;

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
  /**
   * The box the frame left, when the plot's box is narrower (a Pareto chart keeps the room
   * of its right labels beside the plot); the plot's box when unset. Category labels stay
   * inside it and take their height limit from it.
   */
  readonly frameBox?: Box;
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

export interface CategoryBand {
  readonly rows: 1 | 2;
  /** Degrees the labels turn up to the right; 0 when flat. */
  readonly angle: number;
  /** Labels as shown: cut to their box. */
  readonly texts: readonly string[];
  /** From the plot's bottom edge to the bottom of the labels. */
  readonly height: number;
  /** The plot's left and right edges the labels leave. */
  readonly l: number;
  readonly r: number;
}

/** `text` cut at a word boundary to `width`, with an ellipsis when cut. */
export function cutToWidth(text: string, style: ChartTextStyle, width: number): string {
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
      if (++units > MAX_CHARS || estimateTextWidth(kept + char, style) > room) break;
      kept += char;
    }
  }
  return `${kept}…`;
}

/**
 * The plot's edges once every label stays inside `bounds`: label `index` reaches `before`
 * left of its slot centre and `after` right of it.
 */
function fitPlot(
  edges: { readonly l: number; readonly r: number },
  count: number,
  bounds: { readonly l: number; readonly r: number },
  reach: (index: number) => { readonly before: number; readonly after: number }
): { l: number; r: number } {
  // The centre of label i is l (1 - share) + r share, share = (i + 0.5) / count.
  let { l, r } = edges;
  for (let index = 0; index < count; index += 1) {
    const share = (index + 0.5) / count;
    r = Math.min(r, (bounds.r - reach(index).after - l * (1 - share)) / share);
  }
  for (let index = 0; index < count; index += 1) {
    const share = (index + 0.5) / count;
    l = Math.max(l, (bounds.l + reach(index).before - r * share) / (1 - share));
  }
  return { l, r };
}

/** The plot's edges after one move toward `fitPlot`, from the slot before the move. */
function movePlotOnce(
  edges: { readonly l: number; readonly r: number },
  count: number,
  bounds: { readonly l: number; readonly r: number },
  reach: (index: number) => { readonly before: number; readonly after: number }
): { l: number; r: number } {
  const slot = (edges.r - edges.l) / count;
  let { l, r } = edges;
  for (let index = 0; index < count; index += 1) {
    r = Math.min(r, bounds.r - reach(index).after + (count - index - 0.5) * slot);
    l = Math.max(l, bounds.l + reach(index).before - (index + 0.5) * slot);
  }
  return { l, r };
}

/** How category labels `texts` fit between the plot's `edges`, with label boxes at most `limit` wide. */
export function categoryBand(
  texts: readonly string[],
  style: ChartTextStyle,
  edges: { readonly l: number; readonly r: number },
  bounds: { readonly l: number; readonly r: number },
  limit: number
): CategoryBand {
  const count = Math.max(1, texts.length);
  const line = lineHeight(style);
  const shown = texts.map((text) => cutToWidth(text, style, limit));
  const widths = texts.map((text) => estimateTextWidth(text, style));
  const boxes = widths.map((width) => Math.min(width, limit));
  let widest = 0;
  let widestText = 0;
  for (const [index, width] of boxes.entries()) {
    widest = Math.max(widest, width);
    widestText = Math.max(widestText, widths[index]!);
  }
  const slotOf = (placed: { l: number; r: number }) => (placed.r - placed.l) / count;
  const flat = { angle: 0, texts: shown, l: edges.l, r: edges.r };
  // One row shows every label whole.
  if (texts.length <= 1 || widestText + ONE_ROW_ROOM <= slotOf(edges)) {
    return { ...flat, texts, rows: 1, height: CATEGORY_GAP + line };
  }
  // Each arrangement tried keeps the plot edges the ones before it left.
  let placed = { l: edges.l, r: edges.r };
  if (widest <= STAGGER_TRY * slotOf(placed)) {
    const half = (index: number) => ({ before: boxes[index]! / 2, after: boxes[index]! / 2 });
    const fitted = fitPlot(placed, count, bounds, half);
    if (widest <= STAGGER_FILL * slotOf(fitted)) {
      return { ...flat, ...fitted, rows: 2, height: CATEGORY_GAP + 2 * line };
    }
    placed = movePlotOnce(placed, count, bounds, half);
  }
  for (const angle of TURN_ANGLES) {
    const cos = Math.cos((angle * Math.PI) / 180);
    const sin = Math.sin((angle * Math.PI) / 180);
    const footprint = widest * cos + line * sin;
    const last = angle === TURN_ANGLES[TURN_ANGLES.length - 1];
    if (!last && footprint > TURNED_TRY * slotOf(placed)) continue;
    const reach = (index: number) => ({
      before: boxes[index]! * cos + (line / 2) * sin,
      after: (line / 2) * sin,
    });
    const fitted = fitPlot(placed, count, bounds, reach);
    if (last || footprint <= TURNED_FILL * slotOf(fitted)) {
      return {
        rows: 1,
        angle,
        texts: shown,
        height: TURNED_GAP + widest * sin + line * cos,
        ...fitted,
      };
    }
    placed = movePlotOnce(placed, count, bounds, reach);
  }
  return { ...flat, rows: 1, height: CATEGORY_GAP + line };
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
  const valueLabelsOn = valueAxis !== null && !valueAxis.hidden && valueAxis.tickLabels;
  const showCategoryLabels =
    categoryAxis !== null && !categoryAxis.hidden && categoryAxis.tickLabels;
  const count = Math.max(1, input.categories.length);
  const format = (value: number, scale: ValueScale) =>
    formatChartNumber(Math.abs(value) < scale.major * 1e-9 ? 0 : value, input.formatCode);
  const frame = input.frameBox ?? box;
  const bounds = { l: frame.l, r: frame.r + CATEGORY_RIGHT_REACH };
  const limit = (frame.b - frame.t + CHARTEX_PLOT_TOP_ROOM) * CATEGORY_HEIGHT_SHARE;
  const topFor = (labelled: boolean) =>
    box.t -
    CHARTEX_PLOT_TOP_ROOM +
    (labelled ? lineHeight(valueStyle) / 2 - VALUE_TOP_INSET : BARE_TOP_ROOM);

  const scaleFor = (length: number, density: number): ValueScale => {
    const minInterval = density * valueStyle.sizePt;
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
    const labelled = valueLabelsOn && scale !== null;
    if (labelled) {
      let widest = 0;
      for (const tick of scale.ticks) {
        widest = Math.max(widest, estimateTextWidth(format(tick, scale), valueStyle));
      }
      left += widest + VALUE_LABEL_GAP;
    } else if (valueLabelsOn) {
      // Value labels left out for their spacing still keep a little room.
      left += HIDDEN_LABEL_ROOM;
    }
    const edges = { l: left, r: box.r };
    const band: CategoryBand = showCategoryLabels
      ? categoryBand(input.categories, categoryStyle, edges, bounds, limit)
      : { rows: 1, angle: 0, texts: input.categories, height: 0, ...edges };
    const plot = { l: band.l, t: topFor(labelled), r: band.r, b: box.b - band.height };
    return { plot, band, slot: (plot.r - plot.l) / count };
  };
  // The scale fits the plot as it is without value labels. The labels then show only when
  // their ticks, on the plot that makes room for them, keep their spacing; otherwise none
  // shows and the plot keeps its bare layout.
  const bare = layout(null);
  let scale = scaleFor(bare.plot.b - bare.plot.t, TICK_DENSITY);
  let placed = bare;
  let showValueLabels = false;
  if (valueLabelsOn) {
    let labelled = layout(scale);
    const intervals = Math.max(1, Math.round((scale.max - scale.min) / scale.major));
    const spacing = (labelled.plot.b - labelled.plot.t) / intervals;
    if (labelled.band.rows !== bare.band.rows || labelled.band.angle !== bare.band.angle) {
      // The value labels' room changes the category label arrangement: the scale fits the
      // labelled plot with ticks a line apart, and the labels show.
      scale = scaleFor(labelled.plot.b - labelled.plot.t, LINE_DENSITY);
      labelled = layout(scale);
      scale = scaleFor(labelled.plot.b - labelled.plot.t, LINE_DENSITY);
      placed = layout(scale);
      showValueLabels = true;
    } else if (spacing >= LABEL_SPACING * valueStyle.sizePt) {
      placed = labelled;
      showValueLabels = true;
    }
  }
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

  const paintCategoryLabels = () => {
    const size = categoryStyle.sizePt;
    const height = lineHeight(categoryStyle);
    const cos = Math.cos((band.angle * Math.PI) / 180);
    const sin = Math.sin((band.angle * Math.PI) / 180);
    for (const [index, text] of band.texts.entries()) {
      if (!text) continue;
      const frameWidth = estimateTextWidth(text, categoryStyle) * 1.3 + size * 2;
      if (band.angle !== 0) {
        // The label's right middle sits on its slot centre; its box's top on the gap.
        const half = frameWidth / 2;
        const anchorX = categoryAt(index);
        const anchorY = plot.b + TURNED_GAP + (height / 2) * cos;
        const cx = anchorX - half * cos;
        const cy = anchorY + half * sin;
        context.labels.push({
          paragraphs: [[{ text, style: categoryStyle }]],
          align: 'r',
          x: cx - half,
          y: cy - height / 2,
          width: frameWidth,
          height,
          rotation: -band.angle,
        });
        continue;
      }
      const row = band.rows === 2 && index % 2 === 0 ? 1 : 0;
      const center = plot.b + CATEGORY_GAP + (row + 0.5) * height;
      context.labels.push({
        paragraphs: [[{ text, style: categoryStyle }]],
        align: 'ctr',
        x: categoryAt(index) - frameWidth / 2,
        y: center - height / 2,
        width: frameWidth,
        height,
        rotation: 0,
      });
    }
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
      if (showCategoryLabels) paintCategoryLabels();
      if (showValueLabels) {
        const size = valueStyle.sizePt;
        const height = lineHeight(valueStyle);
        for (const tick of scale.ticks) {
          const text = format(tick, scale);
          const frameWidth = estimateTextWidth(text, valueStyle) * 1.3 + size * 2;
          const label: ChartLabel = {
            paragraphs: [[{ text, style: valueStyle }]],
            align: 'r',
            x: plot.l - VALUE_LABEL_GAP - frameWidth,
            y: valueAt(tick) - height / 2,
            width: frameWidth,
            height,
            rotation: 0,
          };
          labels.push(label);
        }
      }
    },
  };
}
