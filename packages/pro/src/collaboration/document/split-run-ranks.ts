/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { LogicalId } from './identity.ts';
import type { SiblingGroup, SiblingRank, SiblingRanks } from './split-sibling-order.ts';

export interface SplitRunOrder {
  readonly first: number;
  readonly end: number;
  readonly shown: readonly LogicalId[];
  readonly moves: boolean;
  /** Whether split points or text gave the run an order, rather than the listed order. */
  readonly ordered: boolean;
  /** The paragraph the run was split off, when the run follows it. */
  readonly source: LogicalId | undefined;
  /** The existing child all heads inserted before, when it immediately follows the run. */
  readonly boundary: LogicalId | undefined;
}

/** Order enclosing runs first, including runs recovered by walking back over undo entries. */
export function composeSplitRanks(
  runs: SplitRunOrder[],
  firstListed: ReadonlyMap<LogicalId, number>
): SiblingRanks {
  if (!runs.some((run) => run.moves)) return null;
  const ranks = new Map<LogicalId, SiblingRank>();
  runs.sort((a, b) => b.end - b.first - (a.end - a.first));
  for (const [group, run] of runs.entries()) {
    const outer = ranks.get(run.shown[0]!);
    if (outer && run.shown.every((id) => ranks.get(id)?.group === outer.group)) {
      // A nested run with no order of its own keeps the order the enclosing run gave it.
      if (!run.ordered) continue;
      // Refine the enclosing order within the slots it assigned to these children. The
      // inserts hold text of the split paragraph, so they precede the paragraph they went in
      // before when the enclosing order shows that paragraph after the split one.
      const after = run.boundary === undefined ? undefined : ranks.get(run.boundary);
      const split = run.source === undefined ? undefined : ranks.get(run.source);
      const from = split?.group === outer.group ? split.rank : outer.rank;
      const ids =
        run.boundary && after?.group === outer.group && after.rank > from
          ? [...run.shown, run.boundary]
          : run.shown;
      const slots = ids.map((id) => ranks.get(id)!).sort((a, b) => a.rank - b.rank);
      ids.forEach((id, at) => ranks.set(id, slots[at]!));
    } else if (run.moves) {
      run.shown.forEach((id, rank) => {
        if ((firstListed.get(id) ?? run.first) >= run.first) ranks.set(id, { group, rank });
      });
    }
  }
  return ranks;
}

/**
 * Put each group from `from` on in the order the ranks show, so a group that a nested run
 * refined reads its paragraphs as they show. A group whose paragraphs do not all share one
 * rank group keeps its own order.
 */
export function showGroupsInRankOrder(
  groups: SiblingGroup[],
  from: number,
  ranks: SiblingRanks
): void {
  if (!ranks) return;
  for (let at = from; at < groups.length; at += 1) {
    const group = groups[at]!;
    const group0 = ranks.get(group.shown[0]!)?.group;
    if (group0 === undefined || !group.shown.every((id) => ranks.get(id)?.group === group0))
      continue;
    const rankOf = (id: LogicalId) => ranks.get(id)!.rank;
    const byRank = (a: LogicalId, b: LogicalId) => rankOf(a) - rankOf(b);
    groups[at] = {
      ...group,
      shown: [...group.shown].sort(byRank),
      heads: [...group.heads].sort(byRank),
    };
  }
}
