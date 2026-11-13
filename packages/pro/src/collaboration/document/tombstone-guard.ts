/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
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
 *
 * A removal that names a survivor, as a cell merge does, writes the survivor that shows the
 * removed node's remaining children in a second key, in the same step. That key is lost the same
 * way, with the deletion or alone, and it is written again the same way, with the survivor this
 * replica named.
 */
import * as Y from 'yjs';
import { NODE_DELETED_FIELD, NODE_REPLACED_BY_FIELD } from './schema.ts';
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
  if (transaction.local) {
    noteOwnSurvivors(transaction, nodes);
    return;
  }
  if (history.undoStack.length === 0) return;
  const doc = transaction.doc;
  // The two keys resolve apart in Yjs, so an update can empty either one of them.
  const emptied = new Map<Y.Map<unknown>, { deletion: boolean }>();
  Y.iterateDeletedStructs(transaction, transaction.deleteSet, (struct) => {
    if (!(struct instanceof Y.Item)) return;
    const deletion = struct.parentSub === NODE_DELETED_FIELD;
    if (!deletion && struct.parentSub !== NODE_REPLACED_BY_FIELD) return;
    const record = struct.parent as unknown;
    if (!(record instanceof Y.Map) || record._item?.parent !== nodes) return;
    const seen = emptied.get(record as Y.Map<unknown>);
    emptied.set(record as Y.Map<unknown>, { deletion: deletion || seen?.deletion === true });
  });
  const lost: {
    record: Y.Map<unknown>;
    step: StackItemShape;
    deletion: boolean;
    survivor: string | null;
  }[] = [];
  for (const [record, { deletion }] of emptied) {
    const deleted = record.get(NODE_DELETED_FIELD);
    if (deletion && deleted === undefined) {
      const step = ownLostWrite(record, doc.clientID, history, NODE_DELETED_FIELD);
      if (step) {
        const survivor = ownLostSurvivor(record, doc.clientID, step.insertions);
        lost.push({ record, step, deletion: true, survivor });
        continue;
      }
    }
    // The deletion stands and only the survivor it named is gone: write the survivor again.
    if (deleted !== true || record.get(NODE_REPLACED_BY_FIELD) !== undefined) continue;
    const step = ownLostWrite(record, doc.clientID, history, NODE_REPLACED_BY_FIELD);
    const survivor = step ? ownLostSurvivor(record, doc.clientID, step.insertions) : null;
    if (step && survivor !== null) lost.push({ record, step, deletion: false, survivor });
  }
  if (lost.length === 0) return;
  doc.transact(() => {
    for (const { record, deletion, survivor } of lost) writeDeletion(record, deletion, survivor);
  }, TOMBSTONE_ORIGIN);
  for (const { record, step, deletion, survivor } of lost) {
    joinWrites(step, record, deletion, survivor);
  }
}

/**
 * The survivors this replica named on each record, by the ID of the `replacedBy` write.
 *
 * A cell merge writes the survivor beside the deletion, in one step. The two keys resolve apart,
 * so an undo from elsewhere can empty both or only the survivor. Left without it, the node
 * stays deleted with no survivor, and the children only it lists, such as a paragraph a peer
 * split there at the same time, show nowhere. Yjs collects the content of a write
 * another client's write replaced, so the value is kept here when this replica writes it.
 */
const ownSurvivors = new WeakMap<Y.Map<unknown>, Map<string, string>>();

/** At most this many survivors are kept per record; a dropped one is only not written again. */
const MAX_SURVIVORS_PER_RECORD = 64;

const writeKey = (id: Y.ID): string => `${id.client}:${id.clock}`;

/** Keep the survivors a local transaction names on node records. */
function noteOwnSurvivors(transaction: Y.Transaction, nodes: unknown): void {
  for (const [type, keys] of transaction.changed) {
    if (!keys.has(NODE_REPLACED_BY_FIELD) || !(type instanceof Y.Map)) continue;
    if (type._item?.parent !== nodes) continue;
    const record = type as Y.Map<unknown>;
    const item = record._map.get(NODE_REPLACED_BY_FIELD);
    const value = record.get(NODE_REPLACED_BY_FIELD);
    if (!item || item.deleted || item.id.client !== transaction.doc.clientID) continue;
    if (typeof value !== 'string' || value.length === 0) continue;
    let kept = ownSurvivors.get(record);
    if (!kept) ownSurvivors.set(record, (kept = new Map()));
    if (kept.size >= MAX_SURVIVORS_PER_RECORD) kept.delete(kept.keys().next().value!);
    kept.set(writeKey(item.id), value);
  }
}

/**
 * The survivor this replica's lost write named, unless its own survivor holds the key: its own
 * `replacedBy` write that `writes` holds.
 */
function ownLostSurvivor(record: Y.Map<unknown>, client: number, writes: unknown): string | null {
  // A peer's survivor can hold the key: it goes when that peer undoes, and this one stays.
  if (ownValueStands(record, client, NODE_REPLACED_BY_FIELD)) return null;
  const kept = ownSurvivors.get(record);
  if (!kept) return null;
  for (let item = record._map.get(NODE_REPLACED_BY_FIELD) ?? null; item; item = item.left) {
    if (item.parentSub !== NODE_REPLACED_BY_FIELD) continue;
    if (item.id.client !== client || !item.deleted) continue;
    if (!Y.isDeleted(writes as never, item.id)) continue;
    return kept.get(writeKey(item.id)) ?? null;
  }
  return null;
}

function writeDeletion(record: Y.Map<unknown>, deletion: boolean, survivor: string | null): void {
  if (deletion) record.set(NODE_DELETED_FIELD, true);
  if (survivor !== null) record.set(NODE_REPLACED_BY_FIELD, survivor);
}

function joinWrites(
  step: StackItemShape,
  record: Y.Map<unknown>,
  deletion: boolean,
  survivor: string | null
): void {
  if (deletion) joinStep(step, record, NODE_DELETED_FIELD);
  if (survivor !== null) joinStep(step, record, NODE_REPLACED_BY_FIELD);
}

/** Add the current write of `field` on `record` to `step`, so the step's undo removes it. */
function joinStep(step: StackItemShape, record: Y.Map<unknown>, field: string): void {
  const written = record._map.get(field);
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
    for (let clock = run.clock; clock < run.clock + run.length;) {
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
    const survivor = ownLostSurvivor(record, doc.clientID, redone.deletions);
    writeDeletion(record, true, survivor);
    joinWrites(step, record, true, survivor);
  }
}

/** The undo step of this replica's write of `field` on `record` that Yjs dropped, or null. */
function ownLostWrite(
  record: Y.Map<unknown>,
  client: number,
  history: HistoryShape,
  field: string
): StackItemShape | null {
  for (let item = record._map.get(field) ?? null; item; item = item.left) {
    if (item.parentSub !== field) continue;
    // A dropped write's content can already be collected, so its value is not read here.
    if (item.id.client !== client || !item.deleted) continue;
    const step = history.undoStack.find((candidate) =>
      Y.isDeleted(candidate.insertions as never, item.id)
    );
    if (step) return step;
  }
  return null;
}

/** Whether this replica's own value holds the key: nothing to write again. */
function ownValueStands(
  record: Y.Map<unknown>,
  client: number,
  field: string = NODE_DELETED_FIELD
): boolean {
  const holder = record._map.get(field);
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
    for (let clock = run.clock; clock < run.clock + run.length;) {
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
