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

import * as Y from 'yjs';
import { replicaOfLogicalId, type LogicalId } from './identity.ts';
import type { DocumentLimits } from './limits.ts';
import {
  NODE_SPLIT_BASE_TEXT_FIELD,
  NODE_SPLIT_FROM_FIELD,
  NODE_SPLIT_START_FIELD,
  NODE_SHELL_FIELD,
  NODE_TEXT_FIELD,
  childArrayOf,
  isNodeMap,
  isTextNodeMap,
  nodeRecordSplitBaseText,
  nodeRecordSplitFrom,
  nodeRecordSplitStart,
  nodeRecordTombstoned,
  unpackNodeShell,
} from './schema.ts';
import { nodeKindOf } from './registry-node-reads.ts';

/**
 * What the dedup reads about the tree it is projecting, injected so the index stays free of the
 * record walk. `isPresent` is true only for a run that still hangs off its parent — a
 * multi-boundary split leaves an intermediate run detached but neither tombstoned nor deleted,
 * and materializing it would double the paragraph's text.
 */
export interface SplitDedupContext {
  readonly isPresent: (id: LogicalId) => boolean;
}

export interface SplitTextOverlays {
  readonly values: ReadonlyMap<LogicalId, string>;
  readonly changedIds: ReadonlySet<LogicalId>;
}

interface RunText {
  readonly ids: readonly LogicalId[];
  readonly witnessIds: readonly LogicalId[];
  readonly value: string;
}

/** Cap on the `splitFrom` walk that classifies a re-split; stops a peer-crafted chain or cycle. */
const RE_SPLIT_WALK_LIMIT = 256;

export class SplitDedupIndex {
  /** Root origin run id → the runs split off from it, across all replicas. */
  private runsBySplitOrigin = new Map<LogicalId, Set<LogicalId>>();
  /** Root origin run id → the distinct replicas that minted a run split off from it. */
  private replicasByOrigin = new Map<LogicalId, Set<string>>();
  /** Origins that more than one replica split — the only ones a dedup pass has to examine. */
  private contestedOrigins = new Set<LogicalId>();
  /** Text witness id → split origins whose derived text can change when that record changes. */
  private originsByTextWitness = new Map<LogicalId, Set<LogicalId>>();
  /** Split origins whose source text changed since the last repair pass. */
  private pendingTextRepairOrigins = new Set<LogicalId>();
  /** Product text id → derived value that rebases a concurrent edit without shared writes. */
  private textOverlays = new Map<LogicalId, string>();
  /** Split origin → product text ids carrying its current derived overlay. */
  private overlayIdsByOrigin = new Map<LogicalId, Set<LogicalId>>();
  /**
   * Origins that are live again while products still point at them — an undo restored the origin.
   * A cold rebuild reads this straight from current state, so a peer joining after the undo drops
   * the stale products the same way the peer that undid does through its sticky contested set.
   */
  private liveRootedOrigins = new Set<LogicalId>();
  /**
   * A monotonic marker bumped whenever a local edit re-splits a run inside a contested lineage —
   * the declined tangle (#581). It rises by however many product runs that one edit mints, so it
   * is a CHANGE signal, not a tangle count. NOT cleared by `reset()`: the session compares it
   * against its last-seen value and reconciles the author's store once per tangle-creating edit,
   * never on the steady keystrokes in between.
   */
  private declinedTangleCount = 0;

  constructor(
    private readonly nodes: Y.Map<Y.Map<unknown>>,
    private readonly limits: Pick<DocumentLimits, 'maxTextLength' | 'maxTreeDepth'>
  ) {}

  reset(): void {
    this.runsBySplitOrigin = new Map();
    this.replicasByOrigin = new Map();
    this.contestedOrigins = new Set();
    this.liveRootedOrigins = new Set();
    this.originsByTextWitness = new Map();
    this.pendingTextRepairOrigins = new Set();
    this.textOverlays = new Map();
    this.overlayIdsByOrigin = new Map();
  }

