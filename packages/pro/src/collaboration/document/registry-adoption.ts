/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import {
  bySurvivorEdge,
  childArrayOf,
  nodeRecordReplacedBy,
  nodeRecordTombstoned,
} from './schema.ts';

/**
 * Which children each join survivor adopts from the tombstones that name it. Derived from
 * the replicated `replacedBy` and `deleted` fields, never replicated itself.
 */
export class AdoptionIndex {
  adoptees = new Map<LogicalId, LogicalId[]>();
  private sources = new Map<LogicalId, Set<LogicalId>>();
  /** Which survivor's source set lists each tombstone. */
  private survivorOf = new Map<LogicalId, LogicalId>();

  constructor(
    private readonly nodes: Y.Map<Y.Map<unknown>>,
    private readonly reads: {
      readonly kindOf: (id: LogicalId) => string | null;
      readonly isTombstoned: (id: LogicalId) => boolean;
      readonly listersOf: (id: LogicalId) => Iterable<LogicalId>;
    }
  ) {}

  reset(): void {
    this.adoptees = new Map();
    this.sources = new Map();
    this.survivorOf = new Map();
  }

  sync(removedId: LogicalId): void {
    // A tombstone lists one survivor, so the reverse index names the one source set holding
    // `removedId`; scanning every survivor made each tombstone event cost every tombstone.
    const previous = this.survivorOf.get(removedId);
    if (previous !== undefined) {
      this.survivorOf.delete(removedId);
      const sources = this.sources.get(previous);
      if (sources) {
        sources.delete(removedId);
        if (sources.size === 0) this.sources.delete(previous);
      }
    }
    const rec = this.nodes.get(removedId);
    const survivor = nodeRecordReplacedBy(rec);
    // Undoing a join removes `replacedBy` too, so the former survivor must give the
    // adopted children back here; returning first left them shown in both paragraphs.
    if (previous !== undefined && previous !== survivor) this.recompute(previous);
    if (survivor === null) return;
    if (nodeRecordTombstoned(rec)) {
      const sources = this.sources.get(survivor) ?? new Set<LogicalId>();
      sources.add(removedId);
      this.sources.set(survivor, sources);
      this.survivorOf.set(removedId, survivor);
    }
    // An un-tombstoned node keeps its `replacedBy`, and its former survivor has to give the
    // adopted children back, so the survivor recomputes in both branches.
    this.recompute(survivor);
  }

  /**
   * A survivor adopts only live children of its tombstones, so a child that is restored (an
   * undone delete) or whose record arrives after its listing changes what the survivor shows.
   * The event names the child, not the survivor, so the survivor is found from the child.
   */
  recomputeListerSurvivors(id: LogicalId): void {
    for (const lister of this.reads.listersOf(id)) {
      const survivor = this.survivorOf.get(lister);
      if (survivor !== undefined) this.recompute(survivor);
    }
  }

  private isContentWitness(id: LogicalId): boolean {
    const kind = this.reads.kindOf(id);
    return kind !== null && !kind.endsWith('Properties');
  }

  private recompute(survivorId: LogicalId): void {
    const extras: LogicalId[] = [];
    const sources = bySurvivorEdge(this.nodes, this.sources.get(survivorId));
    for (const tombstoneId of sources) {
      const rec = this.nodes.get(tombstoneId);
      if (!rec) continue;
      for (const childId of childArrayOf(rec)?.toArray() ?? []) {
        if (this.reads.isTombstoned(childId) || !this.nodes.has(childId)) continue;
        // A join drops the removed paragraph's `w:pPr`. Adopting that property node onto the
        // survivor produced two `paragraphProperties` children, which `known-node-invariant`
        // refused, so the receiving replica never installed the joined tree.
        if (!this.isContentWitness(childId)) continue;
        extras.push(childId);
      }
    }
    if (extras.length > 0) this.adoptees.set(survivorId, extras);
    else this.adoptees.delete(survivorId);
  }
}
