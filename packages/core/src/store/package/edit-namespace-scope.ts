import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/** Bind introduced QNames locally when the destination uses their prefix for another URI. */
export function bindConflictingPrefixes(
  node: OoxmlNode,
  inherited: ReadonlyMap<string, string>
): OoxmlNode {
  if (node.kind === 'textValue') return node;
  const scope = new Map(inherited);
  const authored = new Set(node.namespaceBindings.map((binding) => binding.prefix));
  for (const binding of node.namespaceBindings) scope.set(binding.prefix, binding.namespaceUri);
  const additions = new Map<string, string>();
  const bind = (prefix: string | undefined, uri: string): void => {
    if (!prefix || prefix === 'xml' || prefix === 'xmlns' || !uri || authored.has(prefix)) return;
    const current = scope.get(prefix);
    // Missing declarations still go through the existing validation path. Never repair
    // an explicitly contradictory declaration or two conflicting QNames on one element.
    if (current !== undefined && current !== uri && !additions.has(prefix)) {
      additions.set(prefix, uri);
      scope.set(prefix, uri);
    }
  };
  bind(node.prefix, node.namespaceUri);
  for (const attribute of node.attributes) bind(attribute.prefix, attribute.namespaceUri);
  const children = node.children.map((child) => bindConflictingPrefixes(child, scope));
  if (!additions.size && children.every((child, index) => child === node.children[index]))
    return node;
  return {
    ...node,
    namespaceBindings: [
      ...node.namespaceBindings,
      ...[...additions].map(([prefix, namespaceUri]) => ({ prefix, namespaceUri })),
    ],
    children,
  } as OoxmlElement;
}
