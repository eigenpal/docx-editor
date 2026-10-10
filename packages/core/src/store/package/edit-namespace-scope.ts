import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/**
 * Bind introduced QNames locally when the destination uses their prefix for another URI.
 *
 * Returns `node` itself when nothing in its subtree needs a binding. The walk copies the
 * scope only on an element that declares or adds a binding, and copies the child list only
 * when a child changes: a structural edit hands this whole story-sized child lists, and
 * a per-node scope copy made every Enter cost the size of the body.
 */
export function bindConflictingPrefixes(
  node: OoxmlNode,
  inherited: ReadonlyMap<string, string>
): OoxmlNode {
  if (node.kind === 'textValue') return node;
  let scope: ReadonlyMap<string, string> = inherited;
  let authored: Set<string> | null = null;
  if (node.namespaceBindings.length > 0) {
    const own = new Map(inherited);
    authored = new Set();
    for (const binding of node.namespaceBindings) {
      own.set(binding.prefix, binding.namespaceUri);
      authored.add(binding.prefix);
    }
    scope = own;
  }
  let additions: Map<string, string> | null = null;
  const bind = (prefix: string | undefined, uri: string): void => {
    if (!prefix || prefix === 'xml' || prefix === 'xmlns' || !uri || authored?.has(prefix)) return;
    // Missing declarations still go through the existing validation path. Never repair
    // an explicitly contradictory declaration or two conflicting QNames on one element.
    if (additions?.has(prefix)) return;
    const current = scope.get(prefix);
    if (current !== undefined && current !== uri) {
      additions ??= new Map();
      additions.set(prefix, uri);
      const own = scope === inherited ? new Map(inherited) : (scope as Map<string, string>);
      own.set(prefix, uri);
      scope = own;
    }
  };
  bind(node.prefix, node.namespaceUri);
  for (const attribute of node.attributes) bind(attribute.prefix, attribute.namespaceUri);
  let children: OoxmlNode[] | null = null;
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]!;
    const bound = bindConflictingPrefixes(child, scope);
    if (bound !== child && !children) children = node.children.slice(0, index);
    children?.push(bound);
  }
  // Assigned inside `bind`, which flow analysis does not follow.
  const added = additions as Map<string, string> | null;
  if (!added && !children) return node;
  return {
    ...node,
    namespaceBindings: [
      ...node.namespaceBindings,
      ...[...(added ?? [])].map(([prefix, namespaceUri]) => ({ prefix, namespaceUri })),
    ],
    children: children ?? node.children,
  } as OoxmlElement;
}
