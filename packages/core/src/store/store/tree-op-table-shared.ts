// Shared WordprocessingML name helpers for table store modules.

import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';

export { WML_NAMESPACE_URI };

export function isWmlElement(node: OoxmlNode, localName: string): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

export function isWmlGridCol(node: OoxmlNode): node is OoxmlElement {
  return isWmlElement(node, 'gridCol');
}

export function wmlChildNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (isWmlElement(child, localName)) return child;
  }
  return undefined;
}

export function wmlAttributeValue(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName) {
      return attribute.value;
    }
  }
  return undefined;
}

export function expandedNameMatches(
  node: OoxmlElement,
  localName: string,
  namespaceUri: string = WML_NAMESPACE_URI
): boolean {
  return node.localName === localName && node.namespaceUri === namespaceUri;
}
