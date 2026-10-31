/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * How many node records shared state holds, and how many of them are tombstones.
 *
 * Both counts are maintained from the registry's node events, because the node caps read them
 * on every received edit and on every local commit, and `Y.Map.size` or a tombstone walk there
 * would make a keystroke cost the whole document. Each count is built once, on first read,
 * and dropped whenever the registry rebuilds its derived indexes.
 *
 * The tombstone count is a set of IDs, not a number. A record's `deleted` field can be set,
 * restored by an undo, or arrive with the record, and re-reading the record each time an event
 * names it keeps the set equal to what a fresh walk finds, whatever order those come in.
 */
import type * as Y from 'yjs';
import type { DocumentLimits } from './limits.ts';
import { isNodeMap, nodeRecordTombstoned } from './schema.ts';

export class NodeCounts {
  /** Record total as of the last observed event batch. Negative means "not counted yet". */
  private records = -1;
  /** Records written since that batch. Yjs delivers a nested transaction's events late. */
  private pending = 0;
  /** Tombstoned record IDs. `null` means "not counted yet". */
  private tombstoned: Set<string> | null = null;

  constructor(private readonly nodes: Y.Map<unknown>) {}

  /** Every node record, tombstones included. */
  total(): number {
    if (this.records < 0) this.records = this.nodes.size;
    return this.records + this.pending;
  }

  /** Records whose `deleted` field is set. */
  tombstones(): number {
    if (!this.tombstoned) {
      const ids = new Set<string>();
      // Peer-writable: a hostile update can plant a non-map value, which is not a tombstone.
      this.nodes.forEach((record, id) => {
        if (isNodeMap(record) && nodeRecordTombstoned(record)) ids.add(id);
      });
      this.tombstoned = ids;
    }
    return this.tombstoned.size;
  }

  /** Records that are not tombstones. What materializing builds, and what `maxNodes` bounds. */
  live(): number {
    return this.total() - this.tombstones();
  }

  /**
   * Whether `added` more records would cross either node cap: live records against
   * `maxNodes`, every record against `maxNodeRecords`.
   */
  wouldExceed(limits: Pick<DocumentLimits, 'maxNodes' | 'maxNodeRecords'>, added: number): boolean {
    return this.total() + added > limits.maxNodeRecords || this.live() + added > limits.maxNodes;
  }

  /** A record is about to be written through the registry, before its event arrives. */
  noteWrite(id: string): void {
    if (!this.nodes.has(id)) this.pending += 1;
  }

  /** An event batch arrived: it describes every write, local or remote. */
  batchObserved(): void {
    this.pending = 0;
  }

  /** A record was added to, replaced in, or removed from the node map. */
  recordChanged(id: string, action: 'add' | 'update' | 'delete'): void {
    if (this.records >= 0 && action !== 'update') this.records += action === 'add' ? 1 : -1;
    this.tombstoneChanged(id);
  }

  /** A record's `deleted` field may have changed. */
  tombstoneChanged(id: string): void {
    if (!this.tombstoned) return;
    const record = this.nodes.get(id);
    if (isNodeMap(record) && nodeRecordTombstoned(record)) this.tombstoned.add(id);
    else this.tombstoned.delete(id);
  }

  reset(): void {
    this.records = -1;
    this.pending = 0;
    this.tombstoned = null;
  }
}
