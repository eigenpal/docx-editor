import { WML_NAMESPACE_URI, type OoxmlNode } from '../package/ooxml-tree.ts';

const OFFICE = 'urn:schemas-microsoft-com:office:office';

/** An embedded object: a `w:object`, or a `w:pict` whose picture is an `o:OLEObject` preview. */
export function isClipboardObject(node: OoxmlNode): boolean {
  if (node.kind === 'textValue' || node.namespaceUri !== WML_NAMESPACE_URI) return false;
  if (node.localName === 'object') return true;
  return (
    node.localName === 'pict' &&
    node.children.some(
      (child) =>
        child.kind !== 'textValue' &&
        child.namespaceUri === OFFICE &&
        child.localName === 'OLEObject'
    )
  );
}

/** Embedded object payloads cannot travel in clipboard fragments. Refuse the whole transfer. */
export function containsClipboardObject(nodes: readonly OoxmlNode[]): boolean {
  const pending = [...nodes];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'textValue') continue;
    if (isClipboardObject(node)) return true;
    for (const child of node.children) pending.push(child);
  }
  return false;
}
