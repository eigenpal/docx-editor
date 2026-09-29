import { WML_NAMESPACE_URI, type OoxmlNode } from '../package/ooxml-tree.ts';

/** Embedded object payloads cannot travel in clipboard fragments. Refuse the whole transfer. */
export function containsClipboardObject(nodes: readonly OoxmlNode[]): boolean {
  const pending = [...nodes];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'object') return true;
    for (const child of node.children) pending.push(child);
  }
  return false;
}
