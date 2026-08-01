// Node identity and op-result helpers shared by the op appliers.
//
// Split out of tree-op-apply.ts only so the section/list appliers can live in their own
// module without importing it back — the two would otherwise form a cycle, and this is the
// half both of them need.

import { parentNodeOf, type OoxmlEditResult } from '../package/ooxml-edit.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import type { TreeOpEffect, TreeOpResult } from './tree-op-validate.ts';

export const TEXT_DEPS = [DEPENDENCY_KEY_IDS.story];

export function ok(part: OoxmlPart, effect: TreeOpEffect): TreeOpResult {
  return { ok: true, part, effect };
}

export function fromEdit(result: OoxmlEditResult, effect: TreeOpEffect): TreeOpResult {
  if (!result.ok) {
    return { ok: false, reason: 'tree-invariant', detail: JSON.stringify(result.issues) };
  }
  return ok(result.part, effect);
}

/** A deep copy with freshly minted identities, for content duplicated by a split. */
export function cloneWithNewIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { id: nextId(), kind: 'textValue', value: node.value };
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => cloneWithNewIds(child, nextId)),
  } as OoxmlNode;
}

export function parentOf(part: OoxmlPart, nodeId: string): OoxmlElement | null {
  // Served from the part's node index rather than a fresh full-tree walk: split and join
  // ask for a parent on every op, and the walk made each one O(document).
  return parentNodeOf(part, nodeId);
}
