/**
 * Adapter-local unit arithmetic, derived directly from the OOXML and CSS
 * definitions of the units involved:
 *
 * - A twip is a twentieth of a point (ECMA-376 "twentieths of a point"),
 *   and a point is 1/72 inch, so 1 inch = 20 × 72 = 1440 twips.
 * - CSS defines 1 inch = 96 px.
 * - `w:sz` and friends measure font size in half-points, so 2 half-points = 1 point.
 *
 * Presentation-only: the chrome converts engine twips to CSS pixels for
 * painting rulers and pickers. Nothing here reads engine state.
 */

/** 20 twips per point × 72 points per inch. */
export const TWIPS_PER_INCH = 1440;

/** CSS reference pixel density: 96 px per inch. */
export const PIXELS_PER_INCH = 96;

export function twipsToPixels(twips: number): number {
  return (twips / TWIPS_PER_INCH) * PIXELS_PER_INCH;
}

export function pixelsToTwips(px: number): number {
  return (px / PIXELS_PER_INCH) * TWIPS_PER_INCH;
}

/** A CSS length string rounded to two decimals, e.g. `"12.5px"`. */
export function formatPx(px: number): string {
  return `${Math.round(px * 100) / 100}px`;
}

/** OOXML half-points (`w:sz`) to points. */
export function halfPointsToPoints(halfPoints: number): number {
  return halfPoints / 2;
}

/** Points to OOXML half-points (`w:sz`), rounded to the nearest half-point. */
export function pointsToHalfPoints(points: number): number {
  return Math.round(points * 2);
}
