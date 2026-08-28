/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Deterministic de-duplication of concurrent format splits (#581).
 *
 * `setRunProperties` splits the target run and replaces it with new runs carrying copies of
 * the partitioned text. Two peers doing this at once leave both run-sets in the paragraph, so
 * the text doubles and both replicas agree on the corruption. Each new run records the origin
 * run it superseded (a scalar the minting peer owns, so there is no shared container to
 * race); this index groups the concurrent splits under that origin and names the runs a
 * replica must drop, keeping one replica's set deterministically so every peer converges on
 * the same tree with the text intact.
 */

import type * as Y from 'yjs';
import { replicaOfLogicalId, type LogicalId } from './identity.ts';
import { NODE_SPLIT_FROM_FIELD, isNodeMap, nodeRecordSplitFrom } from './schema.ts';

export class SplitDedupIndex {
  /** Root origin run id → the runs split off from it, across all replicas. */
  private runsBySplitOrigin = new Map<LogicalId, Set<LogicalId>>();

  constructor(
    private readonly nodes: Y.Map<Y.Map<unknown>>,
    private readonly maxDepth: number
  ) {}

  reset(): void {
    this.runsBySplitOrigin = new Map();
  }

  /**
   * Stamp `runId` as split off from `originalId`, resolved to its ROOT origin.
   *
   * One op splits at both edges, so a later split can target a run the earlier split made.
   * Resolving to the root — the run the whole op superseded — groups every product of a
   * multi-boundary split under one id, so the concurrent dedup sees them all.
   */
  record(originalId: LogicalId, runId: LogicalId): void {
    const rec = this.nodes.get(runId);
    if (!isNodeMap(rec)) return;
    const root = this.rootOf(originalId, replicaOfLogicalId(runId));
    rec.set(NODE_SPLIT_FROM_FIELD, root);
    this.index(root, runId);
  }

  /** Index a run that already carries a `splitFrom` (a rebuild scan, or a remote arrival). */
  indexExisting(runId: LogicalId): void {
    const root = nodeRecordSplitFrom(this.nodes.get(runId));
    if (root !== null) this.index(root, runId);
  }

  private index(root: LogicalId, runId: LogicalId): void {
    const runs = this.runsBySplitOrigin.get(root) ?? new Set<LogicalId>();
    runs.add(runId);
    this.runsBySplitOrigin.set(root, runs);
  }

  /**
   * The root a `runReplica` split reached, following `splitFrom` only through ancestors that
   * SAME replica minted.
   *
   * A multi-boundary split by one peer chains its own runs, so those steps resolve to the
   * original run — its whole set groups together. But a LATER peer splitting a run this peer
   * made is a sequential refinement, not a competing split of the original: stopping at the
   * replica boundary keeps the two out of one group, so the later split is not mistaken for a
   * concurrent duplicate and dropped.
   */
  private rootOf(id: LogicalId, runReplica: string | null): LogicalId {
    let current = id;
    for (let depth = 0; depth < this.maxDepth; depth += 1) {
      if (replicaOfLogicalId(current) !== runReplica) return current;
      const parent = nodeRecordSplitFrom(this.nodes.get(current));
      if (parent === null || parent === current) return current;
      current = parent;
    }
    return current;
  }

  /**
   * Runs a concurrent split superseded and a replica must not materialize.
   *
   * An origin with live split children from MORE THAN ONE minting replica was split by two
   * peers at once. The winner is the replica whose identity sorts first — every replica reads
   * the same shared state and picks the same winner — and the losing replicas' runs are
   * dropped, so the text is kept exactly once.
   */
  loserRuns(isTombstoned: (id: LogicalId) => boolean): ReadonlySet<LogicalId> {
    const losers = new Set<LogicalId>();
    for (const runs of this.runsBySplitOrigin.values()) {
      const byReplica = new Map<string, LogicalId[]>();
      for (const runId of runs) {
        if (!this.nodes.has(runId) || isTombstoned(runId)) continue;
        const replica = replicaOfLogicalId(runId) ?? '';
        const group = byReplica.get(replica) ?? [];
        group.push(runId);
        byReplica.set(replica, group);
      }
      if (byReplica.size <= 1) continue;
      const winner = [...byReplica.keys()].sort()[0]!;
      for (const [replica, runIds] of byReplica) {
        if (replica === winner) continue;
        for (const runId of runIds) losers.add(runId);
      }
    }
    return losers;
  }
}
