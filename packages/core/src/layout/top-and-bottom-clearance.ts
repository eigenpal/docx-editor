// Vertical clearance under `wrapTopAndBottom` bands. Extracted from drawing-exclusion so
// that module stays inside its line budget; the rule and its budget are unchanged.

import type { ExclusionZone } from './drawing-exclusion.ts';
import { emuToPointsSafe } from './drawing-layout.ts';

/** Maximum rechecks when clearing a line below overlapping topAndBottom bands. */
export const MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS = 8;

function lineIntervalIntersectsTopAndBottomBand(
  lineTop: number,
  lineBottom: number,
  bandTop: number,
  bandBottom: number
): boolean {
  // A line that only touches the band stays. The two edges come from separate float sums, so
  // an exact comparison moved a line whose bottom equals a band top by rounding alone.
  return lineTop < bandBottom - TOUCH_TOLERANCE_PT && lineBottom > bandTop + TOUCH_TOLERANCE_PT;
}

const TOUCH_TOLERANCE_PT = 0.01;

/**
 * Vertical skip before placing a line whose [top, bottom] interval intersects a topAndBottom band.
 *
 * Uses the full final line height, unions overlapping band bottoms, and rechecks until clear or
 * {@link MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS} — pre-placement may pass a minimum height; callers
 * must re-run at line close with the styled/drawing final height.
 *
 * `spaceAbove` is the paragraph spacing above a paragraph's first line. A drawing's band that
 * crosses that spacing or the line moves the line to the band bottom, and the line keeps its
 * spacing below the band. Floating tables, frames, and header or footer objects keep the plain
 * rule.
 */
export function topAndBottomSkipBeforeLine(
  lineTopY: number,
  lineHeight: number,
  zones: readonly ExclusionZone[],
  spaceAbove = 0
): number {
  if (lineHeight <= 0 || zones.length === 0) return 0;
  let skip = 0;
  if (spaceAbove > 0.001) {
    let spacedBottom = -Infinity;
    for (const zone of zones) {
      // Only a drawing's band. The line after a floating table or frame starts at its bottom.
      if (zone.input.mode !== 'topAndBottom' || zone.sourceKind) continue;
      const bandTop = zone.verticalBand.y;
      const bandBottom = bandTop + zone.verticalBand.height;
      if (
        lineIntervalIntersectsTopAndBottomBand(
          lineTopY - spaceAbove,
          lineTopY + lineHeight,
          bandTop,
          bandBottom
        )
      )
        spacedBottom = Math.max(spacedBottom, bandBottom);
    }
    if (spacedBottom > -Infinity) skip = Math.max(0, spacedBottom + spaceAbove - lineTopY);
  }
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

/**
 * How much of the first placed line's topAndBottom skip this paragraph's own anchor caused.
 *
 * The placement skip mixes two sources: bands inherited from earlier paragraphs, which
 * genuinely move this paragraph down the page, and a band from an anchor inside it, which
 * only moves its text away from a picture pinned to the paragraph origin. Re-running the
 * clearance with the inherited zones alone isolates the second. `spaceAbove` must be the
 * spacing the placed line kept, so both runs apply the same rule.
 */
export function ownTopAndBottomSkip(
  applied: number,
  paragraphStartY: number,
  firstLine: { readonly box: { readonly height: number } } | undefined,
  context: { readonly inheritedZones: readonly ExclusionZone[]; readonly spaceAbove: number }
): number {
  if (!firstLine || applied <= 0.001) return 0;
  const inherited = topAndBottomSkipBeforeLine(
    paragraphStartY,
    firstLine.box.height,
    context.inheritedZones,
    context.spaceAbove
  );
  return Math.max(0, applied - inherited);
}

/**
 * Story y where a `wp:wrapTopAndBottom` band starts: the drawing's own top, not the anchor line's.
 *
 * The band clears the drawing, so it begins where the drawing begins. A `wp:positionV` whose frame
 * is the anchor's own flow position (`paragraph` or `line`) displaces the drawing down by
 * `wp:posOffset`, and the band with it — the painted geometry already applies that offset. Frames
 * that resolve against the page or its margins do not start at the anchor, and an alignment needs a
 * frame box the paragraph does not know while it is breaking; both keep the anchor line top.
 */
export function topAndBottomBandAnchorY(
  anchorLineY: number,
  vertical: Readonly<{
    relativeFrom: string;
    align: string | null;
    offsetEmu: number | null;
  }> | null
): number {
  if (!vertical || vertical.align !== null) return anchorLineY;
  if (vertical.relativeFrom !== 'paragraph' && vertical.relativeFrom !== 'line') return anchorLineY;
  const offset = emuToPointsSafe(vertical.offsetEmu ?? 0);
  if (offset === null) return anchorLineY;
  return anchorLineY + offset;
}
