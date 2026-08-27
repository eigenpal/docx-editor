/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';

/** Read the item that holds a type, which Yjs keeps off the public surface. */
function itemOf(type: unknown): Y.Item | null {
  return (type as { _item?: Y.Item | null } | null)?._item ?? null;
}

/** Whether an item carries a shared type, so deleting it takes a whole subtree along. */
function carriesType(item: Y.Item): boolean {
  return item.content instanceof Y.ContentType;
}

/**
 * Which items an undo may delete, for `Y.UndoManager`'s `deleteFilter`.
 *
 * Creating a node is `nodes.set(id, record)`, so undoing that creation MAP-DELETES the record.
 * That is the one move the tombstone contract forbids: a peer typing in the node anchored its
 * characters in the record's `Y.Text`, and deleting the record deletes that text along with it.
 * The peer's write is concurrent — it has not reached this replica when the undo runs, and it
 * arrives to find its parent gone, so no check of what the record currently holds can see it
 * coming. Afterwards the characters are unreachable through any API: no tombstone to audit,
 * nothing to rescue. Repair cannot help here; only prevention can.
 *
 * So two things are held back, and only these two: the record entry in `nodes`, and a record
 * field that carries a shared type — `children` and `t`. Those are the containers a peer's write
 * can land inside, and the schema only ever writes them when it builds the record, so pinning one
 * can never strand a replaced container either.
 *
 * A record's PLAIN fields are left alone, and that distinction is the whole correctness of this.
 * Holding them back too was the first attempt, and it broke undo of a paragraph split: the split
 * supersedes the original run by setting `deleted` on it, pinning that flag kept the run
 * tombstoned, and the registry then re-unlisted the run that the undo had just restored — the
 * paragraph came back empty, its text gone from the document. `deleted`, `replacedBy` and the
 * packed shell hold no one else's content, so undoing them destroys nothing and skipping them
 * corrupts the record.
 *
 * Everything deeper undoes normally: characters inside a `Y.Text`, ids inside a child listing.
 * Those items belong to the author running the undo, and removing them is what undo means. The
 * inserted node still leaves the document, because the id listing it under its parent is one of
 * them. What stays behind is an unreferenced record holding the peer's text — reachable and
 * repairable, instead of destroyed.
 *
 * @param nodes - the shared node map, `PackageSchema.nodes`.
 */
export function nodeRecordDeleteFilter(nodes: unknown): (item: Y.Item) => boolean {
  return (item: Y.Item): boolean => {
    const parent = item.parent;
    if (parent === null) return true;
    // The record entry itself.
    if ((parent as unknown) === nodes) return false;
    // A field of a record: its holder sits directly in `nodes`.
    const holder = itemOf(parent);
    if (holder === null || (holder.parent as unknown) !== nodes) return true;
    return !carriesType(item);
  };
}
