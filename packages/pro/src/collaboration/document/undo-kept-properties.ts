/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Properties another participant added stay when an undo takes back their container.
 *
 * A first formatting edit of a paragraph creates its `w:pPr`. When another participant then
 * formats the same paragraph, their property goes into that `w:pPr`. An undo of the first
 * edit unlists the `w:pPr`, and the other participant's property, still listed in it, shows
 * nowhere. So the undo keeps the listing of a property container the step listed while the
 * container lists a live child that the step did not write. The step's own children still go.
 */
import * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import { childArrayOf, isNodeMap, NODE_CHILDREN_FIELD, readNodeShell } from './schema.ts';
import { MERGED_KINDS } from './singleton-children.ts';
import { deleteSetRuns, fieldOf, holderItem, structAt } from './yjs-items.ts';

type Step = { readonly insertions?: unknown } | undefined;

/** Whether `container`'s children list a live entry that `step` did not write. */
function holdsOthers(container: Y.Array<LogicalId>, step: Step): boolean {
  const insertions = step?.insertions as Parameters<typeof Y.isDeleted>[0] | undefined;
  for (let item = container._start; item; item = item.right) {
    if (!item.deleted && !(insertions && Y.isDeleted(insertions, item.id))) return true;
  }
  return false;
}

/** The items of `step` that its undo keeps for other participants' properties, or null. */
export function undoKeepsProperties(
  doc: Y.Doc,
  nodes: Y.Map<Y.Map<unknown>>,
  step: unknown
): ((item: Y.Item) => boolean) | null {
  const kept = new Set<Y.Item>();
  for (const run of deleteSetRuns((step as Step)?.insertions)) {
    for (let clock = run.clock; clock < run.clock + run.length;) {
      const item = structAt(doc, { client: run.client, clock });
      if (!item) break;
      clock = item.id.clock + item.length;
      const array = item.parent;
      if (item.deleted || !(array instanceof Y.Array) || fieldOf(array) !== NODE_CHILDREN_FIELD) {
        continue;
      }
      const ids = item.content.getContent();
      const keeps = ids.every((id) => {
        const record = typeof id === 'string' ? nodes.get(id) : undefined;
        if (!isNodeMap(record) || !MERGED_KINDS.has(readNodeShell(record).kind)) return false;
        const children = childArrayOf(record);
        return children !== null && holdsOthers(children, step as Step);
      });
      if (ids.length > 0 && keeps && holderItem(array) !== null) kept.add(item);
    }
  }
  return kept.size === 0 ? null : (item) => kept.has(item);
}
