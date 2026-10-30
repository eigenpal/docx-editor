/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import { sameChildOrder } from './registry-node-reads.ts';

/** Which parents list each child, and the child order each parent last listed. */
export interface ChildListings {
  readonly listings: Map<LogicalId, Set<LogicalId>>;
  readonly childrenSnapshot: Map<LogicalId, readonly LogicalId[]>;
}

export function addListing(index: ChildListings, childId: LogicalId, parentId: LogicalId): void {
  const listed = index.listings.get(childId) ?? new Set<LogicalId>();
  listed.add(parentId);
  index.listings.set(childId, listed);
}

function removeListing(index: ChildListings, childId: LogicalId, parentId: LogicalId): void {
  const listed = index.listings.get(childId);
  if (!listed) return;
  listed.delete(parentId);
  if (listed.size === 0) index.listings.delete(childId);
}

/**
 * Bring one parent's listings in line with its child array, and return the children whose
 * listing moved.
 */
export function syncChildListings(
  index: ChildListings,
  parentId: LogicalId,
  next: readonly LogicalId[]
): LogicalId[] {
  const prev = index.childrenSnapshot.get(parentId) ?? [];
  // The top-level node map reports a whole record as one key change, so this runs for every
  // node a journal writes, whether or not that node's children moved. An unchanged listing
  // has nothing to say and no snapshot to replace.
  if (sameChildOrder(prev, next)) return [];
  // Membership by set, not by scan. The body root lists every block in the document, and a
  // journal now publishes on the commit that produces it, so this sits on the keystroke
  // path: a scan per child cost ~640,000 comparisons to append one block to a list of 800.
  const nextSet = new Set(next);
  const prevSet = new Set(prev);
  const affected: LogicalId[] = [];
  for (const childId of prev) {
    if (nextSet.has(childId)) continue;
    removeListing(index, childId, parentId);
    affected.push(childId);
  }
  for (const childId of next) {
    // A child the snapshot already listed here is already in `listings`, because the two
    // only ever move together. Re-adding it cost three map operations per sibling, so
    // appending one block to a list of 800 rewrote all 800 listings to change one.
    if (prevSet.has(childId)) continue;
    addListing(index, childId, parentId);
    affected.push(childId);
  }
  index.childrenSnapshot.set(parentId, next);
  return affected;
}

/**
 * Delete each of `childIds` from a child array as many times as it is given, newest
 * occurrence first, so the delete stays item-level: an id a peer inserted concurrently is a
 * different Yjs item and keeps its place.
 */
export function unlistChildIds(
  children: Y.Array<LogicalId> | null | undefined,
  childIds: readonly LogicalId[]
): void {
  if (!children || childIds.length === 0) return;
  const remaining = new Map<LogicalId, number>();
  for (const childId of childIds) remaining.set(childId, (remaining.get(childId) ?? 0) + 1);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const value = children.get(index);
    const left = remaining.get(value) ?? 0;
    if (left === 0) continue;
    remaining.set(value, left - 1);
    children.delete(index, 1);
  }
}
