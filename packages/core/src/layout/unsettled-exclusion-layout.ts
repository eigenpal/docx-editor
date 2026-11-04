// Layouts whose wrap reflow ran out of passes and published the layout of its last pass.
//
// Such a layout opens, but some text may wrap around where an object sat one pass earlier. An
// edit of it must not run the whole reflow again: a seeded reflow that misses the ceiling
// would settle again from scratch and reach the ceiling twice per keystroke. It lays out one
// more pass instead, so the wrap keeps settling by one pass per edit. The mark lives on the
// layout session that published the layout, until a pass of that session settles.

import type { BlockLayoutResult } from './column-balance-layout.ts';
import type { LayoutSession } from './layout-session.ts';

const unsettledResults = new WeakSet<BlockLayoutResult>();
const unsettledSessions = new WeakSet<LayoutSession>();
let warned = false;

/** Says once per process that a wrap reflow stopped before it settled. */
export function noteUnsettledExclusionReflow(passes: number): void {
  if (warned) return;
  warned = true;
  console.warn(
    `[docx-editor] Text wrap around anchored objects did not settle in ${passes} layout passes. ` +
      'Some text may wrap around an earlier position of an object.'
  );
}

/** Records that `result` was published before its wrap reflow settled. */
export function markResultUnsettled(result: BlockLayoutResult, passes: number): void {
  unsettledResults.add(result);
  noteUnsettledExclusionReflow(passes);
}

/** Carries whether `result`, which `session` now holds, settled. */
export function noteSessionResult(session: LayoutSession, result: BlockLayoutResult): void {
  if (unsettledResults.has(result)) unsettledSessions.add(session);
  else unsettledSessions.delete(session);
}

/** Whether `session` holds a layout published before its wrap reflow settled. @internal */
export function sessionLayoutUnsettled(session: LayoutSession | undefined): boolean {
  return session !== undefined && unsettledSessions.has(session);
}
