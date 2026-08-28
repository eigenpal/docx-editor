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
import {
  NODE_SPLIT_FROM_FIELD,
  isNodeMap,
  nodeRecordSplitFrom,
  nodeRecordTombstoned,
} from './schema.ts';

/**
 * What the dedup reads about the tree it is projecting, injected so the index stays free of the
 * record walk. `isPresent` is true only for a run that still hangs off its parent — a
 * multi-boundary split leaves an intermediate run detached but neither tombstoned nor deleted,
 * and materializing it would double the paragraph's text.
 */
export interface SplitDedupContext {
  readonly isPresent: (id: LogicalId) => boolean;
}

export class SplitDedupIndex {
  /** Root origin run id → the runs split off from it, across all replicas. */
  private runsBySplitOrigin = new Map<LogicalId, Set<LogicalId>>();
  /** Root origin run id → the distinct replicas that minted a run split off from it. */
  private replicasByOrigin = new Map<LogicalId, Set<string>>();
  /** Origins that more than one replica split — the only ones a dedup pass has to examine. */
  private contestedOrigins = new Set<LogicalId>();
  /**
   * Origins that are live again while products still point at them — an undo restored the origin.
   * A cold rebuild reads this straight from current state, so a peer joining after the undo drops
   * the stale products the same way the peer that undid does through its sticky contested set.
   */
  private liveRootedOrigins = new Set<LogicalId>();

  constructor(private readonly nodes: Y.Map<Y.Map<unknown>>) {}

  reset(): void {
    this.runsBySplitOrigin = new Map();
    this.replicasByOrigin = new Map();
    this.contestedOrigins = new Set();
    this.liveRootedOrigins = new Set();
  }

  /**
   * Stamp `runId` as split off from `root`, the run the whole op superseded.
   *
   * The caller resolves the root, because only the journal knows which intermediate runs this
   * same op created and removed (a multi-boundary split) versus a run split in an earlier round.
   * Both concurrent splits of one run must reach the SAME root, or their products land in
   * separate groups and both survive.
   */
  record(root: LogicalId, runId: LogicalId): void {
    const rec = this.nodes.get(runId);
    if (!isNodeMap(rec)) return;
    // A run is not split from itself. Wrapping a run (a TOC bookmark, a hyperlink) removes and
    // reinserts the SAME node, which looks like a replacement but partitions nothing; stamping it
    // would let the dedup drop the run as a copy of itself.
    if (root === runId) return;
    rec.set(NODE_SPLIT_FROM_FIELD, root);
    this.index(root, runId);
  }

  /** Index a run that already carries a `splitFrom` (a rebuild scan, or a remote arrival). */
  indexExisting(runId: LogicalId): void {
    const root = nodeRecordSplitFrom(this.nodes.get(runId));
    if (root !== null && root !== runId) this.index(root, runId);
  }

  private index(root: LogicalId, runId: LogicalId): void {
    const runs = this.runsBySplitOrigin.get(root) ?? new Set<LogicalId>();
    runs.add(runId);
    this.runsBySplitOrigin.set(root, runs);
    const replicas = this.replicasByOrigin.get(root) ?? new Set<string>();
    replicas.add(replicaOfLogicalId(runId) ?? '');
    this.replicasByOrigin.set(root, replicas);
    // Only an origin two replicas split can produce a loser, so the dedup pass examines just
    // these — a document that only ever split runs single-author keeps this set empty and the
    // pass does no work.
    if (replicas.size > 1) this.contestedOrigins.add(root);
    // A live origin with products means the split was undone; a cold rebuild has no other trace
    // of it, so record it here off current state. Empty in normal use — splits tombstone the
    // origin, so this only fills after an undo.
    const rec = this.nodes.get(root);
    if (isNodeMap(rec) && !nodeRecordTombstoned(rec)) this.liveRootedOrigins.add(root);
  }

  /**
   * Runs a concurrent split superseded and a replica must not materialize.
   *
   * An origin split by MORE THAN ONE replica was split by two peers at once. The winner is the
   * replica whose identity sorts first — every replica reads the same shared state and picks the
   * same winner — so every other replica's products are dropped and the origin's text is kept
   * once. If the origin run is live again — an undo restored it — it represents the text on its
   * own, so every product is dropped instead.
   *
   * The dedup only claims ONE round of concurrent splitting on a run. A second round — a peer
   * splitting a run the first round produced — tangles the winning replica's runs at the merge
   * layer, below what a projection can repair (see the split-replication follow-up). So when a
   * product of an origin was itself split again, this leaves the whole origin alone: every run
   * materializes, exactly as it would without this feature. The result stays consistent across
   * peers — a duplicated but CONVERGENT tree, never one replica disagreeing with another.
   */
  /**
   * True if a contested origin was split again in a later round — the tangle the dedup declines.
   *
   * The materialized tree then differs from what the local author authored, so the session must
   * reconcile the author's store to it or the author would keep a clean view while every other
   * replica sees the duplicated one. Cheap and read straight off shared state, so all replicas
   * agree.
   */
  hasDeclinedTangle(): boolean {
    for (const root of this.contestedOrigins) if (this.isReSplit(root)) return true;
    for (const root of this.liveRootedOrigins) if (this.isReSplit(root)) return true;
    return false;
  }

  private isReSplit(root: LogicalId): boolean {
    const runs = this.runsBySplitOrigin.get(root);
    if (!runs) return false;
    for (const id of runs) if ((this.runsBySplitOrigin.get(id)?.size ?? 0) > 0) return true;
    return false;
  }

  loserRuns(ctx: SplitDedupContext): ReadonlySet<LogicalId> {
    const losers = new Set<LogicalId>();
    const examine = new Set<LogicalId>([...this.contestedOrigins, ...this.liveRootedOrigins]);
    for (const root of examine) {
      const runs = this.runsBySplitOrigin.get(root);
      if (!runs) continue;
      // No-regression guard: a single round collapses every product's origin to `root`, so no
      // product is itself a split origin. If one is, a later round re-split it — hand the whole
      // origin back to the plain projection rather than risk a divergent partial drop.
      if (this.isReSplit(root)) continue;
      const present = new Set<string>();
      for (const runId of runs) {
        if (ctx.isPresent(runId)) present.add(replicaOfLogicalId(runId) ?? '');
      }
      const originLive = ctx.isPresent(root);
      if (!originLive && present.size <= 1) continue;
      // A live origin beats every product; otherwise the first-sorting present replica wins.
      const winner = originLive ? null : [...present].sort()[0]!;
      for (const runId of runs) {
        if (!originLive && (replicaOfLogicalId(runId) ?? '') === winner) continue;
        if (ctx.isPresent(runId)) losers.add(runId);
      }
    }
    return losers;
  }
}
