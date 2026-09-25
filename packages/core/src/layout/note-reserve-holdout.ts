// The hold-out reserve — the fixed point of a footnote eviction. Full account on
// {@link holdOutReserveNeed}.

import { isOutOfFlowFragment } from './fragment-flow.ts';
import { anchoredDrawingWrapsText } from './furniture-drawing-exclusion.ts';
import { fragmentOwnsPosition } from './line-segments.ts';
import {
  bodyFitBottomPt,
  evictedRunStart,
  firstBodyContentTopPt,
  fragmentFlowBottom,
  fragmentFitBottomPt,
  noteReferenceLineBandPt,
  pageHoldsOnly,
} from './note-fragment-geometry.ts';
import {
  classifyKeepGroup,
  frontierKeepGroup,
  lastInFlowParagraphId,
  type FrontierKeepGroup,
} from './note-holdout-keep-group.ts';
import { collapsedSpaceBefore } from './paragraph-style.ts';
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
import type { LineRecord, PageRecord, ParagraphFragmentRecord } from './semantic-records.ts';
import { PAGE_BREAK_CHAR, type OoxmlPart } from '@docx-editor.dev/core/store';

/**
 * How many of the next page's opening blocks may sit above the pulled reference's line:
 * a full keep-with-next chain moves as one unit, and a window smaller than the chain
 * would give up on exactly the groups most likely to have been evicted together.
 */
const MAX_HOLD_OUT_SCAN_BLOCKS = MAX_KEEP_NEXT_CHAIN + 1;

/**
 * Slack an exact pull-back fit must keep. A release the reserve pass then refuses costs the
 * reflow loop an orbit, so a tie that summation order could flip stays held.
 */
