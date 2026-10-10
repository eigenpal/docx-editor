/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Every read of Yjs structure that the public Yjs API does not offer, in one place.
 *
 * The collaboration model reads item IDs, origins, neighbors and the store's pending updates.
 * Yjs declares these members in its own types, but outside its documented API, so each read
 * goes through a function here: an upgrade of Yjs is checked in this file, and no other module
 * casts a Yjs value.
 */
import * as Y from 'yjs';

/**
 * Keep every formatting marker a peer wrote. After a remote update Yjs deletes, in a local
 * transaction, the markers that look redundant on this replica. A peer's concurrent insert
 * can sit behind such a marker, so the deletion reached it and took away its run and text
 * element. Paragraph text keeps a node's identity in these markers, so none is removed; the
 * text still reads the same attributes, and every replica holds the same markers. Returns
 * the function that stops it.
 */
export function keepFormattingMarkers(doc: Y.Doc): () => void {
  const keep = (transaction: Y.Transaction): void => {
    transaction._needFormattingCleanup = false;
  };
  doc.on('afterTransaction', keep);
  return () => doc.off('afterTransaction', keep);
}

/**
 * Delete `length` characters and embeds of `text` from `index`, and nothing else. Yjs's own
 * delete also removes the formatting markers it finds redundant in the deleted range, as this
 * replica sees it; a peer's concurrent insert there then loses its run and text element.
 */
export function deleteContent(text: Y.Text, index: number, length: number): void {
  const doc = text.doc;
  if (!doc) {
    text.delete(index, length);
    return;
  }
  Y.transact(doc, (transaction) => {
    let skip = index;
    let left = length;
    for (let item = text._start; item && left > 0; item = item.right) {
      if (item.deleted || !item.countable) continue;
      if (skip >= item.length) {
        skip -= item.length;
        continue;
      }
      let target: Y.Item = item;
      if (skip > 0) {
        target = Y.getItemCleanStart(transaction, Y.createID(item.id.client, item.id.clock + skip));
        skip = 0;
      }
      if (left < target.length) {
        Y.getItemCleanStart(transaction, Y.createID(target.id.client, target.id.clock + left));
      }
      left -= target.length;
      target.delete(transaction);
      item = target;
    }
  });
  // Yjs caches index positions while it edits a text; this deletion bypassed that bookkeeping.
  if (text._searchMarker) text._searchMarker.length = 0;
}

/**
 * Delete the characters and embeds at `positions` of a text in one pass over its items. One
 * `deleteContent` per position walks the text from its start each time, which a peer that
 * plants many copies of one character turned into quadratic work on an honest replica.
 */
export function deletePositions(text: Y.Text, positions: Iterable<number>): void {
  const wanted = [...new Set(positions)].filter((at) => at >= 0).sort((a, b) => a - b);
  if (wanted.length === 0) return;
  const doc = text.doc;
  if (!doc) {
    for (let at = wanted.length - 1; at >= 0; at -= 1) text.delete(wanted[at]!, 1);
    return;
  }
  Y.transact(doc, (transaction) => {
    let next = 0;
    let at = 0;
    for (let item = text._start; item && next < wanted.length; item = item.right) {
      if (item.deleted || !item.countable) continue;
      const end = at + item.length;
      let piece: Y.Item = item;
      let pieceStart = at;
      while (next < wanted.length && wanted[next]! < end) {
        const from = wanted[next]!;
        let to = from + 1;
        next += 1;
        while (next < wanted.length && wanted[next] === to && to < end) {
          to += 1;
          next += 1;
        }
        let target = piece;
        if (from > pieceStart) {
          target = Y.getItemCleanStart(
            transaction,
            Y.createID(piece.id.client, piece.id.clock + (from - pieceStart))
          );
        }
        if (to - from < target.length) {
          Y.getItemCleanStart(
            transaction,
            Y.createID(target.id.client, target.id.clock + (to - from))
          );
        }
        target.delete(transaction);
        piece = to < end ? target.right! : target;
        pieceStart = to;
      }
      // Continue after the last piece of this item, whatever the splits made of it.
      item = piece;
      at = end;
    }
  });
  if (text._searchMarker) text._searchMarker.length = 0;
}

