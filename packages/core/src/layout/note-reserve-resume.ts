// Resuming a section pass when only its footnote reserves moved.
//
// The reserves of a notes pass are part of each section's context key, so a reserve that moved
// on one page made every checkpoint of the section unusable, and the section laid out again
// from its first page on every round of the reserve search. A checkpoint describes the flow
// before one block, with the pages completed so far and one page open. The reserves of those
// pages are the only ones it has read, so it stays valid while they are unchanged.

import type { FlowCheckpoint, LayoutSession } from './layout-session.ts';
import { notesReserveContextKey } from './note-reserves.ts';

interface ReserveContext {
  /** The pass context without its reserve part. */
  readonly base: string;
  /** Section-local page slot -> reserve, every slot the pass could read. */
  readonly reserves: ReadonlyMap<number, number>;
  /** The pages the pass produced. */
  readonly pageCount: number;
}

const reserveContexts = new WeakMap<LayoutSession, ReserveContext>();

function localReserves(
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  bound: number
): Map<number, number> {
  const local = new Map<number, number>();
  if (!reserves) return local;
  for (const [pageIndex, height] of reserves) {
    const slot = pageIndex - pageIndexStart;
    if (slot >= 0 && slot < bound && height > 0) local.set(slot, height);
  }
  return local;
}

/** Record the context a pass ran under, for the next pass on `session`. */
export function rememberReserveContext(
  session: LayoutSession,
  base: string,
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  pageCount: number
): void {
  reserveContexts.set(session, {
    base,
    reserves: localReserves(reserves, pageIndexStart, pageCount + 1),
    pageCount,
  });
}

/** Save the reserve record behind `session`'s checkpoints; the answer puts it back. */
export function saveReserveContext(session: LayoutSession): () => void {
  const saved = reserveContexts.get(session);
  return () => {
    if (saved) reserveContexts.set(session, saved);
    else reserveContexts.delete(session);
  };
}

/**
 * The first section-local page whose reserve differs from the previous pass, when the rest of
 * the context is the same. Undefined when anything else in the context moved, or when the
 * session holds no record of the previous pass.
 */
export function firstMovedReservePage(
  session: LayoutSession | undefined,
  base: string,
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  bound: number
): number | undefined {
  const previous = session ? reserveContexts.get(session) : undefined;
  if (!previous || previous.base !== base) return undefined;
  const next = localReserves(reserves, pageIndexStart, bound);
  let first = Infinity;
  for (const [slot, height] of next) {
    if (previous.reserves.get(slot) !== height) first = Math.min(first, slot);
  }
  for (const [slot, height] of previous.reserves) {
    if (slot < bound && next.get(slot) !== height) first = Math.min(first, slot);
  }
  return first;
}

/**
 * The last block a pass may resume before: its checkpoint has completed fewer pages than
 * `page`, so the page it holds open, and every page before it, kept its reserve.
 */
export function resumeLimitBeforePage(
  checkpoints: readonly FlowCheckpoint[],
  page: number
): number {
  let index = 0;
  while (index + 1 < checkpoints.length && checkpoints[index + 1]!.pageCount < page) index += 1;
  return checkpoints[0] && checkpoints[0].pageCount < page ? index : 0;
}

/**
 * Whether the previous pass's pages from `fromPage` on can be reused `delta` pages later: each
 * of them must find the same reserve at its new page, and no reserve may appear on a page
 * that had none.
 */
export function tailReservesMatch(
  session: LayoutSession,
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  fromPage: number,
  delta: number
): boolean {
  const previous = reserveContexts.get(session);
  if (!previous) return false;
  // The reused pages land at [fromPage + delta, pageCount + delta]; slots past them belong to
  // another section.
  const next = localReserves(reserves, pageIndexStart, previous.pageCount + delta + 1);
  for (const [slot, height] of previous.reserves) {
    if (slot >= fromPage && next.get(slot + delta) !== height) return false;
  }
  for (const [slot, height] of next) {
    if (slot >= fromPage + delta && previous.reserves.get(slot - delta) !== height) return false;
  }
  return true;
}

/**
 * The reserve slots a section pass keys on. The pass reads reserves at `pageIndexStart` plus
 * consecutive local page slots as it opens pages, so a bound of "the page count the previous
 * pass produced, plus one" covers every slot an input-identical replay can touch, and keeps a
 * reserve on another section's pages from invalidating this one. A fresh session has no such
 * bound and folds every entry from `pageIndexStart` on (conservative, one full pass).
 */
export function reserveKeyBoundOf(session: LayoutSession | undefined): number {
  return session?.previous ? session.previous.pages.length + 1 : Infinity;
}

/**
 * Store the context of a finished pass on `session`.
 *
 * The reserve part is sliced again with the page count THIS pass produced: a pass that grew
 * past the start-time bound read reserve slots the start-time key never folded, and the next
 * comparison must see them. An input-identical replay produces the same count, so its
 * start-time string IS that string, reused by identity so the next check is a pointer compare.
 */
export function publishPassContext(
  session: LayoutSession,
  contextFor: (notesReserveKey: string) => string,
  context: string,
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number,
  startBound: number,
  pageCount: number
): void {
  session.context =
    pageCount + 1 === startBound
      ? context
      : contextFor(notesReserveContextKey(reserves, pageIndexStart, pageCount + 1));
  rememberReserveContext(session, contextFor(''), reserves, pageIndexStart, pageCount);
}

/** The reserve side of one section pass's reuse decisions. */
export interface SectionReserveResume {
  /** The pass context, with the reserve entries this pass can read. */
  readonly context: string;
  /** The first section-local page whose reserve moved, when nothing else did. */
  readonly moved: number | undefined;
  /** `firstChanged`, lowered to a checkpoint the moved reserves left valid. */
  resumeLimit(checkpoints: readonly FlowCheckpoint[], firstChanged: number): number;
  /** Whether the previous tail from `mark` may be reused with this pass at `pageCount` pages. */
  tailHolds(mark: FlowCheckpoint, pageCount: number): boolean;
  /** Store this pass's context on `session` once the pass produced `pageCount` pages. */
  publish(session: LayoutSession, pageCount: number): void;
}

export function sectionReserveResume(
  session: LayoutSession | undefined,
  contextFor: (notesReserveKey: string) => string,
  reserves: ReadonlyMap<number, number> | undefined,
  pageIndexStart: number
): SectionReserveResume {
  const bound = reserveKeyBoundOf(session);
  const context = contextFor(notesReserveContextKey(reserves, pageIndexStart, bound));
  const moved =
    session && session.context !== context
      ? firstMovedReservePage(session, contextFor(''), reserves, pageIndexStart, bound)
      : undefined;
  return {
    context,
    moved,
    // At least the last block is placed again. The previous layout a session holds can be the
    // published one, with note sheets minted after the body; handing it back unchanged would
    // pass those sheets off as body pages.
    resumeLimit: (checkpoints, firstChanged) =>
      moved === undefined
        ? firstChanged
        : Math.min(
            firstChanged,
            resumeLimitBeforePage(checkpoints, moved),
            Math.max(0, checkpoints.length - 2)
          ),
    tailHolds: (mark, pageCount) =>
      moved === undefined ||
      (session !== undefined &&
        tailReservesMatch(
          session,
          reserves,
          pageIndexStart,
          mark.pageCount,
          pageCount - mark.pageCount
        )),
    publish: (target, pageCount) =>
      publishPassContext(target, contextFor, context, reserves, pageIndexStart, bound, pageCount),
  };
}