const EXACT_FIT_MARGIN_PT = 0.01;

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
  /**
   * Every page of the layout: a keep-with-next group may continue onto them, and the
   * body's last paragraph keeps with nothing.
   */
  readonly pages?: readonly PageRecord[];
  /**
   * The session's notes memo, or undefined outside a session. While its reflow loop has
   * adopted nothing for this document state, the page was laid under the previous
   * state's reserves ({@link heldOnThisState}).
   */
  readonly holdState?: { readonly reflowSpent: { readonly adopted: number } | null };
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
 * rule (the note stays whole with its reference), so its reserve keeps that reference's
 * line out and reproduces itself round over round.
 *
 * Zero when there is nothing to hold out: no next page, a source page whose body ends with a
 * manual page break (nothing after the break can return across it), a next page in different
 * section geometry (a pull-back across a page-size change cannot be reasoned about here), a slack
 * too small to seat even the pulled line, the next page opening with a table or holding
 * the reference deeper than {@link MAX_HOLD_OUT_SCAN_BLOCKS} paragraphs, no page-bottom
 * footnote reference at all, or a pulled band whose notes would fit back — then the lines
 * SHOULD return; a deleted note must release its room. A note the eviction guard would
 * refuse to keep whole (taller than the note column minus what would leave the page with
 * its line — the guard's exact complement) never blocks the pull-back on its own: its
 * line may legitimately return with a split head, so it is excluded from the demand rather
 * than aborting the hold. Otherwise the answer holds the frontier line out
 * ({@link frontierHoldPt}): reference-free lines above it may still return, the frontier
 * line may not, and the reflow loop keeps its fixed point.
 *
 * The reference may open the next page behind a heading or a sibling line: the eviction
 * reserve names the reference's line, but widow/orphan control and `w:keepNext` move
 * companions with it, and the body pass decides which of them return under the hold. The
 * line quantum charges only the notes referenced on the lines that must return with the
 * frontier line, because the lines below them stay on the next page. The whole-block
 * quantum charges every pulled reference in the OWNING BLOCK, because a block that
 * returns whole brings all of its notes. On a page whose lines could re-break or change
 * column ({@link pullBackShiftPt} has no answer), both quanta charge every pulled note.
 *
 * A `w:keepNext` group that holds the frontier line ({@link frontierKeepGroup}) returns
 * whole or not at all, so both quanta reach the group's end and charge the notes on its
 * lines. The body pass drops a keep whose group is taller than the page's reserved height,
 * so a frontier hold could split a group that a release keeps whole, or move a head the
 * body pass already placed. Those groups keep the whole-slack hold
 * ({@link classifyKeepGroup}).
 *
 * Where the returning lines' landing on `bodyPage` is exact ({@link pullBackShiftPt}),
 * each quantum is tested there against the rule the reserve pass applies afterwards.
 * Otherwise the fit charges the pulled band's page-top geometry plus one reference-line of
 * headroom. A pulled paragraph whose suppressed `w:spacing w:before` exceeds that headroom
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
  // The next page is read as-is: every consumer below touches only its body fragments,
  // drawings, furniture and `contentBox`, which carried note areas do not change, so
  // stripping would just clone.
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
  let owningIndex = 0;
  for (const block of nextBody.fragments) {
    if (block.kind !== 'paragraph') return 0;
    if (owningIndex >= MAX_HOLD_OUT_SCAN_BLOCKS) return 0;
    if (fragmentOwnsPosition(block, frontierRef.paragraphId, frontierRef.atomOffset)) {
      owningBlock = block;
      break;
    }
    owningIndex += 1;
  }
  if (!owningBlock) return 0;
  // Release a settled hold only when the preceding body plus this opening pair
  // actually fits beside its existing notes. The incoming second-line note can
  // continue, but this policy must never reclaim space occupied by earlier notes.
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
    noteReferenceLineBandPt(nextBody, frontierRef).preserveOrphanLine &&
    fragmentFlowBottom(bodyPage.fragments) +
      frontier.bottom -
      firstBodyContentTopPt(nextBody) +
      args.existingAreaHeight <=
      contentHeight + 0.001
  ) {
    return 0;
  }
  const frontierIndex = owningBlock.lines.findIndex(
    (line) => Math.abs(line.box.y - frontier.top) <= 0.001
  );
  // Where the lines land on `bodyPage`; undefined on a page whose lines could re-break.
  const shift = pullBackShiftPt(bodyPage, nextBody);
  let hold = frontierHoldPt(bodyPage, owningBlock, frontier, bodyBottom, shift);
  // A keep-with-next group that holds the frontier line returns whole or not at all, and a
  // hold that changes whether its keep holds changes which lines return. The policy says
  // how to price the group and when to keep the whole-slack hold instead.
  const group = frontierKeepGroup(
    bodyPage,
    nextBody,
    owningIndex,
    frontierIndex,
    lastInFlowParagraphId(args.pages ?? []),
    args.pages ?? []
  );
  const contentWidth = bodyPage.contentBox.width;
  const columnBudget = noteColumnBudgetPt(contentHeight, args.plainSeparatorHeight);
  const areaBase =
    args.existingAreaHeight > 0 ? args.existingAreaHeight : args.plainSeparatorHeight;
  const layNote = (ref: HoldOutRef) =>
    layoutNoteCached(args.footnotesPart, ref.noteId, contentWidth, args.opts, args.noteLayoutCache);
  const groupNotes = group
    ? groupNotesHeightPt(nextBody, group, owningIndex, candidates, layNote, columnBudget)
    : 0;
  const keepPolicy = group
    ? classifyKeepGroup(
        group,
        shift?.pt,
        contentHeight,
        args.existingAreaHeight,
        Math.max(hold, args.existingAreaHeight),
        RESERVE_BOUNDARY_BACKOFF_PT,
        groupNotes > 0 ? areaBase + groupNotes : args.existingAreaHeight
      )
    : undefined;
  if (keepPolicy?.holdWholeSlack) hold = wholeSlackHoldPt(bodyPage, bodyBottom);
  const groupEnd = keepPolicy ? group?.end : undefined;
  // Blocks that return with the frontier line: the owning block, and the rest of a
  // keep-with-next group it belongs to. A later block brings only the references on its
  // group lines; its lower lines stay on the next page.
  const lastReturning = groupEnd !== undefined ? group!.lastIndex : owningIndex;
  const returning = nextBody.fragments.slice(owningIndex, lastReturning + 1);
  const blockOf = (ref: HoldOutRef): ParagraphFragmentRecord | undefined => {
    for (const entry of returning) {
      if (entry.kind !== 'paragraph') continue;
      if (fragmentOwnsPosition(entry, ref.paragraphId, ref.atomOffset)) return entry;
    }
    return undefined;
  };
  const pulled = candidates.filter((ref) => {
    const block = blockOf(ref);
    if (block === owningBlock) return true;
    return (
      block !== undefined &&
      groupEnd !== undefined &&
      noteReferenceLineBandPt(nextBody, ref).bottom <= groupEnd + 0.001
    );
  });
  if (pulled.length === 0) return 0;

  const firstContentTop = firstBodyContentTopPt(nextBody);
  // Two pull-back quanta. The LINE quantum ends at the smallest cut the body pass may make
  // at or below the reference's line ({@link pullBackUnitBottomPt}): a splittable
  // paragraph returns just its opening lines, but widow/orphan control and `w:keepLines`
  // can tie lines below the reference to it. A keep-with-next group that holds the line
  // returns only whole, so the quantum reaches the group's end. The WHOLE-BLOCK quantum
  // ends at the reference paragraph's fit bottom, or at the group's end when the group
  // continues past it.
  let unitBottom = pullBackUnitBottomPt(bodyPage, owningBlock, frontier);
  if (groupEnd !== undefined) unitBottom = Math.max(unitBottom, groupEnd);
  const wholeBottom = Math.max(
    fragmentFitBottomPt(owningBlock),
    lastReturning > owningIndex && groupEnd !== undefined ? groupEnd : 0
  );
  const lineBandHeight = Math.max(0, unitBottom - firstContentTop);
  const blockBandHeight = Math.max(0, wholeBottom - firstContentTop);

  // The line quantum returns only the lines of its unit, so it carries only the notes
  // referenced there. References lower in the block stay on the next page with their
  // notes; the reserve pass evicts any of them the body pulls back anyway. Pages whose
  // lines could re-break or reflow into another column ({@link pullBackShiftPt} has no
  // answer) charge every pulled note: which lines return there is only an estimate.
  let unitNotesHeight = 0;
  let pulledNotesHeight = 0;
  let deepestRefBottom = 0;
  for (const ref of pulled) {
    deepestRefBottom = Math.max(deepestRefBottom, noteReferenceLineBandPt(nextBody, ref).bottom);
    const laid = layNote(ref);
    if (!laid) continue;
    // The eviction guard's exact complement: a note is kept whole only when it fits the
    // column MINUS what would leave with its line, measured once the line is back on
    // `bodyPage`. A note the guard would split anyway does not hold. The offset applies
    // only to a LINE-precise band — a fallback fragment band (merged or projected offsets,
    // `evictable: false`) spans the whole block and would over-subtract it; the guard never
    // evicts those, so the bare column is their complement.
    const band = noteReferenceLineBandPt(nextBody, ref);
    const moveOffset = band.evictable
      ? returnedEvictionOffsetPt(bodyPage, blockOf(ref) ?? owningBlock, band)
      : 0;
    if (laid.flowHeight > columnBudget - moveOffset + 0.001) continue;
    pulledNotesHeight += laid.flowHeight;
    if (!shift || band.bottom <= unitBottom + 0.001) unitNotesHeight += laid.flowHeight;
  }
  if (pulledNotesHeight <= 0) return 0;

  // A group whose end the next page does not show may return whole, with notes this test
  // cannot see.
  if (keepPolicy?.unpriced) return hold;
  // Where the lines land exactly, each quantum fits when its notes start below its lowest
  // line's full box on `bodyPage` — the rule the reserve pass applies once they are there.
  // Otherwise the page-top geometry is charged plus one reference line of headroom.
  const exact = shift?.exact === true ? shift.pt : undefined;
  const fitsLineQuantum =
    exact !== undefined
      ? unitBottom + exact + areaBase + unitNotesHeight <= contentHeight - EXACT_FIT_MARGIN_PT
      : bodyBottom + lineBandHeight + refLineHeight + areaBase + unitNotesHeight <=
        contentHeight + 0.001;
  if (!fitsLineQuantum) return hold;
  const fitsWholeBlock =
    exact !== undefined
      ? Math.max(deepestRefBottom, wholeBottom) + exact + areaBase + pulledNotesHeight <=
        contentHeight - EXACT_FIT_MARGIN_PT
      : bodyBottom + blockBandHeight + refLineHeight + areaBase + pulledNotesHeight <=
        contentHeight + 0.001;
  if (fitsWholeBlock) return 0;
  // The optimistic quantum fits but the whole block does not. Whether releasing is safe
  // depends on whether the block can SPLIT, which the body pass has already answered:
  // when the used reserve left room for the line quantum and the body still declined it,
  // the block only moves whole (`w:keepLines` and friends). A page already held at this
  // value keeps the hold — a held page offers no gap, so the refusal cannot be
  // re-observed there; upstream shrinkage releases through the whole-block test above,
  // and a vanished note releases through the pulled scan. Release only a page that was
  // offered the room and refused nothing — or whose lay-down reserve is unknown (a caller
  // outside the reflow loop must not manufacture holds the loop never observed). A page
  // laid out under a previous document state's hold counts as held only when that state
  // held the same lines ({@link heldOnThisState}).
  const { usedReservePt } = args;
  if (usedReservePt === undefined) return 0;
  const offeredGap = Math.max(0, contentHeight - usedReservePt - bodyBottom);
  const neverOfferedTheRoom = lineBandHeight + refLineHeight > offeredGap + 0.001;
  const shape = heldShapeKey(bodyPage, owningBlock, frontierIndex, frontierRef.noteId);
  const alreadyHeldHere =
    Math.abs(usedReservePt - hold) <= HELD_RESERVE_TOLERANCE_PT && heldOnThisState(args, shape);
  if (neverOfferedTheRoom && !alreadyHeldHere) return 0;
  recordHeldShape(args, shape);
  return hold;
}

