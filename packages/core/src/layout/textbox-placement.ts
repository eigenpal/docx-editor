// Placement of a text box whose story sizes the box: an unwrapped story sets its width, and
// a legacy story that fits its shape sets its height.

import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import type { TextboxStoryLayout } from './textbox-story-layout.ts';

const EMU_PER_POINT = 12_700;

/**
 * The projection that places a text box whose unwrapped story sized its own width.
 *
 * Only the extent width changes, so frame alignment (center, right, inside, outside) resolves
 * against the box the text actually occupies. Returns the input unchanged otherwise.
 */
export function textboxPlacementProjection(
  projection: DrawingProjection,
  story: TextboxStoryLayout | null | undefined
): DrawingProjection {
  if (story?.extentWidth === undefined && story?.extentHeight === undefined) return projection;
  const cx =
    story.extentWidth === undefined
      ? projection.extentEmu.cx
      : Math.round(story.extentWidth * EMU_PER_POINT);
  const cy =
    story.extentHeight === undefined
      ? projection.extentEmu.cy
      : Math.round(story.extentHeight * EMU_PER_POINT);
  if (cx === projection.extentEmu.cx && cy === projection.extentEmu.cy) return projection;
  return Object.freeze({
    ...projection,
    extentEmu: Object.freeze({ cx, cy }),
  });
}
