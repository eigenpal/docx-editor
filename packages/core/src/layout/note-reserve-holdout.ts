// The hold-out reserve — the fixed point of a footnote eviction. Full account on
// {@link holdOutReserveNeed}.

import { isOutOfFlowFragment } from './fragment-flow.ts';
import { fragmentOwnsPosition } from './line-segments.ts';
import {
  bodyCursorBottomPt,
  firstBodyContentTopPt,
  fragmentFlowBottom,
  fragmentCursorBottomPt,
  noteReferenceLineBandPt,
} from './note-fragment-geometry.ts';
import { splitNoteHead, SPLIT_NOTE_MIN_LINES } from './note-eviction-guard.ts';
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
import { MAX_KEEP_NEXT_CHAIN, paragraphKeeps } from './pagination-keeps.ts';
import { tableRowHoldOutNeed } from './note-table-row-holdout.ts';
import type { PageRecord, ParagraphFragmentRecord } from './semantic-records.ts';
import { PAGE_BREAK_CHAR, type OoxmlPart } from '@docx-editor.dev/core/store';

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
  readonly allowOrphanDeferral?: boolean;
  readonly bodyPage: PageRecord;
  readonly nextPage: PageRecord | undefined;
  /** Height of `bodyPage`'s existing note area (0 when it has none). */
  readonly existingAreaHeight: number;
  /**
   * The reserve `bodyPage` needs for its own references, eviction included (defaults to
   * `existingAreaHeight`). A released hold leaves the page this reserve.
   */
  readonly ownReservePt?: number;
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
 * Zero when there is nothing to hold out: no next page, a source page whose body ends with a
 * manual page break (nothing after the break can return across it), a next page in different
 * section geometry (a pull-back across a page-size change cannot be reasoned about here), a slack
 * too small to seat even the pulled line, a table ahead of the reference (a next page that
 * OPENS with a table continuation takes the row hold-out, {@link tableRowHoldOutNeed}), the
 * reference deeper than {@link MAX_HOLD_OUT_SCAN_BLOCKS} paragraphs, no page-bottom
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
 * companions with it, and the companions can only return together. A block ahead of that
 * `w:keepNext` group is no companion: it returns on its own, so the hold releases and lets
 * it back. Holding would freeze the page at whatever height an earlier round left it, and
 * content an upstream page pushes forward would pile up in front of the reference. If the
 * reference line then returns too, the page's own eviction moves it out again, and the
 * next round finds the group at the page top. The release applies only when the block's
 * smallest movable head fits beside the page's own reserve: a release nothing can use
 * changes no body line, but it drops a hold the reflow loop may need to settle an orbit
 * further down. When the reference sits on the second line of an opening pair that could
 * follow the block back while its note could not place {@link SPLIT_NOTE_MIN_LINES} lines
 * there, the hold shrinks to the blocks ahead of the pair instead: they return and the pair
 * stays with its note on the next page. The release applies only where both pages
 * stack their blocks in one column; lines returning to a multi-column page may change
 * column, which this test cannot predict, so those pages keep the hold. The demand charges
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
  if (!nextPage || endsWithPageBreak(bodyPage)) return 0;
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
  const opening = nextBody.fragments[0];
  if (opening?.kind === 'table') {
    return tableRowHoldOutNeed(args, bodyPage, nextBody, opening, candidates);
  }

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

  const bodyBottom = bodyCursorBottomPt(bodyPage);
  const contentHeight = bodyPage.contentBox.height;
  // A slack that cannot seat even the pulled line needs no reserve to stay out — and
  // publishing one for every naturally full page would churn the reserve fingerprints
  // the reflow loop converges on.
  if (contentHeight - bodyBottom < refLineHeight - 0.001) return 0;

  // The pulled band spans from the page's first content to the reference paragraph's
  // fragment. A table anywhere in that opening run, or a reference deeper than the scan
  // window, is a pull-back this reserve cannot reason about — fail open.
  let owningBlock: ParagraphFragmentRecord | undefined;
  let owningAt = 0;
  for (const [index, block] of nextBody.fragments.entries()) {
    if (block.kind !== 'paragraph') return 0;
    if (index >= MAX_HOLD_OUT_SCAN_BLOCKS) return 0;
    if (fragmentOwnsPosition(block, frontierRef.paragraphId, frontierRef.atomOffset)) {
      owningBlock = block;
      owningAt = index;
      break;
    }
  }
  if (!owningBlock) return 0;
  const independentAhead = opensWithIndependentBlock(nextBody.fragments, owningAt);
  const orphanPairFrontier = noteReferenceLineBandPt(nextBody, frontierRef).preserveOrphanLine;
  const ownReserve = args.ownReservePt ?? args.existingAreaHeight;
  const flowBottom = fragmentFlowBottom(bodyPage.fragments);
  const strandsOrphanNote =
    orphanPairFrontier === true &&
    orphanPairNoteStrands(args, owningBlock, nextBody, frontierRef, flowBottom, ownReserve);
  const oneColumn = stacksInOneColumn(bodyPage) && stacksInOneColumn(nextBody);
  if (independentAhead && strandsOrphanNote && oneColumn) {
    // The blocks ahead return; the pair stays out with its note. The reserve ends the body
    // mid-way into the pair's first line, so the next round finds the pair at the page top.
    const prefixBottom = owningBlock.box.y - firstBodyContentTopPt(nextBody);
    return Math.max(0, contentHeight - flowBottom - prefixBottom - RESERVE_BOUNDARY_BACKOFF_PT);
  }
  if (independentAhead && !strandsOrphanNote && oneColumn) {
    const head = independentHeadHeight(nextBody.fragments, owningAt);
    if (head !== null && flowBottom + head + ownReserve <= contentHeight + 0.001) {
      return 0;
    }
  }
  // Release a settled hold only when the preceding body plus this opening pair
  // actually fits beside its existing notes. The incoming second-line note can
  // continue, but this policy must never reclaim space occupied by earlier notes.
  // The pair returns only when its note can place {@link SPLIT_NOTE_MIN_LINES} lines below
  // it there (the complement of the orphan-pair exemption in {@link evictsReferenceLine});
  // otherwise the note would start on a later page than its reference.
  //
  // DELIBERATELY the painted flow bottom ({@link fragmentFlowBottom}), not the fit-rule
  // bottom every other budget in this file uses, and DELIBERATELY without
  // {@link RESERVE_BOUNDARY_BACKOFF_PT}. Both make this test stricter than the body pass
  // that has to honour it, and this one may only FAIL CLOSED: a release the body then
  // refuses re-demands the hold on the next round and costs the reflow loop an orbit,
  // while a release withheld just leaves the pre-existing strict placement in place. Do
  // not "correct" either to match the neighbours without re-measuring the corpus.
  if (
    args.allowOrphanDeferral &&
    orphanPairFrontier &&
    !strandsOrphanNote &&
    fragmentFlowBottom(bodyPage.fragments) +
      frontier.bottom -
      firstBodyContentTopPt(nextBody) +
      args.existingAreaHeight <=
      contentHeight + 0.001
  ) {
    return 0;
  }
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
  const blockBandHeight = Math.max(0, fragmentCursorBottomPt(owningBlock) - firstContentTop);

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

