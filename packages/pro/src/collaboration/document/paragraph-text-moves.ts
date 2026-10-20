/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Text that one edit moves from one paragraph to another keeps where it came from.
 *
 * Splitting a paragraph deletes its tail and inserts the same characters into the new
 * paragraph. The inserted characters carry their origin: the identity of the first character
 * they copy (`paragraph-text-identity.ts`). Each insert takes its own origin, and the
 * characters of one insert copy characters with consecutive identities, so each copied
 * character's identity follows from its place in the insert. With identities, two peers'
 * copies of one text show once (`paragraph-text-follow.ts`).
 */

import { isNextClock } from './identity.ts';
import * as Y from 'yjs';
import { insertAndFind } from './yjs-items.ts';
import { textMarksOf } from './paragraph-text-marks.ts';

/**
 * The token attribute that carries a moved run's source identity from move matching to the
 * writer, which marks the copy in `paragraph-text-marks.ts`. It never reaches shared text.
 */
export const ORIGIN_KEY = 'o';

/**
 * Where typed text follows: after, or with `before`, before the character `identity`. Its
 * stored form, in `paragraph-text-marks.ts`, is the identity, the identity with a leading `^`,
 * or `-` for text typed into a paragraph that shows no character, which stays where it was
 * typed.
 */
export interface FollowAnchor {
  readonly identity: string;
  readonly before: boolean;
}

const ANCHOR = /^(\^?)(\d{1,16}:\d{1,16})$/;

/** The anchor of text that stays where it was typed: no character has its identity. */
export const STAY = '-';

/** A follow anchor from its shared form, or null. */
export function parseFollowAnchor(value: unknown): FollowAnchor | null {
  if (value === STAY) return { identity: STAY, before: false };
  const match = typeof value === 'string' ? ANCHOR.exec(value) : null;
  return match ? { identity: match[2]!, before: match[1] === '^' } : null;
}

/** Where a copy comes from, and which insert made it. */
export interface Origin {
  /** The identity of the first character the copy copies. */
  readonly client: number;
  readonly clock: number;
  /** The client, first clock and length of the copy's own insert. */
  readonly insertClient: number;
  readonly firstClock: number;
  readonly length: number;
}

/**
 * Insert a copy of characters whose first has identity `source`, and mark it. The mark is
 * keyed by the copy's own first clock, which Yjs assigns as it inserts, so the copy is
 * inserted first and marked after.
 */
export function insertCopy(
  text: Y.Text,
  position: number,
  value: string,
  attributes: Readonly<Record<string, string>>,
  source: string
): void {
  const plain: Record<string, string> = { ...attributes };
  delete plain[ORIGIN_KEY];
  const item = insertAndFind(text, position, value, plain);
  if (item)
    textMarksOf(text.doc!).markCopy('move', item.id.client, item.id.clock, value.length, source);
}

interface MoveToken {
  readonly insert: unknown;
  readonly attributes: Readonly<Record<string, string>>;
  readonly position?: number;
}

type MoveStep =
  | { readonly op: 'eq'; readonly before: number; readonly after: number }
  | { readonly op: 'del'; readonly before: number }
  | { readonly op: 'ins'; readonly after: number };

/** One paragraph's planned write, as `markMoves` reads and changes it. */
export interface ParagraphWrite<T extends MoveToken> {
  readonly before: readonly T[];
  readonly after: T[];
  readonly steps: readonly MoveStep[];
  /** The identity of the character at each position of the paragraph's shared text. */
  readonly identities: readonly (string | null)[];
}

interface Run {
  readonly paragraph: number;
  readonly indexes: readonly number[];
  readonly value: string;
}

/** Contiguous character runs of one step kind. */
function runsOf<T extends MoveToken>(
  write: ParagraphWrite<T>,
  paragraph: number,
  op: 'del' | 'ins'
): Run[] {
  const runs: Run[] = [];
  let indexes: number[] = [];
  let value = '';
  const flush = (): void => {
    if (indexes.length > 0) runs.push({ paragraph, indexes, value });
    indexes = [];
    value = '';
  };
  for (const step of write.steps) {
    if (step.op !== op) {
      if (step.op !== (op === 'del' ? 'ins' : 'del')) flush();
      continue;
    }
    const index = step.op === 'del' ? step.before : step.after;
    const token = step.op === 'del' ? write.before[index]! : write.after[index]!;
    if (typeof token.insert !== 'string') {
      flush();
      continue;
    }
    indexes.push(index);
    value += token.insert;
  }
  flush();
  return runs;
}

/** Characters a move keeps: a stretch of an inserted run equal to a stretch of a deleted one. */
interface Match {
  readonly source: Run;
  /** Offsets of the first character in the source and in the inserted run, and the length. */
  readonly from: number;
  readonly to: number;
  readonly length: number;
}

