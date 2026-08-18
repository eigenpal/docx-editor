// Where an offset sits ACROSS a line, in points.
//
// Split out because two lanes need it and neither owns the other: caret stops ask it for a
// position, selection rectangles ask it for the ends of a range. Both must ask it about ONE
// paragraph's share of the line, which is what the segment argument is for.

import { spanOffsetX } from './semantic-hit-test.ts';
import type { LineSegment } from './line-segments.ts';
import type { LineRecord, TextMeasurer } from './semantic-records.ts';

export /** The x offset of `offset` within a line, by walking its spans. */
function xWithinLine(
  line: LineRecord,
  offset: number,
  measurer?: TextMeasurer | undefined,
  segment?: LineSegment
): number {
  // An offset only means something in ONE paragraph, so a mixed line is walked through the
  // segment that owns it. Given none, the line is its own segment, which is every ordinary
  // line and the path this function always took.
  const spans = segment ? segment.spans : line.spans;
  for (const drawing of segment ? segment.drawings : (line.drawings ?? [])) {
    if (offset === drawing.start) return drawing.advanceStart;
    if (offset === drawing.start + 1) return drawing.advanceEnd;
  }
  let x = segment ? (segment.spans[0]?.box.x ?? line.contentX) : line.contentX;
  for (const span of spans) {
    if (offset <= span.range.start) return span.box.x;
    if (offset >= span.range.end) {
      x = span.box.x + span.box.width;
      continue;
    }
    // MEASURED, not interpolated. Interpolating across the span's advance is exact only for a
    // uniform one — in any proportional face it draws the caret a fraction of the way through
    // the span rather than at a glyph edge, so a caret between two letters appeared on top of
    // one. Without a measurer it still interpolates, and says so.
    return spanOffsetX(span, offset, measurer);
  }
  return x;
}
