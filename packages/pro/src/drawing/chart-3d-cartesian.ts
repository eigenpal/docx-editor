/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// 3-D plots drawn against axes: column, bar, line, area and surface charts in a box, and the
// contour chart, which is a surface seen from above.
//
// The box's front face takes the plot area's shape; its depth is one row of bars, or one row
// per series when the chart has a series axis. A category slot holds bars as wide as in two
// dimensions; a bar is as deep as it is wide times the depth percent, and a row adds the gap
// depth. Value axes end at the data. Walls, gridlines, the series and the axis labels are
// projected; labels keep their two-dimensional offsets from the projected edges.

import {
  categoryInfo,
  extendValueRange,
  plotAxis,
  scaleValues,
  valueFormat,
  type Box,
  type CategoryInfo,
  type ValueInfo,
} from './chart-axes.ts';
import {
  CHART_EYE,
  FaceList,
  litFace,
  fitProjection,
  readView3D,
  shade,
  SHADE_FRONT,
  SHADE_SIDE,
  wallElements,
  type Projection3D,
  type Vec3,
} from './chart-3d.ts';
import type { CartesianContext } from './chart-cartesian.ts';
import { elementText } from './chart-labels.ts';
import { child, type ChartAxis, type ChartPlot, type ChartSeries } from './chart-model.ts';
import { paintSurface, type SurfaceBand } from './chart-3d-surface.ts';
import { formatChartNumber } from './chart-number-format.ts';
import { scaleRatio, type ValueScale } from './chart-scale.ts';
import { seriesLook } from './chart-series.ts';
import {
  mergeStroke,
  readChartShapeProperties,
  type ChartPaint,
  type ChartStroke,
} from './chart-style.ts';
import { estimateTextWidth, lineHeight, type ChartTextStyle } from './chart-text.ts';

const MAX_CATEGORIES = 4_096;
/** Surface grids past this many points do not render. */
const MAX_SURFACE_POINTS = 20_000;
/** Share of the plot area a turned box and its label bands fill. */
const FILL = 0.974;
const DEFAULT_AXIS_LINE: ChartStroke = {
  hex: '000000',
  alpha: 1,
  widthPt: 0.5,
  cap: 'butt',
  dash: null,
};
/** Whether every plot is one the 3-D painter draws. */
export function is3DCartesian(plots: readonly ChartPlot[]): boolean {
  return (
    plots.length > 0 &&
    plots.every(
      (plot) =>
        plot.kind === 'surface' ||
        (plot.threeD && (plot.kind === 'bar' || plot.kind === 'line' || plot.kind === 'area'))
    )
  );
}

/** The value direction of the plots: data range and format, before scaling. */
function valueInfo(context: CartesianContext, plots: readonly ChartPlot[]): ValueInfo {
  const info: ValueInfo = {
    axis: plotAxis(context.model, plots[0]!, 'value'),
    id: '',
    dataMin: Infinity,
    dataMax: -Infinity,
    percent: false,
    scale: null,
    formatCode: null,
  };
  for (const plot of plots) {
    extendValueRange(info, plot);
    info.formatCode ??= plot.series.find((series) => series.formatCode)?.formatCode ?? null;
  }
  info.formatCode = valueFormat(info, info.formatCode);
  return info;
}

/** The value scale of a surface chart laid out in `box`, for its bands and legend. */
export function surfaceScale(
  context: Pick<CartesianContext, 'model' | 'look' | 'baseText'>,
  plots: readonly ChartPlot[],
  box: Box
): { scale: ValueScale; formatCode: string | null } {
  const info = valueInfo(context as CartesianContext, plots);
  const style = elementText(
    context.baseText,
    info.axis?.txPr ?? null,
    context.look.resolveSchemeColor
  );
  // The value direction is drawn upright or, from above, not at all; either way it takes the
  // room of a little under half the plot height.
  const length = Math.max(1, 0.45 * (box.b - box.t));
  const scale = scaleValues(info, length, true, style, context.model.date1904, true);
  return { scale, formatCode: info.formatCode };
}

