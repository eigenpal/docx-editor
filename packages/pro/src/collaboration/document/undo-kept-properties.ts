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
 * container, or a property container in it, lists a live child that the step did not write.
 * The step's own children still go.
 *
 * A paragraph an undo unlists can also show another participant's tracked break proposal:
 * a local edit lists the proposal of a concurrent split where it shows
 * (`split-mark-moves.ts`), which can be a paragraph that the undone step created. After the
 * undo, that proposal goes to the paragraph shown before the unlisted one, so the break
 * stays a pending change.
 */
import * as Y from 'yjs';
import type { LogicalId } from './identity.ts';
import type { DocumentRegistry } from './registry.ts';
import { childArrayOf, isNodeMap, NODE_CHILDREN_FIELD, readNodeShell } from './schema.ts';
import { MERGED_KINDS } from './singleton-children.ts';
import { markPropertiesEnd } from './split-mark-moves.ts';
import { splitSiblingOrder } from './split-sibling-order.ts';
import { deleteSetRuns, fieldOf, holderItem, structAt } from './yjs-items.ts';

type Step = { readonly insertions?: unknown } | undefined;
type Insertions = Parameters<typeof Y.isDeleted>[0] | undefined;

/** Property containers nest at most this deep in a mark (`w:pPr/w:rPr`). */
const MAX_DEPTH = 4;

/** The live children `container` lists, each with whether `step` wrote its entry. */
function* liveEntries(
  container: Y.Array<LogicalId>,
  step: Step
): Generator<{ id: LogicalId; own: boolean }> {
  const insertions = step?.insertions as Insertions;
  for (let item = container._start; item; item = item.right) {
    if (item.deleted) continue;
    const own = insertions !== undefined && Y.isDeleted(insertions, item.id);
    for (const id of item.content.getContent()) {
      if (typeof id === 'string') yield { id: id as LogicalId, own };
    }
  }
}

/**
 * Whether `container`, or a property container it lists, lists a live entry that `step` did
 * not write.
 */
function holdsOthers(
  nodes: Y.Map<Y.Map<unknown>>,
  container: Y.Array<LogicalId>,
  step: Step,
  depth = 0
): boolean {
  for (const { id, own } of liveEntries(container, step)) {
    if (!own) return true;
    const record = nodes.get(id);
    if (depth >= MAX_DEPTH || !isNodeMap(record)) continue;
    if (!MERGED_KINDS.has(readNodeShell(record).kind)) continue;
    const children = childArrayOf(record);
    if (children && holdsOthers(nodes, children, step, depth + 1)) return true;
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
        return children !== null && holdsOthers(nodes, children, step as Step);
      });
      if (ids.length > 0 && keeps && holderItem(array) !== null) kept.add(item);
    }
  }
  return kept.size === 0 ? null : (item) => kept.has(item);
}

/** A proposal another participant listed in a paragraph that an undo unlists. */
export interface UndoneProposal {
  /** The `w:pPr` that holds the proposal. */
  readonly node: LogicalId;
  /** The paragraph the undo unlists. */
  readonly from: LogicalId;
  /** The paragraph shown before it that the step did not list. */
  readonly target: LogicalId;
}

/** The first live child of `parent` of `kind`. */
function childOfKind(registry: DocumentRegistry, parent: LogicalId, kind: string) {
  const record = registry.record(parent);
  const ids = record && 'childIds' in record ? record.childIds : [];
  return ids.find((id) => registry.showsAsChild(id) && registry.kindOf(id) === kind) ?? null;
}

/** Whether `properties`, a `w:pPr`, proposes its paragraph's mark (`w:rPr/w:ins`). */
function proposes(registry: DocumentRegistry, properties: LogicalId): boolean {
  const run = childOfKind(registry, properties, 'runProperties');
  const record = run ? registry.record(run) : null;
  const ids = record && 'childIds' in record ? record.childIds : [];
  return ids.some((id) => {
    const shell = registry.schema.nodes.get(id);
    return isNodeMap(shell) && readNodeShell(shell).localName === 'ins';
  });
}

