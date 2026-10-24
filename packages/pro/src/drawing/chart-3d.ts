/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// 3-D chart geometry: the view `c:view3D` asks for, the projection that fits a box of world
// extents into the plot area, and faces painted back to front with shading by orientation.
//
// World coordinates run x to the right, y up and z away from the viewer, from the front, lower
// left corner of the chart's box. Right-angle axes draw the front face square on and shift the
// depth by (sin rotY, sin rotX) per unit, with no perspective. Otherwise the box turns about
// its centre, by rotY about the vertical and rotX about the horizontal, and the perspective
// value sets the eye distance. Either way the projected box is scaled to fit the plot area and
// centred in it.

import { child, childVal, type ChartModel } from './chart-model.ts';
import type { ChartScene, Point } from './chart-scene.ts';
import type { ChartPaint, ChartStroke } from './chart-style.ts';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface View3D {
  /** Tilt about the horizontal, degrees; positive looks down on the chart. */
  readonly rotX: number;
  /** Turn about the vertical, degrees. */
  readonly rotY: number;
  /** Depth of a bar or row, percent of its width. */
  readonly depthPercent: number;
  /** Front face height, percent of its width; null fits the plot area. */
  readonly hPercent: number | null;
  readonly rightAngles: boolean;
  /** Perspective, 0 for none; 30 is the usual. */
  readonly perspective: number;
}

export interface Extents3D {
  readonly w: number;
  readonly h: number;
  readonly d: number;
}

export interface FitBox {
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
}

export interface Projection3D {
  /** Screen point of a world point. */
  point(p: Vec3): Point;
  /** Distance from the viewer, larger further; only its order matters. */
  depth(p: Vec3): number;
  /** Screen points per world unit at the box centre. */
  readonly scale: number;
}

/** Face colour factors: the front keeps its colour, tops and sides darken. */
export const SHADE_FRONT = 1;
export const SHADE_TOP = 0.76;
export const SHADE_SIDE = 0.64;

/** Space left round a box with right-angle axes, in points on each side. */
const RIGHT_ANGLE_INSET = 2;
/** Share of the plot area a turned box fills. */
const PERSPECTIVE_FILL = 0.974;
/** Eye distance at perspective 30, as a multiple of the box's largest side. */
const BOX_EYE = 3.8;
/**
 * Eye distance at perspective 30, as a multiple of the chart's larger side: measured on
 * charts 432 points wide, where boxes and pies alike put the eye about 730 points away.
 */
export const CHART_EYE = 1.69;
const MAX_FACES = 50_000;

function numberVal(
  parent: Parameters<typeof childVal>[0],
  name: string,
  min: number,
  max: number
): number | null {
  const raw = childVal(parent, name);
  if (raw === undefined || raw.length > 12) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
}

/** The view of a 3-D chart: the schema defaults for missing values, Office's usual view for a chart that names none. */
export function readView3D(model: ChartModel, kind: 'box' | 'pie' | 'contour'): View3D {
  const view = model.view3D;
  if (kind === 'contour') {
    return {
      rotX: 90,
      rotY: 0,
      depthPercent: numberVal(view, 'depthPercent', 20, 2000) ?? 100,
      hPercent: null,
      rightAngles: false,
      perspective: 0,
    };
  }
  const rawAngles = childVal(view, 'rAngAx');
  return {
    // Missing angles take the schema defaults, a square-on view; a chart with no view at all
    // takes the usual Office view.
    rotX: numberVal(view, 'rotX', -90, 90) ?? (view ? 0 : kind === 'pie' ? 30 : 15),
    rotY: numberVal(view, 'rotY', 0, 360) ?? (view ? 0 : kind === 'pie' ? 0 : 20),
    depthPercent: numberVal(view, 'depthPercent', 20, 2000) ?? 100,
    hPercent: numberVal(view, 'hPercent', 5, 500),
    rightAngles:
      kind === 'pie' ? false : rawAngles === undefined || rawAngles === '1' || rawAngles === 'true',
    perspective: numberVal(view, 'perspective', 0, 240) ?? 30,
  };
}

/** Eye distance for `perspective` with `base` the distance at perspective 30; 0 is none. */
export function eyeDistance(perspective: number, base: number): number {
  if (!(perspective > 0)) return 0;
  return (base * Math.tan((7.5 * Math.PI) / 180)) / Math.tan((perspective / 4) * (Math.PI / 180));
}

interface RawProjection {
  point(p: Vec3): Point;
  depth(p: Vec3): number;
}