  /**
   * Stamp `runId` as split off from `root`, the run the whole op superseded.
   *
   * The caller resolves the root, because only the journal knows which intermediate runs this
   * same op created and removed (a multi-boundary split) versus a run split in an earlier round.
   * Both concurrent splits of one run must reach the SAME root, or their products land in
   * separate groups and both survive.
   */
  record(root: LogicalId, replacedRunId: LogicalId, runIds: readonly LogicalId[]): void {
    const rootRecord = this.nodes.get(root);
    const replacedRecord = this.nodes.get(replacedRunId);
    if (!isNodeMap(rootRecord) || !isNodeMap(replacedRecord)) return;
    const baseline = nodeRecordSplitBaseText(rootRecord) ?? this.runText(root)?.value;
    const start = nodeRecordSplitStart(replacedRecord) ?? 0;
    const products = runIds.map((id) => ({ id, text: this.runText(id) }));
    const canRepair =
      baseline !== undefined &&
      baseline.length <= this.limits.maxTextLength &&
      products.every((product) => product.text !== null);
    if (canRepair) {
      rootRecord.set(NODE_SPLIT_BASE_TEXT_FIELD, baseline);
      this.indexTextWitnesses(root, this.runText(root));
    }
    let cursor = start;
    for (const product of products) {
      const rec = this.nodes.get(product.id);
      if (!isNodeMap(rec)) return;
      // A run is not split from itself. Wrapping a run (a TOC bookmark, a hyperlink) removes and
      // reinserts the SAME node, which looks like a replacement but partitions nothing.
      if (root === product.id) continue;
      rec.set(NODE_SPLIT_FROM_FIELD, root);
      if (canRepair) rec.set(NODE_SPLIT_START_FIELD, cursor);
      this.index(root, product.id);
      if (canRepair) this.indexTextWitnesses(root, product.text);
      cursor += product.text?.value.length ?? 0;
    }
    // A later round re-split a run an earlier round produced, and the shared origin was split by
    // two replicas — the tangle the dedup declines. Count it, so the session reconciles the
    // author's store only on the edit that creates the tangle, not on every keystroke while it
    // persists. A single author re-formatting a paragraph re-splits products too, but its origin
    // is never contested, so this ignores it — no wasted reconcile without a real conflict.
    if (this.reSplitOfContestedOrigin(root)) this.declinedTangleCount += products.length;
  }

  /**
   * Rebase text written concurrently to a split source onto the winning split products.
   *
   * The overlay is derived from shared state and never writes to Yjs. Every live peer and late
   * joiner therefore computes the same result without requiring the split author to stay online.
   * The baseline proves the product text has not changed since the split, so a later sequential
   * edit is never overwritten.
   */
  concurrentTextOverlays(isPresent: SplitDedupContext['isPresent']): SplitTextOverlays {
    const changedIds = new Set<LogicalId>();
    const pending = this.pendingTextRepairOrigins;
    this.pendingTextRepairOrigins = new Set();
    for (const root of pending) {
      for (const id of this.overlayIdsByOrigin.get(root) ?? []) {
        if (this.textOverlays.delete(id)) changedIds.add(id);
      }
      this.overlayIdsByOrigin.delete(root);
      const runs = this.runsBySplitOrigin.get(root);
      if (!runs) continue;
      if (this.isReSplit(root) || isPresent(root)) continue;
      const base = nodeRecordSplitBaseText(this.nodes.get(root));
      const source = this.runText(root);
      if (base === null || !source || source.value === base) continue;
      const presentReplicas = new Set<string>();
      for (const runId of runs) {
        if (isPresent(runId)) presentReplicas.add(replicaOfLogicalId(runId) ?? '');
      }
      const winner = [...presentReplicas].sort()[0];
      if (winner === undefined) continue;
      const products = [...runs]
        .filter((runId) => isPresent(runId) && replicaOfLogicalId(runId) === winner)
        .map((runId) => ({
          id: runId,
          start: nodeRecordSplitStart(this.nodes.get(runId)),
          text: this.runText(runId),
        }))
        .sort(
          (left, right) => (left.start ?? 0) - (right.start ?? 0) || left.id.localeCompare(right.id)
        );
      if (!this.productsMatchBaseline(products, base)) continue;
      const boundaries = products.map((product) => product.start!);
      boundaries.push(base.length);
      const mapped = boundaries.map((offset) => mapBaseOffset(base, source.value, offset));
      const overlayIds = new Set<LogicalId>();
      for (let index = 0; index < products.length; index += 1) {
        const product = products[index]!;
        const value = source.value.slice(mapped[index]!, mapped[index + 1]!);
        for (let textIndex = 0; textIndex < product.text!.ids.length; textIndex += 1) {
          const id = product.text!.ids[textIndex]!;
          const overlay = textIndex === 0 ? value : '';
          if (this.textOverlays.get(id) !== overlay) changedIds.add(id);
          this.textOverlays.set(id, overlay);
          overlayIds.add(id);
        }
      }
      this.overlayIdsByOrigin.set(root, overlayIds);
    }
    return { values: this.textOverlays, changedIds };
  }

  noteChanged(logicalId: LogicalId): void {
    for (const root of this.originsByTextWitness.get(logicalId) ?? []) {
      this.pendingTextRepairOrigins.add(root);
    }
  }

