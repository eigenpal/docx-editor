/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * First-preorder placement for ids listed by more than one parent, without walking the
 * document.
 *
 * A contested id used to send the whole update batch through the full preorder walk, which a
 * hostile peer can force per batch just by keeping one child listed twice. The walk only ever
 * decides between the listing parents, and each parent's preorder position is readable off the
 * derived indexes directly: climb the parent chain to a part root and note the sibling index
 * at every step. Comparing those index paths lexicographically — a prefix sorts before its
 * extensions — is exactly the order the walk visits nodes in, so the earliest path wins the
 * child, and the cost is the depth of the listing parents instead of the size of the document.
 *
 * The climb refuses shapes only the walk can rank: it reports `false` and the caller runs the
 * full walk. That keeps the answers identical by construction — every locally decided contest
 * is decided by the same first-preorder rule.
 */

import { childArrayOf, isNodeMap, nodeRecordTombstoned, type PackageSchema } from './schema.ts';
import type { LogicalId } from './identity.ts';

export interface ContestContext {
  readonly nodes: PackageSchema['nodes'];
  /** Mutated in place: contested entries are deleted, then the winners written back. */
  readonly parentIndex: Map<LogicalId, LogicalId>;
  readonly listings: ReadonlyMap<LogicalId, ReadonlySet<LogicalId>>;
  readonly childrenSnapshot: ReadonlyMap<LogicalId, readonly LogicalId[]>;
  /** Part roots in directory order — the order the full walk visits them. */
  readonly partRoots: readonly LogicalId[];
}

type Rank = readonly number[];

