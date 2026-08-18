// Which paragraph a line's offsets count in.
//
// Two lanes need this and neither may import the other: the interaction lane resolves a
// POSITION and the hit-test lane resolves a POINT, and they already meet through the records.

import type { InlineDrawingRecord } from './drawing-layout.ts';
import type { LineRecord, StyleSpanRecord } from './semantic-records.ts';

/**
 * The part of a line that belongs to ONE paragraph.
 *
 * A line normally belongs to one paragraph outright, and then this is the whole of it — the
 * same object every caller read before, so nothing about an ordinary document takes a new
 * path. A resolved display mode merges paragraphs that a tracked decision merges, and the line
 * carrying the join holds spans from two of them. Offsets there are ambiguous by themselves:
 * both paragraphs start at zero, so an offset means nothing without the paragraph it counts in.
 */
export interface LineSegment {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  readonly spans: readonly StyleSpanRecord[];
  readonly drawings: readonly InlineDrawingRecord[];
}

/** Cached per line: a mixed line is rare, and asking costs a walk of every span. */
const lineSegmentsCache = new WeakMap<LineRecord, readonly LineSegment[]>();

/** Every paragraph a line carries, in visual order. One entry for an ordinary line. */
export function lineSegments(line: LineRecord): readonly LineSegment[] {
  const cached = lineSegmentsCache.get(line);
  if (cached) return cached;
  const whole: LineSegment = {
    paragraphId: line.range.paragraphId,
    start: line.range.start,
    end: line.range.end,
    spans: line.spans,
    drawings: line.drawings ?? [],
  };
  const mixed = line.spans.some((span) => span.range.paragraphId !== line.range.paragraphId);
  const segments = mixed ? splitLineByParagraph(line) : [whole];
  lineSegmentsCache.set(line, segments);
  return segments;
}

function splitLineByParagraph(line: LineRecord): readonly LineSegment[] {
  const segments: LineSegment[] = [];
  for (const span of line.spans) {
    const previous = segments[segments.length - 1];
    if (previous && previous.paragraphId === span.range.paragraphId) {
      segments[segments.length - 1] = {
        ...previous,
        start: Math.min(previous.start, span.range.start),
        end: Math.max(previous.end, span.range.end),
        spans: [...previous.spans, span],
      };
      continue;
    }
    segments.push({
      paragraphId: span.range.paragraphId,
      start: span.range.start,
      end: span.range.end,
      spans: [span],
      drawings: [],
    });
  }
  return segments.map((segment) => ({
    ...segment,
    drawings: (line.drawings ?? []).filter(
      (drawing) => drawing.paragraphId === segment.paragraphId
    ),
  }));
}

/** The segment a paragraph owns on this line, or null when it owns none of it. */
export function lineSegmentFor(line: LineRecord, paragraphId: string): LineSegment | null {
  return lineSegments(line).find((segment) => segment.paragraphId === paragraphId) ?? null;
}
