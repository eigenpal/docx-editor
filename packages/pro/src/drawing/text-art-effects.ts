/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The fill, shadow and extrusion of a VML text path shape, read from its model into the
// render data the text art layout paints. Each reader returns `undefined` for markup outside
// what it paints, so the projection refuses the shape rather than approximate it.

import { vmlColor, vmlNumber, vmlOff as off, vmlPoints } from '@docx-editor.dev/core/store';
import type {
  LegacyTextArtModel,
  TextArtExtrusionModel,
  TextArtShadowModel,
} from './text-art-model.ts';
import type {
  TextArtExtrusionData,
  TextArtFillData,
  TextArtLightData,
  TextArtShadowData,
  TextArtStop,
} from './text-art-render-data.ts';

const hex = (value: string) => value.slice(1).toUpperCase();
const unit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
const on = (value: string | undefined) => /^(t|true|1)$/i.test(value ?? '');

/** VML opacity: a fraction, a `f` fixed-point fraction, or a percentage. NaN when malformed. */
export function vmlOpacity(raw: string | undefined): number {
  if (raw === undefined) return 1;
  return vmlFraction(raw);
}

/** A fraction: `f` fixed point, a percentage, or a plain number. NaN when malformed. */
function vmlFraction(raw: string): number {
  const value = raw.trim();
  if (/^-?\d{1,7}f$/.test(value)) return Number(value.slice(0, -1)) / 65536;
  if (/^-?\d{1,3}(\.\d{1,6})?%$/.test(value)) return Number(value.slice(0, -1)) / 100;
  return vmlNumber(value);
}

/**
 * The fill: null when the shape is not filled, `undefined` outside the painted subset. A
 * linear gradient runs from `color` to `color2` down the box; `focus` places `color2` along
 * it, mirrored when it lies inside the box.
 */
export function textArtFill(model: LegacyTextArtModel): TextArtFillData | null | undefined {
  const node = model.fills[0];
  if (off(model.shape.filled) || (node && off(node.on))) return null;
  const color = vmlColor(node?.color ?? model.shape.fillcolor, '#ffffff');
  const alpha = vmlOpacity(node?.opacity);
  if (!color || !unit(alpha)) return undefined;
  const type = node?.type ?? 'solid';
  if (type === 'solid') return { kind: 'solid', hex: hex(color), alpha };
  if (type !== 'gradient' || node?.colors !== undefined) return undefined;
  const color2 = vmlColor(node.color2, '#ffffff');
  const alpha2 = node.opacity2 === undefined ? alpha : vmlOpacity(node.opacity2);
  const angle = node.angle === undefined ? 0 : vmlNumber(node.angle);
  const focus = node.focus === undefined ? 0 : vmlFraction(node.focus);
  // Only the vertical gradient has been measured; any other angle stays refused.
  if (!color2 || !unit(alpha2) || angle !== 0 || !(Math.abs(focus) <= 1)) return undefined;
  const first: TextArtStop = { offset: 0, hex: hex(color), alpha };
  const second: TextArtStop = { offset: 0, hex: hex(color2), alpha: alpha2 };
  // A negative focus swaps the two colours.
  const [a, b] = focus < 0 ? [second, first] : [first, second];
  const at = Math.abs(focus);
  let stops: TextArtStop[];
  if (at === 1) stops = [a, { ...b, offset: 1 }];
  else if (at === 0) stops = [b, { ...a, offset: 1 }];
  else stops = [a, { ...b, offset: at }, { ...a, offset: 1 }];
  return { kind: 'linear', angle: 0, stops };
}

/** Two lengths `x,y` in points; NaN components when malformed. */
function offsetPair(raw: string | undefined, fallback: string): [number, number] {
  const [x = '', y = x] = (raw ?? fallback).split(',').map((part) => part.trim());
  return [x === '' ? 0 : vmlPoints(x), y === '' ? 0 : vmlPoints(y)];
}

/** The shown shadow, null when switched off, `undefined` outside the painted subset. */
export function textArtShadow(
  shadow: TextArtShadowModel | undefined
): TextArtShadowData | null | undefined {
  // A shadow is off unless it says `on`.
  if (!shadow || !on(shadow.on)) return null;
  if (shadow.otherAttributes.length || (shadow.type ?? 'single') !== 'single') return undefined;
  const color = vmlColor(shadow.color, 'gray');
  const alpha = vmlOpacity(shadow.opacity);
  const [dx, dy] = offsetPair(shadow.offset, '2pt,2pt');
  if (!color || !unit(alpha) || !(Math.abs(dx) <= 200 && Math.abs(dy) <= 200)) return undefined;
  return { hex: hex(color), alpha, dxPt: dx, dyPt: dy };
}

