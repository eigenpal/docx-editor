/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The 3-D extrusion of text art, drawn in a parallel projection: the front face swept back to
// a back face at a page offset. Each edge of the front face sweeps a side wall; the walls that
// face the viewer are painted, lit by the extrusion's lights, back to front, and the front
// face is painted over them by the caller.
//
// Lighting is diffuse: a wall's shade is the ambient light plus each light's level times the
// cosine between the wall's normal and the light. Walls are grouped by shade into a bounded
// number of components; each wall is wound the same way, so a group fills by the nonzero rule
// where walls overlap.

import type { VectorShapeComponent } from '@docx-editor.dev/core/store';
import type { TextArtExtrusionData } from './text-art-render-data.ts';
import type { Point } from './text-art-warp.ts';

const EMU = 12_700;
/** Shade steps the walls are grouped into. */
const SHADE_STEPS = 32;

/** `hex` scaled by `shade`, as `RRGGBB`. */
export function shadeHex(hex: string, shade: number): string {
  const s = Math.max(0, Math.min(1, shade));
  let out = '';
  for (let i = 0; i < 6; i += 2) {
    const channel = Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * s);
    out += channel.toString(16).padStart(2, '0');
  }
  return out.toUpperCase();
}

/** The share of its diffuse shade the front face takes, as measured. */
const FRONT_SHARE = 0.48;

/** The diffuse shade of a surface with unit normal `n` (x right, y down, z to the viewer). */
function shadeOf(data: TextArtExtrusionData, n: readonly [number, number, number]): number {
  let shade = data.ambient;
  for (const light of data.lights) {
    const length = Math.hypot(light.x, light.y, light.z);
    if (!(length > 0)) continue;
    const cosine = (n[0] * light.x + n[1] * light.y + n[2] * light.z) / length;
    shade += light.level * Math.max(0, cosine);
  }
  return Math.max(0, Math.min(1, shade));
}

/** The shade of the front face, which faces the viewer. */
export function frontShade(data: TextArtExtrusionData): number {
  return FRONT_SHARE * shadeOf(data, [0, 0, 1]);
}

/** Twice the signed area of a polygon in page space (y down). */
function signedArea(points: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area;
}

/**
 * The side walls and back face of the extruded `front` polygons (box points, already moved by
 * the front offset), in paint order, coloured from `hex`.
 */
export function textArtExtrusionComponents(
  front: readonly Point[][],
  data: TextArtExtrusionData,
  hex: string
): VectorShapeComponent[] {
  // The back face lies where the front face would be without its offset.
  const ox = -data.frontDxPt,
    oy = -data.frontDyPt;
  if (ox === 0 && oy === 0) return [];
  // Outer contours and holes wind opposite ways; the largest contour is an outer one and
  // tells which side of an edge the ink lies on.
  let largest = 0;
  for (const polygon of front) {
    const area = signedArea(polygon);
    if (Math.abs(area) > Math.abs(largest)) largest = area;
  }
  const sign = largest >= 0 ? 1 : -1;
  // Contours closer to the viewer along the projection paint later.
  const order = front
    .map((polygon, index) => {
      let sum = 0;
      for (const p of polygon) sum += p.x * ox + p.y * oy;
      return { index, depth: polygon.length ? sum / polygon.length : 0 };
    })
    .sort((a, b) => a.depth - b.depth);

  const components: VectorShapeComponent[] = [];
  const back = front.map((polygon) =>
    polygon.map((p) => ({ x: (p.x + ox) * EMU, y: (p.y + oy) * EMU }))
  );
  // The back face, darkest: only edges of it can show between the walls.
  components.push({
    subpathsEmu: back,
    fillHex: shadeHex(hex, shadeOf(data, [0, 0, -1])),
    fillAlpha: 1,
    strokeHex: null,
    strokeAlpha: 1,
    strokeWidthEmu: 0,
  });
  let run: { step: number; quads: { x: number; y: number }[][] } | null = null;
  const flush = () => {
    if (!run?.quads.length) return;
    components.push({
      subpathsEmu: run.quads,
      fillHex: shadeHex(hex, run.step / SHADE_STEPS),
      fillAlpha: 1,
      // A hairline of the same colour closes the seams between neighbouring walls.
      strokeHex: shadeHex(hex, run.step / SHADE_STEPS),
      strokeAlpha: 1,
      strokeWidthEmu: 0.25 * EMU,
      strokeJoin: 'round',
      fillRule: 'nonzero',
    });
    run = null;
  };
  for (const { index } of order) {
    const polygon = front[index]!;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!,
        b = polygon[(i + 1) % polygon.length]!;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (!(length > 0)) continue;
      // The outward normal on the page (y down).
      const nx = (sign * dy) / length,
        ny = (-sign * dx) / length;
      // A wall faces the viewer when its normal points the way the back face lies.
      if (nx * ox + ny * oy <= 0) continue;
      const step = Math.round(shadeOf(data, [nx, ny, 0]) * SHADE_STEPS);
      if (run && run.step !== step) flush();
      run ??= { step, quads: [] };
      const quad = [a, b, { x: b.x + ox, y: b.y + oy }, { x: a.x + ox, y: a.y + oy }];
      if (signedArea(quad) < 0) quad.reverse();
      run.quads.push(quad.map((p) => ({ x: p.x * EMU, y: p.y * EMU })));
    }
    flush();
  }
  flush();
  return components;
}
