/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import { holderItem } from './yjs-items.ts';
import { FIELD_SEP, NODE_INITIAL_SHELL_FIELD, NODE_SPLIT_LINEAGE_FIELD } from './schema.ts';

/** The shared maps that hold each element's attributes and namespace bindings by node ID. */
export interface NodeDescriptorMaps {
  readonly attributes: Y.Map<string>;
  readonly bindings: Y.Map<string>;
}

/** The nodes the step being undone created, by the attribute map they describe. */
const undoingCreations = new WeakMap<Y.Map<string>, ReadonlySet<string>>();

/**
 * Run an undo of a step that created the nodes `created`.
 *
 * The undo keeps each created node's record, so a peer that lists the node again at the same
 * time, as a concurrent move does, shows it. The attributes and namespace bindings the step
 * wrote for those nodes are part of that record: without them the node shows again with no
 * paragraph identity, so no peer can place a caret in it. While `run` runs, the delete filter
 * keeps them too.
 */
export function whileUndoingCreations<Result>(
  maps: NodeDescriptorMaps,
  created: ReadonlySet<string>,
  run: () => Result
): Result {
  if (created.size === 0) return run();
  undoingCreations.set(maps.attributes, created);
  try {
    return run();
  } finally {
    undoingCreations.delete(maps.attributes);
  }
}

/** Whether `item` is an attribute or binding of a node the running undo un-creates. */
function describesUndoneCreation(item: Y.Item, maps: NodeDescriptorMaps | undefined): boolean {
  if (!maps || item.parentSub === null) return false;
  const parent = item.parent as unknown;
  if (parent !== maps.attributes && parent !== maps.bindings) return false;
  const created = undoingCreations.get(maps.attributes);
  if (!created) return false;
  const cut = item.parentSub.indexOf(FIELD_SEP);
  return cut > 0 && created.has(item.parentSub.slice(0, cut));
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
 * Retain the record entry in `nodes`, and a record
 * field that carries a shared type — `children` and `t`. Those are the containers a peer's write
 * can land inside, and the schema only ever writes them when it builds the record, so pinning one
 * can never strand a replaced container either.
 *
 * Mutable flags undo normally.
 * Holding them back too was the first attempt, and it broke undo of a paragraph split: the split
 * supersedes the original run by setting `deleted` on it, pinning that flag kept the run
 * tombstoned, and the registry then re-unlisted the run that the undo had just restored — the
 * paragraph came back empty, its text gone from the document. `deleted`, `replacedBy` and the
 * subsequent shell updates hold no one else's content, so undoing them destroys nothing and skipping them
 * corrupts the record.
 *
 * Initial shells and immutable split ancestry also survive: foreign descendants can reuse
 * these retained containers after their original author undoes a split.
 *
 * Everything deeper undoes normally: characters inside a `Y.Text`, ids inside a child listing.
 * Those items belong to the author running the undo, and removing them is what undo means. The
 * inserted node still leaves the document, because the id listing it under its parent is one of
 * them. What stays behind is an unreferenced record holding the peer's text — reachable and
 * repairable, instead of destroyed.
 *
 * The attributes and bindings a step wrote for a node it created stay as well, while an undo
 * of that step runs ({@link whileUndoingCreations}).
 *
 * @param nodes - the shared node map, `PackageSchema.nodes`.
 * @param maps - the attribute and binding maps, `PackageSchema.attributes` and `.bindings`.
 */
export function nodeRecordDeleteFilter(
  nodes: unknown,
  maps?: NodeDescriptorMaps
): (item: Y.Item) => boolean {
  return (item: Y.Item): boolean => {
    const parent = item.parent;
    if (parent === null) return true;
    if (describesUndoneCreation(item, maps)) return false;
    // The record entry itself.
    if ((parent as unknown) === nodes) return false;
    // A field of a record: its holder sits directly in `nodes`.
    const holder = holderItem(parent);
    if (holder === null || (holder.parent as unknown) !== nodes) return true;
    // A descendant created by another author still needs its origin's ancestry after undo.
    // Unlike splitFrom (which records the active split), this lineage is immutable evidence.
    if (item.parentSub === NODE_SPLIT_LINEAGE_FIELD) return false;
    // Retain the immutable fallback, not mutable shell items: a rename back to the initial
    // QName must still undo, even though its value equals the creation descriptor.
    if (item.parentSub === NODE_INITIAL_SHELL_FIELD) return false;
    return !carriesType(item);
  };
}