/**
 * Shapes ({@link heldShapeKey}) of the pages the release test kept held, per notes part.
 * The part outlives body edits, so a hold on a page the edit did not reach stays trusted.
 * One entry per page index bounds the size by the page count.
 */
const heldShapes = new WeakMap<
  OoxmlPart,
  { readonly byIndex: Map<number, string>; readonly keys: Set<string> }
>();

/**
 * Whether a page laid out under its hold was held on this document state.
 *
 * The rule that keeps a held page held exists because a held page offers no gap, so the
 * body pass cannot refuse the returning lines again. A warm session seeds the reflow loop
 * with the reserves of the PREVIOUS document state, and after an edit that shifts the
 * content by whole lines a seeded reserve can equal the new frontier hold exactly. The
 * page then looks held, but no body pass has refused these lines. So before the loop
 * adopts its first reserves for a state, a held page counts only when an earlier state
 * held the same shape: the same last body line and the same returning lines.
 */
function heldOnThisState(args: HoldOutArgs, shape: string): boolean {
  if (!args.holdState || (args.holdState.reflowSpent?.adopted ?? 0) > 0) return true;
  return (
    args.footnotesPart !== null && heldShapes.get(args.footnotesPart)?.keys.has(shape) === true
  );
}

function recordHeldShape(args: HoldOutArgs, shape: string): void {
  if (!args.holdState || !args.footnotesPart) return;
  let shapes = heldShapes.get(args.footnotesPart);
  if (!shapes)
    heldShapes.set(args.footnotesPart, (shapes = { byIndex: new Map(), keys: new Set() }));
  const previous = shapes.byIndex.get(args.bodyPage.index);
  if (previous !== undefined) shapes.keys.delete(previous);
  shapes.byIndex.set(args.bodyPage.index, shape);
  shapes.keys.add(shape);
}

