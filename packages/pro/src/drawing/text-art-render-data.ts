/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The data a text art projection carries for the text art layout (`text-art-layout.ts`):
// plain JSON values, so two projections of the same markup compare equal.

/** A colour stop: offset in [0, 1] along the gradient, `RRGGBB`, opacity. */
export interface TextArtStop {
  readonly offset: number;
  readonly hex: string;
  readonly alpha: number;
}

/** How the text is filled. */
export type TextArtFillData =
  | { readonly kind: 'solid'; readonly hex: string; readonly alpha: number }
  /** A gradient down the box from its top edge, turned clockwise by `angle` degrees. */
  | { readonly kind: 'linear'; readonly angle: number; readonly stops: readonly TextArtStop[] };

/** The outline of the text. */
export interface TextArtStrokeData {
  readonly hex: string;
  readonly alpha: number;
  readonly widthPt: number;
}

/** A shadow: the text's silhouette offset on the page. */
export interface TextArtShadowData {
  readonly hex: string;
  readonly alpha: number;
  readonly dxPt: number;
  readonly dyPt: number;
}

/** A light on the extruded text, on the page: x right, y down, z to the viewer. */
export interface TextArtLightData {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Intensity in [0, 1]. */
  readonly level: number;
}

/** The 3-D extrusion of the text, drawn in a parallel projection. */
export interface TextArtExtrusionData {
  /** `RRGGBB` of the sides, or null to use the text's fill colour. */
  readonly hex: string | null;
  /** The front face's page offset from the box, in points; the back face keeps the box. */
  readonly frontDxPt: number;
  readonly frontDyPt: number;
  /** Ambient light in [0, 1]. */
  readonly ambient: number;
  readonly lights: readonly TextArtLightData[];
}

/**
 * Everything the layout reads besides the core projection.
 *
 * `guides` are the text path's subpaths in the unit square of the box, each a flat list of
 * x, y pairs. Two guides lay the text between them, top and bottom; one lays it along itself.
 */
export interface TextArtRenderData {
  readonly guides: readonly (readonly number[])[];
  /** `font-size` of the text path, in points: the text size along a single guide. */
  readonly fontSizePt: number;
  readonly fill: TextArtFillData | null;
  readonly stroke: TextArtStrokeData | null;
  readonly shadow: TextArtShadowData | null;
  readonly extrusion: TextArtExtrusionData | null;
}

/** The render data a projection carries, when it is this module's. */
export function textArtRenderData(value: unknown): TextArtRenderData | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<TextArtRenderData>;
  return Array.isArray(data.guides) && typeof data.fontSizePt === 'number'
    ? (value as TextArtRenderData)
    : null;
}
