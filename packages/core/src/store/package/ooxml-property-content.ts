import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/** Whether two properties carry the same markup, apart from identity and whitespace. */
export function sameOoxmlProperty(a: OoxmlNode, b: OoxmlNode): boolean {
  if (a.kind === 'textValue' || b.kind === 'textValue')
    return a.kind === 'textValue' && b.kind === 'textValue' && a.value === b.value;
  if (a.namespaceUri !== b.namespaceUri || a.localName !== b.localName) return false;
  const attributes = (node: OoxmlElement) =>
    node.attributes.map((x) => `${x.namespaceUri ?? ''} ${x.localName}=${x.value}`).sort();
  const left = attributes(a);
  const right = attributes(b);
  if (left.length !== right.length || left.some((value, i) => value !== right[i])) return false;
  const content = (node: OoxmlElement) =>
    node.children.filter((child) => child.kind !== 'textValue' || child.value.trim() !== '');
  const leftChildren = content(a);
  const rightChildren = content(b);
  return (
    leftChildren.length === rightChildren.length &&
    leftChildren.every((child, i) => sameOoxmlProperty(child, rightChildren[i]!))
  );
}
