// Anchor framing for a paragraph fragment that does not hold the paragraph's anchors. Extracted
// from the story loop in semantic-layout so that file stays inside its line budget.

import type { PendingLine } from './pending-line.ts';
import type { LineRecord } from './semantic-records.ts';

/**
 * The paragraph's broken lines stacked down from where it first began, as frame geometry.
 *
 * These lines are never aligned, painted or caret-tested, so the content origin is just where
 * their spans were placed. `bottom` is the y below the last line.
 */
export function syntheticAnchorLines(
  lines: readonly PendingLine[],
  origin: { readonly columnX: number; readonly startY: number },
  band: { readonly left: number; readonly width: number },
  paragraphId: string
): { readonly lines: LineRecord[]; readonly bottom: number } {
  let y = origin.startY;
  const records = lines.map((brokenLine, brokenIndex) => {
    const lineRecord = {
      id: `anchor-line-${brokenIndex}`,
      range: { paragraphId, start: brokenLine.start, end: brokenLine.end },
      box: { x: band.left, y, width: band.width, height: brokenLine.height },
      contentX:
        brokenLine.spans.length > 0 ? brokenLine.spans[0]!.box.x + origin.columnX : band.left,
      baseline: brokenLine.baseline,
      leading: brokenLine.leading,
      trailingSpacing: brokenLine.trailingSpacing,
      spans: brokenLine.spans.map((span) => ({
        ...span,
        box: { ...span.box, x: span.box.x + origin.columnX, y },
      })),
    };
    y += brokenLine.height + (brokenLine.exclusionSkipBefore ?? 0);
    return lineRecord;
  });
  return { lines: records, bottom: y };
}
