// Vertical clearance under `wrapTopAndBottom` bands. Extracted from drawing-exclusion so
// that module stays inside its line budget; the rule and its budget are unchanged.

import type { ExclusionZone } from './drawing-exclusion.ts';

/** Maximum rechecks when clearing a line below overlapping topAndBottom bands. */
export const MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS = 8;

function lineIntervalIntersectsTopAndBottomBand(
  lineTop: number,
  lineBottom: number,
  bandTop: number,
  bandBottom: number
): boolean {
  return lineTop < bandBottom && lineBottom > bandTop;
}

/**
 * Vertical skip before placing a line whose [top, bottom] interval intersects a topAndBottom band.
 *
 * Uses the full final line height, unions overlapping band bottoms, and rechecks until clear or
 * {@link MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS} — pre-placement may pass a minimum height; callers
 * must re-run at line close with the styled/drawing final height.
 */
export function topAndBottomSkipBeforeLine(
  lineTopY: number,
  lineHeight: number,
  zones: readonly ExclusionZone[]
): number {
  if (lineHeight <= 0 || zones.length === 0) return 0;
  let skip = 0;
  for (let attempt = 0; attempt < MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS; attempt += 1) {
    const intervalTop = lineTopY + skip;
    const intervalBottom = intervalTop + lineHeight;
    let unionBottom = intervalTop;
    let intersects = false;
    for (const zone of zones) {
      if (zone.input.mode !== 'topAndBottom') continue;
      const bandTop = zone.verticalBand.y;
      const bandBottom = bandTop + zone.verticalBand.height;
      if (
        lineIntervalIntersectsTopAndBottomBand(intervalTop, intervalBottom, bandTop, bandBottom)
      ) {
        intersects = true;
        unionBottom = Math.max(unionBottom, bandBottom);
      }
    }
    if (!intersects) break;
    const nextSkip = unionBottom - lineTopY;
    if (nextSkip <= skip + 0.001) break;
    skip = nextSkip;
  }
  return skip;
}
