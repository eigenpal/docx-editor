// Transactional row-progress preflight for repeated table headers.

import {
  layoutRowFragmentBounded,
  stripAnchorSinksForProbe,
  type CellPlaceCursor,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import type { SemanticTableRow } from './semantic-table.ts';

/**
 * Whether a bounded row placement can consume authored content without publishing anything.
 *
 * Repeated table headers ask this before committing their copy to a continuation page. A header
 * that leaves no room for the pending row must be omitted on that page; discovering that only
 * after placement would leave live line ids, drawing sinks and shared budgets mutated by geometry
 * that is then discarded. The probe deliberately keeps all geometry inputs (including page wrap
 * zones and the exact continuation cursor) while replacing every publication/retention seam.
 *
 * It intentionally probes the row without an admitted vMerge plan. Admission is tied to the
 * row's committed page position and has no snapshot/rollback seam; reusing the previous page's
 * options produced false negatives for carried merges, while accepting against a speculative
 * header position would leave stale floors behind when the repeat is suppressed. The unplanned
 * row is the conservative progress baseline: vMerge can detach or floor geometry, but cannot take
 * away the first authored progress that this baseline can place.
 * @internal
 */
export function probeRowFragmentProgress(
  row: SemanticTableRow,
  cols: readonly number[],
  left: number,
  rowTop: number,
  maxBottom: number,
  isContinuation: boolean,
  depth: number,
  deps: TableFlowDeps,
  cursors: readonly CellPlaceCursor[],
  cellSpacingPt = 0
): boolean {
  let lineCounter = 0;
  const probeDeps: TableFlowDeps = {
    ...stripAnchorSinksForProbe(deps),
    cache: undefined,
    borderOwnershipBudget: undefined,
    vMergeResolveBudget: undefined,
    onCellBreakKey: undefined,
    nextLineId: () => `probe-progress-${lineCounter++}`,
  };
  return layoutRowFragmentBounded(
    row,
    cols,
    left,
    rowTop,
    maxBottom,
    false,
    isContinuation,
    depth,
    probeDeps,
    cursors,
    cellSpacingPt
  ).fitted;
}
