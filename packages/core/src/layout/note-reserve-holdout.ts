// The hold-out reserve — the fixed point of a footnote eviction. Full account on
// {@link holdOutReserveNeed}.

import { fragmentOwnsPosition } from './line-segments.ts';
import {
  bodyFitBottomPt,
  firstBodyContentTopPt,
  fragmentFitBottomPt,
  noteReferenceLineBandPt,
} from './note-fragment-geometry.ts';
import {
  layoutNoteCached,
  type LayoutNoteStoryOptions,
  type NoteStoryLayoutCache,
} from './note-layout.ts';
import {
  HELD_RESERVE_TOLERANCE_PT,
  noteColumnBudgetPt,
  RESERVE_BOUNDARY_BACKOFF_PT,
} from './note-reserves.ts';
import { MAX_KEEP_NEXT_CHAIN } from './pagination-keeps.ts';
import type { PageRecord, ParagraphFragmentRecord } from './semantic-records.ts';
import type { OoxmlPart } from '@docx-editor.dev/core/store';

/**
 * How many of the next page's opening blocks may sit above the pulled reference's line:
 * a full keep-with-next chain moves as one unit, and a window smaller than the chain
 * would give up on exactly the groups most likely to have been evicted together.
 */
const MAX_HOLD_OUT_SCAN_BLOCKS = MAX_KEEP_NEXT_CHAIN + 1;

/** A page-bottom footnote reference site, pre-filtered by the caller. */
export interface HoldOutRef {
  readonly noteId: number;
  readonly paragraphId: string;
  readonly atomOffset: number;
}

export interface HoldOutArgs {
  readonly bodyPage: PageRecord;
  readonly nextPage: PageRecord | undefined;
  /** Height of `bodyPage`'s existing note area (0 when it has none). */
  readonly existingAreaHeight: number;
  /** The reserve `bodyPage` was laid under (for the observed-refusal test), if known. */
  readonly usedReservePt: number | undefined;
  /**
   * Page-bottom footnote references painted on a page. The caller supplies the memoized
   * page-refs filter so merged-paragraph ownership is answered by ONE implementation.
   */
  readonly pageBottomRefsOf: (page: PageRecord) => readonly HoldOutRef[];
  readonly footnotesPart: OoxmlPart | null;
  readonly opts: LayoutNoteStoryOptions;
  /** Height of the plain (non-continuation) footnote separator at this page's width. */
  readonly plainSeparatorHeight: number;
  readonly noteLayoutCache: NoteStoryLayoutCache;
}

/**
 * Reserve (pt) `bodyPage` must keep so the opening lines of `nextPage` stay put.
 *
 * This is the fixed point of an eviction: once the body pass has pushed a reference line
 * forward, the source page's recomputed reserve no longer sees that reference — the
 * note-stack height alone under-claims, the next round pulls the line back, and the
 * reflow loop orbits the two placements forever. When the next page opens with a
 * reference whose note cannot return, the source page's assignment is final under Word's
 * rule (the note stays whole with its reference), so its reserve claims the remaining
 * slack and reproduces itself round over round.
 *
 * Zero when there is nothing to hold out: no next page, a next page in different section
 * geometry (a pull-back across a page-size change cannot be reasoned about here), a slack
 * too small to seat even the pulled line, the next page opening with a table or holding
 * the reference deeper than {@link MAX_HOLD_OUT_SCAN_BLOCKS} paragraphs, no page-bottom
 * footnote reference at all, or a pulled band whose notes would fit back — then the lines
 * SHOULD return; a deleted note must release its room. A note the eviction guard would
 * refuse to keep whole (taller than the note column minus the content above its line in
 * its own block — the guard's exact complement) never blocks the pull-back on its own: its
 * line may legitimately return with a split head, so it is excluded from the demand rather
 * than aborting the hold. Otherwise the answer claims the page's remaining slack, which
 * reproduces the current body end exactly and gives the reflow loop its fixed point.
 *
 * The reference may open the next page behind a heading or a sibling line: the eviction
 * reserve names the reference's line, but widow/orphan control and `w:keepNext` move
 * companions with it, and the companions can only return together. The demand charges
 * every pulled reference in the OWNING BLOCK, not just the frontier line's — a
 * citation-dense paragraph pulls all of its notes back together.
 *
 * Known approximation: the pull-back fit charges the pulled band's page-top geometry plus
 * one reference-line of headroom (the split tail wraps from the split offset, so the
 * reference sits up to one line higher here than the joined re-wrap a pull-back
 * produces). A pulled paragraph whose applied `w:spacing w:before` exceeds that headroom
 * can still release early; the loop then degrades to the pre-eviction envelope/exhaustion
 * exit rather than diverging.
 */
