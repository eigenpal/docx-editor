import type { InlineDrawingRecord } from './drawing-layout.ts';
import type { LineRecord, StyleSpanRecord } from './semantic-records.ts';

/**
 * The inline picture that owns the caret at `offset`, or null when text owns it.
 *
 * Content that STARTS at an offset owns its caret: a picture there, or else a span. Only when
 * nothing starts there does the picture that ENDS there own it. This is the side a wrap jump
 * puts the caret on, and the text after a picture gets a caret of its own height.
 */
export function drawingAtOffset(
  line: LineRecord,
  offset: number,
  segment?: {
    readonly spans: readonly StyleSpanRecord[];
    readonly drawings: readonly InlineDrawingRecord[];
  } | null
): InlineDrawingRecord | null {
  const drawings = segment?.drawings ?? line.drawings ?? [];
  if (drawings.length === 0) return null;
  const starting = drawings.find((drawing) => drawing.start === offset);
  if (starting) return starting;
  const spans = segment?.spans ?? line.spans;
  const ending = drawings.find((drawing) => drawing.start + 1 === offset);
  if (!ending) return null;
  const owned = spans.some(
    (span) =>
      span.range.paragraphId === ending.paragraphId &&
      span.range.start === offset &&
      span.range.end > offset
  );
  return owned ? null : ending;
}

/**
 * The x of the position before or after an inline picture. A right-to-left picture (odd bidi
 * level) starts at its right edge, so the position after it is on its left.
 */
export function pictureEdgeX(drawing: InlineDrawingRecord, after: boolean): number {
  return after !== pictureIsRtl(drawing) ? drawing.advanceEnd : drawing.advanceStart;
}

/** A picture at an odd bidi level reads right to left. */
export function pictureIsRtl(drawing: InlineDrawingRecord): boolean {
  return (drawing.bidiLevel ?? 0) % 2 === 1;
}
