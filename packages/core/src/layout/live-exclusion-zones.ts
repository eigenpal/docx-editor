// The exclusion zones of the pictures a pass has already placed, read from the pass itself.
//
// A reflow pass lays every page out under the zones the previous pass collected. A picture
// positioned against its paragraph moves whenever the text before it moves, so its collected
// zone is where the previous pass put it. After an edit that moves text (a page break, a longer
// paragraph) the text below a picture wraps around its old place, and each pass repairs about
// one more page of that. The pass count then grows with the document, and every pass lays out
// the whole document.
//
// The pictures this pass has placed are known: their records sit in the page being filled.
// Zone collection reads each record on its own, so the zone made from a placed record is the
// zone the pass will collect for it. Text placed after it reads that zone instead of the
// previous pass's, and a placed picture's zone never reaches a page it did not land on. Zones
// of pictures not placed yet (an object reaching back over earlier text, the paragraph being
// laid out) still come from the previous pass. At a fixed point the two agree.

import type { AnchoredDrawingRecord, InlineDrawingLayoutContext } from './drawing-layout.ts';
import {
  collectExclusionZonesFromDrawings,
  type ExclusionColumnLayout,
  type ExclusionZone,
} from './drawing-exclusion.ts';
import type { PageRecord } from './semantic-records.ts';
import type { ResolvedSectionColumns } from './section-columns.ts';

/**
 * Whether the zone is one a placed record replaces: a body picture that follows its text. A
 * page- or margin-framed one (`pageFramedBand`) stays where the page puts it, and a reflow
 * cycle may keep it on a page it left on purpose (`cycleZones`), so it always comes from the
 * previous pass.
 */
const followsText = (zone: ExclusionZone): boolean =>
  zone.sourceKind === undefined && !zone.earlierSection && zone.pageFramedBand !== true;

/**
 * `zones(pages, pending, earlier)`: `earlier` (the previous pass's zones for the page being
 * filled) with every body picture this pass has placed replaced by the zone of its record in
 * `pending` (the page being filled), or dropped when it landed on one of `pages`.
 */
export function createLiveExclusionZones(
  options: {
    readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
    readonly drawingSourceOrder?: ReadonlyMap<string, number>;
  },
  columns: ResolvedSectionColumns,
  contentWidth: number
): (
  pages: readonly PageRecord[],
  pending: readonly AnchoredDrawingRecord[],
  earlier: readonly ExclusionZone[]
) => readonly ExclusionZone[] {
  const drawingLayout = options.inlineDrawingLayout;
  // The same inputs the reflow loop collects zones with (`exclusion-layout-steps.ts`).
  const columnLayout: ExclusionColumnLayout = Object.freeze({
    columnCount: columns.count,
    columnGapPt: columns.gaps[0] ?? 0,
    contentWidth,
    columnLefts: columns.lefts,
    columnWidths: columns.widths,
  });
  const sourceOrderOf = (drawingNodeId: string): number | undefined =>
    options.drawingSourceOrder?.get(
      drawingLayout?.projectionForAtom?.(drawingNodeId)?.drawingNodeId ?? drawingNodeId
    );
  // Pictures on the completed pages of this pass, kept in step with `pages`, which only grows
  // at its end: a last page taken back and laid out again rebuilds the set.
  const placedOnPages = new Set<string>();
  const scanned: PageRecord[] = [];
  let lastEarlier: readonly ExclusionZone[] | undefined;
  let lastPending: readonly AnchoredDrawingRecord[] = [];
  let lastResult: readonly ExclusionZone[] = Object.freeze([]);
  return (pages, pending, earlier) => {
    if (!drawingLayout) return earlier;
    let pagesMoved = pages.length !== scanned.length;
    if (scanned.length > pages.length || pages[scanned.length - 1] !== scanned.at(-1)) {
      placedOnPages.clear();
      scanned.length = 0;
      pagesMoved = true;
    }
    for (let index = scanned.length; index < pages.length; index += 1) {
      const page = pages[index]!;
      scanned.push(page);
      for (const drawing of page.anchoredDrawings ?? []) placedOnPages.add(drawing.drawingNodeId);
    }
    if (
      !pagesMoved &&
      earlier === lastEarlier &&
      pending.length === lastPending.length &&
      pending.every((drawing, index) => drawing === lastPending[index])
    )
      return lastResult;
    lastEarlier = earlier;
    lastPending = pending.slice();
    const onPage = new Set(pending.map((drawing) => drawing.drawingNodeId));
    const placed = (zone: ExclusionZone): boolean =>
      followsText(zone) &&
      (onPage.has(zone.drawingNodeId) || placedOnPages.has(zone.drawingNodeId));
    if (pending.length === 0 && !earlier.some(placed)) return (lastResult = earlier);
    const live = collectExclusionZonesFromDrawings(
      pending,
      drawingLayout,
      0,
      contentWidth,
      sourceOrderOf,
      columnLayout
    );
    // Body pictures in source order, as collection lists them; tables, frames and furniture after.
    const bodyPicture = (zone: ExclusionZone) =>
      zone.sourceKind === undefined && !zone.earlierSection;
    const pictures = earlier
      .filter((zone) => bodyPicture(zone) && !placed(zone))
      .concat(live.filter(followsText))
      .sort((left, right) => left.sourceOrder - right.sourceOrder);
    lastResult = Object.freeze([...pictures, ...earlier.filter((zone) => !bodyPicture(zone))]);
    return lastResult;
  };
}
