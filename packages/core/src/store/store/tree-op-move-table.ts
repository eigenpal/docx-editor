// Moving a whole table among its siblings, as the table handle's drag does.

import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { usedParaIds, w14PrefixInScopeAt } from '../package/para-id.ts';
import { wmlFreshNamespaceContextAt } from '../package/wml-namespace.ts';
import type { MoveTableOp } from './table-placement-op-types.ts';
import { BLOCK_CONTAINERS, emptyParagraph } from './tree-op-insert-table.ts';
import {
  effectiveContentLockAt,
  fromEdit,
  isBoundAt,
  parentOf,
  TEXT_DEPS,
} from './tree-op-nodes.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';
import { deleteBlockTouchesContentRestriction } from './tree-op-validate-controls.ts';

const isTable = (node: OoxmlNode | undefined): boolean =>
  node !== undefined && node.kind !== 'textValue' && node.localName === 'tbl';

export function validateMoveTable(part: OoxmlPart, op: MoveTableOp): TreeOpRejection | null {
  if (typeof op.tableId !== 'string' || typeof op.beforeBlockId !== 'string')
    return 'unknown-block';
  if (op.tableId === op.beforeBlockId) return 'not-a-block';
  const table = findNode(part, op.tableId);
  const before = findNode(part, op.beforeBlockId);
  if (!table || !before) return 'unknown-block';
  if (table.kind !== 'table' || (before.kind !== 'paragraph' && before.kind !== 'table')) {
    return 'not-a-block';
  }
  const parent = parentOf(part, op.tableId);
  if (!parent || !BLOCK_CONTAINERS.has(parent.localName)) return 'not-a-block';
  // One parent keeps the move a single reorder: a reparent could put a table inside itself.
  if (parentOf(part, op.beforeBlockId)?.id !== parent.id) return 'not-adjacent-siblings';
  const restriction = deleteBlockTouchesContentRestriction(part, table);
  if (restriction) return restriction;
  for (const id of [op.tableId, op.beforeBlockId]) {
    if (isBoundAt(part, id)) return 'bound';
    if (effectiveContentLockAt(part, id).content) return 'locked';
  }
  return null;
}

export function applyMoveTable(
  part: OoxmlPart,
  op: MoveTableOp,
  options?: EditOptions
): TreeOpResult {
  const rejection = validateMoveTable(part, op);
  if (rejection) return { ok: false, reason: rejection };
  const parent = parentOf(part, op.tableId)!;
  const table = parent.children.find((child) => child.id === op.tableId)!;
  const children = parent.children.filter((child) => child.id !== op.tableId);
  const index = children.findIndex((child) => child.id === op.beforeBlockId);

  const nextId = createNodeIdAllocator(part);
  const wml = wmlFreshNamespaceContextAt(part, parent);
  const w14Prefix = w14PrefixInScopeAt(part, parent);
  const usedParagraphIds = new Set(usedParaIds(part.root));
  const separator = (side: string) =>
    emptyParagraph(w14Prefix, `${op.tableId}:${side}`, usedParagraphIds, nextId, wml);
  const before = isTable(children[index - 1]) ? separator('sep-before') : null;
  const after = isTable(children[index]) ? separator('sep-after') : null;
  const placed = [...(before ? [before] : []), table, ...(after ? [after] : [])];
  children.splice(index, 0, ...placed);

  // ONE edit on the shared parent: removing and re-inserting in two edits would journal
  // the whole table as new nodes, and a peer's concurrent typing inside it would be lost.
  return fromEdit(replaceChildren(part, parent.id, children, options), {
    dirty: [parent.id, op.tableId],
    created: [before, after].flatMap((paragraph) => (paragraph ? [paragraph.id] : [])),
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
  });
}