/**
 * The IDs of the characters and embeds at `positions` of a text's visible content. An ID stays
 * the same when later edits shift the positions, so it names the same content afterwards.
 */
export function itemIdsAt(text: Y.Text, positions: Iterable<number>): ItemId[] {
  const wanted = [...new Set(positions)].filter((at) => at >= 0).sort((a, b) => a - b);
  const ids: ItemId[] = [];
  let next = 0;
  let at = 0;
  for (let item = text._start; item && next < wanted.length; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const end = at + item.length;
    for (; next < wanted.length && wanted[next]! < end; next += 1) {
      ids.push({ client: item.id.client, clock: item.id.clock + (wanted[next]! - at) });
    }
    at = end;
  }
  return ids;
}

/** Delete the visible content with the given IDs; content already deleted is left as it is. */
export function deleteItemIds(text: Y.Text, ids: readonly ItemId[]): void {
  if (ids.length === 0) return;
  const byClient = new Map<number, Set<number>>();
  for (const { client, clock } of ids) {
    let clocks = byClient.get(client);
    if (!clocks) byClient.set(client, (clocks = new Set()));
    clocks.add(clock);
  }
  const positions: number[] = [];
  let at = 0;
  for (let item = text._start; item; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const clocks = byClient.get(item.id.client);
    if (clocks) {
      for (let offset = 0; offset < item.length; offset += 1) {
        if (clocks.has(item.id.clock + offset)) positions.push(at + offset);
      }
    }
    at += item.length;
  }
  deletePositions(text, positions);
}

/** The live embed item at `index` of a text's visible content, or null. */
export function embedItemAt(text: Y.Text, index: number): Y.Item | null {
  let at = 0;
  for (let item = text._start; item; item = item.right) {
    if (item.deleted || !item.countable) continue;
    if (at === index) return item.content instanceof Y.ContentEmbed ? item : null;
    at += item.length;
    if (at > index) return null;
  }
  return null;
}

/** Where a live item stands in a text's visible content, or null when it is not there. */
export function positionOfItem(text: Y.Text, target: Y.Item): number | null {
  let at = 0;
  for (let item = text._start; item; item = item.right) {
    if (item === target) return item.deleted ? null : at;
    if (!item.deleted && item.countable) at += item.length;
  }
  return null;
}

/** Delete one item of a text, as `deleteContent` does, without touching its neighbors. */
export function deleteItem(text: Y.Text, item: Y.Item): void {
  const doc = text.doc;
  if (!doc || item.deleted) return;
  Y.transact(doc, (transaction) => item.delete(transaction));
  if (text._searchMarker) text._searchMarker.length = 0;
}

/** The ID of one Yjs item: the client that wrote it and its clock. */
export interface ItemId {
  readonly client: number;
  readonly clock: number;
}

/** The first item of a shared type, deleted items included. */
export function firstItem<Event>(type: Y.AbstractType<Event>): Y.Item | null {
  return type._start;
}

/**
 * The struct that holds `id`: an item, or a collected struct once garbage collection merged
 * it. Null when this replica has no struct for the ID.
 */
export function structAt(doc: Y.Doc, id: ItemId): Y.Item | null {
  let struct: Y.AbstractStruct;
  try {
    struct = Y.getItem(doc.store, Y.createID(id.client, id.clock));
  } catch {
    return null;
  }
  return struct instanceof Y.Item ? struct : null;
}

/** The items this replica wrote since its clock stood at `from`, in clock order. */
export function* itemsWrittenSince(doc: Y.Doc, from: number): Generator<Y.Item> {
  const client = doc.clientID;
  const to = Y.getState(doc.store, client);
  for (let clock = from; clock < to; ) {
    const struct: Y.AbstractStruct = Y.getItem(doc.store, Y.createID(client, clock));
    clock = struct.id.clock + struct.length;
    if (struct instanceof Y.Item) yield struct;
  }
}

