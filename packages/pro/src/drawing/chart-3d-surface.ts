/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Surface charts: value bands from the value scale, and the surface over the category and
// series grid, each cell cut into four triangles about its centre and each triangle into the
// bands it crosses. Wireframe surfaces draw the band edges only.

import { FaceList, litFace, type Projection3D, type Vec3 } from './chart-3d.ts';
import type { CategoryInfo } from './chart-axes.ts';
import type { ChartModel, ChartPlot, ChartSeries } from './chart-model.ts';
import { formatChartNumber } from './chart-number-format.ts';
import type { ValueScale } from './chart-scale.ts';
import type { LookContext } from './chart-series.ts';
import {
  mergeStroke,
  readChartShapeProperties,
  styleSeriesColor,
  type ChartPaint,
  type ChartStroke,
} from './chart-style.ts';

const MAX_BANDS = 64;

/** One value band of a surface chart: its range, colour and legend text. */
export interface SurfaceBand {
  readonly from: number;
  readonly to: number;
  readonly fill: ChartPaint;
  readonly line: ChartStroke | null;
  readonly text: string;
}

/** Clip a triangle with values at its corners to the values in [lo, hi]. */
function clipBand(
  corners: readonly { p: Vec3; v: number }[],
  lo: number,
  hi: number
): { p: Vec3; v: number }[] {
  const clip = (
    input: { p: Vec3; v: number }[],
    keep: (v: number) => boolean,
    edge: number
  ): { p: Vec3; v: number }[] => {
    const out: { p: Vec3; v: number }[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const a = input[index]!;
      const b = input[(index + 1) % input.length]!;
      const inA = keep(a.v);
      const inB = keep(b.v);
      if (inA) out.push(a);
      if (inA !== inB) {
        const t = (edge - a.v) / (b.v - a.v);
        out.push({
          p: {
            x: a.p.x + (b.p.x - a.p.x) * t,
            y: a.p.y + (b.p.y - a.p.y) * t,
            z: a.p.z + (b.p.z - a.p.z) * t,
          },
          v: edge,
        });
      }
    }
    return out;
  };
  const above = clip([...corners], (v) => v >= lo, lo);
  return above.length >= 3 ? clip(above, (v) => v <= hi, hi) : [];
}

/** Bands of a surface: one per major unit of the value scale, coloured by the style. */
export function surfaceBands(
  plot: ChartPlot,
  scale: ValueScale,
  formatCode: string | null,
  context: { readonly model: ChartModel; readonly look: LookContext }
): SurfaceBand[] {
  const out: SurfaceBand[] = [];
  const ticks = scale.ticks;
  const count = Math.min(MAX_BANDS, Math.max(0, ticks.length - 1));
  for (let index = 0; index < count; index += 1) {
    const own = readChartShapeProperties(
      plot.bandFormats.get(index) ?? null,
      context.look.resolveSchemeColor
    );
    const color = styleSeriesColor(
      context.model.style,
      index,
      count,
      context.look.resolveSchemeColor
    );
    const fill = own.fill ?? color;
    const line = mergeStroke(
      own.line,
      plot.wireframe ? { ...fill, widthPt: 0.75, cap: 'round', dash: null } : null
    );
    const from = ticks[index]!;
    const to = ticks[index + 1]!;
    const format = (value: number) => formatChartNumber(value, formatCode, context.model.date1904);
    out.push({ from, to, fill, line, text: `${format(from)}-${format(to)}` });
  }
  return out;
}

export interface SurfaceGeometry {
  readonly valueAt: (value: number) => number;
  readonly categoryAt: (index: number) => number;
  readonly rowAt: (row: number) => number;
  readonly p: Projection3D;
  readonly faces: FaceList;
}

/** A surface over the category and series grid: each cell in four triangles, cut by band. */
export function paintSurface(
  plot: ChartPlot,
  rows: readonly { readonly series: ChartSeries }[],
  bands: readonly SurfaceBand[],
  categories: CategoryInfo,
  geometry: SurfaceGeometry
): void {
  const { valueAt, categoryAt, rowAt, p, faces } = geometry;
  if (rows.length < 2 || categories.count < 2 || bands.length === 0) return;
  const at = (column: number, row: number) => {
    const value = rows[row]!.series.values[column];
    return value === null || value === undefined || !Number.isFinite(value) ? null : value;
  };
  const vertex = (x: number, z: number, v: number) => ({ p: { x, y: valueAt(v), z }, v });
  for (let row = 0; row + 1 < rows.length; row += 1) {
    for (let column = 0; column + 1 < categories.count; column += 1) {
      const values = [
        at(column, row),
        at(column + 1, row),
        at(column + 1, row + 1),
        at(column, row + 1),
      ];
      if (values.some((value) => value === null)) continue;
      const [a, b, c, d] = values as number[];
      const x0 = categoryAt(column);
      const x1 = categoryAt(column + 1);
      const z0 = rowAt(row);
      const z1 = rowAt(row + 1);
      const corners = [
        vertex(x0, z0, a!),
        vertex(x1, z0, b!),
        vertex(x1, z1, c!),
        vertex(x0, z1, d!),
      ];
      const centre = vertex((x0 + x1) / 2, (z0 + z1) / 2, (a! + b! + c! + d!) / 4);
      for (let edge = 0; edge < 4; edge += 1) {
        const triangle = [corners[edge]!, corners[(edge + 1) % 4]!, centre];
        for (const band of bands) {
          const piece = clipBand(triangle, band.from, band.to);
          if (piece.length < 3) continue;
          const points = piece.map((item) => item.p);
          if (plot.wireframe) {
            // Lines only: the band's share of the cell edge and its contour edges.
            const outline = [...points, points[0]!];
            for (let index = 1; index < outline.length; index += 1) {
              const from = piece[index - 1];
              const to = piece[index % piece.length];
              const onContour =
                from && to && from.v === to.v && (from.v === band.from || from.v === band.to);
              const onCellEdge =
                from && to && isCellEdge(from.p, to.p, triangle[0]!.p, triangle[1]!.p);
              if (!onContour && !onCellEdge) continue;
              faces.add({
                points: [outline[index - 1]!, outline[index]!],
                fill: null,
                stroke: band.line,
                oneSided: false,
                open: true,
              });
            }
            continue;
          }
          litFace(faces, points, band.fill, null, p);
        }
      }
    }
  }
}

/** Whether a segment lies on the cell edge from `a` to `b` (the triangle's outer side). */
function isCellEdge(from: Vec3, to: Vec3, a: Vec3, b: Vec3): boolean {
  const onLine = (q: Vec3) => {
    const cross = (b.x - a.x) * (q.z - a.z) - (b.z - a.z) * (q.x - a.x);
    return Math.abs(cross) < 1e-6 * (1 + Math.abs(b.x - a.x) + Math.abs(b.z - a.z)) ** 2;
  };
  return onLine(from) && onLine(to);
}
