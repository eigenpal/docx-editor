/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Plots drawn against axes: bar, line, area and scatter. Lays out the axis label bands around
// the plot area, then paints gridlines, series, axis lines, data labels and tick labels.

import {
  categoryInfo,
  categoryPosition,
  categorySlot,
  extendValueRange,
  plotAxis,
  scaleValues,
  valueFormat,
  valuePosition,
  type Box,
  type ValueInfo,
} from './chart-axes.ts';
import { elementText, titleParagraphs } from './chart-labels.ts';
import { child, type ChartAxis, type ChartModel, type ChartPlot } from './chart-model.ts';
import { formatChartNumber } from './chart-number-format.ts';
import type { ValueScale } from './chart-scale.ts';
import type { ChartScene, Point } from './chart-scene.ts';
import type { LookContext } from './chart-series.ts';
import { paintSeries } from './chart-series-paint.ts';
import { mergeStroke, readChartShapeProperties, type ChartStroke } from './chart-style.ts';
import {
  bodyRotation,
  estimateTextWidth,
  lineHeight,
  paragraphsHeight,
  paragraphsWidth,
  type ChartLabel,
  type ChartTextRun,
  type ChartTextStyle,
} from './chart-text.ts';

const MAX_CATEGORIES = 4_096;
const TICK_LENGTH = 3.1;
/** Labels beside a vertical axis sit this many sizes above their tick's centre line. */
export const LABEL_LIFT = 0.08;
const DEFAULT_AXIS_LINE: ChartStroke = {
  hex: '000000',
  alpha: 1,
  widthPt: 0.5,
  cap: 'butt',
  dash: null,
};

export interface CartesianContext {
  readonly model: ChartModel;
  readonly look: LookContext;
  readonly scene: ChartScene;
  readonly labels: ChartLabel[];
  readonly baseText: ChartTextStyle;
  readonly blanks: 'gap' | 'zero' | 'span';
  readonly chartWidth: number;
  readonly chartHeight: number;
}

interface AxisView {
  readonly axis: ChartAxis | null;
  readonly role: 'category' | 'value' | 'x';
  readonly side: 'l' | 'r' | 't' | 'b';
  readonly style: ChartTextStyle;
  /** Shows tick labels. */
  readonly labelled: boolean;
  readonly value: ValueInfo | null;
  title: { paragraphs: ChartTextRun[][]; style: ChartTextStyle; rotation: number | null } | null;
}

function vertical(side: AxisView['side']): boolean {
  return side === 'l' || side === 'r';
}

function tickOut(axis: ChartAxis | null): number {
  return axis && (axis.majorTickMark === 'out' || axis.majorTickMark === 'cross') ? 1 : 0;
}

function axisStroke(axis: ChartAxis | null, context: CartesianContext): ChartStroke | null {
  if (!axis) return null;
  const own = readChartShapeProperties(axis.spPr, context.look.resolveSchemeColor);
  return mergeStroke(own.line, DEFAULT_AXIS_LINE);
}

function gridStroke(
  element: ReturnType<typeof child>,
  context: CartesianContext
): ChartStroke | null {
  if (!element) return null;
  const own = readChartShapeProperties(child(element, 'spPr'), context.look.resolveSchemeColor);
  return mergeStroke(own.line, DEFAULT_AXIS_LINE);
}

/** Tick label texts of a value axis. */
function valueLabels(view: AxisView, model: ChartModel): string[] {
  const info = view.value!;
  if (!info.scale) return [];
  return info.scale.ticks.map((tick) =>
    formatChartNumber(
      Math.abs(tick) < info.scale!.major * 1e-9 ? 0 : tick,
      info.formatCode,
      model.date1904
    )
  );
}

function maxWidth(texts: readonly string[], style: ChartTextStyle): number {
  let widest = 0;
  for (const text of texts) widest = Math.max(widest, estimateTextWidth(text, style));
  return widest;
}

interface InnerLayout {
  readonly plot: Box;
  readonly categoryRotation: number;
  readonly categorySkip: number;
  /** Category labels wrap at this width; 0 when they keep one line. */
  readonly categoryWrap: number;
}

