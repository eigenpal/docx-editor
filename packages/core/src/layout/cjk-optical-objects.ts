// Inline objects (`wp:inline` in `w:drawing`, or `w:pict`) on a line that East Asian punctuation
// fitting (`w:characterSpacingControl`) compresses.
import { automaticTextSpacingBefore } from './cjk-automatic-spacing.ts';
import { shiftInlineDrawingRecord, type InlineDrawingRecord } from './drawing-layout.ts';
import type { PendingLine } from './pending-line.ts';
import type { StyleSpanRecord } from './semantic-records.ts';

const TOLERANCE = 0.001;
const NONE: readonly InlineDrawingRecord[] = Object.freeze([]);

/**
 * The inline objects of a line in source order, from the first one after the line's first text.
 * An object keeps its advance, including its distances from text (`wp:inline` `distL`/`distR`);
 * the text around it compresses, and the object moves with the text before it. Its baseline
 * offset (`w:position`) does not change. Returns undefined when the line cannot fit: a passage beside a float, a
 * right-to-left or unplaced object, or text that does not run on from the previous text or object.
 */
export function lineObjectsInFlow(
  line: PendingLine,
  candidates: readonly StyleSpanRecord[]
): readonly InlineDrawingRecord[] | undefined {
  if (
    line.drawings.length &&
    (line.wrapSegment ||
      line.wrapPassages ||
      line.drawings.some(
        (drawing) =>
          drawing.bidiLevel ||
          !Number.isFinite(drawing.start) ||
          !Number.isFinite(drawing.advanceStart) ||
          !Number.isFinite(drawing.advanceEnd)
      ))
  )
    return undefined;
  const firstStart = line.spans[0]?.range.start ?? candidates[0]?.range.start ?? 0;
  const objects = line.drawings.length
    ? line.drawings
        .filter((drawing) => drawing.start >= firstStart)
        .sort((left, right) => left.start - right.start)
    : NONE;
  let next = 0;
  for (let index = 1; index <= line.spans.length; index++) {
    const previous = line.spans[index - 1]!;
    const current = line.spans[index] ?? candidates[0];
    let end = previous.box.x + previous.box.width;
    for (
      ;
      next < objects.length && (!current || objects[next]!.start < current.range.start);
      next++
    ) {
      if (Math.abs(objects[next]!.advanceStart - end) > TOLERANCE) return undefined;
      end = objects[next]!.advanceEnd;
    }
    if (index === line.spans.length) break;
    // Do not redistribute spacing across separate float passages.
    const gap = automaticTextSpacingBefore(current!);
    if (!Number.isFinite(gap) || gap < 0 || Math.abs(end + gap - current!.box.x) > TOLERANCE)
      return undefined;
  }
  return objects;
}

/** Places each object at the running x of a fitted line, before the text that follows it. */
export function createObjectPlacer(objects: readonly InlineDrawingRecord[]) {
  const placed = new Map<InlineDrawingRecord, InlineDrawingRecord>();
  let next = 0;
  return {
    /** Places the objects before `start` from `x`; returns the x after them. */
    before(start: number, x: number): number {
      for (; next < objects.length && objects[next]!.start < start; next++) {
        const object = objects[next]!;
        placed.set(object, shiftInlineDrawingRecord(object, x - object.advanceStart, 0));
        x += object.advanceEnd - object.advanceStart;
      }
      return x;
    },
    /** Writes the placed objects into the line. */
    commit(line: PendingLine): void {
      line.drawings.forEach((drawing, index) => {
        line.drawings[index] = placed.get(drawing) ?? drawing;
      });
    },
  };
}
