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
import { deleteSetRuns, structAt } from './yjs-items.ts';

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
  for (const { record, step } of lost) joinStep(step, record);
}

/** Add the current deletion write on `record` to `step`, so the step's undo removes it. */
function joinStep(step: StackItemShape, record: Y.Map<unknown>): void {
  const written = record._map.get(NODE_DELETED_FIELD);
  if (!written) return;
  const added = Y.createDeleteSet();
  added.clients.set(written.id.client, [{ clock: written.id.clock, len: written.length }] as never);
  step.insertions = Y.mergeDeleteSets([step.insertions as never, added]);
}

/**
 * After a redo: write again each deletion of this replica that Yjs did not put back.
 *
 * Yjs does not redo a map value when a later value from another client follows it, even a
 * deleted one. After a peer wrote its own dropped deletion again, that is the case for this
 * replica's deletion of the same node: the redo writes nothing, and the node shows deleted
 * only through the peer's write, or not at all once the peer undid. The peer's undo then
 * brings the node back although this redo stands. So the redo writes the deletion under this
 * client, and the undo step it pushed takes it back.
 * Call it inside a transaction.
 *
 * The undo's own record of its step's deletions counts too ({@link ownDeletedRecords}): when a
 * peer's later write had already replaced this replica's write, the undo deleted nothing, so
 * the redo step does not name the write, though the redo must still delete the node.
 *
 * @param redone - the history step the redo popped.
 * @param undoneRecords - the nodes whose deletion the undo of that step took back.
 * @param pushed - the undo step that redo pushed, or a function that pushes one.
 */
export function redoRefusedDeletes(
  doc: Y.Doc,
  nodes: unknown,
  redone: { readonly deletions?: unknown },
  undoneRecords: readonly string[],
  pushed: () => StackItemShape
): void {
  const records = new Set<Y.Map<unknown>>();
  const nodeMap = nodes instanceof Y.Map ? (nodes as Y.Map<unknown>) : null;
  for (const id of undoneRecords) {
    const record = nodeMap?.get(id);
    if (record instanceof Y.Map && !ownValueStands(record, doc.clientID)) records.add(record);
  }
  for (const run of deleteSetRuns(redone.deletions)) {
    for (let clock = run.clock; clock < run.clock + run.length; ) {
      const item = structAt(doc, { client: run.client, clock });
      if (!item) break;
      clock = item.id.clock + item.length;
      if (item.parentSub !== NODE_DELETED_FIELD || item.id.client !== doc.clientID) continue;
      if (!item.deleted || item.redone !== null) continue;
      const record = item.parent as unknown;
      if (!(record instanceof Y.Map) || record._item?.parent !== nodes) continue;
      if (ownValueStands(record as Y.Map<unknown>, doc.clientID)) continue;
      records.add(record as Y.Map<unknown>);
    }
  }
  if (records.size === 0) return;
  const step = pushed();
  for (const record of records) {
    record.set(NODE_DELETED_FIELD, true);
    joinStep(step, record);
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

/** Whether this replica's own deletion value holds the key: nothing to write again. */
function ownValueStands(record: Y.Map<unknown>, client: number): boolean {
  const holder = record._map.get(NODE_DELETED_FIELD);
  return !!holder && !holder.deleted && holder.id.client === client;
}

/**
 * The nodes this replica's deletion writes in `step` name, by ID: what an undo of the step
 * takes back, kept on the redo step for {@link redoRefusedDeletes}.
 */
export function ownDeletedRecords(
  doc: Y.Doc,
  nodes: unknown,
  step: { readonly insertions?: unknown } | undefined
): string[] {
  const ids = new Set<string>();
  for (const run of deleteSetRuns(step?.insertions)) {
    if (run.client !== doc.clientID) continue;
    for (let clock = run.clock; clock < run.clock + run.length; ) {
      const item = structAt(doc, { client: run.client, clock });
      if (!item) break;
      clock = item.id.clock + item.length;
      if (item.parentSub !== NODE_DELETED_FIELD) continue;
      const record = item.parent as unknown;
      if (!(record instanceof Y.Map) || record._item?.parent !== nodes) continue;
      const id = record._item?.parentSub ?? null;
      if (id !== null) ids.add(id);
    }
  }
  return [...ids];
}
