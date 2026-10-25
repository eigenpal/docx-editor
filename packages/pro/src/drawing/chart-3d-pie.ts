/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// 3-D pie plots: the pie as a disc a quarter of its radius thick, tilted by rotX and seen in
// perspective, its slices clockwise from rotY. Tops keep the slice colour; the rim darkens
// towards the right. The disc is scaled to fit the plot area.

import { categoryLabel } from './chart-number-format.ts';
import { CHART_EYE, FaceList, fitProjection, readView3D, shade, type Vec3 } from './chart-3d.ts';
import type { Box } from './chart-axes.ts';
import { dataLabelFor, dataLabelText, elementText } from './chart-labels.ts';
import { childVal, type ChartModel, type ChartPlot } from './chart-model.ts';
import type { PieContext } from './chart-pie.ts';
import { seriesLook, variesByPoint } from './chart-series.ts';
import { lineHeight, textBlock } from './chart-text.ts';

/** World radius; the projection scales it to the plot. */
const R = 100;
/** Disc thickness, as a share of the radius. */
const THICKNESS = 0.24;
/** Eye distance at perspective 30, as a multiple of the radius. */
const PIE_EYE = 5;
/** Degrees per rim segment. */
const STEP = 3;

export interface Pie3DContext extends PieContext {
  readonly model: ChartModel;
}

function explosionOf(plot: ChartPlot, pointIndex: number): number {
  const series = plot.series[0]!;
  const point = series.points.get(pointIndex);
  const own = point ? childVal(point, 'explosion') : undefined;
  const raw = own !== undefined && /^\d{1,3}$/.test(own) ? Number(own) : NaN;
  return raw >= 0 && raw <= 400 ? raw : series.explosion;
}

/** The rim colour factor at clockwise angle `degrees` from the back. */
function rimShade(degrees: number): number {
  const value = 0.55 - 0.17 * Math.sin((degrees * Math.PI) / 180);
  return Math.min(0.9, Math.max(0.3, value));
}

/** Paint a 3-D pie plot inside `box`. */
export function paintPie3D(plot: ChartPlot, box: Box, context: Pie3DContext): void {
  const series = plot.series[0];
  if (!series) return;
  const total = series.values.reduce<number>(
    (sum, value) => sum + (value !== null && value > 0 ? value : 0),
    0
  );
  if (!(total > 0)) return;
  const view = { ...readView3D(context.model, 'pie'), rotY: 0, rightAngles: false };
  const start = readView3D(context.model, 'pie').rotY;
  const t = R * THICKNESS;
  const centre = { x: R, z: R };
  const count = series.values.length;

  interface Slice {
    readonly index: number;
    readonly from: number;
    readonly to: number;
    readonly value: number;
    readonly ox: number;
    readonly oz: number;
  }
  const slices: Slice[] = [];
  let angle = start;
  let reach = R;
  for (let index = 0; index < count; index += 1) {
    const value = series.values[index];
    if (value === null || value === undefined || !(value > 0)) continue;
    const sweep = (value / total) * 360;
    const middle = ((angle + sweep / 2) * Math.PI) / 180;
    const offset = (explosionOf(plot, index) / 100) * R;
    reach = Math.max(reach, R + offset);
    slices.push({
      index,
      from: angle,
      to: angle + sweep,
      value,
      ox: offset * Math.sin(middle),
      oz: offset * Math.cos(middle),
    });
    angle += sweep;
  }
  const at = (slice: Slice, degrees: number, radius: number, y: number): Vec3 => {
    const radians = (degrees * Math.PI) / 180;
    return {
      x: centre.x + slice.ox + radius * Math.sin(radians),
      y,
      z: centre.z + slice.oz + radius * Math.cos(radians),
    };
  };
  // The fit holds the whole rim, top and bottom.
  const corners: Vec3[] = [];
  for (let degrees = 0; degrees < 360; degrees += 5) {
    const radians = (degrees * Math.PI) / 180;
    for (const y of [0, t]) {
      corners.push({
        x: centre.x + reach * Math.sin(radians),
        y,
        z: centre.z + reach * Math.cos(radians),
      });
    }
  }
  const bounds = context.bounds;
  const projection = fitProjection(
    view,
    { w: 2 * R, h: t, d: 2 * R },
    box,
    bounds
      ? { eyePoints: CHART_EYE * Math.max(bounds.r - bounds.l, bounds.b - bounds.t), corners }
      : { eyeBase: PIE_EYE * R, corners }
  );

  const faces = new FaceList();
  for (const slice of slices) {
    const look = seriesLook(
      plot,
      series,
      context.look,
      variesByPoint(plot) || series.points.has(slice.index)
        ? { index: slice.index, count }
        : undefined
    );
    const sweep = slice.to - slice.from;
    const steps = Math.max(1, Math.ceil(sweep / STEP));
    const arc = (y: number) => {
      const points: Vec3[] = [];
      for (let step = 0; step <= steps; step += 1) {
        points.push(at(slice, slice.from + (sweep * step) / steps, R, y));
      }
      return points;
    };
    const top = arc(t);
    const bottom = arc(0);
    const middleTop = at(slice, 0, 0, t);
    const middleBottom = at(slice, 0, 0, 0);
    faces.add({
      points: sweep >= 359.99 ? top : [middleTop, ...top],
      fill: look.fill,
      stroke: look.line,
      oneSided: true,
      // Tops lie over the rim and the cut faces below them.
      bias: -t,
    });
    for (let step = 0; step < steps; step += 1) {
      const degrees = slice.from + (sweep * (step + 0.5)) / steps;
      faces.add({
        points: [bottom[step + 1]!, top[step + 1]!, top[step]!, bottom[step]!],
        fill: shade(look.fill, rimShade(degrees)),
        stroke: null,
        oneSided: true,
      });
    }
    if (slice.ox !== 0 || slice.oz !== 0) {
      faces.add({
        points: [bottom[0]!, top[0]!, middleTop, middleBottom],
        fill: shade(look.fill, 0.6),
        stroke: null,
        oneSided: true,
      });
      faces.add({
        points: [middleBottom, middleTop, top[steps]!, bottom[steps]!],
        fill: shade(look.fill, 0.6),
        stroke: null,
        oneSided: true,
      });
    }
  }
  faces.paint(projection, context.scene);

  // Data labels sit on the top face, inside or just beyond the rim.
  for (const slice of slices) {
    const spec = dataLabelFor(plot, series, slice.index);
    if (!spec) continue;
    const style = elementText(context.baseText, spec.txPr, context.look.resolveSchemeColor);
    const text = dataLabelText(
      spec,
      slice.value,
      slice.value / total,
      categoryLabel(series, slice.index, context.date1904),
      series.name,
      series.formatCode,
      context.date1904
    );
    const block = textBlock(text, style);
    const height = lineHeight(style) * block.lines;
    const middle = (slice.from + slice.to) / 2;
    const outside = spec.position === 'outEnd';
    const anchor = projection.point(at(slice, middle, outside ? R * 1.12 : R * 0.65, t));
    const frame = block.width * 1.3 + style.sizePt * 2;
    const radians = (middle * Math.PI) / 180;
    const shiftX = outside ? (block.width / 2) * Math.sin(radians) : 0;
    const shiftY = outside ? (-height / 2) * Math.cos(radians) : 0;
    context.labels.push({
      paragraphs: [[{ text, style }]],
      align: 'ctr',
      x: anchor.x + shiftX - frame / 2,
      y: anchor.y + shiftY - height / 2,
      width: frame,
      height,
      rotation: 0,
    });
  }
}
