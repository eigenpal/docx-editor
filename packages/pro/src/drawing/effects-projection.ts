/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The effects model as paint: the components the engine draws for a glow, an inner shadow and
// a dark-edged bevel rim, and the reflection and soft edge a picture paints with.
//
// This is the effects renderer `installDrawing` installs. The engine calls it once per shape
// or picture, with the effect list it already resolved for the outer shadow, so a shape
// without effects costs two direct-child lookups.

import type {
  DrawingEffectsRenderer,
  PictureEffectsProjection,
  ShapeReflection,
  ShapeShadow,
  VectorShapeComponent,
} from '@docx-editor.dev/core/store';
import {
  hasDrawingEffects,
  readDrawingEffects,
  type DrawingEffectsModel,
  type GlowModel,
  type InnerShadowModel,
  type ReflectionModel,
} from './effects-model.ts';

type Point = Readonly<{ x: number; y: number }>;
type Subpaths = readonly (readonly Point[])[];

/** A glow the painters can draw: a soft halo of one colour around the shape. */
export interface ShapeGlow {
  readonly radiusEmu: number;
  readonly hex: string;
  readonly alpha: number;
}

/** The glow to paint, or null when the model's glow paints nothing. */
export function glowOf(glow: GlowModel | null): ShapeGlow | null {
  const color = glow?.color?.color;
  if (!glow || !color || color.alpha <= 0 || glow.rad <= 0) return null;
  return { radiusEmu: glow.rad, hex: color.hex, alpha: color.alpha };
}

/** The inner shadow to paint, or null when it paints nothing. */
export function innerShadowOf(inner: InnerShadowModel | null): ShapeShadow | null {
  if (!inner) return null;
  // A shadow with no colour is black at full strength (ECMA-376 20.1.8.40).
  const color = inner.color ? inner.color.color : { hex: '000000', alpha: 1 };
  if (!color || color.alpha <= 0) return null;
  const radians = ((inner.dir / 60_000) * Math.PI) / 180;
  return {
    dxEmu: inner.dist * Math.cos(radians),
    dyEmu: inner.dist * Math.sin(radians),
    blurEmu: inner.blurRad,
    hex: color.hex,
    alpha: color.alpha,
  };
}

/**
 * The reflection to paint, or null when it has a form outside the painted subset: a straight
 * mirror image below the shape (`sy` -100%, no skew or horizontal scale), fading downward.
 */
export function reflectionOf(reflection: ReflectionModel | null): ShapeReflection | null {
  if (!reflection) return null;
  const { sx, sy, stA, stPos, endA, endPos, algn } = reflection;
  if (
    sx !== 1 ||
    sy !== -1 ||
    reflection.kx !== 0 ||
    reflection.ky !== 0 ||
    reflection.dir !== 5_400_000 ||
    reflection.fadeDir !== 5_400_000 ||
    stPos !== 0 ||
    (algn !== 'b' && algn !== 'bl' && algn !== 'br') ||
    stA === null ||
    endA === null ||
    endPos === null ||
    endPos <= 0
  ) {
    return null;
  }
  return {
    startAlpha: Math.max(0, Math.min(1, stA)),
    endAlpha: Math.max(0, Math.min(1, endA)),
    endPosition: Math.min(1, endPos),
    distanceEmu: reflection.dist,
    blurEmu: reflection.blurRad,
  };
}

/** The rim a dark-edged bevel shows, as an outline inside the shape. */
const DARK_EDGE = Object.freeze({ hex: '000000', alpha: 0.55 });
const DEFAULT_BEVEL_WIDTH_EMU = 76_200;

/**
 * The dark rim of a `dkEdge` bevel (`a:sp3d prstMaterial="dkEdge"` with `a:bevelT` or
 * `a:bevelB`): an inset outline as wide as the bevel, between 0.25 pt and 2 pt. Lit bevel
 * faces and other materials are not drawn.
 */
export function darkEdgeOf(
  model: DrawingEffectsModel
): { readonly widthEmu: number; readonly hex: string; readonly alpha: number } | null {
  const bevel = model.bevel;
  if (!bevel || bevel.prstMaterial !== 'dkEdge' || !bevel.bevel) return null;
  const width = bevel.bevel.w || DEFAULT_BEVEL_WIDTH_EMU;
  return { widthEmu: Math.max(3_175, Math.min(25_400, width)), ...DARK_EDGE };
}

/**
 * An inner shadow as a component that paints only its shadow, clipped to the shape: the
 * shadow of a frame around the shape, so it falls inside along the edges its direction
 * points to.
 */
export function innerShadowComponent(
  shadow: ShapeShadow,
  subpathsEmu: Subpaths,
  extent: Readonly<{ cx: number; cy: number }>
): VectorShapeComponent {
  const margin = Math.abs(shadow.dxEmu) + Math.abs(shadow.dyEmu) + shadow.blurEmu * 2 + 1;
  const frame = [
    { x: -margin, y: -margin },
    { x: extent.cx + margin, y: -margin },
    { x: extent.cx + margin, y: extent.cy + margin },
    { x: -margin, y: extent.cy + margin },
  ];
  return {
    subpathsEmu: [frame, ...subpathsEmu],
    subpathsClosed: [true, ...subpathsEmu.map(() => true)],
    fillHex: shadow.hex,
    fillAlpha: 1,
    strokeHex: null,
    strokeAlpha: 1,
    strokeWidthEmu: 0,
    // The shadow falls on the side its direction points to: the frame moves the other way.
    // An inner shadow's blur spreads twice as far as an outer one's.
    shadow: { ...shadow, dxEmu: -shadow.dxEmu, dyEmu: -shadow.dyEmu, blurEmu: shadow.blurEmu * 2 },
    shadowOnly: true,
    clipEmu: subpathsEmu,
  };
}