export function holdOutReserveNeed(args: HoldOutArgs): number {
  const { bodyPage, nextPage } = args;
  if (!nextPage) return 0;
  if (
    nextPage.contentBox.width !== bodyPage.contentBox.width ||
    nextPage.contentBox.height !== bodyPage.contentBox.height
  ) {
    return 0;
  }
  // The next page is read as-is: every consumer below touches only `fragments` and
  // `contentBox`, which carried note areas do not change, so stripping would just clone.
  const nextBody = nextPage;
  const candidates = args.pageBottomRefsOf(nextBody);
  if (candidates.length === 0) return 0;

  // The EARLIEST reference line on the next page is the pull-back frontier.
  let frontier: { readonly top: number; readonly bottom: number } | undefined;
  let frontierRef: HoldOutRef | undefined;
  for (const ref of candidates) {
    const band = noteReferenceLineBandPt(nextBody, ref);
    if (band.bottom <= band.top) continue;
    if (!frontier || band.bottom < frontier.bottom - 0.001) {
      frontier = band;
      frontierRef = ref;
    }
  }
  if (!frontier || !frontierRef) return 0;
  const refLineHeight = frontier.bottom - frontier.top;

  const bodyBottom = bodyFitBottomPt(bodyPage);
  const contentHeight = bodyPage.contentBox.height;
  // A slack that cannot seat even the pulled line needs no reserve to stay out — and
  // publishing one for every naturally full page would churn the reserve fingerprints
  // the reflow loop converges on.
  if (contentHeight - bodyBottom < refLineHeight - 0.001) return 0;

  // The pulled band spans from the page's first content to the reference paragraph's
  // fragment. A table anywhere in that opening run, or a reference deeper than the scan
  // window, is a pull-back this reserve cannot reason about — fail open.
  let owningBlock: ParagraphFragmentRecord | undefined;
  let scanned = 0;
  for (const block of nextBody.fragments) {
    if (block.kind !== 'paragraph') return 0;
    if (scanned >= MAX_HOLD_OUT_SCAN_BLOCKS) return 0;
    scanned += 1;
    if (fragmentOwnsPosition(block, frontierRef.paragraphId, frontierRef.atomOffset)) {
      owningBlock = block;
      break;
    }
  }
  if (!owningBlock) return 0;
  const pulled = candidates.filter((ref) =>
    fragmentOwnsPosition(owningBlock, ref.paragraphId, ref.atomOffset)
  );
  if (pulled.length === 0) return 0;

  const firstContentTop = firstBodyContentTopPt(nextBody);
  // Two pull-back quanta: the OPTIMISTIC one ends at the reference's line (a splittable
  // paragraph returns just its opening lines), the WHOLE-BLOCK one at the reference
  // paragraph's fit bottom (a `w:keepLines`/keep-with-next group returns only as one
  // piece). Which quantum the body pass actually uses is not readable off the fragments.
  const lineBandHeight = Math.max(0, frontier.bottom - firstContentTop);
  const blockBandHeight = Math.max(0, fragmentFitBottomPt(owningBlock) - firstContentTop);

  const contentWidth = bodyPage.contentBox.width;
  const columnBudget = noteColumnBudgetPt(contentHeight, args.plainSeparatorHeight);
  let pulledNotesHeight = 0;
  for (const ref of pulled) {
    const laid = layoutNoteCached(
      args.footnotesPart,
      ref.noteId,
      contentWidth,
      args.opts,
      args.noteLayoutCache
    );
    if (!laid) continue;
    // The eviction guard's exact complement: a note is kept whole only when it fits the
    // column MINUS the content above its own line within its block (that block opens the
    // destination page whole). A note the guard would split anyway does not hold. The
    // offset applies only to a LINE-precise band — a fallback fragment band (merged or
    // projected offsets, `evictable: false`) spans the whole block and would over-subtract
    // it; the guard never evicts those, so the bare column is their complement.
    const band = noteReferenceLineBandPt(nextBody, ref);
    const inBlockOffset = band.evictable ? band.bottom - band.blockTop : 0;
    if (laid.flowHeight > columnBudget - inBlockOffset + 0.001) continue;
    pulledNotesHeight += laid.flowHeight;
  }
  if (pulledNotesHeight <= 0) return 0;

  const areaWithPulled =
    (args.existingAreaHeight > 0 ? args.existingAreaHeight : args.plainSeparatorHeight) +
    pulledNotesHeight;
  // Backed off by half a point like the eviction reserve: the last kept body line's bottom
  // is exactly `bodyBottom`, and a budget equal to it flips on float drift.
  const hold = Math.max(0, contentHeight - bodyBottom - RESERVE_BOUNDARY_BACKOFF_PT);
  const fitsLineQuantum =
    bodyBottom + lineBandHeight + refLineHeight + areaWithPulled <= contentHeight + 0.001;
  if (!fitsLineQuantum) return hold;
  const fitsWholeBlock =
    bodyBottom + blockBandHeight + refLineHeight + areaWithPulled <= contentHeight + 0.001;
  if (fitsWholeBlock) return 0;
  // The optimistic quantum fits but the whole block does not. Whether releasing is safe
  // depends on whether the block can SPLIT, which the body pass has already answered:
  // when the used reserve left room for the line quantum and the body still declined it,
  // the block only moves whole (`w:keepLines` and friends). A page already held at this
  // value keeps the hold — a held page offers no gap, so the refusal cannot be
  // re-observed there; upstream shrinkage releases through the whole-block test above,
  // and a vanished note releases through the pulled scan. Release only a page that was
  // offered the room and refused nothing — or whose lay-down reserve is unknown (a caller
  // outside the reflow loop must not manufacture holds the loop never observed).
  const { usedReservePt } = args;
  if (usedReservePt === undefined) return 0;
  const offeredGap = Math.max(0, contentHeight - usedReservePt - bodyBottom);
  const neverOfferedTheRoom = lineBandHeight + refLineHeight > offeredGap + 0.001;
  const alreadyHeldHere = Math.abs(usedReservePt - hold) <= HELD_RESERVE_TOLERANCE_PT;
  return neverOfferedTheRoom && !alreadyHeldHere ? 0 : hold;
}
