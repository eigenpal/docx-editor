// Placement of a text box whose unwrapped story sizes the box width.

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
  if (story?.extentWidth === undefined) return projection;
  const cx = Math.round(story.extentWidth * EMU_PER_POINT);
  if (cx === projection.extentEmu.cx) return projection;
  return Object.freeze({
    ...projection,
    extentEmu: Object.freeze({ ...projection.extentEmu, cx }),
  });
}