  private productsMatchBaseline(
    products: readonly {
      readonly start: number | null;
      readonly text: RunText | null;
    }[],
    baseline: string
  ): boolean {
    if (products.length === 0 || products[0]?.start !== 0) return false;
    for (let index = 0; index < products.length; index += 1) {
      const product = products[index]!;
      if (product.start === null || !product.text) return false;
      const end = products[index + 1]?.start ?? baseline.length;
      if (end < product.start || product.text.value !== baseline.slice(product.start, end))
        return false;
    }
    return true;
  }

  private runText(runId: LogicalId): RunText | null {
    if (nodeKindOf(this.nodes, runId) !== 'run') return null;
    const ids: LogicalId[] = [];
    const witnessIds: LogicalId[] = [];
    let value = '';
    const seen = new Set<LogicalId>();
    const visit = (id: LogicalId, depth: number): boolean => {
      if (depth > this.limits.maxTreeDepth || seen.has(id)) return false;
      seen.add(id);
      witnessIds.push(id);
      const rec = this.nodes.get(id);
      if (!isNodeMap(rec)) return false;
      if (isTextNodeMap(rec)) {
        const text = rec.get(NODE_TEXT_FIELD);
        if (!(text instanceof Y.Text)) return false;
        value += text.toString();
        if (value.length > this.limits.maxTextLength) return false;
        ids.push(id);
        return true;
      }
      const shell = rec.get(NODE_SHELL_FIELD);
      const decoded = unpackNodeShell(typeof shell === 'string' ? shell : '');
      if (depth > 0 && decoded.kind === 'runProperties') return true;
      if (depth > 0 && decoded.localName !== 't') return false;
      for (const childId of childArrayOf(rec)?.toArray() ?? []) {
        if (!visit(childId, depth + 1)) return false;
      }
      return true;
    };
    return visit(runId, 0) && ids.length > 0 ? { ids, witnessIds, value } : null;
  }

  /**
   * True if `root` is itself a split product whose shared origin two replicas split.
   *
   * Walks `splitFrom` from `root` to the run the rounds share. A `root` that is an original run
   * (no `splitFrom`) is a first round, not a re-split. The bound stops a peer-crafted cycle.
   */
  private reSplitOfContestedOrigin(root: LogicalId): boolean {
    if (nodeRecordSplitFrom(this.nodes.get(root)) === null) return false;
    let current = root;
    for (let depth = 0; depth < RE_SPLIT_WALK_LIMIT; depth += 1) {
      if (this.contestedOrigins.has(current) || this.liveRootedOrigins.has(current)) return true;
      const parent = nodeRecordSplitFrom(this.nodes.get(current));
      if (parent === null || parent === current) return false;
      current = parent;
    }
    return false;
  }

  /** Index a run that already carries a `splitFrom` (a rebuild scan, or a remote arrival). */
  indexExisting(runId: LogicalId): void {
    const root = nodeRecordSplitFrom(this.nodes.get(runId));
    if (root !== null && root !== runId) {
      this.index(root, runId);
      this.indexTextWitnesses(root, this.runText(root));
      this.indexTextWitnesses(root, this.runText(runId));
      const base = nodeRecordSplitBaseText(this.nodes.get(root));
      const source = this.runText(root);
      if (base !== null && source && source.value !== base) {
        this.pendingTextRepairOrigins.add(root);
      }
    }
  }

  private indexTextWitnesses(root: LogicalId, text: RunText | null): void {
    if (!text) return;
    for (const witnessId of text.witnessIds) {
      const origins = this.originsByTextWitness.get(witnessId) ?? new Set<LogicalId>();
      origins.add(root);
      this.originsByTextWitness.set(witnessId, origins);
    }
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
   * How many declined tangles this replica's local edits have created (#581).
   *
   * The session reconciles the author's store to the materialized tree when this rises, because
   * the edit that creates a tangle leaves the author with a clean view while every other replica
   * converges on the duplicated one. It rises only on the tangle-creating edit, so steady typing
   * in an already-tangled document costs nothing.
   */
  declinedTangleEvents(): number {
    return this.declinedTangleCount;
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

function mapBaseOffset(base: string, next: string, offset: number): number {
  let prefix = 0;
  const shared = Math.min(base.length, next.length);
  while (prefix < shared && base.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    suffix < next.length - prefix &&
    base.charCodeAt(base.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix += 1;
  }
  const baseEnd = base.length - suffix;
  const nextEnd = next.length - suffix;
  if (offset <= prefix) return offset;
  if (offset >= baseEnd) return nextEnd + offset - baseEnd;
  return prefix;
}