/**
 * Whether an in-flow block ahead of the owning block's `w:keepNext` group opens the page.
 * Such a block is not tied to the reference: it can return to the previous page without
 * the reference line, so a hold there would strand it on this page for nothing. The
 * fragments before `owningAt` are paragraphs (the caller fails open on tables). Text
 * frames and collapsed section marks take no flow height, so they neither return nor
 * break a chain.
 */
function opensWithIndependentBlock(fragments: PageRecord['fragments'], owningAt: number): boolean {
  for (let index = owningAt - 1; index >= 0; index -= 1) {
    const block = fragments[index]!;
    if (block.kind !== 'paragraph' || block.positionedFrame || block.outOfFlow) continue;
    if (!paragraphKeeps(block.props).keepNext) return true;
  }
  return false;
}

/**
 * Whether the opening pair of the owning block could return to the previous page while its
 * second-line note could not place {@link SPLIT_NOTE_MIN_LINES} lines there. The pair can
 * return when everything above it, down to the glyph band of its second line, fits beside
 * the page's own reserve; the note's room ends at the reference line's full box.
 */
function orphanPairNoteStrands(
  args: HoldOutArgs,
  owningBlock: ParagraphFragmentRecord,
  nextBody: PageRecord,
  frontierRef: HoldOutRef,
  flowBottom: number,
  ownReserve: number
): boolean {
  const line = owningBlock.lines[1];
  if (!line) return false;
  const contentHeight = args.bodyPage.contentBox.height;
  const shift = flowBottom - firstBodyContentTopPt(nextBody);
  const glyphBottom =
    line.box.y + line.box.height - Math.min(line.trailingSpacing ?? 0, line.box.height);
  if (shift + glyphBottom + ownReserve > contentHeight + 0.001) return false;
  const laid = layoutNoteCached(
    args.footnotesPart,
    frontierRef.noteId,
    args.bodyPage.contentBox.width,
    args.opts,
    args.noteLayoutCache
  );
  if (!laid) return false;
  const area = Math.max(args.existingAreaHeight, args.plainSeparatorHeight);
  const room = contentHeight - (shift + line.box.y + line.box.height) - area;
  const fullNoteColumn = Math.max(0, contentHeight - args.plainSeparatorHeight);
  return splitNoteHead(laid, room, fullNoteColumn).lines < SPLIT_NOTE_MIN_LINES;
}

