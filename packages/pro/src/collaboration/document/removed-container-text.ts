/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The text that paragraphs inside a removed container showed, for the deletion record of the
 * edit that removed it (`paragraph-text-deletions.ts`).
 *
 * Removing a block that holds paragraphs, as a content control removed with its content or
 * a table, deletes their text with it. Only the container leaves its parent's list, so the
 * paragraphs in it keep their records and their listing in the container. A peer that moved
 * those paragraphs out at the same time, as a removal of the same control that keeps its
 * content does, lists them where nothing removed them, and the deleted text showed again.
 * The record of what the paragraphs showed hides that text wherever it is listed.
 *
 * Rows and cells are left out: a row or column deletion removes the cells, not the text a
 * concurrent cell merge moved out of them.
 */
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';

/** Kinds whose removal deletes the cells that hold text, not the text. */
const STRUCTURE_KINDS = new Set(['tableRow', 'tableCell']);

/** The nodes an edit took out of lists, and those it listed again: a removal it undid is a move. */
interface RemovalPlan {
  readonly removed: readonly LogicalId[];
  readonly reinserted: ReadonlySet<LogicalId>;
  readonly unlistedAtEnd: ReadonlySet<LogicalId>;
}

/**
 * What each paragraph inside a container this edit removed showed, by paragraph. Reads the
 * view while the index still describes the state before the edit, as `deleteCopiesOfRemoved`
 * does for removed paragraphs.
 */
export function textOfRemovedContainers(
  registry: DocumentRegistry,
  planned: RemovalPlan,
  formerChildren: ReadonlyMap<LogicalId, readonly LogicalId[]>
): Map<LogicalId, string[]> {
  const shownBy = new Map<LogicalId, string[]>();
  const moved = (id: LogicalId): boolean =>
    planned.reinserted.has(id) && !planned.unlistedAtEnd.has(id);
  const stack: LogicalId[] = [];
  /** The removed containers and the nodes inside them, as far as the walk has come. */
  const inside = new Set<LogicalId>();
  for (const id of planned.removed) {
    const kind = registry.kindOf(id);
    if (kind === null || kind === 'paragraph' || STRUCTURE_KINDS.has(kind)) continue;
    if (moved(id) || !registry.isTombstoned(id)) continue;
    inside.add(id);
    for (const child of formerChildren.get(id) ?? []) stack.push(child);
  }
  // Bounded by the nodes shared state holds: each is visited once.
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (inside.has(id) || moved(id) || registry.isTombstoned(id)) continue;
    inside.add(id);
    const kind = registry.kindOf(id);
    if (kind === 'paragraph') {
      // A paragraph another list holds too, as when a peer's removal that kept the content
      // arrived first, can show there: this edit did not take it out of view.
      if (listedOutside(registry, id, inside)) continue;
      const shown = shownOf(registry, id);
      if (shown.length > 0) shownBy.set(id, shown);
      continue;
    }
    const shape = registry.nodeShape(id);
    if (shape && !shape.isText) for (const child of shape.children) stack.push(child);
  }
  return shownBy;
}

/** Whether a live node outside the removed containers lists the paragraph. */
function listedOutside(
  registry: DocumentRegistry,
  id: LogicalId,
  inside: ReadonlySet<LogicalId>
): boolean {
  return registry
    .listingParents(id)
    .some((parent) => !inside.has(parent) && !registry.isTombstoned(parent));
}

/** The identities a paragraph shows: its own text and the text that follows into it. */
function shownOf(registry: DocumentRegistry, id: LogicalId): string[] {
  const text = registry.inline.textOf(id);
  if (!text) return [];
  const shown = registry.inline.viewOf(id).shown(text);
  const showing: string[] = [];
  shown.identities.ids.forEach((identity, position) => {
    if (identity && !shown.hidden.has(position)) showing.push(identity);
  });
  for (const following of shown.incoming) {
    for (const identity of following.identities) if (identity) showing.push(identity);
  }
  return showing;
}
