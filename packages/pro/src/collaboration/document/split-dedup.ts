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
import {
  NODE_SPLIT_FROM_FIELD,
  NODE_SPLIT_LINEAGE_FIELD,
  isNodeMap,
  nodeRecordSplitFrom,
  nodeRecordSplitLineage,
} from './schema.ts';

export interface SplitDedupContext {
  readonly isPresent: (id: LogicalId) => boolean;
}
export interface SplitTextOverlays {
  readonly values: ReadonlyMap<LogicalId, string>;
  readonly changedIds: ReadonlySet<LogicalId>;
}

export class SplitDedupIndex {
  private cachedLosers: ReadonlySet<LogicalId> | null = null;

  invalidate(): void {
    this.cachedLosers = null;
  }

  private runsBySplitOrigin = new Map<LogicalId, Set<LogicalId>>();
  private liveRootedOrigins = new Set<LogicalId>();

  constructor(private readonly nodes: Y.Map<Y.Map<unknown>>) {}

  reset(): void {
    this.invalidate();
    this.runsBySplitOrigin.clear();
    this.liveRootedOrigins.clear();
  }

  record(root: LogicalId, _replaced: LogicalId, products: readonly LogicalId[]): void {
    this.invalidate();
    for (const id of products) {
      if (id === root) continue;
      const record = this.nodes.get(id);
      if (!isNodeMap(record)) continue;
      record.set(NODE_SPLIT_FROM_FIELD, root);
      record.set(NODE_SPLIT_LINEAGE_FIELD, root);
      this.indexExisting(id);
    }
  }

  indexExisting(id: LogicalId): void {
    const root = nodeRecordSplitLineage(this.nodes.get(id));
    if (root === null || root === id) return;
    this.invalidate();
    const runs = this.runsBySplitOrigin.get(root) ?? new Set<LogicalId>();
    runs.add(id);
    this.runsBySplitOrigin.set(root, runs);
    // Include single-author origins too: undo can restore an ancestor while another
    // author's later descendants still refer to its immutable lineage.
    this.liveRootedOrigins.add(root);
  }

  /** Current provenance, rather than the sticky index, decides undo and late-join winners. */
  private productsOf(root: LogicalId): readonly LogicalId[] {
    return [...(this.runsBySplitOrigin.get(root) ?? [])].filter(
      (id) => nodeRecordSplitLineage(this.nodes.get(id)) === root
    );
  }

  /** Resolve each split generation separately and suppress every losing branch's descendants. */
  loserRuns(ctx: SplitDedupContext): ReadonlySet<LogicalId> {
    if (this.cachedLosers) return this.cachedLosers;
    const losers = new Set<LogicalId>();
    const excluded = new Set<LogicalId>();
    const dropBranch = (first: LogicalId): void => {
      const pending = [first];
      while (pending.length > 0) {
        const id = pending.pop()!;
        if (excluded.has(id)) continue;
        excluded.add(id);
        if (ctx.isPresent(id)) losers.add(id);
        for (const child of this.productsOf(id)) pending.push(child);
      }
    };
    for (const root of this.liveRootedOrigins) {
      const products = this.productsOf(root);
      // A deleted winner still owns its branch. Choosing by visible leaves would resurrect
      // the losing text when an author deletes or re-splits the entire winning branch.
      const winner = ctx.isPresent(root)
        ? null
        : products
            .filter((id) => nodeRecordSplitFrom(this.nodes.get(id)) === root)
            .map((id) => replicaOfLogicalId(id) ?? '')
            .sort()[0];
      for (const id of products) {
        if ((replicaOfLogicalId(id) ?? '') !== winner) dropBranch(id);
      }
    }
    this.cachedLosers = losers;
    return losers;
  }
}