/** Lines `text` takes when its words wrap at `width`. */
function wrappedLines(text: string, style: ChartTextStyle, width: number): number {
  const space = estimateTextWidth(' ', style);
  let lines = 1;
  let line = 0;
  for (const word of text.split(/\s+/).slice(0, 256)) {
    const wordWidth = estimateTextWidth(word, style);
    if (line > 0 && line + space + wordWidth > width) {
      lines += 1;
      line = wordWidth;
    } else line += (line > 0 ? space : 0) + wordWidth;
  }
  return lines;
}

/** Paint the plots that use axes inside `outer`. False when the combination is unsupported. */
export function paintCartesian(
  plots: readonly ChartPlot[],
  outer: Box,
  context: CartesianContext
): boolean {
  const { model } = context;
  const xy = (plot: ChartPlot) => plot.kind === 'scatter' || plot.kind === 'bubble';
  const scatter = plots.filter(xy);
  const categorical = plots.filter((plot) => !xy(plot));
  if (scatter.length > 0 && categorical.length > 0) return false;
  const horizontal = categorical.some((plot) => plot.kind === 'bar' && plot.horizontal);
  if (horizontal && categorical.some((plot) => plot.kind !== 'bar' || !plot.horizontal))
    return false;
  const resolve = context.look.resolveSchemeColor;

  // Value directions and their data ranges.
  const values = new Map<string, ValueInfo>();
  const valueOf = (axis: ChartAxis | null): ValueInfo => {
    const id = axis?.id ?? '';
    let info = values.get(id);
    if (!info) {
      info = {
        axis,
        id,
        dataMin: Infinity,
        dataMax: -Infinity,
        percent: false,
        scale: null,
        formatCode: null,
      };
      values.set(id, info);
    }
    return info;
  };
  const plotValues = new Map<ChartPlot, ValueInfo>();
  let xInfo: ValueInfo | null = null;
  for (const plot of plots) {
    const info = valueOf(plotAxis(model, plot, 'value'));
    extendValueRange(info, plot);
    info.formatCode ??= plot.series.find((series) => series.formatCode)?.formatCode ?? null;
    plotValues.set(plot, info);
    if (xy(plot)) {
      const axis = plotAxis(model, plot, 'x');
      xInfo ??= {
        axis,
        id: `x:${axis?.id ?? ''}`,
        dataMin: Infinity,
        dataMax: -Infinity,
        percent: false,
        scale: null,
        formatCode: null,
      };
      extendValueRange(xInfo, plot, true);
    }
  }
  for (const info of values.values()) info.formatCode = valueFormat(info, info.formatCode);
  if (xInfo) xInfo.formatCode = valueFormat(xInfo, null);
  const categories =
    categorical.length > 0 ? categoryInfo(model, categorical, MAX_CATEGORIES) : null;

  // Axis views: which side each axis labels.
  const views: AxisView[] = [];
  const textOf = (axis: ChartAxis | null) =>
    elementText(context.baseText, axis?.txPr ?? null, resolve);
  const visible = (axis: ChartAxis | null) => axis !== null && !axis.deleted;
  const labelled = (axis: ChartAxis | null) => visible(axis) && axis!.tickLabelPosition !== 'none';
  if (categories) {
    const axis = categories.axis;
    views.push({
      axis,
      role: 'category',
      side: horizontal ? (axis?.position === 'r' ? 'r' : 'l') : axis?.position === 't' ? 't' : 'b',
      style: textOf(axis),
      labelled: labelled(axis),
      value: null,
      title: null,
    });
  } else if (xInfo) {
    views.push({
      axis: xInfo.axis,
      role: 'x',
      side: xInfo.axis?.position === 't' ? 't' : 'b',
      style: textOf(xInfo.axis),
      labelled: labelled(xInfo.axis),
      value: xInfo,
      title: null,
    });
  }
  let primary = true;
  for (const info of values.values()) {
    const axis = info.axis;
    const fallback = horizontal ? (primary ? 'b' : 't') : primary ? 'l' : 'r';
    const side = (axis?.position ?? fallback) as AxisView['side'];
    views.push({
      axis,
      role: 'value',
      side: horizontal ? (side === 't' ? 't' : 'b') : side === 'r' ? 'r' : 'l',
      style: textOf(axis),
      labelled: labelled(axis),
      value: info,
      title: null,
    });
    primary = false;
  }
  for (const view of views) {
    if (!visible(view.axis) || !view.axis!.title) continue;
    const style = elementText(context.baseText, child(view.axis!.title, 'txPr'), resolve, {
      bold: true,
    });
    const paragraphs = titleParagraphs(view.axis!.title, style, 'Axis Title', resolve);
    if (paragraphs.length === 0) continue;
    const rich = child(child(view.axis!.title, 'tx'), 'rich');
    view.title = {
      paragraphs,
      style,
      rotation: bodyRotation(rich ?? child(view.axis!.title, 'txPr')),
    };
  }
  const categoryView = views.find((view) => view.role === 'category') ?? null;
  const manual = model.plotLayout;
  const valueView = views.find((view) => view.role === 'value') ?? null;

  const layoutInner = (): InnerLayout => {
    if (manual && manual.inner) {
      const chartWidth = context.chartWidth;
      const chartHeight = context.chartHeight;
      return {
        plot: {
          l: manual.x * chartWidth,
          t: manual.y * chartHeight,
          r: (manual.x + manual.w) * chartWidth,
          b: (manual.y + manual.h) * chartHeight,
        },
        categoryRotation: 0,
        categorySkip: 1,
        categoryWrap: 0,
      };
    }
    const box: Box =
      manual && !manual.inner
        ? {
            l: manual.x * context.chartWidth,
            t: manual.y * context.chartHeight,
            r: (manual.x + manual.w) * context.chartWidth,
            b: (manual.y + manual.h) * context.chartHeight,
          }
        : { ...outer };
    for (const view of views) {
      if (!view.title) continue;
      const band = paragraphsHeight(view.title.paragraphs, view.title.style) + 9;
      if (view.side === 'l') box.l += band;
      else if (view.side === 'r') box.r -= band;
      else if (view.side === 't') box.t += band;
      else box.b -= band;
    }
    // Side bands first: they decide the width the category labels share.
    for (const view of views) {
      if (!view.labelled || !vertical(view.side)) continue;
      const texts = view.value ? valueLabels(view, model) : (categories?.labels ?? []);
      const fallbackText = view.value
        ? formatChartNumber(
            view.value.dataMax > -Infinity ? view.value.dataMax : 1,
            view.value.formatCode,
            model.date1904
          )
        : '';
      const band =
        maxWidth(texts.length ? texts : [fallbackText], view.style) +
        0.417 * view.style.sizePt +
        0.5 * tickOut(view.axis);
      if (view.side === 'l') box.l += band;
      else box.r -= band;
    }
    let rotation = 0;
    let skip = 1;
    let wrap = 0;
    for (const view of views) {
      if (!view.labelled || vertical(view.side)) continue;
      const size = view.style.sizePt;
      let band = 1.338 * size + 0.6 * tickOut(view.axis);
      if (view.role === 'category' && categories) {
        const slot = categorySlot(categories, box.r - box.l);
        const widest = maxWidth(categories.labels, view.style);
        const authoredRotation = bodyRotation(view.axis?.txPr ?? null);
        // Labels too wide for their slot wrap between words, and turn only when one word
        // alone is wider than the slot.
        const wordsFit = categories.labels.every((label) =>
          label
            .split(/\s+/)
            .slice(0, 256)
            .every((word) => estimateTextWidth(word, view.style) <= slot * 0.98)
        );
        if (authoredRotation !== null && authoredRotation !== 0) rotation = authoredRotation;
        else if (widest > slot * 0.98 && categories.count > 1) {
          if (wordsFit) wrap = slot;
          else rotation = -45;
        }
        if (wrap > 0) {
          const lines = Math.max(
            ...categories.labels.map((label) => wrappedLines(label, view.style, wrap))
          );
          band += (lines - 1) * lineHeight(view.style);
        }
        if (rotation !== 0) {
          const radians = (Math.abs(rotation) * Math.PI) / 180;
          band =
            widest * Math.sin(radians) + lineHeight(view.style) * Math.cos(radians) + 0.625 * size;
          const pitch = lineHeight(view.style) / Math.sin(radians);
          skip = Math.max(1, Math.ceil(pitch / Math.max(slot, 1e-6)));
        }
        if (view.axis?.tickLabelSkip) skip = view.axis.tickLabelSkip;
        if (valueView?.value?.scale && crossesInside(view, valueView.value.scale)) band = 0;
      }
      if (view.side === 't') box.t += band;
      else box.b -= band;
    }
    // The last label of a horizontal value axis centres on the plot's far edge.
    for (const view of views) {
      if (!view.labelled || vertical(view.side) || !view.value) continue;
      const texts = valueLabels(view, model);
      if (texts.length > 0) box.r -= estimateTextWidth(texts[texts.length - 1]!, view.style) / 2;
    }
    return { plot: box, categoryRotation: rotation, categorySkip: skip, categoryWrap: wrap };
  };

  const scaleAll = (inner: Box) => {
    for (const view of views) {
      if (!view.value) continue;
      const length = vertical(view.side) ? inner.b - inner.t : inner.r - inner.l;
      view.value.scale = scaleValues(
        view.value,
        Math.max(1, length),
        vertical(view.side),
        view.style,
        model.date1904
      );
    }
  };
  let inner = layoutInner();
  scaleAll(inner.plot);
  inner = layoutInner();
  scaleAll(inner.plot);
  const plot = inner.plot;
  if (!(plot.r - plot.l > 1) || !(plot.b - plot.t > 1)) return true;

  // Coordinate mapping.
  const categoryReversed = categoryView?.axis?.reversed ?? false;
  const categoryAt = (index: number): number => {
    if (!categories) return 0;
    if (horizontal) {
      return categoryReversed
        ? categoryPosition(categories, index, plot.t, plot.b)
        : categoryPosition(categories, index, plot.b, plot.t);
    }
    return categoryReversed
      ? categoryPosition(categories, index, plot.r, plot.l)
      : categoryPosition(categories, index, plot.l, plot.r);
  };
  const valueAt = (info: ValueInfo, value: number): number => {
    const scale = info.scale!;
    const reversed = info.axis?.reversed ?? false;
    return horizontal || info === xInfo
      ? valuePosition(scale, value, plot.l, plot.r, reversed)
      : valuePosition(scale, value, plot.b, plot.t, reversed);
  };
  const crossing = (scale: ValueScale, axis: ChartAxis | null): number => {
    const crosses = axis?.crosses ?? 'autoZero';
    if (crosses === 'min') return scale.min;
    if (crosses === 'max') return scale.max;
    const target = typeof crosses === 'number' ? crosses : 0;
    return Math.min(scale.max, Math.max(scale.min, target));
  };

  // Plot area.
  const area = readChartShapeProperties(model.plotSpPr, resolve);
  context.scene.rect(
    plot.l,
    plot.t,
    plot.r - plot.l,
    plot.b - plot.t,
    area.fill ?? null,
    area.line ?? null
  );

  // Gridlines.
  for (const view of views) {
    if (!view.axis || (view.axis.deleted && !view.axis.majorGridlines)) continue;
    for (const [element, minor] of [
      [view.axis.minorGridlines, true],
      [view.axis.majorGridlines, false],
    ] as const) {
      const stroke = gridStroke(element, context);
      if (!stroke) continue;
      const lines: Point[][] = [];
      if (view.value?.scale) {
        for (const value of gridValues(view.value.scale, minor)) {
          const at = valueAt(view.value, value);
          lines.push(
            vertical(view.side)
              ? [
                  { x: plot.l, y: at },
                  { x: plot.r, y: at },
                ]
              : [
                  { x: at, y: plot.t },
                  { x: at, y: plot.b },
                ]
          );
        }
      } else if (categories && !minor) {
        const count = categories.between ? categories.count + 1 : categories.count;
        for (let index = 0; index < count; index += 1) {
          const at = categories.between
            ? categoryAt(index) - (categoryAt(1) - categoryAt(0)) / 2
            : categoryAt(index);
          lines.push(
            vertical(view.side)
              ? [
                  { x: plot.l, y: at },
                  { x: plot.r, y: at },
                ]
              : [
                  { x: at, y: plot.t },
                  { x: at, y: plot.b },
                ]
          );
        }
      }
      if (lines.length > 0) context.scene.path(lines, false, null, stroke);
    }
  }

  // Series.
  const pending: ChartLabel[] = [];
  for (const plotItem of plots) {
    const info = plotValues.get(plotItem)!;
    if (!info.scale) continue;
    const base = crossing(info.scale, categoryView?.axis ?? null);
    paintSeries(
      plotItem,
      info,
      base,
      { categoryAt, valueAt, categories, horizontal, xInfo, plot },
      context,
      pending
    );
  }

  // Axis lines and ticks.
  for (const view of views) {
    if (!visible(view.axis)) continue;
    const stroke = axisStroke(view.axis, context);
    if (!stroke) continue;
    let position: number;
    if (view.role === 'category' || view.role === 'x') {
      const info = valueView?.value;
      position = info?.scale
        ? valueAt(info, crossing(info.scale, view.axis))
        : vertical(view.side)
          ? plot.l
          : plot.b;
    } else {
      const crossesAxis = view.axis!.crosses;
      const atMax = crossesAxis === 'max';
      position = vertical(view.side)
        ? view.side === 'r' || atMax
          ? plot.r
          : plot.l
        : view.side === 't' || atMax
          ? plot.t
          : plot.b;
      if (xInfo?.scale && view.value !== xInfo && !horizontal) {
        position = valueAt(xInfo, crossing(xInfo.scale, view.axis));
      }
    }
    const segment: Point[] = vertical(view.side)
      ? [
          { x: position, y: plot.t },
          { x: position, y: plot.b },
        ]
      : [
          { x: plot.l, y: position },
          { x: plot.r, y: position },
        ];
    context.scene.line(segment, stroke);
    const mark = view.axis!.majorTickMark;
    if (mark === 'none') continue;
    const outward = view.side === 'l' || view.side === 't' ? -1 : 1;
    const from = mark === 'in' ? 0 : mark === 'cross' ? -TICK_LENGTH : 0;
    const to = mark === 'in' ? -TICK_LENGTH : TICK_LENGTH;
    const ticks: number[] = [];
    if (view.value?.scale)
      for (const tick of view.value.scale.ticks) ticks.push(valueAt(view.value, tick));
    else if (categories) {
      const count = categories.between ? categories.count + 1 : categories.count;
      for (let index = 0; index < count; index += 1) {
        ticks.push(
          categories.between
            ? categoryAt(index) - (categoryAt(1) - categoryAt(0)) / 2
            : categoryAt(index)
        );
      }
    }
    const marks = ticks.map((at) =>
      vertical(view.side)
        ? [
            { x: position + outward * from, y: at },
            { x: position + outward * to, y: at },
          ]
        : [
            { x: at, y: position - outward * -from },
            { x: at, y: position + outward * to },
          ]
    );
    if (marks.length > 0) context.scene.path(marks, false, null, stroke);
  }

  for (const label of pending) context.labels.push(label);

  // Tick labels.
  for (const view of views) {
    if (!view.labelled) continue;
    const size = view.style.sizePt;
    const height = lineHeight(view.style);
    const offset = 0.91 * size;
    if (view.value?.scale) {
      const texts = valueLabels(view, model);
      for (const [index, tick] of view.value.scale.ticks.entries()) {
        const text = texts[index]!;
        const textWidth = estimateTextWidth(text, view.style);
        const frame = textWidth * 1.3 + size * 2;
        const at = valueAt(view.value, tick);
        if (vertical(view.side)) {
          const left = view.side === 'l';
          context.labels.push({
            paragraphs: [[{ text, style: view.style }]],
            align: left ? 'r' : 'l',
            x: left ? plot.l - offset - frame : plot.r + offset,
            y: at - height / 2 - LABEL_LIFT * size,
            width: frame,
            height,
            rotation: 0,
          });
        } else {
          const top = view.side === 'b' ? plot.b + 0.625 * size : plot.t - 0.625 * size - height;
          context.labels.push({
            paragraphs: [[{ text, style: view.style }]],
            align: 'ctr',
            x: at - frame / 2,
            y: top,
            width: frame,
            height,
            rotation: 0,
          });
        }
      }
      continue;
    }
    if (!categories) continue;
    const crossLine =
      valueView?.value?.scale && crossesInside(view, valueView.value.scale)
        ? valueAt(valueView.value, crossing(valueView.value.scale, view.axis))
        : null;
    for (let index = 0; index < categories.count; index += inner.categorySkip) {
      const text = categories.labels[index]!;
      if (text === '') continue;
      const textWidth = estimateTextWidth(text, view.style);
      const frame = textWidth * 1.3 + size * 2;
      const at = categoryAt(index);
      if (vertical(view.side)) {
        const edge = crossLine ?? (view.side === 'l' ? plot.l : plot.r);
        const left = view.side === 'l';
        context.labels.push({
          paragraphs: [[{ text, style: view.style }]],
          align: left ? 'r' : 'l',
          x: left ? edge - offset - frame : edge + offset,
          y: at - height / 2 - LABEL_LIFT * size,
          width: frame,
          height,
          rotation: 0,
        });
        continue;
      }
      const edge = crossLine ?? (view.side === 'b' ? plot.b : plot.t);
      const top = view.side === 'b' ? edge + 0.625 * size : edge - 0.625 * size - height;
      if (inner.categoryRotation !== 0) {
        const radians = (inner.categoryRotation * Math.PI) / 180;
        const half = frame / 2;
        // Turned labels end at their tick: the frame's right middle sits on the anchor.
        const anchorX = at;
        const anchorY = top + height / 2;
        const cx = anchorX - half * Math.cos(radians);
        const cy = anchorY - half * Math.sin(radians);
        context.labels.push({
          paragraphs: [[{ text, style: view.style }]],
          align: 'r',
          x: cx - half,
          y: cy - height / 2,
          width: frame,
          height,
          rotation: inner.categoryRotation,
        });
        continue;
      }
      // A wrapped label sets in a frame as wide as its slot, so it breaks where the slot ends.
      const wrapWidth = inner.categoryWrap;
      const lines = wrapWidth > 0 ? wrappedLines(text, view.style, wrapWidth) : 1;
      const width = wrapWidth > 0 ? wrapWidth : frame;
      context.labels.push({
        paragraphs: [[{ text, style: view.style }]],
        align: 'ctr',
        x: at - width / 2,
        y: view.side === 'b' ? top : top - (lines - 1) * height,
        width,
        height: height * lines,
        rotation: 0,
      });
    }
  }

  // Axis titles.
  for (const view of views) {
    if (!view.title) continue;
    const style = view.title.style;
    const height = paragraphsHeight(view.title.paragraphs, style);
    const textWidth = paragraphsWidth(view.title.paragraphs);
    const frame = textWidth * 1.3 + style.sizePt * 2;
    if (vertical(view.side)) {
      const rotation = view.title.rotation ?? -90;
      const cx = view.side === 'l' ? outer.l + 1.5 + height / 2 : outer.r - 1.5 - height / 2;
      const cy = (plot.t + plot.b) / 2;
      const turned = Math.abs(Math.abs(rotation) - 90) < 1;
      context.labels.push({
        paragraphs: view.title.paragraphs,
        align: 'ctr',
        x: cx - (turned ? frame : frame) / 2,
        y: cy - height / 2,
        width: frame,
        height,
        rotation,
      });
    } else {
      const top = view.side === 'b' ? outer.b - 1.4 - height : outer.t + 1.5;
      context.labels.push({
        paragraphs: view.title.paragraphs,
        align: 'ctr',
        x: (plot.l + plot.r) / 2 - frame / 2,
        y: top,
        width: frame,
        height,
        rotation: view.title.rotation ?? 0,
      });
    }
  }
  return true;
}