/**
 * Height (pt) the next page's opening blocks need on the previous page before any of them
 * can return there: the first block's smallest head that may move, from the page's first
 * line plus its applied before-spacing down to the glyph band of the head's last line (the
 * body fit rule lets that line's trailing depth cross the reserve). The head is one line;
 * under widow control it is the opening pair of a paragraph that starts here (the whole
 * paragraph when it has fewer than four lines) and it leaves at least two lines of a
 * paragraph that ends here; under `w:keepLines` it is the whole paragraph when the paragraph
 * sits whole on the page (one that already splits returns line by line). A head that
 * completes a `w:keepNext` paragraph takes the next block's head as well. Null when the head
 * reaches the owning block, whose lines return only with the reference.
 */
function independentHeadHeight(
  fragments: PageRecord['fragments'],
  owningAt: number
): number | null {
  let top: number | undefined;
  for (let index = 0; index < owningAt; index += 1) {
    const block = fragments[index]!;
    if (block.kind !== 'paragraph' || block.positionedFrame || block.outOfFlow) continue;
    const lines = block.lines;
    if (lines.length === 0) continue;
    top ??= lines[0]!.box.y - (block.fragmentIndex === 0 ? block.spacing.before : 0);
    const keeps = paragraphKeeps(block.props);
    const count = lines.length;
    let take = 1;
    const whole = block.fragmentIndex === 0 && block.paragraphEnd === true;
    if (keeps.keepLines && whole) take = count;
    else if (keeps.widowControl && block.fragmentIndex === 0) {
      take = whole && count < 4 ? count : Math.min(2, count);
    } else if (keeps.widowControl && block.paragraphEnd && count < 3) take = count;
    const last = lines[take - 1]!;
    if (take < count || !block.paragraphEnd || !keeps.keepNext) {
      return (
        last.box.y + last.box.height - Math.min(last.trailingSpacing ?? 0, last.box.height) - top
      );
    }
  }
  return null;
}

/**
 * Whether the page's body blocks stack in document order, as one column does. A block that
 * starts above its predecessor's bottom sits in another column or beside a float; lines
 * returning to such a page may change column, so the release above cannot predict them.
 * A section that continues onto the next page fills every column of the earlier page, so
 * checking both pages catches a next page that fills only its first column.
 */
function stacksInOneColumn(page: PageRecord): boolean {
  let previousBottom = Number.NEGATIVE_INFINITY;
  for (const fragment of page.fragments) {
    if (isOutOfFlowFragment(fragment)) continue;
    if (fragment.kind === 'paragraph' && fragment.positionedFrame) continue;
    if (fragment.box.y < previousBottom - 0.001) return false;
    previousBottom = fragment.box.y + fragment.box.height;
  }
  return true;
}

/**
 * Whether the page's body ends with a manual page break: its last paragraph line, the kept
 * empty line of a leading break included. Text frames and collapsed section marks sit
 * outside the flow and do not end it.
 */
function endsWithPageBreak(page: PageRecord): boolean {
  for (let index = page.fragments.length - 1; index >= 0; index -= 1) {
    const fragment = page.fragments[index]!;
    if (fragment.kind !== 'paragraph') return false;
    const last = fragment.lines[fragment.lines.length - 1];
    const breaks = last?.spans.some((span) => span.text === PAGE_BREAK_CHAR) ?? false;
    if (!breaks && (fragment.positionedFrame || fragment.outOfFlow)) continue;
    return breaks;
  }
  return false;
}
