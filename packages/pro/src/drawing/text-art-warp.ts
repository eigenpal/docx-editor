/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Glyph outlines warped onto a text path.
//
// The outlines are flattened to polygons and their long edges split, so a straight stem bends
// with the path. Two guides hold the text between them: a point's place across the text's ink
// picks the same fraction of each guide's length, and its height picks the point between the
// two. One guide carries the text along it, the middle of its em box on the guide.

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Points the flattened outline may hold; past it the text paints nothing. */
const MAX_POINTS = 60_000;
/** Line segments per Bezier curve. */
const CURVE_STEPS = 8;

/**
 * The closed polygons of an outline's path data (absolute M, L, Q, C, Z), or null when the
 * data leaves that grammar or exceeds the point budget.
 */
export function outlinePolygons(path: string): Point[][] | null {
  const polygons: Point[][] = [];
  let current: Point[] = [];
  let pen: Point = { x: 0, y: 0 };
  let count = 0;
  const close = () => {
    if (current.length > 2) polygons.push(current);
    current = [];
  };
  for (const command of path.matchAll(/([MLQCZ])([^MLQCZ]*)/gu)) {
    const letter = command[1]!;
    const v = command[2]!
      .trim()
      .split(/[\s,]+/u)
      .filter(Boolean)
      .map(Number);
    if (!v.every(Number.isFinite)) return null;
    const arity = { M: 2, L: 2, Q: 4, C: 6, Z: 0 }[letter]!;
    if (v.length !== arity) return null;
    if (letter === 'M') {
      close();
      pen = { x: v[0]!, y: v[1]! };
      current.push(pen);
    } else if (letter === 'L') {
      pen = { x: v[0]!, y: v[1]! };
      current.push(pen);
    } else if (letter === 'Q' || letter === 'C') {
      const p0 = pen;
      for (let step = 1; step <= CURVE_STEPS; step++) {
        const t = step / CURVE_STEPS,
          u = 1 - t;
        current.push(
          letter === 'Q'
            ? {
                x: u * u * p0.x + 2 * u * t * v[0]! + t * t * v[2]!,
                y: u * u * p0.y + 2 * u * t * v[1]! + t * t * v[3]!,
              }
            : {
                x:
                  u * u * u * p0.x +
                  3 * u * u * t * v[0]! +
                  3 * u * t * t * v[2]! +
                  t * t * t * v[4]!,
                y:
                  u * u * u * p0.y +
                  3 * u * u * t * v[1]! +
                  3 * u * t * t * v[3]! +
                  t * t * t * v[5]!,
              }
        );
      }
      pen = letter === 'Q' ? { x: v[2]!, y: v[3]! } : { x: v[4]!, y: v[5]! };
    } else {
      close();
    }
    count += CURVE_STEPS;
    if (count > MAX_POINTS) return null;
  }
  close();
  return polygons;
}

/** Each polygon with every edge split into pieces no longer than `step`. */
export function densify(polygons: readonly Point[][], step: number): Point[][] | null {
  let count = 0;
  const out: Point[][] = [];
  for (const polygon of polygons) {
    const dense: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!,
        b = polygon[(i + 1) % polygon.length]!;
      const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
      count += pieces;
      if (count > MAX_POINTS) return null;
      for (let k = 0; k < pieces; k++) {
        const t = k / pieces;
        dense.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    out.push(dense);
  }
  return out;
}

/** A polyline measured along its length. */
export interface Guide {
  readonly points: readonly Point[];
  /** Cumulative length at each point. */
  readonly lengths: readonly number[];
  readonly length: number;
}

export function guide(points: readonly Point[]): Guide | null {
  if (points.length < 2) return null;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    lengths.push(lengths[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = lengths[lengths.length - 1]!;
  return length > 0 ? { points, lengths, length } : null;
}

/** The point at `distance` along the guide, and its unit tangent; extended past both ends. */
export function along(g: Guide, distance: number): { point: Point; tangent: Point } {
  const { points, lengths } = g;
  let index = 1;
  if (distance >= g.length) index = points.length - 1;
  else if (distance > 0) {
    let low = 1,
      high = points.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (lengths[mid]! < distance) low = mid + 1;
      else high = mid;
    }
    index = low;
  }
  const a = points[index - 1]!,
    b = points[index]!;
  const span = lengths[index]! - lengths[index - 1]!;
  const t = span > 0 ? (distance - lengths[index - 1]!) / span : 0;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return {
    point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    tangent: { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
  };
}

/** The ink box an outline is laid out from. */
export interface InkBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Text between a top and a bottom guide: `ink` spans both guides' whole length and height. */
export function warpBetween(
  polygons: readonly Point[][],
  ink: InkBox,
  top: Guide,
  bottom: Guide
): Point[][] {
  const width = ink.right - ink.left || 1,
    height = ink.bottom - ink.top || 1;
  return polygons.map((polygon) =>
    polygon.map((p) => {
      const u = (p.x - ink.left) / width,
        v = (p.y - ink.top) / height;
      const a = along(top, u * top.length).point,
        b = along(bottom, u * bottom.length).point;
      return { x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v };
    })
  );
}

/**
 * Text along one guide, sized by `scale`: the middle of its em box, `centreY` in outline
 * space, runs on the guide, and the text's centre sits at the guide's middle.
 */
export function warpAlong(
  polygons: readonly Point[][],
  ink: InkBox,
  path: Guide,
  scale: number,
  centreY: number
): Point[][] {
  const centre = (ink.left + ink.right) / 2;
  return polygons.map((polygon) =>
    polygon.map((p) => {
      const { point, tangent } = along(path, path.length / 2 + (p.x - centre) * scale);
      const depth = (p.y - centreY) * scale;
      // Below the em centre is the guide's right-hand side on the page (y down).
      return { x: point.x - tangent.y * depth, y: point.y + tangent.x * depth };
    })
  );
}