/**
 * What a held page's hold depends on, by source position: the body's last line on the
 * page, the returning block's first line, and the frontier line with its note.
 */
function heldShapeKey(
  bodyPage: PageRecord,
  owningBlock: ParagraphFragmentRecord,
  frontierIndex: number,
  noteId: number
): string {
  let last: ParagraphFragmentRecord | undefined;
  for (const fragment of bodyPage.fragments) {
    if (fragment.kind === 'paragraph' && !isOutOfFlowFragment(fragment)) last = fragment;
  }
  const range = (line: LineRecord | undefined) =>
    line ? `${line.range.paragraphId}:${line.range.start}:${line.range.end}` : '-';
  return [
    range(last?.lines[last.lines.length - 1]),
    range(owningBlock.lines[0]),
    range(owningBlock.lines[frontierIndex]),
    noteId,
  ].join('|');
}

/**
 * Height of the notes referenced on `group`'s lines on the next page, each one a page can
 * keep whole: a lower bound on the notes the group brings back when it returns whole.
 * References on later pages are not counted.
 */
function groupNotesHeightPt(
  nextPage: PageRecord,
  group: FrontierKeepGroup,
  owningIndex: number,
  candidates: readonly HoldOutRef[],
  layNote: (ref: HoldOutRef) => { readonly flowHeight: number } | null | undefined,
  columnBudget: number
): number {
  // The frontier line is the page's earliest reference line, so no group line above the
  // owning block carries a reference.
  const blocks = nextPage.fragments.slice(owningIndex, group.lastIndex + 1);
  let height = 0;
  for (const ref of candidates) {
    const inGroup = blocks.some(
      (block) =>
        block.kind === 'paragraph' && fragmentOwnsPosition(block, ref.paragraphId, ref.atomOffset)
    );
    if (!inGroup) continue;
    if (
      group.end !== undefined &&
      noteReferenceLineBandPt(nextPage, ref).bottom > group.end + 0.001
    )
      continue;
    const laid = layNote(ref);
    if (laid && laid.flowHeight <= columnBudget + 0.001) height += laid.flowHeight;
  }
  return height;
}