/**
 * Before an undo of `step`: the proposals of other participants that paragraphs the step
 * listed show, and where each goes once the undo unlists its paragraph.
 */
export function undoneProposals(registry: DocumentRegistry, step: unknown): UndoneProposal[] {
  const nodes = registry.schema.nodes;
  const listed = new Map<LogicalId, Set<LogicalId>>();
  for (const run of deleteSetRuns((step as Step)?.insertions)) {
    for (let clock = run.clock; clock < run.clock + run.length;) {
      const item = structAt(registry.doc, { client: run.client, clock });
      if (!item) break;
      clock = item.id.clock + item.length;
      const array = item.parent;
      if (item.deleted || !(array instanceof Y.Array) || fieldOf(array) !== NODE_CHILDREN_FIELD) {
        continue;
      }
      const holder = holderItem(holderItem(array)?.parent);
      const parent = holder?.parentSub;
      if ((holder?.parent as unknown) !== nodes || typeof parent !== 'string') continue;
      for (const id of item.content.getContent()) {
        if (typeof id !== 'string' || !registry.inline.textOf(id as LogicalId)) continue;
        const ids = listed.get(parent as LogicalId) ?? new Set<LogicalId>();
        ids.add(id as LogicalId);
        listed.set(parent as LogicalId, ids);
      }
    }
  }
  const out: UndoneProposal[] = [];
  for (const [parent, ids] of listed) {
    const record = registry.record(parent);
    if (!record || !('childIds' in record)) continue;
    const children = record.childIds;
    const order = splitSiblingOrder(children, registry.splitSiblings.ranksOf(parent));
    const shown = order ? order.map((index) => children[index]!) : children;
    let target: LogicalId | null = null;
    for (const id of shown) {
      if (!ids.has(id)) {
        if (registry.showsAsChild(id) && registry.inline.textOf(id)) target = id;
        continue;
      }
      const paragraph = nodes.get(id);
      const entries = paragraph ? childArrayOf(paragraph) : null;
      if (!target || !entries) continue;
      for (const { id: child, own } of liveEntries(entries, step as Step)) {
        if (own || registry.kindOf(child) !== 'paragraphProperties') continue;
        if (proposes(registry, child)) out.push({ node: child, from: id, target });
      }
    }
  }
  return out;
}

/** Move `node` from `from`'s children into `to`'s children at `at`. */
function relist(registry: DocumentRegistry, node: LogicalId, from: LogicalId, to: LogicalId) {
  const source = childArrayOf(registry.schema.nodes.get(from));
  const target = childArrayOf(registry.schema.nodes.get(to));
  if (!source || !target) return;
  const at = source.toArray().indexOf(node);
  if (at < 0) return;
  source.delete(at, 1);
  const children = target.toArray();
  const end = registry.kindOf(node) === 'runProperties' ? markPropertiesEnd(registry, children) : 0;
  target.insert(end, [node]);
}

/**
 * After the undo: each proposal whose paragraph the undo unlisted goes to its target, as its
 * own `w:pPr` when the target has none, or one level down where the target has none.
 */
export function relistUndoneProposals(
  registry: DocumentRegistry,
  proposals: readonly UndoneProposal[]
): void {
  for (const { node, from, target } of proposals) {
    if (registry.parentOf(from) !== null || registry.parentOf(target) === null) continue;
    const properties = childOfKind(registry, target, 'paragraphProperties');
    if (!properties) {
      relist(registry, node, from, target);
      continue;
    }
    const run = childOfKind(registry, node, 'runProperties');
    const own = childOfKind(registry, properties, 'runProperties');
    if (run && !own) relist(registry, run, node, properties);
    else if (run && own && !proposes(registry, properties)) {
      const record = registry.record(run);
      const ins = (record && 'childIds' in record ? record.childIds : []).find((id) => {
        const shell = registry.schema.nodes.get(id);
        return isNodeMap(shell) && readNodeShell(shell).localName === 'ins';
      });
      if (ins) relist(registry, ins, run, own);
    }
  }
}
