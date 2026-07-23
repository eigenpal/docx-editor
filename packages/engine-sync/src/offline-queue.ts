// Durable offline update queue (document-engine task 10.5 / design D10). While a
// client is offline its outbound updates are buffered here, keyed by stable update
// id (so a re-enqueue is idempotent) and retained in causal order. On reconnect
// the queue is drained and replayed; the coordinator's dedup makes replay
// exactly-once, so two independently-edited offline clients converge. The concrete
// persistence adapter (y-indexeddb / y-leveldb) lives behind the persistence port;
// this is the port-neutral queue logic.

import type { ReplicationUpdate } from '@docx-editor.dev/engine-core';

export class OfflineQueue {
  private readonly order: string[] = [];
  private readonly byId = new Map<string, ReplicationUpdate>();

  /** Buffer an update; a repeat of the same update id is idempotent. */
  enqueue(update: ReplicationUpdate): void {
    if (this.byId.has(update.updateId)) return;
    this.byId.set(update.updateId, update);
    this.order.push(update.updateId);
  }

  get size(): number {
    return this.order.length;
  }

  /** Return buffered updates in causal order and clear the queue. */
  drain(): ReplicationUpdate[] {
    const out = this.order.map((id) => this.byId.get(id)!);
    this.order.length = 0;
    this.byId.clear();
    return out;
  }

  /** Acknowledge specific update ids (durable queues delete only acked ids). */
  ack(ids: readonly string[]): void {
    const acked = new Set(ids);
    for (const id of [...this.order]) {
      if (acked.has(id)) {
        this.byId.delete(id);
        this.order.splice(this.order.indexOf(id), 1);
      }
    }
  }
}
