import { shiftInlineDrawingRecord, type InlineDrawingRecord } from './drawing-layout.ts';
import { alignDrawings } from './pending-line.ts';
import type { StyleSpanRecord } from './semantic-records.ts';
import { DEFAULT_RUN_STYLE } from './run-style.ts';

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
 * A line with no shaped text and no resolved pictures keeps its logical order, so its
 * pictures move by the line's alignment offset alone. A line of pictures only in a
 * right-to-left paragraph still reorders, so its pictures read right to left.
 */
export function alignLineWithPictures(
  placedSpans: readonly StyleSpanRecord[],
  placedDrawings: readonly InlineDrawingRecord[],
  paragraphRtl: boolean,
  align: (spans: readonly StyleSpanRecord[]) => readonly StyleSpanRecord[],
  offsetOf: (alignedSpans: readonly StyleSpanRecord[]) => number
): {
  readonly spans: readonly StyleSpanRecord[];
  readonly drawings: readonly InlineDrawingRecord[];
  readonly offset: number;
} {
  const template = placedSpans.find((span) => span.style.shaping);
  const resolved =
    template !== undefined || placedDrawings.some((drawing) => drawing.bidiLevel !== undefined);
  if (!resolved || placedDrawings.length === 0) {
    const spans = align(placedSpans);
    const offset = offsetOf(spans);
    return { spans, offset, drawings: alignDrawings(placedDrawings, offset) };
  }
  const baseLevel = template?.style.shaping?.baseLevel ?? (paragraphRtl ? 1 : 0);
  const groupsByRun = template?.style.shaping?.runDirection !== undefined;
  const templateStyle = template?.style ?? placedSpans[0]?.style ?? DEFAULT_RUN_STYLE;
  const standIns = placedDrawings.map((drawing): StyleSpanRecord => {
    const level = drawing.bidiLevel ?? baseLevel;
    const direction = level % 2 ? ('rtl' as const) : ('ltr' as const);
    return {
      range: { paragraphId: drawing.paragraphId, start: drawing.start, end: drawing.start + 1 },
      text: OBJECT_REPLACEMENT,
      props: [],
      style: {
        ...templateStyle,
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
        y: drawing.y,
        width: Math.max(0, drawing.advanceEnd - drawing.advanceStart),
        height: 0,
      },
    };
  });
  // Spans and pictures in model order: the order bidi reordering reads them in.
  const sorted = [...placedSpans, ...standIns].sort(
    (left, right) => left.range.start - right.range.start
  );
  // A float's jump before a picture splits the line into passages, which reorder apart. Spans
  // already carry theirs; a stand-in carries the room left after the content before it.
  const merged = sorted.map((span, index) => {
    const previous = sorted[index - 1];
    if (span.text !== OBJECT_REPLACEMENT || !previous) return span;
    const jump = span.box.x - (previous.box.x + previous.box.width);
    return jump > 0.001 ? { ...span, wrapAdvanceBefore: jump } : span;
  });
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