/** A 3-D point `x,y,z`, with the given defaults for empty or missing components. */
function point3(raw: string | undefined, fallback: readonly number[]): number[] | null {
  if (raw === undefined) return [...fallback];
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length > 3) return null;
  const values = fallback.map((value, i) => (parts[i] ? vmlNumber(parts[i]) : value));
  return values.every((value, i) => Number.isFinite(value) || (i === 2 && !parts[2]))
    ? values
    : null;
}

/** A light level: `f` fixed point or a plain fraction. */
function level(raw: string | undefined, fallback: number): number {
  return raw === undefined ? fallback : vmlFraction(raw);
}

/** A viewpoint `x,y[,z]` of lengths; missing components keep the defaults. Null when malformed. */
function viewpoint(raw: string | undefined): [number, number] | null {
  // The default viewer stands up and to the right of the shape.
  const fallback: [number, number] = [34.72222 * (72 / 25.4), -34.72222 * (72 / 25.4)];
  if (raw === undefined) return fallback;
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.length > 3) return null;
  const x = parts[0] ? vmlPoints(parts[0]) : fallback[0];
  const y = parts[1] ? vmlPoints(parts[1]) : fallback[1];
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/**
 * The extrusion, null when switched off, `undefined` outside the painted subset: a solid
 * parallel extrusion, unturned.
 *
 * As measured, the back face keeps the shape box and the front face moves away from the
 * viewpoint by a third of the depth on each axis of a diagonal view (`backdepth` times
 * sqrt(2)/3 along the viewpoint direction); `skewangle` and `skewamt` change nothing. A wall's
 * shade is twice `brightness` plus each light's level times the cosine to the light, the
 * lights placed on the page (x right, y down) at a depth equal to their reach; the front face
 * takes a little under half of its own diffuse shade.
 */
export function textArtExtrusion(
  extrusion: TextArtExtrusionModel | undefined
): TextArtExtrusionData | null | undefined {
  if (!extrusion || !on(extrusion.on)) return null;
  const unsupported =
    extrusion.otherAttributes.length ||
    (extrusion.render ?? 'solid') !== 'solid' ||
    (extrusion.foredepth !== undefined && vmlPoints(extrusion.foredepth) !== 0) ||
    (extrusion.rotationangle !== undefined &&
      extrusion.rotationangle.replace(/[\s,0]/g, '') !== '') ||
    (extrusion.orientationangle !== undefined && vmlNumber(extrusion.orientationangle) !== 0) ||
    // A perspective extrusion reaches much further and has not been measured.
    (extrusion.type ?? 'parallel') !== 'parallel';
  if (unsupported) return undefined;
  const depth = extrusion.backdepth === undefined ? 36 : vmlPoints(extrusion.backdepth);
  const view = viewpoint(extrusion.viewpoint);
  const color = extrusion.color === undefined ? null : vmlColor(extrusion.color, '#000000');
  const brightness = level(extrusion.brightness, 20000 / 65536);
  const levels = [
    level(extrusion.lightlevel, 38000 / 65536),
    level(extrusion.lightlevel2, 38000 / 65536),
  ];
  const positions = [
    point3(extrusion.lightposition, [50000, 0, NaN]),
    point3(extrusion.lightposition2, [-50000, 0, NaN]),
  ];
  if (
    !(depth >= 0 && depth <= 1000) ||
    !view ||
    (extrusion.color !== undefined && !color) ||
    !unit(brightness) ||
    !levels.every(unit) ||
    !positions.every((p) => p !== null)
  )
    return undefined;
  const lights: TextArtLightData[] = positions.map((p, i) => {
    const [x, y, z] = p as [number, number, number];
    return {
      x,
      y,
      z: Number.isFinite(z) ? z : Math.max(Math.abs(x), Math.abs(y)),
      level: levels[i]!,
    };
  });
  const length = Math.hypot(view[0], view[1]);
  const reach = (depth * Math.SQRT2) / 3;
  const frontDx = length > 0 ? (-reach * view[0]) / length : 0;
  const frontDy = length > 0 ? (-reach * view[1]) / length : 0;
  return {
    hex: color ? hex(color) : null,
    frontDxPt: frontDx,
    frontDyPt: frontDy,
    ambient: Math.min(1, 2 * brightness),
    lights,
  };
}
