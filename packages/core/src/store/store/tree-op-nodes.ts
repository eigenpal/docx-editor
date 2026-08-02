// Node identity and op-result helpers shared by the op appliers.
//
// Split out of tree-op-apply.ts only so the section/list appliers can live in their own
// module without importing it back — the two would otherwise form a cycle, and this is the
// half both of them need.

import { parentNodeOf, type OoxmlEditResult } from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
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

/**
 * A paragraph's property container: its `w:pPr`, whether or not the canonical read TYPED it.
 *
 * A `w:pPr` demotes to generic whenever the reader's known-node invariant refuses it, and one
 * shape that trips it is ordinary Word output — a paragraph mark (`w:rPr`) followed by
 * `w:sectPr` or `w:pPrChange`, which is exactly the CT_PPr order (17.3.1.26). Matching only
 * `kind === 'paragraphProperties'` made every op that writes paragraph properties miss that
 * container and mint a SECOND `w:pPr`, which Word rejects outright; the split appliers lost
 * the tail's properties the same way. The element the paragraph actually has is the one an
 * op must write, so the lookup names it.
 */
export function paragraphPropertiesNodeOf(paragraph: OoxmlNode): OoxmlElement | undefined {
  if (paragraph.kind === 'textValue') return undefined;
  const children: readonly OoxmlNode[] = paragraph.children;
  return children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && isParagraphPropertiesNode(child)
  );
}

export function isParagraphPropertiesNode(node: OoxmlNode): boolean {
  if (node.kind === 'paragraphProperties') return true;
  return (
    node.kind === 'generic' && node.localName === 'pPr' && node.namespaceUri === WML_NAMESPACE_URI
  );
}

/** A named `w:`-namespace child element of a property container. */
export function namedChild(
  container: OoxmlNode | undefined | null,
  localName: string
): OoxmlElement | undefined {
  if (!container || container.kind === 'textValue') return undefined;
  const children: readonly OoxmlNode[] = container.children;
  return children.find(
    (child): child is OoxmlElement =>
      child.kind !== 'textValue' &&
      child.localName === localName &&
      child.namespaceUri === WML_NAMESPACE_URI
  );
}

export function parentOf(part: OoxmlPart, nodeId: string): OoxmlElement | null {
  // Served from the part's node index rather than a fresh full-tree walk: split and join
  // ask for a parent on every op, and the walk made each one O(document).
  return parentNodeOf(part, nodeId);
}
