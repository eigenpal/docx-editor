// The `w:keepNext` group a footnote hold-out must treat as one piece. Full account on
// {@link frontierKeepGroup}.

import { isOutOfFlowFragment } from './fragment-flow.ts';
import {
  keepNextTerminalLines,
  MAX_KEEP_NEXT_CHAIN,
  paragraphKeeps,
  type ParagraphKeeps,
} from './pagination-keeps.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  ParagraphFragmentRecord,
} from './semantic-records.ts';

/** A keep-with-next group that holds the hold-out's frontier line. */
export interface FrontierKeepGroup {
  /** Whether the chain head is on the source page rather than the next page. */
  readonly headOnSource: boolean;
  /**
   * Content-relative top of the head's flow on its page: below its applied before-spacing,
   * above its top border.
   */
  readonly top: number;
  /**
   * Content-relative bottom (full line box) of the group's last line on the next page, or
   * undefined when the group continues past the next page.
   */
  readonly end: number | undefined;
  /** Where the next page's flow ends: a lower bound on the group's end when `end` is unknown. */
  readonly endLowerBound: number;
  /** Index into the next page's fragments of the last group block the page holds. */
  readonly lastIndex: number;
  /** Whether group lines sit above the frontier line on the next page. */
  readonly linesAboveFrontier: boolean;
}

/**
 * How a hold-out must treat a keep-with-next group ({@link classifyKeepGroup}). The group
 * returns whole or not at all, so the pull-back quanta must price all of it.
 */
export interface KeepGroupPolicy {
  /** The group's end is unknown, so no pull-back quantum can be priced. */
  readonly unpriced: boolean;
  /** The frontier hold could change the body pass's keep decision: hold the whole slack. */
  readonly holdWholeSlack: boolean;
}

/**
 * The `w:keepNext` group that holds line `frontierIndex` of `nextPage.fragments[owningIndex]`,
 * or undefined when no group the source page's reserve can affect holds it.
 *
 * The body pass prices a keep-with-next chain once, at its head (`keepNextGroupHeight`):
 * every member whole, plus the opening lines the terminal paragraph's own keeps allow. When
 * the group fits the page's reserved height, the body pass places it whole or moves it
 * whole; otherwise it drops the keep and the lines flow one by one. A group that holds the
 * frontier line therefore returns whole or not at all while its keep holds.
 *
 * Undefined when no group holds the frontier line, when the head is on a page before the
 * source page (a reserve here cannot reprice it), and when the body pass cannot price the
 * group at all (a table in the chain, or a chain longer than {@link MAX_KEEP_NEXT_CHAIN}),
 * because the body pass then drops the keep. `bodyLastParagraphId` names the body's last
 * block, which keeps with nothing.
 */
export function frontierKeepGroup(
  bodyPage: PageRecord,
  nextPage: PageRecord,
  owningIndex: number,
  frontierIndex: number,
  bodyLastParagraphId: string | undefined
): FrontierKeepGroup | undefined {
  const fragments = nextPage.fragments;
  const owning = fragments[owningIndex];
  if (owning?.kind !== 'paragraph') return undefined;
  const bindsNext = (block: ParagraphFragmentRecord, keeps: ParagraphKeeps) =>
    keeps.keepNext && block.paragraphId !== bodyLastParagraphId;
  const owningKeeps = paragraphKeeps(owning.props);
  const last = fragments[fragments.length - 1];
  const endLowerBound = last ? last.box.y + last.box.height : 0;

  let end: number | undefined;
  let lastIndex = owningIndex;
  let members = 1;
  if (bindsNext(owning, owningKeeps)) {
    // A chain member: the owning paragraph returns whole, with the rest of the chain.
    let previous = owning;
    for (let index = owningIndex + 1; previous.paragraphEnd; index += 1) {
      const block = fragments[index];
      if (!block) break;
      members += 1;
      if (block.kind !== 'paragraph' || members > MAX_KEEP_NEXT_CHAIN) return undefined;
      const keeps = paragraphKeeps(block.props);
      lastIndex = index;
      if (!bindsNext(block, keeps)) {
        end = terminalOpeningBottom(block, keeps);
        break;
      }
      previous = block;
    }
  } else {
    // A chain terminal: only its opening lines belong to the group.
    if (owning.fragmentIndex > 0) return undefined;
    const previous = owningIndex > 0 ? fragments[owningIndex - 1] : lastInFlowBlock(bodyPage);
    if (!keepsNext(previous)) return undefined;
    const opening = terminalOpeningCount(owning, owningKeeps);
    // A frontier line the fragment cannot place is treated as held by the group.
    if (opening !== undefined && frontierIndex >= 0 && frontierIndex >= opening) return undefined;
    end = opening === undefined ? undefined : lineBottom(owning, opening - 1);
  }

  // Walk back to the chain head, onto the source page when the chain crosses the break.
  let head = owningIndex;
  while (head > 0 && keepsNext(fragments[head - 1])) {
    head -= 1;
    members += 1;
  }
  const first = fragments[head] as ParagraphFragmentRecord;
  const crosses = head === 0 && (first.fragmentIndex > 0 || keepsNext(lastInFlowBlock(bodyPage)));
  const linesAboveFrontier = head < owningIndex || frontierIndex !== 0;
  if (!crosses) {
    if (members > MAX_KEEP_NEXT_CHAIN) return undefined;
    const top = flowTop(first);
    return { headOnSource: false, top, end, endLowerBound, lastIndex, linesAboveFrontier };
  }
  const sourceHead = chainHeadOnSource(bodyPage, first.fragmentIndex > 0);
  if (!sourceHead || members + sourceHead.members > MAX_KEEP_NEXT_CHAIN) return undefined;
  const top = flowTop(sourceHead.head);
  return { headOnSource: true, top, end, endLowerBound, lastIndex, linesAboveFrontier };
}

