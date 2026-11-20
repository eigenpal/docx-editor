/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Which review items get a card of their own, and the small identity helpers that let a rail
// skip work for an item list that did not change. Shared by the React and Vue rails.

/** The fields of a review item that decide whether it is a reply inside another card. */
export interface ReviewThreadEntry {
  readonly id: string;
  readonly kind: string;
  readonly parentId?: string;
  readonly parentRevisionId?: string;
}

/**
 * Whether this entry renders INSIDE another card rather than as one of its own.
 *
 * Two kinds of reply, one rule. A threaded reply belongs in the comment it answers; a reply to
 * a TRACKED CHANGE is also a comment — OOXML gives `w:ins` and `w:del` no body, so the text is
 * written over the change's own range — and belongs in the change's card. Everywhere the rail
 * lists roots asks this, because a filter that checked only `parentId` drew a reply to a
 * revision twice: once inside the change and once beside it.
 */
export function isThreadedReply(entry: ReviewThreadEntry, present: ReadonlySet<string>): boolean {
  if (entry.kind !== 'comment') return false;
  // A parent this list does not hold is not a parent HERE. The engine already drops a link
  // its own `excludeRevisionKinds` filter broke, but a consumer's `filter` prop can break one
  // too, and a comment excluded as a reply to a card nobody draws is a comment that vanishes.
  // Falling back to root is the only answer that always renders it somewhere.
  if (entry.parentId !== undefined) return present.has(entry.parentId);
  if (entry.parentRevisionId !== undefined) return present.has(entry.parentRevisionId);
  return false;
}

/** Ids of everything the rail is working from, for the reply/root test above. */
export function idsOf(items: readonly ReviewThreadEntry[]): ReadonlySet<string> {
  return new Set(items.map((entry) => entry.id));
}

const rootsByList = new WeakMap<readonly ReviewThreadEntry[], readonly ReviewThreadEntry[]>();

/**
 * The items that render as cards: every item that is not a reply threaded inside another.
 *
 * Indexed once per item list. The rail, its card list and its markers all ask for the roots of
 * the same list, and an unchanged list answers with the same array, so a memo that depends on
 * the roots holds.
 */
export function reviewRootsOf<Item extends ReviewThreadEntry>(
  items: readonly Item[]
): readonly Item[] {
  const known = rootsByList.get(items);
  if (known) return known as readonly Item[];
  const present = idsOf(items);
  const roots = items.filter((entry) => !isThreadedReply(entry, present));
  rootsByList.set(items, roots);
  return roots;
}

/** True when both lists hold the same elements, by identity, in the same order. */
export function sameElements<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/** True when both maps hold the same keys in the same order, with identical values. */
export function sameEntries<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  const other = b.entries();
  for (const [key, value] of a) {
    const next = other.next().value as [K, V];
    if (next[0] !== key || next[1] !== value) return false;
  }
  return true;
}

/** True when both records hold the same keys with identical values. */
export function sameFields<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof T)[];
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (!Object.hasOwn(b, key) || a[key] !== b[key]) return false;
  return true;
}

const NO_REPLIES: readonly never[] = Object.freeze([]);

/**
 * The replies a card draws, in the item's own order. An item without replies answers one
 * shared empty list, so a card that compares its replies by identity does not see a change.
 */
export function repliesOf<Item extends { readonly replyIds: readonly string[] }>(
  entry: Item,
  byId: ReadonlyMap<string, Item>
): readonly Item[] {
  if (entry.replyIds.length === 0) return NO_REPLIES;
  const replies: Item[] = [];
  for (const id of entry.replyIds) {
    const reply = byId.get(id);
    if (reply) replies.push(reply);
  }
  return replies;
}