interface TickLabel {
  readonly text: string;
  readonly style: ChartTextStyle;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly place: 'left' | 'right' | 'below';
}

/** The room a box and its label bands fit in: a little in from the plot area's edges. */
function insetBox(box: Box, rightAngles: boolean): Box {
  if (rightAngles) return { l: box.l + 2, t: box.t + 2, r: box.r - 2, b: box.b - 2 };
  const dx = ((box.r - box.l) * (1 - FILL)) / 2;
  const dy = ((box.b - box.t) * (1 - FILL)) / 2;
  return { l: box.l + dx, t: box.t + dy, r: box.r - dx, b: box.b - dy };
}

interface Row {
  readonly plot: ChartPlot;
  readonly series: ChartSeries;
  readonly row: number;
}

/**
 * The height of a 3-D box `width` wide and `depth` deep in a room `room` tall and `width`
 * wide: the room's height, or, with a series axis, the room's shape applied to the width or
 * the depth, whichever is less.
 */
export function boxHeight(width: number, depth: number, room: number, byRow: boolean): number {
  return byRow ? (Math.min(width, depth) * room) / width : room;
}

/** Paint 3-D plots inside `outer`. False when the combination is unsupported. */
export function paint3DCartesian(
  plots: readonly ChartPlot[],
  outer: Box,
  context: CartesianContext,
  bands?: readonly SurfaceBand[]
): boolean {
  const { model } = context;
  if (!is3DCartesian(plots)) return false;
  const surface = plots.some((plot) => plot.kind === 'surface');
  if (surface && plots.some((plot) => plot.kind !== 'surface')) return false;
  const horizontal = plots.some((plot) => plot.kind === 'bar' && plot.horizontal);
  if (horizontal && plots.some((plot) => plot.kind !== 'bar' || !plot.horizontal)) return false;
  const contour = surface && plots.every((plot) => !plot.threeD);
  const view = readView3D(model, contour ? 'contour' : 'box');
  const resolve = context.look.resolveSchemeColor;
  const categories = categoryInfo(model, plots, MAX_CATEGORIES);
  if (categories.count === 0) return true;
  const info = valueInfo(context, plots);
  const seriesAxis =
    plots
      .flatMap((plot) => plot.axisIds)
      .map((id) => model.axes.get(id))
      .find((axis) => axis?.kind === 'series') ?? null;
  const all: Row[] = [];
  for (const plot of plots) for (const series of plot.series) all.push({ plot, series, row: 0 });
  const byRow =
    surface ||
    seriesAxis !== null ||
    plots.some((plot) => plot.kind === 'bar' && plot.grouping === 'standard');
  const rows = byRow ? all.map((item, index) => ({ ...item, row: index })) : all;
  const rowCount = byRow ? Math.max(1, rows.length) : 1;
  if (surface && categories.count * rowCount > MAX_SURFACE_POINTS) return false;

  const textOf = (axis: ChartAxis | null) =>
    elementText(context.baseText, axis?.txPr ?? null, resolve);
  const visible = (axis: ChartAxis | null) => axis !== null && !axis.deleted;
  const labelled = (axis: ChartAxis | null) => visible(axis) && axis!.tickLabelPosition !== 'none';
  const valueAxis = info.axis;
  const categoryAxis = categories.axis;
  const valueStyle = textOf(valueAxis);
  const categoryStyle = textOf(categoryAxis);
  const seriesStyle = textOf(seriesAxis);
  const seriesNames = rows.map((item) => item.series.name ?? `Series${item.series.index + 1}`);

  // World extents and the slot rules.
  const gap = (plots.find((plot) => plot.kind === 'bar')?.gapWidth ?? 150) / 100;
  const clustered = plots.filter(
    (plot) => plot.kind === 'bar' && !byRow && plot.grouping === 'clustered'
  );
  const clusterSize = Math.max(
    1,
    clustered.reduce((sum, plot) => sum + plot.series.length, 0)
  );
  const gapDepth = (plots[0]!.gapDepth ?? 150) / 100;
  // The front face takes the room's shape. With a series axis the box is as tall, for its
  // width or its depth if that is less, as the room is for its width.
  const world = (box: Box) => {
    const w = Math.max(1, box.r - box.l);
    const room = Math.max(1, box.b - box.t);
    const along = horizontal ? (view.hPercent !== null ? (w * view.hPercent) / 100 : room) : w;
    const slot = along / categories.count;
    const barWidth = slot / ((clustered.length > 0 ? clusterSize : 1) + gap);
    const barDepth = (barWidth * view.depthPercent) / 100;
    const rowDepth = barDepth * (1 + gapDepth);
    const d = rowCount * rowDepth;
    const h =
      view.hPercent !== null
        ? (w * view.hPercent) / 100
        : boxHeight(w, d, room, byRow && !horizontal);
    return { w, h, d, slot, barWidth, barDepth, rowDepth };
  };

  const valueTexts = (scale: ValueScale) =>
    scale.ticks.map((tick) =>
      formatChartNumber(
        Math.abs(tick) < scale.major * 1e-9 ? 0 : tick,
        info.formatCode,
        model.date1904
      )
    );

  // The box and its tick labels fit the plot area together: lay out, measure how far the
  // labels reach past the box, and fit again in what is left. The value scale follows the
  // room the projection leaves the value direction. Surface bands fix the scale beforehand.
  const bandScale: ValueScale | null =
    surface && bands && bands.length > 0
      ? {
          min: bands[0]!.from,
          max: bands[bands.length - 1]!.to,
          major: bands[0]!.to - bands[0]!.from,
          ticks: [...bands.map((band) => band.from), bands[bands.length - 1]!.to],
        }
      : null;
  if (surface && !bandScale) return true;
  const scaleFor = (length: number): ValueScale =>
    bandScale ??
    scaleValues(info, Math.max(1, length), !horizontal, valueStyle, model.date1904, true);
  const reversed = valueAxis?.reversed ?? false;
  const layout = (extents: ReturnType<typeof world>, scale: ValueScale) => {
    const valueAt = (value: number): number => {
      const ratio = Math.min(1, Math.max(0, scaleRatio(scale, value)));
      return (reversed ? 1 - ratio : ratio) * (horizontal ? extents.w : extents.h);
    };
    const along = horizontal ? extents.h : extents.w;
    const categoryAt = (index: number): number =>
      categories.between
        ? (index + 0.5) * extents.slot
        : categories.count > 1
          ? (index / (categories.count - 1)) * along
          : along / 2;
    const rowAt = (row: number): number =>
      surface
        ? rowCount > 1
          ? (row / (rowCount - 1)) * extents.d
          : extents.d / 2
        : byRow
          ? (row + 0.5) * extents.rowDepth
          : extents.d / 2;
    return { valueAt, categoryAt, rowAt };
  };
  const tickLabels = (
    projection: Projection3D,
    extents: ReturnType<typeof world>,
    scale: ValueScale
  ): TickLabel[] => {
    const { valueAt, categoryAt, rowAt } = layout(extents, scale);
    const out: TickLabel[] = [];
    if (labelled(valueAxis)) {
      const texts = valueTexts(scale);
      for (const [index, tick] of scale.ticks.entries()) {
        const at = valueAt(tick);
        const anchor = horizontal
          ? projection.point({ x: at, y: 0, z: 0 })
          : projection.point({ x: 0, y: at, z: 0 });
        out.push({
          text: texts[index]!,
          style: valueStyle,
          anchor,
          place: horizontal ? 'below' : 'left',
        });
      }
    }
    if (labelled(categoryAxis)) {
      for (let index = 0; index < categories.count; index += 1) {
        const text = categories.labels[index]!;
        if (text === '') continue;
        const at = categoryAt(index);
        const anchor = horizontal
          ? projection.point({ x: 0, y: at, z: 0 })
          : projection.point({ x: at, y: 0, z: 0 });
        out.push({ text, style: categoryStyle, anchor, place: horizontal ? 'left' : 'below' });
      }
    }
    if (byRow && labelled(seriesAxis)) {
      for (const item of rows) {
        const anchor = projection.point({ x: extents.w, y: 0, z: rowAt(item.row) });
        out.push({ text: seriesNames[item.row]!, style: seriesStyle, anchor, place: 'right' });
      }
    }
    return out;
  };
  // Tick labels take bands round the plot area as in two dimensions, and the box fits what is
  // left, a little in from its edges.
  const widest = (texts: readonly string[], style: ChartTextStyle) =>
    texts.reduce((max, text) => Math.max(max, estimateTextWidth(text, style)), 0);
  let valueScale = scaleFor((horizontal ? outer.r - outer.l : outer.b - outer.t) * 0.75);
  let projection: Projection3D | null = null;
  let extents = world(outer);
  for (let pass = 0; pass < 2; pass += 1) {
    const box: Box = { ...outer };
    if (labelled(valueAxis) && !horizontal) {
      box.l += widest(valueTexts(valueScale), valueStyle) + 0.417 * valueStyle.sizePt;
    }
    if (labelled(valueAxis) && horizontal) box.b -= 1.338 * valueStyle.sizePt;
    if (labelled(categoryAxis) && !horizontal) box.b -= 1.338 * categoryStyle.sizePt;
    if (labelled(categoryAxis) && horizontal) {
      box.l += widest(categories.labels, categoryStyle) + 0.417 * categoryStyle.sizePt;
    }
    if (byRow && labelled(seriesAxis)) {
      box.r -= widest(seriesNames, seriesStyle) + 0.417 * seriesStyle.sizePt;
    }
    if (!(box.r - box.l > 1) || !(box.b - box.t > 1)) break;
    extents = world(box);
    projection = fitProjection(view, extents, insetBox(box, view.rightAngles), {
      exact: true,
      eyePoints: CHART_EYE * Math.max(context.chartWidth, context.chartHeight),
    });
    if (bandScale) break;
    const from = projection.point({ x: 0, y: 0, z: 0 });
    const to = horizontal
      ? projection.point({ x: extents.w, y: 0, z: 0 })
      : projection.point({ x: 0, y: extents.h, z: 0 });
    valueScale = scaleFor(Math.hypot(to.x - from.x, to.y - from.y));
  }
  if (!projection) return true;
  const p = projection;
  const { w: W, h: H, d: D, slot, barWidth, barDepth } = extents;
  const { valueAt, categoryAt, rowAt } = layout(extents, valueScale);
  const base = valueAt(Math.min(valueScale.max, Math.max(valueScale.min, 0)));

  const faces = new FaceList();
  const walls = wallElements(model);
  const wallLook = (spPr: ReturnType<typeof child>) => readChartShapeProperties(spPr, resolve);
  const sideX = view.rightAngles
    ? view.rotY >= 0 && view.rotY <= 180
      ? 0
      : W
    : Math.sin((view.rotY * Math.PI) / 180) >= 0
      ? 0
      : W;
  const WALL_BIAS = 1e7;
  const GRID_BIAS = 1e6;
  const back = wallLook(walls.back);
  if (back.fill || back.line) {
    faces.add({
      points: [
        { x: 0, y: 0, z: D },
        { x: 0, y: H, z: D },
        { x: W, y: H, z: D },
        { x: W, y: 0, z: D },
      ],
      fill: back.fill ?? null,
      stroke: back.line ?? null,
      oneSided: false,
      bias: WALL_BIAS,
    });
  }
  const side = wallLook(walls.side);
  if (side.fill || side.line) {
    faces.add({
      points: [
        { x: sideX, y: 0, z: 0 },
        { x: sideX, y: H, z: 0 },
        { x: sideX, y: H, z: D },
        { x: sideX, y: 0, z: D },
      ],
      fill: side.fill ?? null,
      stroke: side.line ?? null,
      oneSided: false,
      bias: WALL_BIAS,
    });
  }
  const floor = wallLook(walls.floor);
  if (floor.fill || floor.line) {
    faces.add({
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: D },
        { x: W, y: 0, z: D },
        { x: W, y: 0, z: 0 },
      ],
      fill: floor.fill ?? null,
      stroke: floor.line ?? null,
      oneSided: false,
      bias: WALL_BIAS,
    });
  }

  // Gridlines on the back wall, the side wall and the floor.
  const gridStroke = (element: ReturnType<typeof child>) => {
    if (!element) return null;
    const own = readChartShapeProperties(child(element, 'spPr'), resolve);
    return mergeStroke(own.line, DEFAULT_AXIS_LINE);
  };
  const valueGrid = valueAxis ? gridStroke(valueAxis.majorGridlines) : null;
  if (valueGrid && !contour) {
    for (const tick of valueScale.ticks) {
      const at = valueAt(tick);
      const lines: Vec3[][] = horizontal
        ? [
            [
              { x: at, y: 0, z: D },
              { x: at, y: H, z: D },
            ],
            [
              { x: at, y: 0, z: 0 },
              { x: at, y: 0, z: D },
            ],
          ]
        : [
            [
              { x: sideX, y: at, z: 0 },
              { x: sideX, y: at, z: D },
            ],
            [
              { x: 0, y: at, z: D },
              { x: W, y: at, z: D },
            ],
          ];
      for (const points of lines) {
        faces.add({
          points,
          fill: null,
          stroke: valueGrid,
          oneSided: false,
          open: true,
          bias: GRID_BIAS,
        });
      }
    }
  }
  const categoryGrid = categoryAxis ? gridStroke(categoryAxis.majorGridlines) : null;
  if (categoryGrid && !surface) {
    for (let index = 0; index <= categories.count; index += 1) {
      const at = index * slot;
      const lines: Vec3[][] = horizontal
        ? [
            [
              { x: 0, y: at, z: D },
              { x: W, y: at, z: D },
            ],
          ]
        : [
            [
              { x: at, y: 0, z: D },
              { x: at, y: H, z: D },
            ],
            [
              { x: at, y: 0, z: 0 },
              { x: at, y: 0, z: D },
            ],
          ];
      for (const points of lines) {
        faces.add({
          points,
          fill: null,
          stroke: categoryGrid,
          oneSided: false,
          open: true,
          bias: GRID_BIAS,
        });
      }
    }
  }

  // Series.
  if (surface) {
    paintSurface(plots[0]!, rows, bands ?? [], categories, {
      valueAt,
      categoryAt,
      rowAt,
      p,
      faces,
    });
  } else {
    for (const plot of plots) {
      const plotRows = rows.filter((item) => item.plot === plot);
      if (plot.kind === 'bar') {
        paintBars(plot, plotRows, categories, {
          valueAt,
          categoryAt,
          rowAt,
          base,
          barWidth,
          barDepth,
          clusterSize: clustered.includes(plot) ? clusterSize : 1,
          clusterOffset: clustered.includes(plot)
            ? clustered
                .slice(0, clustered.indexOf(plot))
                .reduce((sum, item) => sum + item.series.length, 0)
            : 0,
          horizontal,
          context,
          faces,
        });
      } else {
        paintRibbons(plot, plotRows, categories, {
          valueAt,
          categoryAt,
          rowAt,
          base,
          barDepth,
          context,
          faces,
          p,
        });
      }
    }
  }
  faces.paint(p, context.scene);
  if (!faces.ok) return false;

  // Axis lines along the front edges.
  const axisStroke = (axis: ChartAxis | null) => {
    if (!visible(axis)) return null;
    const own = readChartShapeProperties(axis!.spPr, resolve);
    return mergeStroke(own.line, DEFAULT_AXIS_LINE);
  };
  const categoryLine = axisStroke(categoryAxis);
  if (categoryLine) {
    const end = horizontal ? { x: 0, y: H, z: 0 } : { x: W, y: 0, z: 0 };
    context.scene.line([p.point({ x: 0, y: 0, z: 0 }), p.point(end)], categoryLine);
  }
  const valueLine = axisStroke(valueAxis);
  if (valueLine && !contour) {
    const end = horizontal ? { x: W, y: 0, z: 0 } : { x: 0, y: H, z: 0 };
    context.scene.line([p.point({ x: 0, y: 0, z: 0 }), p.point(end)], valueLine);
  }

  // Tick labels.
  for (const item of tickLabels(p, extents, valueScale)) {
    const size = item.style.sizePt;
    const height = lineHeight(item.style);
    const frame = estimateTextWidth(item.text, item.style) * 1.3 + size * 2;
    const offset = 0.91 * size;
    context.labels.push({
      paragraphs: [[{ text: item.text, style: item.style }]],
      align: item.place === 'left' ? 'r' : item.place === 'right' ? 'l' : 'ctr',
      x:
        item.place === 'left'
          ? item.anchor.x - offset - frame
          : item.place === 'right'
            ? item.anchor.x + offset
            : item.anchor.x - frame / 2,
      y: item.place === 'below' ? item.anchor.y + 0.625 * size : item.anchor.y - height / 2,
      width: frame,
      height,
      rotation: 0,
    });
  }
  return true;
}

