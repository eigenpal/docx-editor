// Where an inline drawing sits once its line's baseline is known.

import { shiftGeometry } from './inline-drawing-clip.ts';
import type { InlineDrawingRecord } from './drawing-layout.ts';
import { turnedLineInsetPt } from './inline-picture-extent.ts';

/**
 * How far the turned box of an inline shape or group reaches above and below its extent on the
 * line, in points: positive where the turned box is the taller one, negative where it is the
 * shorter one, and zero unless the shape turns nearer a quarter turn.
 */
export function inlineTurnedInset(
  drawing: Pick<InlineDrawingRecord, 'textboxStory' | 'vectorShape' | 'width' | 'height'>
): number {
  const turn = drawing.textboxStory?.chromeRotationDegrees ?? drawing.vectorShape?.rotationDegrees;
  return turnedLineInsetPt(turn, drawing.width, drawing.height);
}

/** The bottom of an inline drawing on its line: of its turned box, when it has one. */
export function inlineDrawingBottom(drawing: InlineDrawingRecord): number {
  return drawing.y + drawing.height + inlineTurnedInset(drawing);
}

/**
 * The line's inline drawings with their bottom on `baseline`. A shape that turns nearer a
 * quarter turn sits with the bottom of its turned box there (see `inlineEffectInsetsPt`).
 */
export function repositionInlineDrawingsForBaseline(
  drawings: readonly InlineDrawingRecord[],
  baseline: number
): readonly InlineDrawingRecord[] {
  if (drawings.length === 0) return drawings;
  return drawings.map((drawing) => {
    const effectB = drawing.geometry.effectInsets.bottom + inlineTurnedInset(drawing);
    const extentTopY = baseline - drawing.height - effectB - (drawing.runPositionPt ?? 0);
    const dy = extentTopY - drawing.y;
    if (Math.abs(dy) < 0.000_1 && drawing.baselineOffset === baseline) return drawing;
    return Object.freeze({
      ...drawing,
      y: extentTopY,
      baselineOffset: baseline,
      geometry: shiftGeometry(drawing.geometry, 0, dy),
      paintBounds: Object.freeze({ ...drawing.paintBounds, y: drawing.paintBounds.y + dy }),
      hitBounds: Object.freeze({ ...drawing.hitBounds, y: drawing.hitBounds.y + dy }),
    });
  });
}
