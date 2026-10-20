// The time every scenario reads.
//
// Yjs groups an author's edits into one undo step when they come within its capture window,
// and it reads the time through lib0, which binds `Date.now` once, when it loads. With the
// real clock, a seed replayed on a busier machine groups its edits differently, undoes
// something else, and fails differently or not at all, so it cannot be shrunk. Import this
// module before anything that loads Yjs: from then on the time moves only when a scenario
// performs an action.

const START = 1_700_000_000_000;
let now = START;

Date.now = () => now;

/** Start a scenario at the same time as every other. */
export function resetClock(): void {
  now = START;
}

/** Move the time on by one action's worth. */
export function advanceClock(milliseconds: number): void {
  now += milliseconds;
}
