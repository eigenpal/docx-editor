// Anchor framing for the paragraph fragment that publishes the paragraph's anchors. Extracted
// from the story loop in semantic-layout so that file stays inside its line budget.

import type { PendingLine } from './pending-line.ts';
import type { LayoutBox, LineRecord } from './semantic-records.ts';

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

/**
 * The lines and paragraph box a fragment's anchors resolve against.
 *
 * A fragment that holds every anchor frames them against its own placed lines. A
 * `wrapTopAndBottom` anchor pushed its OWN paragraph's lines down to clear the band; framing it
 * against those lines would chase the displacement it caused, and the picture would land on the
 * text it just moved. `positionV relativeFrom="paragraph"` means where the paragraph would begin
 * without its own band, so `ownSkip` comes back off. A band inherited from an earlier paragraph
 * is not removed: it moved this paragraph for real, and the anchor travels with it.
 *
 * Any other fragment frames them against the paragraph's broken lines stacked down from where
 * the paragraph first began (`origin`, or this fragment's top when it is the first).
 */
export function fragmentAnchorFrame(input: {
  readonly anchorOffsets: readonly number[];
  readonly pending: readonly LineRecord[];
  readonly lines: readonly PendingLine[];
  readonly paragraphId: string;
  readonly top: number;
  readonly height: number;
  readonly column: { readonly x: number; readonly width: number };
  readonly indentLeft: number;
  readonly available: number;
  /** How far an earlier band displaced this paragraph on the page. */
  readonly displacement: number;
  readonly ownSkip: () => number;
  readonly origin: { readonly columnX: number; readonly startY: number } | null;
}): { readonly lines: readonly LineRecord[]; readonly paragraphBox: LayoutBox } {
  const { pending, available } = input;
  const covered =
    input.anchorOffsets.length > 0 &&
    input.anchorOffsets.every((offset) =>
      pending.some((line) => offset >= line.range.start && offset < line.range.end)
    );
  if (covered) {
    const y = input.top - input.ownSkip() - input.displacement;
    const x = input.column.x + input.indentLeft;
    return { lines: pending, paragraphBox: { x, y, width: available, height: input.height } };
  }
  const origin = input.origin ?? { columnX: input.column.x, startY: input.top };
  const band = { left: origin.columnX + input.indentLeft, width: available };
  const synthetic = syntheticAnchorLines(input.lines, origin, band, input.paragraphId);
  const y = origin.startY - input.displacement;
  const height = Math.max(synthetic.bottom - y, pending[0]?.box.height ?? 0);
  return { lines: synthetic.lines, paragraphBox: { x: band.left, y, width: available, height } };
}
