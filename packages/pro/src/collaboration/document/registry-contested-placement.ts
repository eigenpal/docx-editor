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
function rankOf(
  ctx: ContestContext,
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
      if (parent !== undefined) return 'fallback';
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
    const index = childrenOf(ctx, current).indexOf(child);
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
export function resolveContestedPlacements(
  ctx: ContestContext,
  multi: readonly LogicalId[]
): boolean {
  const pending = new Set(multi);
  for (const id of pending) ctx.parentIndex.delete(id);
  const rootRank = new Map<LogicalId, number>();
  ctx.partRoots.forEach((root, index) => {
    if (!rootRank.has(root)) rootRank.set(root, index);
  });
  let remaining = [...pending];
  while (remaining.length > 0) {
    const deferred: LogicalId[] = [];
    for (const id of remaining) {
      let best: { rank: Rank; parent: LogicalId } | null = null;
      let defer = false;
      for (const parent of ctx.listings.get(id) ?? []) {
        if (parent === id) continue;
        const rank = rankOf(ctx, rootRank, pending, parent);
        if (rank === 'fallback') return false;
        if (rank === 'deferred') {
          defer = true;
          continue;
        }
        if (rank === null) continue;
        const index = childrenOf(ctx, parent).indexOf(id);
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
