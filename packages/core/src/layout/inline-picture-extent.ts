import { quarterTurned } from '../store/package/drawing-group-transform.ts';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';

/** Quarter-turn inline pictures occupy the rotated extent, before effect insets. */
export function inlinePictureExtent(projection: DrawingProjection): DrawingProjection['extentEmu'] {
  const rotation = projection.picture?.transform.rotationDegrees;
  if (projection.kind === 'inline' && rotation !== undefined && Math.abs(rotation % 180) === 90) {
    const { cx, cy } = projection.extentEmu;
    return { cx: cy, cy: cx };
  }
  return projection.extentEmu;
}

const EMU_PER_POINT = 12_700;

/**
 * How far the turned box of a shape of `width` by `height` reaches past its extent at the top
 * and the bottom, and stays inside it at the left and the right, in points. Zero unless the
 * shape turns nearer a quarter turn.
 */
export function turnedLineInsetPt(
  turnDegrees: number | undefined,
  width: number,
  height: number
): number {
  return turnDegrees !== undefined && quarterTurned(turnDegrees) ? (width - height) / 2 : 0;
}

/**
 * The effect insets of a drawing on its line, in points (`wp:effectExtent`, ECMA-376 Part 1,
 * 20.4.2.6), and the inset its turn adds.
 *
 * An inline shape or group that turns nearer a quarter turn (`a:xfrm/@rot`, 20.1.7.6) takes
 * the room of its turned box on the line: its width and height swap about the centre of its
 * extent. The extent itself keeps its size, since the shape lays out and
 * paints in it before it turns. `turned` is how far the turned box reaches past the extent at
 * the top and the bottom; the left and right insets already hold the same length, taken off.
 * It is negative where the turned box is the shorter one.
 *
 * The turned room adds to the effect extent.
 */
export function inlineEffectInsetsPt(projection: DrawingProjection): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly turned: number;
} {
  const effect = projection.effectExtentEmu;
  const turned =
    projection.kind !== 'inline' || projection.picture
      ? 0
      : turnedLineInsetPt(
          // The same turn the laid-out record publishes: see `inlineTurnedInset`.
          (projection.textboxStory?.legacyFrame?.rotationDegrees || undefined) ??
            projection.vectorShape?.rotationDegrees,
          projection.extentEmu.cx / EMU_PER_POINT,
          projection.extentEmu.cy / EMU_PER_POINT
        );
  return {
    left: effect.left / EMU_PER_POINT - turned,
    right: effect.right / EMU_PER_POINT - turned,
    top: effect.top / EMU_PER_POINT,
    bottom: effect.bottom / EMU_PER_POINT,
    turned,
  };
}