/** Preorder order: positions differ at the first divergent index, and a prefix comes first. */
function compareRanks(left: Rank, right: Rank): number {
  const shared = Math.min(left.length, right.length);
  for (let at = 0; at < shared; at += 1) {
    const diff = left[at]! - right[at]!;
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

function childrenOf(ctx: ContestContext, id: LogicalId): readonly LogicalId[] {
  const snapshot = ctx.childrenSnapshot.get(id);
  if (snapshot) return snapshot;
  return childArrayOf(ctx.nodes.get(id))?.toArray() ?? [];
}

/** A node the walk would not iterate: missing from shared state, malformed, or tombstoned. */
function isDead(ctx: ContestContext, id: LogicalId): boolean {
  const rec = ctx.nodes.get(id);
  return !isNodeMap(rec) || nodeRecordTombstoned(rec);
}

/**
 * The preorder position of one listing parent, as a path of sibling indexes from a part root.
 *
 * `deferred` means the chain runs through a contested id this batch has not decided yet.
 * `fallback` means only the walk can rank it — a part root that some child array also lists
 * has two positions. `null` means the parent reaches no root at all: a cycle, an orphan, or a
 * tombstoned ancestor, none of which the walk lets claim a child.
 */
/**
 * Sibling indexes for one resolution call. A contest climbs through the body root, which
 * lists every block, so scanning its child array once per contested id made every
 * structural edit cost the number of contests times the number of blocks.
 */
class SiblingIndexes {
  private readonly byParent = new Map<LogicalId, Map<LogicalId, number>>();
  constructor(private readonly ctx: ContestContext) {}

  indexOf(parent: LogicalId, child: LogicalId): number {
    let indexes = this.byParent.get(parent);
    if (!indexes) {
      indexes = new Map();
      childrenOf(this.ctx, parent).forEach((id, index) => {
        if (!indexes!.has(id)) indexes!.set(id, index);
      });
      this.byParent.set(parent, indexes);
    }
    return indexes.get(child) ?? -1;
  }
}

function rankOf(
  ctx: ContestContext,
  siblings: SiblingIndexes,
  rootRank: ReadonlyMap<LogicalId, number>,
  pending: ReadonlySet<LogicalId>,
  startId: LogicalId
): Rank | 'deferred' | 'fallback' | null {
  const chain: LogicalId[] = [];
  const visited = new Set<LogicalId>();
  let node = startId;
  let rootIndex: number | undefined;
  for (;;) {
    if (visited.has(node)) return null;
    visited.add(node);
    if (isDead(ctx, node)) return null;
    rootIndex = rootRank.get(node);
    const parent = ctx.parentIndex.get(node);
    if (rootIndex !== undefined) {
      // A part root some child array also lists has two positions. A pending one has had its
      // parent entry cleared for this call, so the missing parent does not prove it has none.
      if (parent !== undefined || pending.has(node)) return 'fallback';
      break;
    }
    if (parent === undefined) return pending.has(node) ? 'deferred' : null;
    chain.push(node);
    node = parent;
  }
  const path: number[] = [rootIndex];
  let current = node;
  for (let at = chain.length - 1; at >= 0; at -= 1) {
    const child = chain[at]!;
    const index = siblings.indexOf(current, child);
    if (index < 0) return null;
    path.push(index);
    current = child;
  }
  return path;
}

/**
 * Decide every contested id locally, or say the caller has to run the full walk.
 *
 * Ids are retried in rounds so a contested id whose listing parent is itself contested waits
 * for that parent's decision. A round that decides nothing is a contest that depends on
 * itself — an id listed inside its own subtree — and only the walk untangles that.
 */
function resolveContestedPlacements(ctx: ContestContext, multi: readonly LogicalId[]): boolean {
  const pending = new Set(multi);
  for (const id of pending) ctx.parentIndex.delete(id);
  const rootRank = new Map<LogicalId, number>();
  ctx.partRoots.forEach((root, index) => {
    if (!rootRank.has(root)) rootRank.set(root, index);
  });
  const siblings = new SiblingIndexes(ctx);
  // A decided rank never changes within one call: only pending ids move, and a chain through
  // one of them is `deferred`, which is not kept.
  const ranks = new Map<LogicalId, Rank | 'fallback' | null>();
  const rankOfLister = (parent: LogicalId): Rank | 'deferred' | 'fallback' | null => {
    const known = ranks.get(parent);
    if (known !== undefined) return known;
    const rank = rankOf(ctx, siblings, rootRank, pending, parent);
    if (rank !== 'deferred') ranks.set(parent, rank);
    return rank;
  };
  let remaining = [...pending];
  while (remaining.length > 0) {
    const deferred: LogicalId[] = [];
    for (const id of remaining) {
      let best: { rank: Rank; parent: LogicalId } | null = null;
      let defer = false;
      for (const parent of ctx.listings.get(id) ?? []) {
        if (parent === id) continue;
        const rank = rankOfLister(parent);
        if (rank === 'fallback') return false;
        if (rank === 'deferred') {
          defer = true;
          continue;
        }
        if (rank === null) continue;
        const index = siblings.indexOf(parent, id);
        if (index < 0) continue;
        const full = [...rank, index];
        if (!best || compareRanks(full, best.rank) < 0) best = { rank: full, parent };
      }
      if (defer) {
        deferred.push(id);
        continue;
      }
      if (best) ctx.parentIndex.set(id, best.parent);
      pending.delete(id);
    }
    if (deferred.length === remaining.length) return false;
    remaining = deferred;
  }
  return true;
}

/**
 * Full first-preorder parent assignment over every part.
 *
 * The fallback for shapes the local resolution refuses, and the whole-index rebuild after a
 * bulk load. Explicit enter/exit frames instead of recursion: nesting depth is remote input,
 * and a crafted deep child chain must not overflow the call stack from inside a Yjs
 * observer. A node is assigned its parent when it is first REACHED in preorder — before its
 * own record guards — which is the order the recursive walk had.
 */
export function assignFirstReachableParents(
  context: ContestContext,
  only: ReadonlySet<LogicalId> | null
): void {
  const { nodes, parentIndex, childrenSnapshot, partRoots } = context;
  if (only) {
    for (const id of only) parentIndex.delete(id);
  }
  type Frame = {
    readonly id: LogicalId;
    readonly parent: LogicalId | null;
    readonly exit: boolean;
  };
  for (const root of partRoots) {
    const path = new Set<LogicalId>();
    const stack: Frame[] = [{ id: root, parent: null, exit: false }];
    while (stack.length > 0) {
      const frame = stack.pop()!;
      if (frame.exit) {
        path.delete(frame.id);
        continue;
      }
      const id = frame.id;
      if (frame.parent !== null && (only === null || only.has(id))) {
        if (!parentIndex.has(id)) parentIndex.set(id, frame.parent);
      }
      if (path.has(id)) continue;
      const rec = nodes.get(id);
      if (!isNodeMap(rec) || nodeRecordTombstoned(rec)) continue;
      const children = childrenSnapshot.get(id) ?? childArrayOf(rec)?.toArray() ?? [];
      path.add(id);
      stack.push({ id, parent: null, exit: true });
      const seen = new Set<string>();
      const pending: LogicalId[] = [];
      for (const childId of children) {
        if (seen.has(childId) || childId === id) continue;
        seen.add(childId);
        pending.push(childId);
      }
      for (let at = pending.length - 1; at >= 0; at -= 1) {
        stack.push({ id: pending[at]!, parent: id, exit: false });
      }
    }
  }
}

/**
 * Give each of `ids` its parent: none when nothing lists it, its one lister when one does, and
 * for a child two parents list, the contest rules above, or the first-preorder walk when they
 * cannot decide.
 */
export function placeParents(context: ContestContext, ids: ReadonlySet<LogicalId>): void {
  const multi: LogicalId[] = [];
  for (const id of ids) {
    const listed = context.listings.get(id);
    if (!listed || listed.size === 0) {
      context.parentIndex.delete(id);
      continue;
    }
    if (listed.size === 1) {
      context.parentIndex.set(id, [...listed][0]!);
      continue;
    }
    multi.push(id);
  }
  if (multi.length === 0) return;
  if (!resolveContestedPlacements(context, multi)) {
    assignFirstReachableParents(context, new Set(multi));
  }
}