/**
 * How a hold-out must treat `group` under a frontier hold that reserves `frontierReservePt`.
 *
 * `shiftPt` carries a next-page y onto the source page (undefined when unknown).
 * `existingAreaPt` is the source page's own note area: the least reserve the page keeps
 * when the hold releases.
 *
 * A group taller than the page minus that area loses its keep on any reserve, so it
 * constrains nothing. Otherwise a release lets the keep hold, and the quanta must price the
 * group whole. The frontier hold then changes the outcome in two cases, which hold the
 * whole slack instead, as before the frontier hold existed:
 * - The head is on the next page, and the hold could drop a keep that a release honors.
 *   The body pass would then return the group's lines above the frontier line and split a
 *   group that fits a page. With no group line above the frontier line, nothing returns.
 * - The head is on the source page, where the keep was dropped, and the hold could honor
 *   it. The body pass would then move the head to the next page.
 */
export function classifyKeepGroup(
  group: FrontierKeepGroup,
  shiftPt: number | undefined,
  contentHeight: number,
  existingAreaPt: number,
  frontierReservePt: number,
  marginPt: number
): KeepGroupPolicy | undefined {
  const landing = (y: number) =>
    group.headOnSource ? (shiftPt === undefined ? undefined : y + shiftPt) : y;
  const endLanding = group.end === undefined ? undefined : landing(group.end);
  const lowerLanding = landing(group.endLowerBound);
  const size = endLanding === undefined ? undefined : endLanding - group.top;
  const lowerSize = lowerLanding === undefined ? undefined : lowerLanding - group.top;
  const neverKept = (height: number | undefined) =>
    height !== undefined && height > contentHeight - existingAreaPt + marginPt;
  if (neverKept(size) || (size === undefined && neverKept(lowerSize))) return undefined;
  const heldHeight = contentHeight - frontierReservePt;
  // Both answers err toward the whole-slack hold: an unknown size may do either.
  const mayKeep = (size ?? lowerSize ?? 0) <= heldHeight + marginPt;
  const mayDrop = size === undefined || size > heldHeight - marginPt;
  return {
    unpriced: size === undefined,
    holdWholeSlack: group.headOnSource ? mayKeep : mayDrop && group.linesAboveFrontier,
  };
}

/**
 * The chain head among the source page's trailing blocks, walking back from its last
 * in-flow block, which belongs to the chain. Undefined when the chain began on an earlier
 * page. `continued` is true when the next page's first block continues that last block.
 */
function chainHeadOnSource(
  bodyPage: PageRecord,
  continued: boolean
): { readonly head: ParagraphFragmentRecord; readonly members: number } | undefined {
  const inFlow = bodyPage.fragments.filter((fragment) => !isOutOfFlowFragment(fragment));
  let index = inFlow.length - 1;
  let members = continued ? 0 : 1;
  for (;;) {
    const block = inFlow[index];
    if (block?.kind !== 'paragraph' || block.fragmentIndex > 0) return undefined;
    if (index === 0 || !keepsNext(inFlow[index - 1])) return { head: block, members };
    index -= 1;
    members += 1;
  }
}

/** Bottom of the terminal paragraph's opening lines, or undefined when the page cannot tell. */
function terminalOpeningBottom(
  block: ParagraphFragmentRecord,
  keeps: ParagraphKeeps
): number | undefined {
  const opening = terminalOpeningCount(block, keeps);
  return opening === undefined ? undefined : lineBottom(block, opening - 1);
}

/**
 * Opening line count ({@link keepNextTerminalLines}) of a paragraph that starts in `block`.
 * A fragment that does not end its paragraph shows only a lower bound on the line count,
 * which is enough unless the rule would hold more lines than the fragment shows.
 */
function terminalOpeningCount(
  block: ParagraphFragmentRecord,
  keeps: ParagraphKeeps
): number | undefined {
  const shown = block.lines.length;
  if (shown === 0) return undefined;
  // The body pass leaves at least two lines of a widow-controlled paragraph after a cut.
  const lineCount = block.paragraphEnd ? shown : shown + (keeps.widowControl ? 2 : 1);
  const opening = keepNextTerminalLines(keeps, lineCount, lineCount);
  return opening <= shown ? opening : undefined;
}

function flowTop(block: ParagraphFragmentRecord): number {
  return block.box.y + block.spacing.before;
}

function lineBottom(block: ParagraphFragmentRecord, index: number): number | undefined {
  const line = block.lines[index];
  return line ? line.box.y + line.box.height : undefined;
}

function keepsNext(block: BlockFragmentRecord | undefined): boolean {
  return block?.kind === 'paragraph' && paragraphKeeps(block.props).keepNext;
}

function lastInFlowBlock(page: PageRecord): BlockFragmentRecord | undefined {
  for (let index = page.fragments.length - 1; index >= 0; index -= 1) {
    const fragment = page.fragments[index]!;
    if (!isOutOfFlowFragment(fragment)) return fragment;
  }
  return undefined;
}

/**
 * Paragraph id of the body's last in-flow block, or undefined when that block is not a
 * paragraph. Its `w:keepNext` binds nothing: it has no following paragraph to keep with.
 */
export function lastInFlowParagraphId(pages: readonly PageRecord[]): string | undefined {
  for (let pageAt = pages.length - 1; pageAt >= 0; pageAt -= 1) {
    const fragments = pages[pageAt]!.fragments;
    for (let index = fragments.length - 1; index >= 0; index -= 1) {
      const fragment = fragments[index]!;
      if (isOutOfFlowFragment(fragment)) continue;
      return fragment.kind === 'paragraph' ? fragment.paragraphId : undefined;
    }
  }
  return undefined;
}