/**
 * Whether a match covers a whole stretch of its source that nothing matched yet: what the
 * same-element pass left between two matched pieces, or a run's untouched remainder.
 */
function coversStretch(sourceTaken: readonly boolean[], match: Match): boolean {
  const end = match.from + match.length;
  return (
    (match.from === 0 || sourceTaken[match.from - 1]!) &&
    (end === sourceTaken.length || sourceTaken[end]!)
  );
}

/** Above this many compared pairs, only whole deleted runs are matched. */
const MAX_MATCH_CELLS = 1 << 20;
/**
 * Comparisons one edit may spend finding moved text, over all its paragraphs. Past it, the
 * rest of the inserted text is new text: correct, but text a peer typed in it meanwhile no
 * longer follows it. An edit that replaces a large document stays bounded.
 */
const MAX_EDIT_MATCH_CELLS = 1 << 24;

/** What is left of `MAX_EDIT_MATCH_CELLS` for one edit. */
interface MatchBudget {
  cells: number;
}

/**
 * The longest stretch of `run` equal, character and text element alike, to a stretch of a
 * deleted run of another paragraph, among characters neither side has matched yet.
 */
function longestMatch(
  run: Run,
  keysOf: (run: Run) => readonly string[],
  deleted: readonly Run[],
  taken: Map<Run, boolean[]>,
  sameScope: (left: number, right: number) => boolean,
  budget: MatchBudget,
  within = false
): Match | null {
  const keys = keysOf(run);
  const runTaken = taken.get(run)!;
  let best: Match | null = null;
  for (const source of deleted) {
    // Moves are between paragraphs; `within` matches text a paragraph wrote again in place.
    if ((source.paragraph === run.paragraph) !== within) continue;
    if (!sameScope(source.paragraph, run.paragraph)) continue;
    const sourceKeys = keysOf(source);
    const sourceTaken = taken.get(source)!;
    const cells = sourceKeys.length * keys.length;
    if (cells > MAX_MATCH_CELLS) continue;
    if (cells > budget.cells) return best;
    budget.cells -= cells;
    let previous = new Uint32Array(keys.length + 1);
    for (let i = 1; i <= sourceKeys.length; i += 1) {
      const current = new Uint32Array(keys.length + 1);
      for (let j = 1; j <= keys.length; j += 1) {
        if (sourceTaken[i - 1] || runTaken[j - 1] || sourceKeys[i - 1] !== keys[j - 1]) continue;
        const length = previous[j - 1]! + 1;
        current[j] = length;
        if (length > (best?.length ?? 0))
          best = { source, from: i - length, to: j - length, length };
      }
      previous = current;
    }
  }
  return best;
}

/**
 * Give the characters one plan moves between paragraphs their origin. `withOrigin` returns a
 * token with the origin added to its attributes; `signature` names a token's attributes, so
 * that each Yjs insert, which groups equal attributes, starts its own origin. `holderOf`
 * names the text element a token's character sits in, the same in every paragraph.
 *
 * A moved character keeps its text element, so a stretch of inserted text that equals a
 * stretch of deleted text in both is that text moved, even when the edit deleted the rest
 * of its run, as a deletion across two paragraphs does. `scopeOf` names the story a
 * paragraph is in: text moves only within one, and the same letters written into a comment
 * or a note in the same edit are not text moved there.
 */