/**
 * Bottom (content-relative pt, full line box) of the smallest run of the owning block's
 * lines that can return to `bodyPage` together with the frontier line.
 *
 * The body pass cuts a paragraph only where {@link evictedRunStart} leaves the cut in
 * place, so the run ends at the first line at or below the frontier line after which that
 * rule accepts a cut: two lines must stay behind under widow control, the paragraph's
 * lines on `bodyPage` must not be a lone orphan, and `w:keepLines` never splits unless
 * those lines are all their column holds. With no such cut inside the fragment, the whole
 * fragment returns as one piece.
 */
function pullBackUnitBottomPt(
  bodyPage: PageRecord,
  owningBlock: ParagraphFragmentRecord,
  frontier: { readonly top: number; readonly bottom: number }
): number {
  const lines = owningBlock.lines;
  const frontierIndex = lines.findIndex((line) => Math.abs(line.box.y - frontier.top) <= 0.001);
  const last = lines[lines.length - 1];
  const wholeBottom = last ? last.box.y + last.box.height : frontier.bottom;
  if (frontierIndex < 0) return Math.max(frontier.bottom, wholeBottom);
  const head = returningHead(bodyPage, owningBlock);
  const before = head?.lines.length ?? 0;
  const alone = head !== undefined && pageHoldsOnly(bodyPage, head);
  for (let index = frontierIndex; index < lines.length; index += 1) {
    const endsParagraph = index === lines.length - 1 && owningBlock.paragraphEnd === true;
    if (endsParagraph || evictedRunStart(owningBlock, index + 1, before, alone) === index + 1) {
      const line = lines[index]!;
      return line.box.y + line.box.height;
    }
  }
  return wholeBottom;
}