interface BarGeometry {
  readonly valueAt: (value: number) => number;
  readonly categoryAt: (index: number) => number;
  readonly rowAt: (row: number) => number;
  readonly base: number;
  readonly barWidth: number;
  readonly barDepth: number;
  readonly clusterSize: number;
  readonly clusterOffset: number;
  readonly horizontal: boolean;
  readonly context: CartesianContext;
  readonly faces: FaceList;
}

function paintBars(
  plot: ChartPlot,
  rows: readonly Row[],
  categories: CategoryInfo,
  geometry: BarGeometry
): void {
  const { valueAt, base, barWidth, barDepth, horizontal, faces } = geometry;
  const stacked = plot.grouping === 'stacked' || plot.grouping === 'percentStacked';
  const percent = plot.grouping === 'percentStacked';
  const totals: number[] = [];
  if (percent) {
    for (let index = 0; index < categories.count; index += 1) {
      totals.push(rows.reduce((sum, item) => sum + Math.abs(item.series.values[index] ?? 0), 0));
    }
  }
  const positive = new Array<number>(categories.count).fill(0);
  const negative = new Array<number>(categories.count).fill(0);
  for (const [seriesIndex, item] of rows.entries()) {
    const look = seriesLook(plot, item.series, geometry.context.look);
    const fill = look.fill;
    const z0 = geometry.rowAt(item.row) - barDepth / 2;
    const z1 = z0 + barDepth;
    for (let index = 0; index < categories.count; index += 1) {
      const raw = item.series.values[index];
      if (raw === null || raw === undefined || !Number.isFinite(raw)) continue;
      const value = percent ? (totals[index]! > 0 ? raw / totals[index]! : 0) : raw;
      let from = base;
      let to: number;
      if (stacked) {
        const start = value >= 0 ? positive[index]! : negative[index]!;
        const end = start + value;
        if (value >= 0) positive[index] = end;
        else negative[index] = end;
        from = valueAt(start);
        to = valueAt(end);
      } else {
        to = valueAt(value);
      }
      if (Math.abs(to - from) < 1e-9) continue;
      const centre = geometry.categoryAt(index);
      const slotStart = centre - (barWidth * (geometry.clusterSize + plot.gapWidth / 100)) / 2;
      const offset =
        stacked || geometry.clusterSize === 1 ? 0 : geometry.clusterOffset + seriesIndex;
      const a = slotStart + ((plot.gapWidth / 100) * barWidth) / 2 + offset * barWidth;
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      if (horizontal) faces.box(lo, hi, a, a + barWidth, z0, z1, fill, look.line);
      else faces.box(a, a + barWidth, lo, hi, z0, z1, fill, look.line);
    }
  }
}

