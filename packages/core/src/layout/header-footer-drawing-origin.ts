import type { AnchoredDrawingRecord } from './drawing-layout.ts';

/** Resolve a header/footer anchor origin across mixed page- and story-relative axes. @internal */
export function headerFooterAnchoredDrawingOrigin(
  drawing: AnchoredDrawingRecord,
  storyOrigin: Readonly<{ x: number; y: number }>,
  pageOrigin: Readonly<{ x: number; y: number }>
): Readonly<{ x: number; y: number }> {
  return Object.freeze({
    x:
      drawing.horizontalFrame === 'page'
        ? pageOrigin.x + drawing.x - drawing.horizontalFrameOrigin
        : storyOrigin.x + drawing.x,
    y:
      drawing.verticalFrame === 'page'
        ? pageOrigin.y + drawing.y - drawing.verticalFrameOrigin
        : storyOrigin.y + drawing.y,
  });
}
