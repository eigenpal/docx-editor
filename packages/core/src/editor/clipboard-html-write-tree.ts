// Shared canonical-tree walkers for the outbound clipboard HTML writer modules —
// split from clipboard-html-write.ts at the max-lines cap and de-duplicated across
// the write-table-styles and write-numbering modules.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';

export function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

export function wmlChild(
  parent: OoxmlNode | null | undefined,
  localName: string
): OoxmlElement | null {
  if (!parent || parent.kind === 'textValue') return null;
  for (const child of parent.children) {
    if (
      isElement(child) &&
      child.localName === localName &&
      child.namespaceUri === WML_NAMESPACE_URI
    ) {
      return child;
    }
  }
  return null;
}

export function wmlVal(node: OoxmlElement | null, localName = 'val'): string | undefined {
  return node ? attributeValueOf(node, localName, WML_NAMESPACE_URI) : undefined;
}

export function attrOf(
  node: OoxmlElement | null,
  localName: string,
  namespaceUri: string
): string | undefined {
  return node ? attributeValueOf(node, localName, namespaceUri) : undefined;
}

export function textUnder(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  let out = '';
  for (const child of node.children) out += textUnder(child);
  return out;
}

/** First descendant element with the expanded name, depth-first. */
export function findDescendant(
  node: OoxmlNode,
  localName: string,
  namespaceUri: string
): OoxmlElement | null {
  if (node.kind === 'textValue') return null;
  if (node.localName === localName && node.namespaceUri === namespaceUri) return node;
  for (const child of node.children) {
    const found = findDescendant(child, localName, namespaceUri);
    if (found) return found;
  }
  return null;
}

export function parseIntValue(raw: string | undefined): number | null {
  if (raw === undefined || !/^-?\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
