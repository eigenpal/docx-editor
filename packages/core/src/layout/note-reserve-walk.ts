// The footnote reserve search, one page at a time.
//
// A page's footnote reserve and its body decide each other: the reserve sets how much body
// the page holds, and the body sets which references, and so which notes, the page holds.
// More than one reserve can agree with its own body, and some pages have no reserve that
// does. A search that adopts every page's reserve at once therefore ends on an answer that
// depends on where it started, so a document laid out after an edit could differ from the
// same document opened fresh.
//
// This search decides the pages in order. Each page starts from no reserve and follows its
// own need until the need repeats. When the page reaches a cycle instead, it takes the
// smallest reserve in the cycle that leaves its notes room, or the largest one when none
// does. A decided page does not change again. Its answer depends only on the decided pages
// before it, its own content, and the opening of the next page, so the walk gives the same
// answer from any start.
//
// An edit keeps the decisions on the pages before it and walks on from there. Once the walk
// reaches a page that starts exactly where a page of the previous walk started, with the same
// notes carried in and the same content after it, the previous decisions from that page on
// are the ones this walk would make, and the walk takes them.

import type { LayoutSteps } from './layout-steps.ts';
import type { PageRecord, SemanticLayout } from './semantic-records.ts';

type Reserves = ReadonlyMap<number, number>;

/** Where a reserve computation starts: a page index and the notes carried into it. */
export interface ReserveComputeRange {
  readonly from: number;
  readonly carry: unknown;
}

/** What one reserve computation returns, for the pages from its range on. */
export interface ReserveComputeResult {
  readonly reserves: Reserves;
  readonly stable: boolean;
  readonly reasons: readonly import('./note-pagination.ts').NotePaginationFallbackReason[];
  /** Any reference sits on an orphan pair. */
  readonly orphanCandidates: boolean;
  /** The page indices whose references sit on an orphan pair. */
  readonly orphanPages: ReadonlySet<number>;
  /** By page position: the notes carried into that page. */
  readonly carryBefore: readonly unknown[];
}

/** The decisions a walk made, kept for the next pass. */
export interface ReserveWalkRecord {
  /** Decided reserves, by page index. */
  readonly reserves: Reserves;
  /** Pages `[0, decided)` are decided. */
  readonly decided: number;
  /** Whether the walk reached the end of the document. */
  readonly complete: boolean;
  /** By page index: where the page starts and what notes it carries in. */
  readonly starts: readonly string[];
  /** By page index: the notes carried into the page, as the computation reads them. */
  readonly carries: readonly unknown[];
}

/** Pages a cycle may run through on one page before the page takes an answer. */
export const MAX_PAGE_RESERVE_ROUNDS = 8;

/** A walk round: the body laid out with `reserves`, complete through page `throughPage`. */
export interface ReserveWalkRound {
  readonly layout: SemanticLayout;
  /** Whether the layout holds the whole document. */
  readonly whole: boolean;
}

export interface ReserveWalkOptions {
  /** Decided reserves and starts before `floor`, and the notes carried into it. */
  readonly start: {
    readonly reserves: Reserves;
    readonly floor: number;
    readonly carry: unknown;
    readonly starts: readonly string[];
    readonly carries: readonly unknown[];
  };
  /** The previous walk, and the first page of its layout whose content this pass keeps. */
  readonly previous?: {
    readonly record: ReserveWalkRecord;
    /** Previous page index from which pages hold unchanged content. */
    readonly unchangedFrom: number;
  };
  /** Lay out with `reserves`, so that pages through `throughPage` are complete. */
  readonly round: (reserves: Reserves, throughPage: number) => LayoutSteps<ReserveWalkRound>;
  readonly compute: (
    layout: SemanticLayout,
    used: Reserves,
    allowOrphanDeferral: boolean,
    range: ReserveComputeRange
  ) => ReserveComputeResult;
  /** The start signature of a page with the notes carried into it. */
  readonly startOf: (page: PageRecord, carry: unknown) => string;
  /** True when a newer edit replaces this pass. */
  readonly stopped: () => boolean;
}

export interface ReserveWalkResult {
  readonly reserves: Reserves;
  readonly record: ReserveWalkRecord;
  /** Some page took a cycle answer, or the walk stopped early. */
  readonly exhausted: boolean;
  /** The last round's layout, and whether it was laid out under `reserves`. */
  readonly last: ReserveWalkRound | null;
  readonly lastCurrent: boolean;
}

/**
 * Pages beyond the decided one that a round must complete: the decided page reads the next
 * page's opening, and the one after it when the next page is a blank parity sheet.
 */
const LOOKAHEAD_PAGES = 3;

/** The reserve one page settles on when its need cycles. */
function cycleAnswer(seen: ReadonlyMap<number, number>, fallback: number | undefined): number {
  if (fallback !== undefined) return fallback;
  let smallestStable: number | undefined;
  let largest = 0;
  for (const [reserve, need] of seen) {
    if (need <= reserve + 0.001 && (smallestStable === undefined || reserve < smallestStable)) {
      smallestStable = reserve;
    }
    largest = Math.max(largest, reserve, need);
  }
  return smallestStable ?? largest;
}

function withReserve(reserves: Reserves, page: number, value: number): Map<number, number> {
  const next = new Map<number, number>();
  for (const [index, height] of reserves) if (index !== page) next.set(index, height);
  if (value > 0) next.set(page, value);
  return next;
}

/** The decided reserves of `record` from page `from`, moved to start at page `to`. */
function shiftedTail(record: ReserveWalkRecord, from: number, to: number): Map<number, number> {
  const moved = new Map<number, number>();
  for (const [index, height] of record.reserves) {
    if (index >= from) moved.set(index - from + to, height);
  }
  return moved;
}

