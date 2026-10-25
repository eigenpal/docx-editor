// How far a raised text-anchored table pushes the lines before its anchor on its page.
//
// A text-anchored table with a negative `w:tblpY` that leaves no passage beside it moves the
// earlier lines it covers below it (`reachesEarlierLines` zones). The anchor follows them, but
// the table keeps the place its anchor had before the move: its top is the anchor top minus
// this push, plus the offset. The first earlier line the band pushes sets the push; the lines
// after it follow without a skip of their own.
//
// The zones come from the previous pass, so the push is measured in the pass it applies to and
// an edit above the table moves the table with its text. When the moved lines would carry the
// anchor off the page, the anchor's band pricing (`coveredLinesAnchorBand`) sends the anchor and
// its table to the next page first, so no zone is left behind on this one.

import type { ExclusionZone } from './drawing-exclusion.ts';

const EPSILON = 0.5;

export function createEarlierLinePush(orderOf: (paragraphId: string) => number | undefined) {
  const pushes = new Map<string, number>();
  const key = (page: number, zoneId: string) => `${page}:${zoneId}`;
  return {
    /**
     * Records a line of `paragraphId` that moved from `top` down by `skip` on `page`, when it
     * landed at the bottom of a raised table's band anchored after that paragraph.
     */
    note(
      page: number,
      paragraphId: string,
      top: number,
      height: number,
      skip: number,
      zones: readonly ExclusionZone[]
    ): void {
      if (skip <= 0) return;
      const order = orderOf(paragraphId);
      if (order === undefined) return;
      for (const zone of zones) {
        if (!zone.reachesEarlierLines) continue;
        const anchorOrder = orderOf(zone.anchorParagraphId);
        if (anchorOrder === undefined || anchorOrder <= order) continue;
        const id = key(page, zone.drawingNodeId);
        if (pushes.has(id)) continue;
        const band = zone.verticalBand;
        const bottom = band.y + band.height;
        if (top < bottom && top + height > band.y && Math.abs(top + skip - bottom) <= EPSILON)
          pushes.set(id, skip);
      }
    },
    /** The push the table `tableId` leaves out of its anchor top on `page`. */
    of(page: number, tableId: string): number {
      return pushes.get(key(page, `table:${tableId}`)) ?? 0;
    },
  };
}