/** A category axis that crosses the value axis inside the plot labels next to that line. */
function crossesInside(view: AxisView, scale: ValueScale): boolean {
  if (view.role !== 'category' || view.axis?.tickLabelPosition !== 'nextTo') return false;
  const crosses = view.axis.crosses;
  if (crosses !== 'autoZero') return false;
  return scale.min < 0 && scale.max > 0;
}

/**
 * The values of an axis's gridlines: the ticks, or for minor gridlines five steps per interval
 * on a linear scale and each whole multiple between powers on a logarithmic one. Bounded.
 */
function gridValues(scale: ValueScale, minor: boolean): number[] {
  const values: number[] = [];
  if (scale.logBase !== undefined) {
    if (!minor) return [...scale.ticks];
    const steps = Math.min(Math.floor(scale.logBase), 100);
    for (const tick of scale.ticks) {
      for (let k = 2; k < steps && values.length < 1_000; k += 1) {
        if (tick * k < scale.max) values.push(tick * k);
      }
    }
    return values;
  }
  const step = minor ? scale.major / 5 : scale.major;
  for (
    let index = 0, value = scale.min;
    value <= scale.max + step * 1e-9 && index < 1_000;
    index += 1, value = scale.min + index * step
  ) {
    values.push(value);
  }
  return values;
}
