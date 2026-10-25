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
  const key = (page: number, anchorId: string) => `${page}:${anchorId}`;
  return {
    /**
     * Records a line of `paragraphId` that moved from `top` down by `skip` on `page`, when it
     * crossed the bands of the raised tables anchored after that paragraph and landed at the
     * bottom of the lowest one. Tables stacked on one anchor push as one.
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
      const bottoms = new Map<string, number>();
      const crossed = new Set<string>();
      for (const zone of zones) {
        if (!zone.reachesEarlierLines) continue;
        const anchorOrder = orderOf(zone.anchorParagraphId);
        if (anchorOrder === undefined || anchorOrder <= order) continue;
        const band = zone.verticalBand;
        const bottom = band.y + band.height;
        bottoms.set(
          zone.anchorParagraphId,
          Math.max(bottoms.get(zone.anchorParagraphId) ?? 0, bottom)
        );
        if (top < bottom && top + height > band.y) crossed.add(zone.anchorParagraphId);
      }
      for (const anchorId of crossed) {
        const id = key(page, anchorId);
        if (!pushes.has(id) && Math.abs(top + skip - bottoms.get(anchorId)!) <= EPSILON)
          pushes.set(id, skip);
      }
    },
    /** The push the raised tables anchored at `anchorId` leave out of its top on `page`. */
    of(page: number, anchorId: string): number {
      return pushes.get(key(page, anchorId)) ?? 0;
    },
  };
}

/**
 * Whether a text-anchored table the previous pass placed beside `anchorId` keeps that place while
 * its anchor moves on to the next column or page: the anchor's first line fits where it stood
 * before the table moved anything (`overrun`, how far it now misses the bottom, is no more than
 * the push), so the table's band is what pushed it out. A page- or margin-positioned table
 * follows its anchor instead (`coveredLinesAnchorBand`).
 */
export function ownTableStaysForAnchor(
  zones: readonly ExclusionZone[],
  anchorId: string,
  at: {
    /** The column being filled in a multi-column section. */
    readonly column: number | undefined;
    /** How far the raised tables of `anchorId` pushed the earlier lines on this page. */
    readonly pushed: number;
    readonly overrun: number;
  }
): boolean {
  return zones.some(
    (zone) =>
      zone.sourceKind === 'table' &&
      zone.anchorParagraphId === anchorId &&
      !zone.pageFramedBand &&
      (at.column === undefined || zone.columnIndex === at.column) &&
      at.overrun - at.pushed <= 0
  );
}
