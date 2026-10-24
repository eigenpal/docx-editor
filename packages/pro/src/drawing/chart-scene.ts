/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The painted primitives of one chart, in chart points, and their vector components.
//
// Chart geometry is computed in points from the chart's top-left corner. Every primitive
// becomes one vector shape component in extent EMU; curves are flattened into polylines, and
// dashed lines into one open subpath per dash, since the components carry neither.

import { type VectorShapeComponent } from '@docx-editor.dev/core/store';
import type { ChartPaint, ChartStroke } from './chart-style.ts';

const EMU_PER_POINT = 12_700;
/** Every chart shares one point budget; past it the chart does not render. */
const MAX_SCENE_POINTS = 200_000;
const MAX_DASHES_PER_LINE = 2_000;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export class ChartScene {
  readonly components: VectorShapeComponent[] = [];
  private points = 0;
  /** False once the point budget ran out; the chart then keeps its placeholder. */
  ok = true;

  /** A filled and or outlined shape of closed or open subpaths. */
  path(
    subpaths: readonly (readonly Point[])[],
    closed: boolean,
    fill: ChartPaint | null,
    stroke: ChartStroke | null,
    join?: 'round' | 'bevel'
  ): void {
    if (!fill && !stroke) return;
    if (stroke && stroke.dash && !closed && !fill) {
      this.dashed(subpaths, stroke, join);
      return;
    }
    const usable = subpaths.filter((path) => path.length >= 2);
    if (usable.length === 0) return;
    for (const path of usable) this.points += path.length;
    if (this.points > MAX_SCENE_POINTS) {
      this.ok = false;
      return;
    }
    const strokeWidth = stroke ? Math.max(0, stroke.widthPt) : 0;
    this.components.push({
      subpathsEmu: usable.map((path) =>
        path.map((point) => ({
          x: Math.round(point.x * EMU_PER_POINT),
          y: Math.round(point.y * EMU_PER_POINT),
        }))
      ),
      subpathsClosed: usable.map(() => closed),
      fillHex: closed && fill ? fill.hex : null,
      fillAlpha: fill?.alpha ?? 1,
      strokeHex: stroke && strokeWidth > 0 ? stroke.hex : null,
      strokeAlpha: stroke?.alpha ?? 1,
      strokeWidthEmu: Math.round(strokeWidth * EMU_PER_POINT),
      ...(stroke ? { strokeCap: stroke.cap } : {}),
      ...(join ? { strokeJoin: join } : {}),
    });
  }

  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    fill: ChartPaint | null,
    stroke: ChartStroke | null
  ): void {
    const left = Math.min(x, x + width);
    const top = Math.min(y, y + height);
    const right = Math.max(x, x + width);
    const bottom = Math.max(y, y + height);
    this.path(
      [
        [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ],
      ],
      true,
      fill,
      stroke
    );
  }

  line(points: readonly Point[], stroke: ChartStroke | null, join?: 'round' | 'bevel'): void {
    if (stroke) this.path([points], false, null, stroke, join);
  }

  /** A dashed line as one open subpath per dash. */
  private dashed(
    subpaths: readonly (readonly Point[])[],
    stroke: ChartStroke,
    join?: 'round' | 'bevel'
  ): void {
    // Round and square caps reach half the width past each dash, inside the pattern: dashes
    // draw a width shorter and gaps a width longer, so a dot pattern paints separate dots.
    const width = Math.max(stroke.widthPt, 0.5);
    const capped = stroke.cap !== 'butt';
    const pattern = stroke.dash!.map((length, index) => {
      const base = length * width;
      if (!capped) return Math.max(0.1, base);
      return index % 2 === 0 ? Math.max(0.01, base - width) : base + width;
    });
    const dashes: Point[][] = [];
    for (const path of subpaths) {
      let index = 0;
      let left = pattern[0]!;
      let on = true;
      let current: Point[] = [path[0]!];
      for (let segment = 1; segment < path.length; segment += 1) {
        let from = path[segment - 1]!;
        const to = path[segment]!;
        let remaining = Math.hypot(to.x - from.x, to.y - from.y);
        while (remaining > 0 && dashes.length < MAX_DASHES_PER_LINE) {
          const step = Math.min(left, remaining);
          const ratio = step / remaining;
          const point = {
            x: from.x + (to.x - from.x) * ratio,
            y: from.y + (to.y - from.y) * ratio,
          };
          if (on) current.push(point);
          remaining -= step;
          left -= step;
          from = point;
          if (left <= 1e-9) {
            if (on && current.length >= 2) dashes.push(current);
            on = !on;
            index = (index + 1) % pattern.length;
            left = pattern[index]!;
            current = [point];
          }
        }
      }
      if (on && current.length >= 2) dashes.push(current);
    }
    if (dashes.length > 0) this.path(dashes, false, null, { ...stroke, dash: null }, join);
  }
}