/** The projection of a box of `world` extents, before fitting. */
function rawProjection(view: View3D, world: Extents3D, eye: number): RawProjection {
  const sinX = Math.sin((view.rotX * Math.PI) / 180);
  const cosX = Math.cos((view.rotX * Math.PI) / 180);
  const sinY = Math.sin((view.rotY * Math.PI) / 180);
  const cosY = Math.cos((view.rotY * Math.PI) / 180);
  if (view.rightAngles) {
    return {
      point: (p) => ({ x: p.x + p.z * sinY, y: -(p.y + p.z * sinX) }),
      depth: (p) => p.z - p.x * sinY - p.y * sinX,
    };
  }
  const turn = (p: Vec3) => {
    const x = p.x - world.w / 2;
    const y = p.y - world.h / 2;
    const z = p.z - world.d / 2;
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;
    return { x: x1, y: y * cosX + z1 * sinX, z: -y * sinX + z1 * cosX };
  };
  return {
    point: (p) => {
      const t = turn(p);
      const f = eye > 0 ? eye / Math.max(eye * 0.05, eye + t.z) : 1;
      return { x: t.x * f, y: -t.y * f };
    },
    depth: (p) => turn(p).z,
  };
}

/**
 * Fit the projection of a box of `world` extents into `box`. `corners` are extra world points
 * the fit must hold, beyond the box's own corners. The eye distance at perspective 30 is
 * `eyePoints` on the page, or `eyeBase` in world units, or by default a multiple of the box's
 * largest side.
 */
export function fitProjection(
  view: View3D,
  world: Extents3D,
  box: FitBox,
  options: {
    readonly eyeBase?: number;
    readonly eyePoints?: number;
    readonly corners?: readonly Vec3[];
    /** Fill `box` exactly, with no inset. */
    readonly exact?: boolean;
  } = {}
): Projection3D {
  const corners: Vec3[] = [...(options.corners ?? [])];
  if (!options.corners) {
    for (const x of [0, world.w])
      for (const y of [0, world.h]) for (const z of [0, world.d]) corners.push({ x, y, z });
  }
  const width = box.r - box.l;
  const height = box.b - box.t;
  const availableW = options.exact
    ? width
    : view.rightAngles
      ? width - 2 * RIGHT_ANGLE_INSET
      : width * PERSPECTIVE_FILL;
  const availableH = options.exact
    ? height
    : view.rightAngles
      ? height - 2 * RIGHT_ANGLE_INSET
      : height * PERSPECTIVE_FILL;
  const fit = (eye: number): Projection3D => {
    const raw = rawProjection(view, world, eye);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
      const p = raw.point(corner);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const spanX = Math.max(maxX - minX, 1e-9);
    const spanY = Math.max(maxY - minY, 1e-9);
    const scale = Math.max(1e-9, Math.min(availableW / spanX, availableH / spanY));
    const cx = (box.l + box.r) / 2;
    const cy = (box.t + box.b) / 2;
    const mx = (minX + maxX) / 2;
    const my = (minY + maxY) / 2;
    return {
      point: (p) => {
        const q = raw.point(p);
        return { x: cx + (q.x - mx) * scale, y: cy + (q.y - my) * scale };
      },
      depth: raw.depth,
      scale,
    };
  };
  if (view.rightAngles || !(view.perspective > 0)) return fit(0);
  if (options.eyePoints === undefined) {
    const base = options.eyeBase ?? BOX_EYE * Math.max(world.w, world.h, world.d, 1e-6);
    return fit(eyeDistance(view.perspective, base));
  }
  // An eye distance on the page depends on the scale it gives: settle the two together.
  let projection = fit(0);
  for (let pass = 0; pass < 4; pass += 1) {
    projection = fit(eyeDistance(view.perspective, options.eyePoints / projection.scale));
  }
  return projection;
}