/** The page at `at` and the page its answer reads: the next one, past a blank parity sheet. */
function pagesRead(pages: readonly PageRecord[], at: number): PageRecord[] {
  const next = pages[at + 1]?.parityBlank ? pages[at + 2] : pages[at + 1];
  return next ? [pages[at]!, next] : [pages[at]!];
}

function reservesEqual(a: Reserves, b: Reserves): boolean {
  if (a.size !== b.size) return false;
  for (const [index, height] of a) if (b.get(index) !== height) return false;
  return true;
}

/** Decide the footnote reserves page by page. */
export function* walkFootnoteReserves(options: ReserveWalkOptions): LayoutSteps<ReserveWalkResult> {
  const { start, previous } = options;
  let used = new Map([...start.reserves].filter(([index]) => index < start.floor));
  const starts = start.starts.slice(0, start.floor);
  const carries = start.carries.slice(0, start.floor);
  let floor = start.floor;
  let carry = start.carry;
  let exhausted = false;
  // The previous walk's pages by start signature, among those with unchanged content after.
  const previousStarts = new Map<string, number>();
  if (previous?.record.complete) {
    const { record, unchangedFrom } = previous;
    for (let index = Math.max(0, unchangedFrom); index < record.starts.length; index += 1) {
      const signature = record.starts[index];
      if (signature !== undefined && !previousStarts.has(signature)) {
        previousStarts.set(signature, index);
      }
    }
  }
  // The page being decided, and its search so far.
  let page = -1;
  let phase: 'strict' | 'deferral' = 'strict';
  let strictValue: number | undefined;
  let decidedValue: number | undefined;
  const seen = new Map<number, number>();
  let rounds = 0;
  const enter = (index: number): void => {
    page = index;
    phase = 'strict';
    strictValue = undefined;
    decidedValue = undefined;
    seen.clear();
    rounds = 0;
  };
  let last: ReserveWalkRound | null = null;
  let lastUsed: Reserves | null = null;
  let complete = false;

  for (;;) {
    if (options.stopped()) {
      // A newer edit waits: keep the last whole round as it was laid. Only the page being
      // decided changed since, so the decided pages keep their reserves.
      if (last?.whole && lastUsed) used = new Map(lastUsed);
      // The decided pages fix the notes carried into the next page, so the next pass can
      // start there.
      carries[floor] = carry;
      exhausted = true;
      break;
    }
    const round = yield* options.round(used, floor + LOOKAHEAD_PAGES);
    last = round;
    lastUsed = used;
    const pages = round.layout.pages;
    if (round.whole && floor >= pages.length) {
      complete = true;
      break;
    }
    // A page is decided only when the pages it reads are complete in this round.
    const reliable = round.whole ? pages.length : Math.max(0, pages.length - 1 - LOOKAHEAD_PAGES);
    if (page !== floor) enter(floor);
    let computedDeferral = phase === 'deferral';
    let computed = options.compute(round.layout, used, computedDeferral, { from: floor, carry });
    // `relayout`: the page being decided takes another reserve and needs a new round.
    // `finished`: the rest of the previous walk applies.
    let relayout = false;
    let finished = false;
    while (floor < reliable) {
      const at = pages[floor]!;
      if (computedDeferral !== (phase === 'deferral')) {
        computedDeferral = phase === 'deferral';
        computed = options.compute(round.layout, used, computedDeferral, { from: floor, carry });
      }
      const have = used.get(at.index) ?? 0;
      const need = computed.reserves.get(at.index) ?? 0;
      if (decidedValue === undefined && need !== have) {
        seen.set(have, need);
        rounds += 1;
        if (seen.has(need) || rounds >= MAX_PAGE_RESERVE_ROUNDS) {
          decidedValue = cycleAnswer(seen, phase === 'deferral' ? strictValue : undefined);
          exhausted = true;
          if (decidedValue === have) continue;
          used = withReserve(used, at.index, decidedValue);
        } else {
          used = withReserve(used, at.index, need);
        }
        relayout = true;
        break;
      }
      if (
        decidedValue === undefined &&
        phase === 'strict' &&
        pagesRead(pages, floor).some((read) => computed.orphanPages.has(read.index))
      ) {
        // The page settles strictly first. A second-line reference on it, or on a page it
        // reads, may then stay with its opening line while its note continues; a page that
        // finds no such answer keeps the strict one.
        phase = 'deferral';
        strictValue = have;
        seen.clear();
        rounds = 0;
        continue;
      }
      starts[at.index] = options.startOf(at, carry);
      carries[at.index] = carry;
      carry = computed.carryBefore[floor + 1] ?? new Map();
      floor += 1;
      enter(floor);
      // The rest of the previous walk applies once a page starts where one of its pages did.
      const next = pages[floor];
      const from =
        next && previous && floor < reliable
          ? previousStarts.get(options.startOf(next, carry))
          : undefined;
      if (next && previous && from !== undefined) {
        used = new Map([...used, ...shiftedTail(previous.record, from, next.index)]);
        for (let index = from; index < previous.record.starts.length; index += 1) {
          const target = index - from + next.index;
          starts[target] = previous.record.starts[index]!;
          carries[target] = previous.record.carries[index];
        }
        complete = true;
        finished = true;
        break;
      }
    }
    if (finished) break;
    if (relayout) continue;
    if (round.whole && floor >= pages.length) {
      complete = true;
      break;
    }
  }

  return {
    reserves: used,
    record: {
      reserves: used,
      decided: complete ? starts.length : floor,
      complete,
      starts,
      carries,
    },
    exhausted,
    last,
    lastCurrent: lastUsed !== null && reservesEqual(lastUsed, used),
  };
}