/** The first character item this replica wrote since its clock stood at `from`. */
export function firstStringWrittenSince(doc: Y.Doc, from: number): Y.Item | null {
  for (const item of itemsWrittenSince(doc, from)) {
    if (item.content instanceof Y.ContentString) return item;
  }
  return null;
}

/**
 * Insert text or an embed, and return the first item the insert wrote, so a mark can name
 * it. Null for a text that belongs to no document, which marks cannot reach.
 */
export function insertAndFind(
  text: Y.Text,
  position: number,
  content: string | object,
  attributes: Readonly<Record<string, string>>
): Y.Item | null {
  const doc = text.doc;
  const from = doc ? Y.getState(doc.store, doc.clientID) : 0;
  if (typeof content === 'string') text.insert(position, content, { ...attributes });
  else text.insertEmbed(position, content, { ...attributes });
  if (!doc) return null;
  return typeof content === 'string'
    ? firstStringWrittenSince(doc, from)
    : firstEmbedWrittenSince(doc, from);
}

/** The first embed this replica wrote since its clock stood at `from`, or null. */
export function firstEmbedWrittenSince(doc: Y.Doc, from: number): Y.Item | null {
  for (const item of itemsWrittenSince(doc, from)) {
    if (item.content instanceof Y.ContentEmbed) return item;
  }
  return null;
}

/** The key under which a shared type sits in its parent map, or null in an array or a root. */
export function fieldOf<Event>(type: Y.AbstractType<Event>): string | null {
  return type._item?.parentSub ?? null;
}

/**
 * The item that holds a shared type, or null for a root type, a type not yet integrated, or a
 * value that is no shared type (an item's parent can also be an ID).
 */
export function holderItem(value: unknown): Y.Item | null {
  return value instanceof Y.AbstractType ? value._item : null;
}

/** The ID of the item that holds a shared type, or null before it is integrated. */
export function itemIdOf<Event>(type: Y.AbstractType<Event>): ItemId | null {
  return type._item?.id ?? null;
}

/**
 * The item of a map key, deleted or not. Undefined when the key never reached this replica:
 * Yjs keeps a deleted value as a deleted item, while a key whose update has not arrived has
 * no item at all.
 */
export function mapEntry<Value>(map: Y.Map<Value>, key: string): Y.Item | undefined {
  return map._map.get(key);
}

/** The update Yjs holds because it waits on updates that have not arrived, if any. */
export function pendingUpdate(doc: Y.Doc): Uint8Array | null {
  return doc.store.pendingStructs?.update ?? null;
}

/**
 * Whether Yjs holds back part of what a replica received.
 *
 * Updates from several peers can arrive out of order. Yjs applies at once the deletions of
 * an update and holds back its insertions until what they depend on arrives. Meanwhile
 * shared state can lack a record a text embeds, or an attribute a peer replaced. That
 * state is incomplete, not broken, and the update that completes it arrives later.
 */
export function awaitingUpdates(doc: Y.Doc): boolean {
  return doc.store.pendingStructs !== null || doc.store.pendingDs !== null;
}

/** The keys a transaction changed in one shared type, or null when it changed none. */
export function changedKeysOf(
  transaction: Y.Transaction,
  type: object
): ReadonlySet<string | null> | null {
  for (const [changed, keys] of transaction.changed) if (changed === type) return keys;
  return null;
}

/** The runs of item ids a delete set holds, such as a history step's insertions. */
export function deleteSetRuns(
  deleteSet: unknown
): { readonly client: number; readonly clock: number; readonly length: number }[] {
  const clients = (deleteSet as { clients?: unknown } | null)?.clients;
  if (!(clients instanceof Map)) return [];
  const runs: { client: number; clock: number; length: number }[] = [];
  for (const [client, items] of clients as Map<number, { clock: number; len: number }[]>) {
    for (const item of items) runs.push({ client, clock: item.clock, length: item.len });
  }
  return runs;
}
