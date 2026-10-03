// Keep a text box's legacy VML copy in step with its DrawingML copy on save.
//
// A text box written by Word appears twice: `mc:Choice` holds the DrawingML shape with its
// `wps:txbx/w:txbxContent`, and `mc:Fallback` holds a VML `v:textbox/w:txbxContent` for readers
// that do not understand DrawingML. Word writes the two story copies identically. Edits change
// only the DrawingML copy, so an export snapshot copies it over the fallback wherever the two
// differ. A file whose copies already agree is written back unchanged.
//
// The decision reads canonical content only, never peer-local state, so every participant in a
// collaboration session saves the same bytes for the same document.

import { runWithoutJournalCapture } from './canonical-primitive-capture.ts';
import { createNodeIdAllocator, replaceNode } from './ooxml-edit.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { MC_NAMESPACE_URI, WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlNamespaceBinding, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';

const VML_NAMESPACE_URI = 'urn:schemas-microsoft-com:vml';
const WPS_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

/** Node visits per part. A part that exhausts it is written as it is, never half-synced. */
const MAX_SCANNED_NODES = 1 << 20;

interface Found {
  readonly node: OoxmlElement;
  /** Namespace bindings declared on the way down from the searched branch, inclusive. */
  readonly bindings: readonly OoxmlNamespaceBinding[];
}

function isNamed(node: OoxmlNode, namespaceUri: string, localName: string): boolean {
  return (
    node.kind !== 'textValue' && node.namespaceUri === namespaceUri && node.localName === localName
  );
}

/**
 * The single `w:txbxContent` under `branch` whose parent satisfies `parentIs`, or null when
 * there is none or more than one. A nested text box inside the story is part of that story.
 */
function storyUnder(branch: OoxmlElement, parentIs: (node: OoxmlElement) => boolean): Found | null {
  let found: Found | null = null;
  let count = 0;
  const stack: {
    node: OoxmlNode;
    parent: OoxmlElement;
    bindings: readonly OoxmlNamespaceBinding[];
  }[] = branch.children.map((child) => ({
    node: child,
    parent: branch,
    bindings: branch.namespaceBindings,
  }));
  while (stack.length > 0) {
    const { node, parent, bindings } = stack.pop()!;
    if (node.kind === 'textValue') continue;
    const inScope =
      node.namespaceBindings.length === 0 ? bindings : [...bindings, ...node.namespaceBindings];
    if (isNamed(node, WML_NAMESPACE_URI, 'txbxContent')) {
      if (parentIs(parent)) {
        count += 1;
        found = { node: node as OoxmlElement, bindings: inScope };
      }
      continue;
    }
    for (const child of node.children) stack.push({ node: child, parent: node, bindings: inScope });
  }
  return count === 1 ? found : null;
}

function sameMarkup(left: OoxmlNode, right: OoxmlNode, budget: { left: number }): boolean {
  if (--budget.left < 0) return true;
  if (left.kind === 'textValue' || right.kind === 'textValue') {
    return left.kind === 'textValue' && right.kind === 'textValue' && left.value === right.value;
  }
  if (left.namespaceUri !== right.namespaceUri || left.localName !== right.localName) return false;
  if (left.attributes.length !== right.attributes.length) return false;
  for (const attribute of left.attributes) {
    const match = right.attributes.find(
      (other) =>
        other.namespaceUri === attribute.namespaceUri &&
        other.localName === attribute.localName &&
        other.value === attribute.value
    );
    if (!match) return false;
  }
  if (left.children.length !== right.children.length) return false;
  for (let index = 0; index < left.children.length; index += 1) {
    if (!sameMarkup(left.children[index]!, right.children[index]!, budget)) return false;
  }
  return true;
}

function cloneWithFreshIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: nextId() };
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => cloneWithFreshIds(child, nextId)),
  } as OoxmlNode;
}

/** Fallback stories to replace in one part, as `[fallback story, replacement]` pairs. */
function staleFallbacks(part: OoxmlPart): [OoxmlElement, OoxmlElement][] {
  const pairs: [OoxmlElement, OoxmlElement][] = [];
  let nextId: (() => string) | null = null;
  let visits = 0;
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    if (++visits > MAX_SCANNED_NODES) return [];
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (!isNamed(node, MC_NAMESPACE_URI, 'AlternateContent')) {
      for (const child of node.children) stack.push(child);
      continue;
    }
    const choice = node.children.find((child) => isNamed(child, MC_NAMESPACE_URI, 'Choice'));
    const fallback = node.children.find((child) => isNamed(child, MC_NAMESPACE_URI, 'Fallback'));
    if (!choice || !fallback || choice.kind === 'textValue' || fallback.kind === 'textValue') {
      continue;
    }
    const modern = storyUnder(choice, (parent) => isNamed(parent, WPS_NAMESPACE_URI, 'txbx'));
    const legacy = storyUnder(fallback, (parent) => isNamed(parent, VML_NAMESPACE_URI, 'textbox'));
    if (!modern || !legacy) continue;
    if (sameMarkup(modern.node, legacy.node, { left: MAX_SCANNED_NODES })) continue;
    nextId ??= createNodeIdAllocator(part);
    const mint = nextId;
    // A prefix the DrawingML side declared on its way down must still resolve in the copy.
    const declared = new Set(legacy.node.namespaceBindings.map((binding) => binding.prefix));
    const carried = modern.bindings.filter((binding) => !declared.has(binding.prefix));
    pairs.push([
      legacy.node,
      {
        ...legacy.node,
        namespaceBindings: [...legacy.node.namespaceBindings, ...carried],
        children: modern.node.children.map((child) => cloneWithFreshIds(child, mint)),
      } as OoxmlElement,
    ]);
  }
  return pairs;
}

/** An export snapshot in which every text box's VML fallback story matches its DrawingML one. */
export function textboxFallbackExportPackage(pkg: OoxmlPackage): OoxmlPackage {
  let next: OoxmlPackage | null = null;
  for (const part of pkg.parts.values()) {
    const pairs = staleFallbacks(part);
    if (pairs.length === 0) continue;
    const synced = runWithoutJournalCapture(() => {
      let current = part;
      for (const [stale, replacement] of pairs) {
        const replaced = replaceNode(current, stale.id, replacement);
        if (!replaced.ok) return null;
        current = replaced.part;
      }
      return current;
    });
    if (!synced) continue;
    next ??= { ...pkg, parts: new Map(pkg.parts) };
    (next.parts as Map<string, OoxmlPart>).set(part.name, synced);
  }
  return next ?? pkg;
}
