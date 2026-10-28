/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';

/**
 * The paragraphs that leave the document inside the removed nodes, not removed themselves.
 *
 * A deleted row, column, or table tombstones its rows or cells, not the paragraphs they hold.
 * Those paragraphs keep their text for an undo, and the edit records the text they showed as
 * deleted, as it does for a paragraph it removes itself. Without that record, a peer that
 * deleted the same row at the same time and then undid its delete showed the row again with
 * the text this edit deleted, including text that peer never saw.
 *
 * Only a tombstone with no survivor counts: a survivor adopts what the tombstone lists, so
 * that content stays in the document. A child the tombstone still lists is walked even when a
 * live parent lists it too, because the walk stops at the first node the registry shows
 * elsewhere: {@link DocumentRegistry.listingParents} names every listing parent.
 */
export function paragraphsInsideRemoved(
  registry: DocumentRegistry,
  removed: readonly LogicalId[]
): ReadonlySet<LogicalId> {
  const removedSet = new Set(removed);
  const inside = new Set<LogicalId>();
  const seen = new Set<LogicalId>(removed);
  const stack: { id: LogicalId; depth: number }[] = [];
  for (const id of removed) {
    if (!registry.isTombstoned(id) || registry.replacedByOf(id) !== null) continue;
    stack.push({ id, depth: 0 });
  }
  while (stack.length > 0) {
    const { id, depth } = stack.pop()!;
    if (depth >= registry.limits.maxTreeDepth) continue;
    const shape = registry.nodeShape(id);
    if (!shape || shape.isText) continue;
    for (const child of shape.children) {
      if (seen.has(child)) continue;
      seen.add(child);
      // A child a parent outside the removed nodes also lists stays in the document.
      if (
        registry
          .listingParents(child)
          .some((parent) => parent !== id && !removedSet.has(parent) && !seen.has(parent))
      ) {
        continue;
      }
      if (registry.kindOf(child) === 'paragraph') inside.add(child);
      stack.push({ id: child, depth: depth + 1 });
    }
  }
  return inside;
}