/** The fragment on `bodyPage` that `block` continues, when the paragraph resumes there. */
function returningHead(
  bodyPage: PageRecord,
  block: ParagraphFragmentRecord
): ParagraphFragmentRecord | undefined {
  const previous = bodyPage.fragments[bodyPage.fragments.length - 1];
  return block.fragmentIndex > 0 &&
    previous?.kind === 'paragraph' &&
    previous.paragraphId === block.paragraphId
    ? previous
    : undefined;
}

/**
 * Height the eviction guard would measure for a pulled reference once its lines are back
 * on `bodyPage`: from the top of what leaves with its line ({@link evictedRunStart},
 * counted with the paragraph's lines already on `bodyPage`) to the line's bottom.
 */
function returnedEvictionOffsetPt(
  bodyPage: PageRecord,
  block: ParagraphFragmentRecord,
  band: { readonly top: number; readonly bottom: number }
): number {
  const index = block.lines.findIndex((line) => Math.abs(line.box.y - band.top) <= 0.001);
  if (index < 0) return band.bottom - block.box.y;
  const head = returningHead(bodyPage, block);
  const before = head?.lines.length ?? 0;
  const alone = head !== undefined && pageHoldsOnly(bodyPage, head);
  const run = evictedRunStart(block, index, before, alone);
  if (run > 0 || (run === 0 && head)) return band.bottom - block.lines[run]!.box.y;
  if (!head) return band.bottom - block.box.y;
  // The run reaches back into the paragraph's lines on `bodyPage`.
  const headRun = before + run;
  const headTop = headRun > 0 ? head.lines[headRun]!.box.y : head.box.y;
  const headLast = head.lines[before - 1]!;
  return band.bottom - block.lines[0]!.box.y + headLast.box.y + headLast.box.height - headTop;
}

/**
 * The hold (pt) that keeps the frontier line — the next page's earliest reference line —
 * off `bodyPage` while every line above it stays free to return.
 *
 * The budget ends inside the frontier line as it would land on `bodyPage`, so the body
 * pass refuses that line and decides everything above it with its own rules:
 * widow/orphan control, `w:keepLines`, `w:keepNext` groups and the page's existing note
 * area (the caller's reserve never drops below it). Reference-free lines the old
 * whole-slack hold kept out then return when they fit.
 *
 * The landing is a LOWER bound, never an estimate: every gap between the two pages'
 * content is at least as large on `bodyPage` as the next page shows it. The one gap the
 * fragments do not record — before-spacing the next page's top suppressed — reads as
 * zero, which only lowers the budget. A budget too low keeps a returnable line out; one
 * too high would let the frontier line in, and its note would evict it again. The budget
 * therefore ends a glyph band into the landing line, which absorbs any unrecorded gap up
 * to that height. Where lines could re-break on the way back (a float or text frame on
 * either page) the landing is unreadable, and the whole slack is held as before. The
 * caller also holds the whole slack when this hold could change a `w:keepNext` decision.
 */
function frontierHoldPt(
  bodyPage: PageRecord,
  owningBlock: ParagraphFragmentRecord,
  frontier: { readonly top: number },
  bodyBottom: number,
  shift: PullBackShift | undefined
): number {
  const contentHeight = bodyPage.contentBox.height;
  const wholeSlack = wholeSlackHoldPt(bodyPage, bodyBottom);
  const line = owningBlock.lines.find((entry) => Math.abs(entry.box.y - frontier.top) <= 0.001);
  if (!shift || !line) return wholeSlack;
  const landing = frontier.top + shift.pt;
  const glyphExtent = line.box.height - Math.min(line.trailingSpacing ?? 0, line.box.height);
  // A line too thin to straddle the budget by the backoff on both sides cannot be refused
  // reliably; hold everything rather than risk pulling it back.
  if (glyphExtent <= 2 * RESERVE_BOUNDARY_BACKOFF_PT) return wholeSlack;
  const budget = landing + glyphExtent - RESERVE_BOUNDARY_BACKOFF_PT;
  return Math.min(wholeSlack, Math.max(0, contentHeight - budget));
}

