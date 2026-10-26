/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * A decision that removes a revision from text on both sides of text it deletes, as rejecting
 * an insertion nested in a deletion does, writes the removal across the deleted text too.
 *
 * A removal is a format: it ends with a marker that restores the revision where the next
 * character still holds it. Written only over the kept text, that marker stood just after it,
 * before the text the decision deletes, and a character a peer typed into the deleted text at
 * the same time sat after the marker: inside the revision the decision removed. Written across
 * the deleted text first, the revision ends where the deleted text ends, and the peer's
 * character is outside it, as everywhere else the decision reached.
 */
import type * as Y from 'yjs';
import { REVISION_PREFIX, SUPERSEDED_KEY } from './paragraph-text-revisions.ts';
import type { Step, Token } from './paragraph-text-diff.ts';

type Changes = Readonly<Record<string, string | null>>;

/** Whether a change removes a revision from the characters it formats. */
function removesRevision(changes: Changes): boolean {
  for (const key of Object.keys(changes)) {
    if (key.startsWith(REVISION_PREFIX) && changes[key] === null) return true;
  }
  return false;
}

/**
 * Format each run of deleted characters beside a kept character that loses a revision with
 * that character's change, before the edit inserts or deletes anything. `changeOf` is the
 * change the edit writes on a kept character, or null.
 */
export function formatDecidedDeletions(
  text: Y.Text,
  before: readonly Token[],
  after: readonly Token[],
  steps: readonly Step[],
  changeOf: (from: Token['attributes'], to: Token['attributes']) => Changes | null
): void {
  // One entry per character before the edit: the change of a kept character that loses a
  // revision, `del` for a deleted one, null for anything else.
  const marks: (Changes | 'del' | null)[] = new Array<Changes | 'del' | null>(before.length).fill(
    null
  );
  let decides = false;
  for (const step of steps) {
    if (step.op === 'del') marks[step.before] = 'del';
    if (step.op !== 'eq') continue;
    const changes = changeOf(before[step.before]!.attributes, after[step.after]!.attributes);
    if (!changes || !removesRevision(changes)) continue;
    marks[step.before] = changes;
    decides = true;
  }
  if (!decides) return;
  let index = 0;
  while (index < marks.length) {
    if (marks[index] !== 'del') {
      index += 1;
      continue;
    }
    let end = index;
    while (end < marks.length && marks[end] === 'del') end += 1;
    const left = index > 0 ? marks[index - 1] : null;
    const right = end < marks.length ? marks[end] : null;
    const beside = left && left !== 'del' ? left : right && right !== 'del' ? right : null;
    if (beside) {
      // The deleted text leaves every revision it was in, a nested one included: text a peer
      // typed into it at the same time is in none of the revisions the decision removed. It
      // also takes the kept neighbor's other changes, a text element's kind among them, so the
      // peer's text reads as the text around it does after the decision.
      const changes: Record<string, string | null> = { ...beside };
      for (let at = index; at < end; at += 1) {
        for (const key of Object.keys(before[at]!.attributes)) {
          if (key.startsWith(REVISION_PREFIX) || key === SUPERSEDED_KEY) changes[key] = null;
        }
      }
      // Only adjacent positions: a hidden character between two deleted ones keeps its own.
      let start = index;
      for (let at = index + 1; at <= end; at += 1) {
        if (at < end && before[at]!.position === before[at - 1]!.position! + 1) continue;
        const first = before[start]!.position!;
        text.format(first, before[at - 1]!.position! - first + 1, changes);
        start = at;
      }
    }
    index = end;
  }
}