export function markMoves<T extends MoveToken>(
  writes: readonly ParagraphWrite<T>[],
  withOrigin: (token: T, origin: string) => T,
  signature: (token: T) => string,
  holderOf: (token: T, paragraph: number) => string = () => '',
  scopeOf: (paragraph: number) => string = () => ''
): ReadonlySet<string> {
  const copied = new Set<string>();
  const deleted = writes.flatMap((write, paragraph) => runsOf(write, paragraph, 'del'));
  if (deleted.length === 0) return copied;
  const inserted = writes.flatMap((write, paragraph) => runsOf(write, paragraph, 'ins'));
  const deletedRuns = new Set(deleted);
  const budget: MatchBudget = { cells: MAX_EDIT_MATCH_CELLS };
  const keyCache = new Map<string, string[]>();
  const keysBy =
    (withHolder: boolean) =>
    (run: Run): readonly string[] => {
      const isDeleted = deletedRuns.has(run);
      const cacheKey = `${withHolder}:${run.paragraph}:${run.indexes[0]}:${isDeleted}`;
      let cached = keyCache.get(cacheKey);
      if (!cached) {
        const write = writes[run.paragraph]!;
        cached = run.indexes.map((index) => {
          const token = isDeleted ? write.before[index]! : write.after[index]!;
          const value = token.insert as string;
          return withHolder ? `${value}\u0000${holderOf(token, run.paragraph)}` : value;
        });
        keyCache.set(cacheKey, cached);
      }
      return cached;
    };
  const taken = new Map<Run, boolean[]>();
  for (const run of [...deleted, ...inserted])
    taken.set(
      run,
      run.indexes.map(() => false)
    );
  const scopes = writes.map((_, paragraph) => scopeOf(paragraph));
  // A paragraph this edit creates has no parent edge yet, so its story is unknown: any.
  const sameScope = (left: number, right: number): boolean =>
    scopes[left] === '' || scopes[right] === '' || scopes[left] === scopes[right];
  const take = (run: Run, match: Match): void => {
    for (let at = 0; at < match.length; at += 1) {
      taken.get(match.source)![match.from + at] = true;
      taken.get(run)![match.to + at] = true;
    }
    assignOrigins(writes, run, match, withOrigin, signature, copied);
  };
  // A run inserted whole as another paragraph deleted it is that run moved, as Enter moves a
  // paragraph's tail: its characters keep their order, whatever elements a split gives them.
  for (const run of inserted) {
    const source = deleted.find(
      (candidate) =>
        candidate.paragraph !== run.paragraph &&
        sameScope(candidate.paragraph, run.paragraph) &&
        candidate.value === run.value &&
        !taken.get(candidate)!.some(Boolean)
    );
    if (source) take(run, { source, from: 0, to: 0, length: run.indexes.length });
  }
  // Then characters in the same text element: a move keeps the element of most of what it
  // moves. Then by value, but only whole stretches the first pass left: a split gives its
  // tail a new run, and by value alone a short match could be any typed text.
  for (const run of inserted) {
    for (let match = longestMatch(run, keysBy(true), deleted, taken, sameScope, budget); match; ) {
      take(run, match);
      match = longestMatch(run, keysBy(true), deleted, taken, sameScope, budget);
    }
  }
  // Text a paragraph deletes and writes again, as a run split by new formatting or markup
  // is, was rewritten there, not moved: its letters elsewhere are new text.
  const insertedIn = new Map<number, Run[]>();
  for (const run of inserted)
    insertedIn.set(run.paragraph, [...(insertedIn.get(run.paragraph) ?? []), run]);
  const rewritten = new Set(
    deleted.filter((source) =>
      (insertedIn.get(source.paragraph) ?? []).some((run) => run.value.includes(source.value))
    )
  );
  const movable = deleted.filter((source) => !rewritten.has(source));
  const wholeMatches = (sources: readonly Run[], run: Run, within: boolean): void => {
    for (;;) {
      const match = longestMatch(run, keysBy(false), sources, taken, sameScope, budget, within);
      if (!match || !coversStretch(taken.get(match.source)!, match)) break;
      take(run, match);
    }
  };
  for (const run of inserted) wholeMatches(movable, run, false);
  // Rewritten text keeps its identities where it was rewritten, as a run that a join merges
  // with the next one is: text a peer typed after one of its characters still finds it, and a
  // record of the deletion never names text that still shows.
  const rewrittenIn = new Map<number, Run[]>();
  for (const source of rewritten) {
    rewrittenIn.set(source.paragraph, [...(rewrittenIn.get(source.paragraph) ?? []), source]);
  }
  for (const run of inserted) {
    const sources = rewrittenIn.get(run.paragraph);
    if (sources) wholeMatches(sources, run, true);
  }
  return copied;
}

function assignOrigins<T extends MoveToken>(
  writes: readonly ParagraphWrite<T>[],
  run: Run,
  match: Match,
  withOrigin: (token: T, origin: string) => T,
  signature: (token: T) => string,
  copied: Set<string>
): void {
  const write = writes[match.source.paragraph]!;
  const identityAt = (at: number): string | null => {
    const token = write.before[match.source.indexes[match.from + at]!];
    return token?.position === undefined ? null : (write.identities[token.position] ?? null);
  };
  const target = writes[run.paragraph]!;
  let origin: string | null = null;
  for (let at = 0; at < match.length; at += 1) {
    const index = run.indexes[match.to + at]!;
    const identity = identityAt(at);
    if (identity) copied.add(identity);
    const previous = at > 0 ? target.after[run.indexes[match.to + at - 1]!]! : null;
    const sameInsert = previous !== null && signature(previous) === signature(target.after[index]!);
    if (!origin || !sameInsert || !isNextClock(identityAt(at - 1), identity)) origin = identity;
    if (origin) target.after[index] = withOrigin(target.after[index]!, origin);
  }
}