/** Twice the signed area of a screen polygon; positive when its outward side faces the viewer. */
export function signedArea(points: readonly Point[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** A colour darkened by `factor` (0..1). */
export function shade(paint: ChartPaint | null, factor: number): ChartPaint | null {
  if (!paint || factor >= 0.999) return paint;
  const channel = (offset: number) =>
    Math.round(Number.parseInt(paint.hex.slice(offset, offset + 2), 16) * factor)
      .toString(16)
      .padStart(2, '0');
  return { hex: `${channel(0)}${channel(2)}${channel(4)}`.toUpperCase(), alpha: paint.alpha };
}

/** The shading factor of a face whose normal is `normal`. */
export function shadeFor(normal: Vec3): number {
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const nx = normal.x / length;
  const ny = normal.y / length;
  const nz = normal.z / length;
  return SHADE_SIDE * nx * nx + SHADE_TOP * ny * ny + SHADE_FRONT * nz * nz;
}

/** The (unnormalised) normal of a planar polygon. */
export function polygonNormal(points: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  return { x, y, z };
}

export interface Face3D {
  readonly points: readonly Vec3[];
  readonly fill: ChartPaint | null;
  readonly stroke: ChartStroke | null;
  /** One-sided faces paint only when their outward side faces the viewer. */
  readonly oneSided: boolean;
  /** Paint order bias: added to the depth, so a positive bias paints earlier. */
  readonly bias?: number;
  /** Open polylines paint as strokes only. */
  readonly open?: boolean;
}

/** Collects faces and paints them back to front. */
export class FaceList {
  readonly faces: Face3D[] = [];
  ok = true;

  add(face: Face3D): void {
    if (this.faces.length >= MAX_FACES) {
      this.ok = false;
      return;
    }
    if (face.points.length >= 2) this.faces.push(face);
  }

  /** The six faces of a box, each shaded by its side, one-sided. */
  box(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    fill: ChartPaint | null,
    stroke: ChartStroke | null
  ): void {
    const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
    const faces: [Vec3[], number][] = [
      [[v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0)], SHADE_FRONT],
      [[v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), v(x0, y0, z1)], SHADE_FRONT],
      [[v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)], SHADE_SIDE],
      [[v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), v(x0, y0, z0)], SHADE_SIDE],
      [[v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0)], SHADE_TOP],
      [[v(x0, y0, z1), v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1)], SHADE_TOP],
    ];
    for (const [points, factor] of faces) {
      this.add({ points, fill: shade(fill, factor), stroke, oneSided: true });
    }
  }

  /** Paint every face back to front through `projection`. */
  paint(projection: Projection3D, scene: ChartScene): void {
    const placed = this.faces.map((face, index) => {
      let depth = 0;
      for (const point of face.points) depth += projection.depth(point);
      return {
        face,
        index,
        depth: depth / face.points.length + (face.bias ?? 0),
        screen: face.points.map((point) => projection.point(point)),
      };
    });
    placed.sort((a, b) => b.depth - a.depth || a.index - b.index);
    for (const item of placed) {
      const { face, screen } = item;
      if (face.open) {
        scene.line(screen, face.stroke);
        continue;
      }
      if (face.oneSided && signedArea(screen) <= 1e-9) continue;
      scene.path([screen], true, face.fill, face.stroke, 'round');
    }
  }
}

/** Light for faces at any angle: fronts keep their colour, tops and sides darken. */
const LIGHT: Vec3 = { x: 0.288, y: 0.47, z: -0.834 };
const AMBIENT = 0.45;
const DIFFUSE = 0.659;

export function lightFactor(normal: Vec3, towardViewer: boolean): number {
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const sign = towardViewer ? 1 : -1;
  const dot = (sign * (normal.x * LIGHT.x + normal.y * LIGHT.y + normal.z * LIGHT.z)) / length;
  return Math.min(1, AMBIENT + DIFFUSE * Math.max(0, dot));
}

/** A two-sided face shaded by the light on the side the viewer sees. */
export function litFace(
  faces: FaceList,
  points: Vec3[],
  fill: ChartPaint | null,
  stroke: ChartStroke | null,
  projection: Projection3D
): void {
  const normal = polygonNormal(points);
  // The normal faces the viewer when moving along it brings the point nearer.
  const centre = points.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y, z: sum.z + p.z }), {
    x: 0,
    y: 0,
    z: 0,
  });
  const c = {
    x: centre.x / points.length,
    y: centre.y / points.length,
    z: centre.z / points.length,
  };
  const step = 1e-3 / (Math.hypot(normal.x, normal.y, normal.z) || 1);
  const ahead = { x: c.x + normal.x * step, y: c.y + normal.y * step, z: c.z + normal.z * step };
  const toward = projection.depth(ahead) < projection.depth(c);
  faces.add({ points, fill: shade(fill, lightFactor(normal, toward)), stroke, oneSided: false });
}

/** The walls and floor a chart names: shape properties of `c:floor`, `c:sideWall`, `c:backWall`. */
export function wallElements(model: ChartModel) {
  return {
    floor: child(model.floor, 'spPr'),
    side: child(model.sideWall, 'spPr'),
    back: child(model.backWall, 'spPr'),
  };
}
