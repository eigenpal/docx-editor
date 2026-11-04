// Layouts whose wrap reflow ran out of passes and published the layout of its last pass.
//
// Such a layout opens, but some text may wrap around where an object sat one pass earlier.
// The mark lives on the result object only, never on the layout session: an edit lays the
// document out again like a fresh layout, so no state has to survive between layouts. A
// column-balance search reads it to skip trials that would each run to the ceiling.

import type { BlockLayoutResult } from './column-balance-layout.ts';

const unsettledResults = new WeakSet<BlockLayoutResult>();
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

/** Whether `result` was published before its wrap reflow settled. @internal */
export function resultUnsettled(result: BlockLayoutResult): boolean {
  return unsettledResults.has(result);
}