/**
 * The hold that claims all of `bodyPage`'s remaining slack, so nothing returns. Backed off
 * by half a point like the eviction reserve: the last kept body line's bottom is exactly
 * `bodyBottom`, and a budget equal to it flips on float drift.
 */
function wholeSlackHoldPt(bodyPage: PageRecord, bodyBottom: number): number {
  return Math.max(0, bodyPage.contentBox.height - bodyBottom - RESERVE_BOUNDARY_BACKOFF_PT);
}

/** How far `nextPage` content moves when it flows back onto `bodyPage`. */
interface PullBackShift {
  /** Added to a `nextPage` y (content-relative pt) to give its y on `bodyPage`. */
  readonly pt: number;
  /** False when `pt` is only a lower bound: a gap the fragments do not record reads as 0. */
  readonly exact: boolean;
}

/**
 * The shift that carries `nextPage`'s lines onto `bodyPage` when they flow back, or
 * undefined when the fragments cannot answer.
 *
 * The returning lines keep their breaks only when neither page wraps text around a
 * float or a text frame. Line breaks are then fixed per paragraph, so the lines keep
 * their heights and relative positions. The only gap that moves is the one between
 * the two pages' content. A continued paragraph has no gap there. A paragraph that
 * opens the next page collapses its before-spacing with the preceding after-spacing.
 */
function pullBackShiftPt(bodyPage: PageRecord, nextPage: PageRecord): PullBackShift | undefined {
  if (!rigidFlowPage(bodyPage) || !rigidFlowPage(nextPage)) return undefined;
  const last = bodyPage.fragments[bodyPage.fragments.length - 1];
  const first = nextPage.fragments[0];
  const firstLine = first?.kind === 'paragraph' ? first.lines[0] : undefined;
  if (!last || !first || first.kind !== 'paragraph' || !firstLine) return undefined;
  if (last.kind === 'paragraph' && last.paragraphId === first.paragraphId) {
    const lastLine = last.lines[last.lines.length - 1];
    if (!lastLine || first.fragmentIndex !== last.fragmentIndex + 1) return undefined;
    return { pt: lastLine.box.y + lastLine.box.height - firstLine.box.y, exact: true };
  }
  if (first.fragmentIndex !== 0) return undefined;
  // `box` ends below the preceding paragraph's after-spacing: where the flow cursor stops.
  const previousAfter = last.kind === 'paragraph' ? last.spacing.after : 0;
  // A page-top paragraph that shows before-spacing kept all of it (a section start); one
  // that shows none may have had it suppressed, and its collapsed gap is at least zero.
  const before = first.spacing.before;
  const lead = before > 0 ? collapsedSpaceBefore(before, previousAfter) : 0;
  return {
    pt: last.box.y + last.box.height + lead - first.box.y - before,
    exact: before > 0,
  };
}

/**
 * A single-column page whose body lines keep their breaks and stacking when content moves
 * across it: no text-wrapping float in the body or its furniture, no text frame, no
 * floating table, and no out-of-flow fragment. Blocks of one column stack in document
 * order, so a block that starts above its predecessor's bottom means a second column.
 */
function rigidFlowPage(page: PageRecord): boolean {
  if (page.anchoredDrawings?.some(anchoredDrawingWrapsText)) return false;
  for (const story of [page.header, page.footer]) {
    if (story?.anchoredDrawings?.some(anchoredDrawingWrapsText)) return false;
  }
  let previousBottom = Number.NEGATIVE_INFINITY;
  for (const fragment of page.fragments) {
    if (fragment.kind === 'paragraph') {
      if (fragment.positionedFrame || isOutOfFlowFragment(fragment)) return false;
    } else if (fragment.floatingWrap) {
      return false;
    }
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
