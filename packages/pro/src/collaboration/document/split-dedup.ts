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
 * and counting it would double the group's text. `groupText` concatenates the runs' text in
 * document order — the dedup drops a run only when another run already carries the exact same
 * text, so it never loses distinct content.
 */
export interface SplitDedupContext {
  readonly isPresent: (id: LogicalId) => boolean;
  readonly groupText: (runIds: readonly LogicalId[]) => string;
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

  constructor(
    private readonly nodes: Y.Map<Y.Map<unknown>>,
    private readonly maxDepth: number
  ) {}

  reset(): void {
    this.runsBySplitOrigin = new Map();
    this.replicasByOrigin = new Map();
    this.contestedOrigins = new Set();
    this.liveRootedOrigins = new Set();
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
   * the same shared state and picks the same winner — and a losing replica's runs are dropped
   * ONLY when they carry the exact text the winner already carries, so the concurrent case
   * keeps the text once while a run a peer grew with new typed text is never lost.
   *
   * If the origin run itself is live again — an undo restored it — it represents the text on its
   * own, so every product that merely repeats it is dropped. Without this, undoing the winner's
   * split would leave the restored origin AND the loser's runs, doubling the text again.
   */
  loserRuns(ctx: SplitDedupContext): ReadonlySet<LogicalId> {
    const losers = new Set<LogicalId>();
    const examine = new Set<LogicalId>([...this.contestedOrigins, ...this.liveRootedOrigins]);
    for (const root of examine) {
      const runs = this.runsBySplitOrigin.get(root);
      if (!runs) continue;
      const byReplica = new Map<string, LogicalId[]>();
      for (const runId of runs) {
        if (!ctx.isPresent(runId)) continue;
        const replica = replicaOfLogicalId(runId) ?? '';
        const group = byReplica.get(replica) ?? [];
        group.push(runId);
        byReplica.set(replica, group);
      }
      if (ctx.isPresent(root)) {
        const rootText = ctx.groupText([root]);
        for (const runIds of byReplica.values()) {
          if (ctx.groupText(runIds) === rootText) for (const id of runIds) losers.add(id);
        }
        continue;
      }
      if (byReplica.size <= 1) continue;
      const winner = [...byReplica.keys()].sort()[0]!;
      const winnerText = ctx.groupText(byReplica.get(winner)!);
      for (const [replica, runIds] of byReplica) {
        if (replica === winner) continue;
        if (ctx.groupText(runIds) === winnerText) for (const id of runIds) losers.add(id);
      }
    }
    return losers;
  }
}