interface RibbonGeometry {
  readonly valueAt: (value: number) => number;
  readonly categoryAt: (index: number) => number;
  readonly rowAt: (row: number) => number;
  readonly base: number;
  readonly barDepth: number;
  readonly context: CartesianContext;
  readonly faces: FaceList;
  readonly p: Projection3D;
}

/** Line series as ribbons and area series as slabs, one row each. */
function paintRibbons(
  plot: ChartPlot,
  rows: readonly Row[],
  categories: CategoryInfo,
  geometry: RibbonGeometry
): void {
  const { valueAt, categoryAt, faces, barDepth, p } = geometry;
  const stacked = plot.grouping === 'stacked' || plot.grouping === 'percentStacked';
  const running = new Array<number>(categories.count).fill(0);
  for (const item of rows) {
    const look = seriesLook(plot, item.series, geometry.context.look);
    const color = plot.kind === 'line' ? (look.line ?? look.fill) : look.fill;
    const z0 = geometry.rowAt(item.row) - barDepth / 2;
    const z1 = z0 + barDepth;
    const points: { x: number; y: number; floor: number }[] = [];
    for (let index = 0; index < categories.count; index += 1) {
      const raw = item.series.values[index];
      if (raw === null || raw === undefined || !Number.isFinite(raw)) {
        if (plot.kind === 'line') points.push({ x: NaN, y: NaN, floor: 0 });
        continue;
      }
      const start = stacked ? running[index]! : 0;
      const end = start + raw;
      if (stacked) running[index] = end;
      points.push({
        x: categoryAt(index),
        y: valueAt(end),
        floor: stacked ? valueAt(start) : geometry.base,
      });
    }
    const paint: ChartPaint | null = color ? { hex: color.hex, alpha: color.alpha } : null;
    if (plot.kind === 'line') {
      for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1]!;
        const b = points[index]!;
        if (!Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
        litFace(
          faces,
          [
            { x: a.x, y: a.y, z: z0 },
            { x: b.x, y: b.y, z: z0 },
            { x: b.x, y: b.y, z: z1 },
            { x: a.x, y: a.y, z: z1 },
          ],
          paint,
          null,
          p
        );
      }
      continue;
    }
    if (points.length < 2) continue;
    const front: Vec3[] = [{ x: points[0]!.x, y: points[0]!.floor, z: z0 }];
    for (const point of points) front.push({ x: point.x, y: point.y, z: z0 });
    for (let index = points.length - 1; index >= 0; index -= 1) {
      front.push({ x: points[index]!.x, y: points[index]!.floor, z: z0 });
    }
    faces.add({
      points: front,
      fill: shade(paint, SHADE_FRONT),
      stroke: look.line,
      oneSided: true,
    });
    faces.add({
      points: [...front].reverse().map((point) => ({ ...point, z: z1 })),
      fill: shade(paint, SHADE_FRONT),
      stroke: look.line,
      oneSided: true,
    });
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!;
      const b = points[index]!;
      litFace(
        faces,
        [
          { x: a.x, y: a.y, z: z0 },
          { x: a.x, y: a.y, z: z1 },
          { x: b.x, y: b.y, z: z1 },
          { x: b.x, y: b.y, z: z0 },
        ],
        paint,
        look.line,
        p
      );
    }
    const first = points[0]!;
    const last = points[points.length - 1]!;
    faces.add({
      points: [
        { x: first.x, y: first.floor, z: z1 },
        { x: first.x, y: first.y, z: z1 },
        { x: first.x, y: first.y, z: z0 },
        { x: first.x, y: first.floor, z: z0 },
      ],
      fill: shade(paint, SHADE_SIDE),
      stroke: look.line,
      oneSided: true,
    });
    faces.add({
      points: [
        { x: last.x, y: last.floor, z: z0 },
        { x: last.x, y: last.y, z: z0 },
        { x: last.x, y: last.y, z: z1 },
        { x: last.x, y: last.floor, z: z1 },
      ],
      fill: shade(paint, SHADE_SIDE),
      stroke: look.line,
      oneSided: true,
    });
  }
}
