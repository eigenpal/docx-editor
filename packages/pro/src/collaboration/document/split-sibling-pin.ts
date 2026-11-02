/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * A local edit leaves the blocks it does not remove where its author saw them.
 *
 * Concurrent split siblings show in an order that `split-sibling-order.ts` reads from the
 * whole run: its members, their split points, and the text they copy. An edit that removes one
 * member, by a delete or a join, changes what the rule reads, so the members the edit left can
 * show in another order than the one the author saw. A plain store never reorders blocks an
 * edit leaves, and neither may shared state.
 *
 * So after a local edit, each parent it changed whose order the rule moved is read again. When
 * the blocks the edit left show in another order than before, the range that moved is listed
 * again, as one new entry in the order the author saw. The rule moves only paragraphs that a
 * split listed, so a block listed again shows where it is listed. The new entry goes right
 * after the block shown before the range, so it moves with that block wherever the rule shows
 * it. The edit and this listing are one undo step; the undo puts the removed entries back, and
 * `relistSplitEntries` makes each name its split points again.
 */
import type * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import { childArrayOf } from './schema.ts';
import type { CanonicalPrimitiveJournal } from '@docx-editor.dev/core/collaboration/replication';

/** How often a parent is listed again after one edit; each pass reads the rule again. */
const MAX_PASSES = 2;

/** A parent an edit changes, and the order it showed its children in before the edit. */
export interface ShownOrder {
  readonly parentId: LogicalId;
  readonly shown: readonly LogicalId[];
  /** The blocks the edit lists or moves itself: it decides where those show. */
  readonly placed: ReadonlySet<LogicalId>;
}

/**
 * The order of each parent that `journal` changes and whose shown order the split sibling rule
 * moves. Most edits change no such parent, and this reads only stored orders.
 */
export function shownOrdersBefore(
  registry: DocumentRegistry,
  /** A journal in shared coordinates (`projectJournalToShared`). */
  journal: CanonicalPrimitiveJournal
): ShownOrder[] {
  const parents = new Set<LogicalId>();
  const placed = new Set<LogicalId>();
  for (const effect of journal.effects) {
    if (effect.kind === 'spliceChildren') {
      parents.add(effect.parentLogicalId as LogicalId);
      for (const id of effect.childLogicalIds) placed.add(id as LogicalId);
    } else if (effect.kind === 'moveNode') {
      placed.add(effect.logicalId as LogicalId);
      parents.add(effect.destinationParentLogicalId as LogicalId);
      const from = registry.parentOf(effect.logicalId as LogicalId);
      if (from) parents.add(from);
    }
  }
  const orders: ShownOrder[] = [];
  for (const parentId of parents) {
    if (!registry.splitSiblings.ranksOf(parentId)) continue;
    const shown = registry.splitSiblings.shownChildren(parentId);
    if (shown) orders.push({ parentId, shown, placed });
  }
  return orders;
}

/**
 * `after` with the blocks it shares with `before`, other than those the edit placed, in the
 * order of `before`, each in a place one of them holds in `after`; null when they already are.
 */
function keptOrder(
  before: readonly LogicalId[],
  after: readonly LogicalId[],
  placed: ReadonlySet<LogicalId>
): LogicalId[] | null {
  const inAfter = new Set(after);
  const keeps = new Set(before.filter((id) => inAfter.has(id) && !placed.has(id)));
  const kept = before.filter((id) => keeps.has(id));
  let next = 0;
  let moved = false;
  const target = after.map((id) => {
    if (!keeps.has(id)) return id;
    const placed = kept[next++]!;
    if (placed !== id) moved = true;
    return placed;
  });
  return moved ? target : null;
}

/**
 * List the range of `target` that differs from `after` again, as one entry right after the
 * block shown before it. False, writing nothing, when a block of the range is listed more
 * than once or by another parent too: its placement is a contest this rule does not decide.
 */
function listAgain(
  registry: DocumentRegistry,
  parentId: LogicalId,
  after: readonly LogicalId[],
  target: readonly LogicalId[]
): boolean {
  const children = childArrayOf(registry.schema.nodes.get(parentId));
  if (!children) return false;
  let low = 0;
  while (target[low] === after[low]) low += 1;
  let high = target.length - 1;
  while (target[high] === after[high]) high -= 1;
  const range = target.slice(low, high + 1);
  const listed = children.toArray();
  for (const id of range) {
    if (listed.indexOf(id) !== listed.lastIndexOf(id)) return false;
    const parents = registry.listingParents(id);
    if (parents.length !== 1 || parents[0] !== parentId) return false;
  }
  const moving = new Set(range);
  for (let at = listed.length - 1; at >= 0; at -= 1)
    if (moving.has(listed[at]!)) children.delete(at, 1);
  const before = low > 0 ? children.toArray().indexOf(target[low - 1]!) : -1;
  children.insert(before + 1, range);
  return true;
}

/**
 * After a local edit, list again each range of `orders` whose blocks the edit left now show in
 * another order, in this replica's `origin`, so the undo step of the edit holds it.
 */
export function keepShownOrders(
  registry: DocumentRegistry,
  doc: Y.Doc,
  origin: unknown,
  orders: readonly ShownOrder[]
): void {
  for (const { parentId, shown, placed } of orders)
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const after = registry.splitSiblings.shownChildren(parentId);
      const target = after ? keptOrder(shown, after, placed) : null;
      if (!after || !target) break;
      let written = false;
      doc.transact(() => {
        written = listAgain(registry, parentId, after, target);
      }, origin);
      if (!written) break;
    }
}