/**
 * A glow as a component that paints only its shadow: the outline of `subpathsEmu` widened by
 * half the glow radius and blurred with a standard deviation of a sixth of it, which puts the
 * halo's half-strength edge half the radius out and its last trace at the radius.
 */
export function glowComponent(
  glow: ShapeGlow,
  subpathsEmu: Subpaths,
  subpathsClosed: readonly boolean[],
  filled: boolean,
  /** The width of the outline the glow surrounds, for an unfilled shape such as a line. */
  baseWidthEmu = 0
): VectorShapeComponent {
  return {
    subpathsEmu,
    subpathsClosed,
    fillHex: filled ? glow.hex : null,
    fillAlpha: 1,
    strokeHex: glow.hex,
    strokeAlpha: 1,
    strokeWidthEmu: glow.radiusEmu + baseWidthEmu,
    strokeJoin: 'round',
    strokeCap: 'round',
    shadow: {
      dxEmu: 0,
      dyEmu: 0,
      blurEmu: (glow.radiusEmu * 2) / 3,
      hex: glow.hex,
      alpha: glow.alpha,
    },
    shadowOnly: true,
  };
}

/** Whether a closed path encloses any area (shoelace), so that clipping to it leaves ink. */
function enclosesArea(points: readonly Point[]): boolean {
  let twiceArea = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    twiceArea += a.x * b.y - b.x * a.y;
    minX = Math.min(minX, a.x);
    maxX = Math.max(maxX, a.x);
    minY = Math.min(minY, a.y);
    maxY = Math.max(maxY, a.y);
  }
  // Relative to the path's own box; what remains below this is rounding on a collinear path.
  const box = (maxX - minX) * (maxY - minY);
  return box > 0 && Math.abs(twiceArea) > box * 1e-9;
}

const closedFlags = (components: readonly VectorShapeComponent[]) =>
  components.flatMap((component) =>
    component.subpathsEmu.map((_, index) => component.subpathsClosed?.[index] !== false)
  );

/** A shape's components with its inner shadow, glow and bevel rim added in paint order. */
export function decorateShapeComponents(
  model: DrawingEffectsModel,
  input: readonly VectorShapeComponent[],
  extent: Readonly<{ cx: number; cy: number }>
): readonly VectorShapeComponent[] {
  const components = [...input];
  // An inner shadow paints over the fill, inside the filled paths.
  const inner = innerShadowOf(model.innerShadow);
  const filled = components.find(
    (component) => !component.shadowOnly && component.fillHex !== null
  );
  if (inner && filled) {
    components.splice(
      components.indexOf(filled) + 1,
      0,
      innerShadowComponent(inner, filled.subpathsEmu, extent)
    );
  }
  // A glow paints under everything else: around the filled paths, or around a line.
  const glow = glowOf(model.glow);
  const painted = components.filter((component) => !component.shadowOnly);
  if (glow && painted.length) {
    const fills = painted.filter((component) => component.fillHex !== null);
    const casters = fills.length ? fills : painted;
    components.unshift(
      glowComponent(
        glow,
        casters.flatMap((component) => component.subpathsEmu),
        closedFlags(casters),
        fills.length > 0,
        fills.length
          ? 0
          : casters.reduce((widest, component) => Math.max(widest, component.strokeWidthEmu), 0)
      )
    );
  }
  // A dark-edged bevel shows a rim inside the filled outline; it paints over the fill.
  const edge = darkEdgeOf(model);
  const body = edge
    ? components.find(
        (component) =>
          component.fillHex !== null &&
          component.subpathsClosed?.every(Boolean) !== false &&
          component.subpathsEmu.every(enclosesArea)
      )
    : undefined;
  if (edge && body) {
    components.push({
      subpathsEmu: body.subpathsEmu,
      subpathsClosed: body.subpathsClosed,
      fillHex: null,
      fillAlpha: 1,
      strokeHex: edge.hex,
      strokeAlpha: edge.alpha,
      strokeWidthEmu: edge.widthEmu,
      strokeInset: true,
    });
  }
  return components;
}

/** A picture's reflection, soft edge and glow. Null when it has none. */
export function pictureEffects(
  model: DrawingEffectsModel,
  outlineEmu: Subpaths | null
): PictureEffectsProjection | null {
  const reflection = reflectionOf(model.reflection);
  const softEdgeEmu = model.softEdge?.rad ?? 0;
  const glow = glowOf(model.glow);
  const halo =
    glow && outlineEmu?.length
      ? glowComponent(
          glow,
          outlineEmu,
          outlineEmu.map(() => true),
          true
        )
      : null;
  if (!reflection && !(softEdgeEmu > 0) && !halo) return null;
  return {
    ...(reflection || softEdgeEmu > 0
      ? {
          effects: {
            ...(reflection ? { reflection } : {}),
            ...(softEdgeEmu > 0 ? { softEdgeEmu } : {}),
          },
        }
      : {}),
    ...(halo ? { underComponents: [halo] } : {}),
  };
}

/** The effects renderer `installDrawing` installs. */
const renderer: DrawingEffectsRenderer = {
  shape({ spPr, effectList, components, extent, resolveSchemeColor }) {
    const model = readDrawingEffects(spPr, effectList, resolveSchemeColor);
    return hasDrawingEffects(model)
      ? decorateShapeComponents(model, components, extent)
      : components;
  },
  picture({ spPr, effectList, outlineEmu, resolveSchemeColor }) {
    const model = readDrawingEffects(spPr, effectList, resolveSchemeColor);
    return hasDrawingEffects(model) ? pictureEffects(model, outlineEmu) : null;
  },
};
export const drawingEffectsRenderer: DrawingEffectsRenderer = Object.freeze(renderer);
