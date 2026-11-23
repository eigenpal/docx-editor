/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * A property container an undo empties goes with its last property.
 *
 * An undo keeps a `w:pPr` or `w:rPr` another participant also wrote a property into
 * (`undo-kept-properties.ts`). When an undo later takes back that last property, the container
 * stays listed with nothing in it, and the document saves an empty `<w:pPr/>` or `<w:rPr/>`
 * that it did not hold before. So after an undo, each such container the undo emptied is
 * unlisted, and then the container that listed it when that one is empty too. The redo of
 * that undo puts the properties back into the same records, so it lists each container again
 * where it was.
 */
import * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import { childArrayOf, NODE_CHILDREN_FIELD } from './schema.ts';
import { deleteSetRuns, fieldOf, holderItem, structAt } from './yjs-items.ts';

/** The containers this module unlists when they are empty. */
const CONTAINER_KINDS: ReadonlySet<string> = new Set(['paragraphProperties', 'runProperties']);

/** Containers nest at most this deep (`w:pPr/w:rPr`). */
const MAX_DEPTH = 4;

/** A container an undo emptied and unlisted, which its redo lists again. */
export interface RemovedContainer {
  readonly node: LogicalId;
  readonly from: LogicalId;
  readonly index: number;
}

/** Before an undo of `step`: the containers that list entries the step wrote. */
export function containersOfStep(registry: DocumentRegistry, step: unknown): LogicalId[] {
  const nodes = registry.schema.nodes;
  const found = new Set<LogicalId>();
  const insertions = (step as { readonly insertions?: unknown } | undefined)?.insertions;
  for (const run of deleteSetRuns(insertions)) {
    for (let clock = run.clock; clock < run.clock + run.length;) {
      const item = structAt(registry.doc, { client: run.client, clock });
      if (!item) break;
      clock = item.id.clock + item.length;
      const array = item.parent;
      if (item.deleted || !(array instanceof Y.Array) || fieldOf(array) !== NODE_CHILDREN_FIELD) {
        continue;
      }
      const holder = holderItem(holderItem(array)?.parent);
      const id = holder?.parentSub;
      if ((holder?.parent as unknown) !== nodes || typeof id !== 'string') continue;
      if (CONTAINER_KINDS.has(registry.kindOf(id as LogicalId) ?? '')) found.add(id as LogicalId);
    }
  }
  return [...found];
}

/** Whether `id` is a listed container with no children and no attributes. */
function isEmptyContainer(registry: DocumentRegistry, id: LogicalId): boolean {
  if (!CONTAINER_KINDS.has(registry.kindOf(id) ?? '')) return false;
  const record = registry.record(id);
  return (
    !!record &&
    'childIds' in record &&
    record.childIds.length === 0 &&
    record.attributes.length === 0
  );
}

/** After the undo: unlist each candidate it emptied, and each container that empties with it. */
export function removeEmptyContainers(
  registry: DocumentRegistry,
  candidates: readonly LogicalId[]
): RemovedContainer[] {
  const removed: RemovedContainer[] = [];
  for (const candidate of candidates) {
    let node: LogicalId | null = candidate;
    for (let depth = 0; node && depth < MAX_DEPTH && isEmptyContainer(registry, node); depth++) {
      const from = registry.parentOf(node);
      const children = from ? childArrayOf(registry.schema.nodes.get(from)) : null;
      const index = children ? children.toArray().indexOf(node) : -1;
      if (!from || !children || index < 0) break;
      children.delete(index, 1);
      removed.push({ node, from, index });
      node = from;
    }
  }
  return removed;
}

/** On a redo of the undo that made `removed`: each container is listed again, last first. */
export function restoreEmptyContainers(
  registry: DocumentRegistry,
  removed: readonly RemovedContainer[]
): void {
  for (const { node, from, index } of [...removed].reverse()) {
    if (registry.parentOf(node) !== null) continue;
    const children = childArrayOf(registry.schema.nodes.get(from));
    if (children) children.insert(Math.min(index, children.length), [node]);
  }
}
