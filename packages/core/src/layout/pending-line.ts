// The broken-but-unplaced line: the record breakParagraph accumulates and pagination
// budgets, before placement publishes a LineRecord from it. Extracted from paragraph-flow
// so the flow module stays under its line budget; paragraph-flow re-exports everything here.

import type { RevisionAttribution } from './revision-projection.ts';
import type { StyleSpanRecord } from './semantic-records.ts';
import type { InlineDrawingRecord } from './drawing-layout.ts';
import { topAndBottomSkipBeforeLine, type ExclusionZone } from './drawing-exclusion.ts';
import type { ModelRange } from './field-pieces.ts';

export interface PendingLine {
  readonly spans: StyleSpanRecord[];
  readonly drawings: InlineDrawingRecord[];
  readonly start: number;
  end: number;
  width: number;
  height: number;
  baseline: number;
  /**
   * Space ABOVE the glyph band inside {@link height}.
   *
   * Exact spacing can center the glyphs and move the baseline. Auto/atLeast spacing leaves
   * this at zero and puts its extra depth below instead.
   */
  leading: number;
  /**
   * Auto/atLeast line-spacing depth below the painted glyph band.
   *
   * Word lets this external depth cross the bottom text margin when the glyphs themselves
   * still fit. Pagination therefore budgets {@link height} minus this amount at a page
   * bottom, while paint keeps the full box and padding.
   */
  trailingSpacing: number;
  /** When true, layout must start a new page after this line is placed. */
  pageBreakAfter?: boolean;
  /** When true, layout must advance to the next authored section column. */
  columnBreakAfter?: boolean;
  /** Model ranges on this line covering deleted content; see {@link LineRecord.deletedRanges}. */
  deletedRanges?: readonly ModelRange[];
  /** Vertical gap inserted before this line to clear a topAndBottom exclusion band. */
  exclusionSkipBefore?: number;
  /** Tracked anchored-drawing attributions on this line; see {@link LineRecord.anchorRevisions}. */
  anchorRevisions?: readonly RevisionAttribution[];
}

/** Vertical extent of a pending line for flow/pagination budget checks (skip + box + optional tail). */
export function pendingLineFlowExtent(
  line: Pick<PendingLine, 'height' | 'trailingSpacing' | 'exclusionSkipBefore'>,
  tail = 0
): number {
  return (line.exclusionSkipBefore ?? 0) + Math.max(0, line.height - line.trailingSpacing) + tail;
}

/** Recompute topAndBottom skip at placement time from live page zones and absolute line top. */
export function pendingLineFlowExtentAtPlacement(
  lineTopY: number,
  line: Pick<PendingLine, 'height' | 'trailingSpacing' | 'exclusionSkipBefore'>,
  zones: readonly ExclusionZone[],
  tail = 0
): number {
  const skip =
    zones.length > 0
      ? topAndBottomSkipBeforeLine(lineTopY, line.height, zones)
      : (line.exclusionSkipBefore ?? 0);
  return skip + Math.max(0, line.height - line.trailingSpacing) + tail;
}

/**
 * A cached line, safe to hand back on every later hit.
 *
 * Placement copies span boxes rather than mutating them, but a cache entry outlives the
 * layout that produced it — freezing means a future change to the placement path cannot
 * quietly corrupt every subsequent reuse.
 */
export function frozenLine(line: PendingLine): PendingLine {
  return Object.freeze({
    spans: line.spans.map((span) =>
      Object.freeze({ ...span, box: Object.freeze({ ...span.box }) })
    ),
    drawings: line.drawings.map((drawing) =>
      Object.freeze({
        ...drawing,
        paintBounds: Object.freeze({ ...drawing.paintBounds }),
        hitBounds: Object.freeze({ ...drawing.hitBounds }),
      })
    ),
    start: line.start,
    end: line.end,
    width: line.width,
    height: line.height,
    baseline: line.baseline,
    leading: line.leading,
    trailingSpacing: line.trailingSpacing,
    ...(line.pageBreakAfter ? { pageBreakAfter: true } : {}),
    ...(line.columnBreakAfter ? { columnBreakAfter: true } : {}),
    ...(line.deletedRanges ? { deletedRanges: Object.freeze(line.deletedRanges) } : {}),
    ...(line.exclusionSkipBefore ? { exclusionSkipBefore: line.exclusionSkipBefore } : {}),
    ...(line.anchorRevisions ? { anchorRevisions: Object.freeze(line.anchorRevisions) } : {}),
  }) as PendingLine;
}
