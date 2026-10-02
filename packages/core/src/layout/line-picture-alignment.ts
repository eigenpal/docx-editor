import { shiftInlineDrawingRecord, type InlineDrawingRecord } from './drawing-layout.ts';
import { alignDrawings } from './pending-line.ts';
import type { StyleSpanRecord } from './semantic-records.ts';

const OBJECT_REPLACEMENT = '￼';

/**
 * Align a line's text and its inline pictures together.
 *
 * Alignment and bidi reordering work on spans. On a line whose text bidi resolution shaped,
 * each picture joins them as a stand-in span: its U+FFFC, its own resolved level, and its
 * advance as its width. It then reorders with the text around it, so a picture in a
 * right-to-left paragraph stands to the right of the text that follows it. Each picture moves
 * to where its stand-in landed, and the stand-ins leave the line again.
 *
 * A line with no shaped text keeps its logical order, so its pictures move by the line's
 * alignment offset alone, as they always have.
 */
export function alignLineWithPictures(
  placedSpans: readonly StyleSpanRecord[],
  placedDrawings: readonly InlineDrawingRecord[],
  align: (spans: readonly StyleSpanRecord[]) => readonly StyleSpanRecord[],
  offsetOf: (alignedSpans: readonly StyleSpanRecord[]) => number
): {
  readonly spans: readonly StyleSpanRecord[];
  readonly drawings: readonly InlineDrawingRecord[];
  readonly offset: number;
} {
  const template = placedSpans.find((span) => span.style.shaping);
  if (!template?.style.shaping || placedDrawings.length === 0) {
    const spans = align(placedSpans);
    const offset = offsetOf(spans);
    return { spans, offset, drawings: alignDrawings(placedDrawings, offset) };
  }
  const baseLevel = template.style.shaping.baseLevel;
  const groupsByRun = template.style.shaping.runDirection !== undefined;
  const standIns = placedDrawings.map((drawing): StyleSpanRecord => {
    const level = drawing.bidiLevel ?? baseLevel;
    const direction = level % 2 ? ('rtl' as const) : ('ltr' as const);
    return {
      range: { paragraphId: drawing.paragraphId, start: drawing.start, end: drawing.start + 1 },
      text: OBJECT_REPLACEMENT,
      props: [],
      style: {
        ...template.style,
        shaping: {
          script: 'Zyyy',
          direction,
          level,
          baseLevel,
          // Lines that group text by run direction read a picture in its resolved direction.
          ...(groupsByRun ? { runDirection: direction } : {}),
        },
      },
      box: {
        x: drawing.advanceStart,
        y: template.box.y,
        width: Math.max(0, drawing.advanceEnd - drawing.advanceStart),
        height: 0,
      },
    };
  });
  // Spans and pictures in model order: the order bidi reordering reads them in.
  const merged = [...placedSpans, ...standIns].sort(
    (left, right) => left.range.start - right.range.start
  );
  const aligned = align(merged);
  const pictureStarts = new Set(placedDrawings.map((drawing) => drawing.start));
  const isStandIn = (span: StyleSpanRecord) =>
    span.text === OBJECT_REPLACEMENT &&
    span.range.end - span.range.start === 1 &&
    pictureStarts.has(span.range.start);
  const landed = new Map<number, number>();
  for (const span of aligned) if (isStandIn(span)) landed.set(span.range.start, span.box.x);
  const spans = aligned.filter((span) => !isStandIn(span));
  const drawings = placedDrawings.map((drawing) =>
    shiftInlineDrawingRecord(
      drawing,
      (landed.get(drawing.start) ?? drawing.advanceStart) - drawing.advanceStart,
      0
    )
  );
  return { spans, drawings, offset: offsetOf(spans) };
}
