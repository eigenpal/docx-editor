import { paragraphLinesFor } from './paragraph-lines.ts';
import { lineSegmentFor } from './line-segments.ts';
import { contentControlsOfLayout, type SemanticLayout } from './semantic-records.ts';

/** Visible deletion boundaries split words without changing canonical text offsets. */
export function deletedTextBoundaries(
  layout: SemanticLayout,
  paragraphId: string
): ReadonlySet<number> {
  const stops = new Set<number>();
  for (const { line } of paragraphLinesFor(layout, paragraphId) ?? []) {
    const segment = lineSegmentFor(line, paragraphId);
    if (!segment) continue;
    for (const span of segment.spans) {
      if (span.range.end === span.range.start) continue;
      if (!span.revisions?.some((entry) => entry.kind === 'delete' || entry.kind === 'moveFrom')) {
        continue;
      }
      stops.add(span.range.start);
      stops.add(span.range.end);
    }
  }
  return stops;
}

/** Locked inline controls split word motions at each authored control edge. */
export function wordMotionBoundaries(
  layout: SemanticLayout,
  paragraphId: string
): ReadonlySet<number> {
  const stops = new Set(deletedTextBoundaries(layout, paragraphId));
  for (const control of contentControlsOfLayout(layout)) {
    if (
      control.level !== 'inline' ||
      control.placeholder ||
      control.range?.paragraphId !== paragraphId ||
      (control.effectiveLock !== 'contentLocked' && control.effectiveLock !== 'sdtContentLocked')
    )
      continue;
    stops.add(control.range.start);
    stops.add(control.range.end);
  }
  return stops;
}
