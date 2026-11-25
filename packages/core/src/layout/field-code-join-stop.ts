// Where the two sides of field codes that hold paragraph marks meet on one line.
//
// The paragraph that holds a field's `begin` and the paragraph where its field codes end lay
// out as one merged line (`field-code-paragraph-merge.ts`; ECMA-376 Part 1, 17.16.18,
// CT_FldChar). On that line the end of the first side and the start of the result side are
// one place, so the caret has one stop there. That holds only while the two positions paint
// at the same spot: when the result side starts a wrapped line, or the two sides run in
// opposite directions, each keeps its own stop. Caret stops and the caret's shown position
// both ask this one rule, so they never disagree.

import { xWithinLine } from './line-geometry.ts';
import { joinStartHidden } from './merged-paragraph-ranges.ts';
import { paragraphLinesFor } from './paragraph-lines.ts';
import { lineSegmentFor, lineSegments, type LineSegment } from './line-segments.ts';
import type { LineRecord, SemanticLayout, TextMeasurer } from './semantic-records.ts';

/** Painted x positions closer than this are the same caret spot. */
const SAME_SPOT = 0.5;

/**
 * Whether the start of `segment`, the result side of a field-code merge on `line`, shares one
 * caret stop with the end of the segment drawn directly before it.
 */
export function joinStopShared(
  line: LineRecord,
  segment: LineSegment,
  measurer?: TextMeasurer
): boolean {
  if (segment.start !== 0 || !joinStartHidden(line, segment.paragraphId)) return false;
  const segments = lineSegments(line);
  const index = segments.findIndex((entry) => entry.paragraphId === segment.paragraphId);
  const before = index > 0 ? segments[index - 1] : undefined;
  if (!before) return false;
  const start = xWithinLine(line, 0, measurer, segment);
  const end = xWithinLine(line, before.end, measurer, before);
  return Math.abs(start - end) < SAME_SPOT;
}

/** Whether offset 0 of `paragraphId` shares one caret stop with the end of the first side. */
export function joinStartShared(
  layout: SemanticLayout,
  paragraphId: string,
  measurer?: TextMeasurer
): boolean {
  return paragraphLinesFor(layout, paragraphId).some(({ line }) => {
    const segment = lineSegmentFor(line, paragraphId);
    return segment !== null && joinStopShared(line, segment, measurer);
  });
}
