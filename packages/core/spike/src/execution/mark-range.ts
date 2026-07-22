/** @spike-features bold-mark, italic-mark */
import type { AuthoredParagraph } from '../model/types';

export type MarkKind = 'bold' | 'italic';

export function isRangeFullyMarked(
  paragraph: AuthoredParagraph,
  markKind: MarkKind,
  start: number,
  end: number
): boolean {
  if (start >= end) return false;

  const overlapping = paragraph.marks
    .filter((mark) => mark.kind === markKind && mark.start < end && mark.end > start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  let cursor = start;
  for (const mark of overlapping) {
    if (mark.start > cursor) return false;
    if (mark.end > cursor) cursor = mark.end;
    if (cursor >= end) return true;
  }
  return cursor >= end;
}
