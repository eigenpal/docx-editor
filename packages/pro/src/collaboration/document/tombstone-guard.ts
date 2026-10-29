/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * A deletion stays when a peer that deleted the same node at the same time undoes its own.
 *
 * A node is deleted by `deleted: true` on its record, one shared key. Two peers that delete one
 * node at the same time write that key concurrently, and Yjs keeps one write and deletes the
 * other. When the peer whose write Yjs kept undoes its delete, its undo deletes that write, and
 * the key holds no value at all: the node shows again, with the text the other peer deleted,
 * although that peer never undid anything. With the client IDs the other way round, the node
 * stays deleted. Only the replica whose own write was lost can tell that it still stands.
 *
 * So after an update from elsewhere, a replica writes `deleted: true` again for a node whose
 * key it emptied that way: one of its own deletion writes is gone, the key holds nothing, and
 * the step that wrote it is still on its undo stack, so it did not undo it. The new write joins
 * that step, so the replica's own undo of the delete still takes the node back out. A replica
 * that reloaded has no undo stack and leaves the key as it is.
 */
import * as Y from 'yjs';
import { NODE_DELETED_FIELD } from './schema.ts';

/** The transaction origin of the writes; no undo stack tracks it, the step it joins does. */
export const TOMBSTONE_ORIGIN = Symbol('docx-tombstone-again');

interface StackItemShape {
  insertions: unknown;
}

interface HistoryShape {
  readonly undoStack: readonly StackItemShape[];
}

/**
 * Write again the deletions an update from elsewhere emptied on this replica's own deletes.
 *
 * @param nodes - the shared node map, `PackageSchema.nodes`.
 * @param history - this replica's undo manager.
 */
export function restoreLostTombstones(
  transaction: Y.Transaction,
  nodes: unknown,
  history: HistoryShape
): void {
  if (transaction.local || history.undoStack.length === 0) return;
  const doc = transaction.doc;
  const records = new Set<Y.Map<unknown>>();
  Y.iterateDeletedStructs(transaction, transaction.deleteSet, (struct) => {
    if (!(struct instanceof Y.Item) || struct.parentSub !== NODE_DELETED_FIELD) return;
    const record = struct.parent as unknown;
    if (record instanceof Y.Map && record._item?.parent === nodes) {
      records.add(record as Y.Map<unknown>);
    }
  });
  const lost: { record: Y.Map<unknown>; step: StackItemShape }[] = [];
  for (const record of records) {
    if (record.get(NODE_DELETED_FIELD) !== undefined) continue;
    const step = ownLostDelete(record, doc.clientID, history);
    if (step) lost.push({ record, step });
  }
  if (lost.length === 0) return;
  doc.transact(() => {
    for (const { record } of lost) record.set(NODE_DELETED_FIELD, true);
  }, TOMBSTONE_ORIGIN);
  for (const { record, step } of lost) {
    const written = record._map.get(NODE_DELETED_FIELD);
    if (!written) continue;
    const added = Y.createDeleteSet();
    added.clients.set(written.id.client, [
      { clock: written.id.clock, len: written.length },
    ] as never);
    step.insertions = Y.mergeDeleteSets([step.insertions as never, added]);
  }
}

/** The undo step of this replica's deletion write on `record` that Yjs dropped, or null. */
function ownLostDelete(
  record: Y.Map<unknown>,
  client: number,
  history: HistoryShape
): StackItemShape | null {
  for (let item = record._map.get(NODE_DELETED_FIELD) ?? null; item; item = item.left) {
    if (item.parentSub !== NODE_DELETED_FIELD) continue;
    // This replica only ever writes `true` here. A dropped write's content can already be
    // collected, so its value is not read.
    if (item.id.client !== client || !item.deleted) continue;
    const step = history.undoStack.find((candidate) =>
      Y.isDeleted(candidate.insertions as never, item.id)
    );
    if (step) return step;
  }
  return null;
}