/** A circle or ellipse as a polygon. */
export function ellipse(cx: number, cy: number, rx: number, ry: number, steps = 24): Point[] {
  const out: Point[] = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    out.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return out;
}

/**
 * A pie slice (or a ring segment when `inner > 0`) between two clockwise angles measured from
 * twelve o'clock, in degrees.
 */
export function slice(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  from: number,
  to: number
): Point[] {
  const sweep = Math.max(0, to - from);
  const steps = Math.max(2, Math.ceil(sweep / 2));
  const at = (radius: number, degrees: number): Point => {
    const radians = (degrees * Math.PI) / 180;
    return { x: cx + radius * Math.sin(radians), y: cy - radius * Math.cos(radians) };
  };
  const out: Point[] = [];
  for (let index = 0; index <= steps; index += 1)
    out.push(at(outer, from + (sweep * index) / steps));
  if (inner > 0) {
    for (let index = steps; index >= 0; index -= 1)
      out.push(at(inner, from + (sweep * index) / steps));
  } else if (sweep < 360) {
    out.push({ x: cx, y: cy });
  }
  return out;
}

/** A Catmull-Rom curve through `points`, flattened, as charts draw smoothed lines. */
export function smoothPath(points: readonly Point[], steps = 10): Point[] {
  if (points.length < 3) return [...points];
  const out: Point[] = [points[0]!];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const u = 1 - t;
      out.push({
        x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
        y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
      });
    }
  }
  return out;
}

/** The outline of a marker symbol centred on a point, with `size` its width in points. */
export function markerPath(symbol: string, x: number, y: number, size: number): Point[][] {
  const h = size / 2;
  switch (symbol) {
    case 'square':
      return [
        [
          { x: x - h, y: y - h },
          { x: x + h, y: y - h },
          { x: x + h, y: y + h },
          { x: x - h, y: y + h },
        ],
      ];
    case 'diamond':
      return [
        [
          { x, y: y - h },
          { x: x + h, y },
          { x, y: y + h },
          { x: x - h, y },
        ],
      ];
    case 'triangle':
      return [
        [
          { x, y: y - h },
          { x: x + h, y: y + h },
          { x: x - h, y: y + h },
        ],
      ];
    case 'dash':
      return [
        [
          { x: x - h, y: y - size * 0.1 },
          { x: x + h, y: y - size * 0.1 },
          { x: x + h, y: y + size * 0.1 },
          { x: x - h, y: y + size * 0.1 },
        ],
      ];
    case 'dot':
      // A short bar from the point to its right.
      return [
        [
          { x, y: y - size * 0.12 },
          { x: x + size * 0.55, y: y - size * 0.12 },
          { x: x + size * 0.55, y: y + size * 0.12 },
          { x, y: y + size * 0.12 },
        ],
      ];
    case 'x':
    case 'star':
    case 'plus':
      return [];
    default:
      return [ellipse(x, y, h, h, 16)];
  }
}

/** The strokes of a marker symbol drawn as lines (`x`, `star`, `plus`). */
export function markerStrokes(symbol: string, x: number, y: number, size: number): Point[][] {
  const h = size / 2;
  const cross = [
    [
      { x: x - h, y: y - h },
      { x: x + h, y: y + h },
    ],
    [
      { x: x - h, y: y + h },
      { x: x + h, y: y - h },
    ],
  ];
  const plus = [
    [
      { x: x - h, y },
      { x: x + h, y },
    ],
    [
      { x, y: y - h },
      { x, y: y + h },
    ],
  ];
  if (symbol === 'x') return cross;
  if (symbol === 'plus') return plus;
  if (symbol === 'star') return [...cross, plus[1]!];
  return [];
}
