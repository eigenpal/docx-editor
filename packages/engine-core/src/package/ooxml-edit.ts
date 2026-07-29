// Atomic canonical-tree edit primitives (typed-ooxml-paragraph-editor task 4.5).
//
// The ONLY sanctioned way to mutate an `OoxmlPart`. Every primitive is pure — it returns a
// new part and never mutates the input, which is deep-frozen anyway — and every result is
// re-validated through `validateOoxmlPart` before it is handed back. An edit that would
// break an invariant returns its issues and NO part, so a caller cannot half-apply one.
//
// These exist for `DocumentStore` transactions to call; nothing else should reach for them.
// The store composes one or more primitives per `DocOp` and publishes a single revision, so
// atomicity at this layer is what makes atomicity at that layer possible.
//
// Identity follows `OOXML_NODE_IDENTITY_RULES`:
//   - untouched subtrees are STRUCTURALLY SHARED, so their ids survive by construction;
//   - a rebuilt ancestor chain keeps its own id (the node is the same node, its children
//     changed), which is what lets a paragraph edit leave every sibling id stable;
//   - genuinely new nodes get freshly allocated ids that cannot collide within the part.

import {
  validateOoxmlPart,
  type OoxmlElement,
  type OoxmlInvariantIssue,
  type OoxmlNode,
  type OoxmlPart,
} from './ooxml-tree.ts';

export type OoxmlEditResult =
  | { readonly ok: true; readonly part: OoxmlPart }
  | { readonly ok: false; readonly issues: readonly OoxmlInvariantIssue[] };

/** Every node id currently present in the part. */
export function collectNodeIds(part: OoxmlPart): Set<string> {
  const ids = new Set<string>();
  const walk = (node: OoxmlNode): void => {
    ids.add(node.id);
    if (node.kind === 'textValue') return;
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return ids;
}

/**
 * Mint ids for nodes an edit introduces.
 *
 * Deterministic and collision-checked against the whole part: a structural-path id from the
 * original parse (`/word/document.xml#0.1.2`) and a minted one (`/word/document.xml#new:3`)
 * can never coincide, and the counter skips anything already taken so repeated edits in one
 * session stay unique.
 */
export function createNodeIdAllocator(part: OoxmlPart): () => string {
  const taken = collectNodeIds(part);
  let counter = 0;
  return () => {
    let id = `${part.name}#new:${counter}`;
    while (taken.has(id)) {
      counter += 1;
      id = `${part.name}#new:${counter}`;
    }
    taken.add(id);
    counter += 1;
    return id;
  };
}

/** Locate a node and the chain of ancestors from the root down to it. */
function pathToNode(root: OoxmlNode, nodeId: string): OoxmlNode[] | null {
  if (root.id === nodeId) return [root];
  if (root.kind === 'textValue') return null;
  for (const child of root.children) {
    const found = pathToNode(child, nodeId);
    if (found) return [root, ...found];
  }
  return null;
}

/** Whether a node id exists in the part. */
export function hasNode(part: OoxmlPart, nodeId: string): boolean {
  return pathToNode(part.root, nodeId) !== null;
}

/** Read a node back out of a part by id. */
export function findNode(part: OoxmlPart, nodeId: string): OoxmlNode | null {
  const path = pathToNode(part.root, nodeId);
  return path ? path[path.length - 1]! : null;
}

function withChildren(element: OoxmlElement, children: readonly OoxmlNode[]): OoxmlElement {
  // Spread preserves kind, identity, namespace, prefix, bindings and attributes; only the
  // child list differs. Casting is confined here because the typed unions constrain child
  // types per kind and the invariant validator re-checks the result.
  return Object.freeze({ ...element, children }) as OoxmlElement;
}

/**
 * Rebuild the ancestor chain so `nodeId`'s subtree is replaced by `replacement`.
 * `null` removes the node. Every sibling and every unrelated subtree is REUSED by
 * reference, so their identities and contents are untouched by construction.
 */
function rebuild(part: OoxmlPart, nodeId: string, replacement: OoxmlNode | null): OoxmlPart | null {
  const path = pathToNode(part.root, nodeId);
  if (!path) return null;
  if (path.length === 1) {
    // Replacing the root wholesale is not an edit primitive; it would discard the part.
    if (!replacement || replacement.kind === 'textValue') return null;
    return Object.freeze({ ...part, root: replacement as OoxmlElement });
  }
  let current: OoxmlNode | null = replacement;
  for (let i = path.length - 2; i >= 0; i -= 1) {
    const parent = path[i] as OoxmlElement;
    const childId = path[i + 1]!.id;
    const children: OoxmlNode[] = [];
    for (const child of parent.children) {
      if (child.id !== childId) {
        children.push(child); // shared by reference — identity preserved
        continue;
      }
      if (current) children.push(current);
    }
    current = withChildren(parent, children);
  }
  return Object.freeze({ ...part, root: current as OoxmlElement });
}

function finish(part: OoxmlPart | null): OoxmlEditResult {
  if (!part) {
    return { ok: false, issues: [{ code: 'known-node-invariant', path: '(edit target)' }] };
  }
  const validation = validateOoxmlPart(part);
  // Fail CLOSED: an edit that produces an invalid tree yields no part at all, so a caller
  // cannot accidentally publish a half-valid revision by ignoring the issues.
  if (!validation.ok) return { ok: false, issues: validation.issues };
  return { ok: true, part };
}

/** Replace one node's children wholesale. */
export function replaceChildren(
  part: OoxmlPart,
  nodeId: string,
  children: readonly OoxmlNode[]
): OoxmlEditResult {
  const target = findNode(part, nodeId);
  if (!target || target.kind === 'textValue') {
    return { ok: false, issues: [{ code: 'known-node-invariant', path: nodeId, nodeId }] };
  }
  return finish(rebuild(part, nodeId, withChildren(target, children)));
}

/** Insert children into a node at `index` (clamped to the child list). */
export function insertChildren(
  part: OoxmlPart,
  nodeId: string,
  index: number,
  children: readonly OoxmlNode[]
): OoxmlEditResult {
  const target = findNode(part, nodeId);
  if (!target || target.kind === 'textValue') {
    return { ok: false, issues: [{ code: 'known-node-invariant', path: nodeId, nodeId }] };
  }
  const at = Math.max(0, Math.min(index, target.children.length));
  const next = [...target.children.slice(0, at), ...children, ...target.children.slice(at)];
  return finish(rebuild(part, nodeId, withChildren(target, next)));
}

/** Replace one node with another, keeping its position among its siblings. */
export function replaceNode(
  part: OoxmlPart,
  nodeId: string,
  replacement: OoxmlNode
): OoxmlEditResult {
  if (!hasNode(part, nodeId)) {
    return { ok: false, issues: [{ code: 'known-node-invariant', path: nodeId, nodeId }] };
  }
  return finish(rebuild(part, nodeId, replacement));
}

/** Remove a node and its subtree. */
export function removeNode(part: OoxmlPart, nodeId: string): OoxmlEditResult {
  if (!hasNode(part, nodeId)) {
    return { ok: false, issues: [{ code: 'known-node-invariant', path: nodeId, nodeId }] };
  }
  return finish(rebuild(part, nodeId, null));
}

/**
 * Apply several primitives as ONE atomic step.
 *
 * Each edit runs against the result of the previous one, and the whole sequence is
 * validated once at the end. If any step fails, the ORIGINAL part is what the caller keeps
 * — there is no partially-edited intermediate to publish. This is the shape a multi-`DocOp`
 * store transaction needs.
 */
export function applyEdits(
  part: OoxmlPart,
  edits: readonly ((current: OoxmlPart) => OoxmlEditResult)[]
): OoxmlEditResult {
  let current = part;
  for (const edit of edits) {
    const result = edit(current);
    if (!result.ok) return result;
    current = result.part;
  }
  return finish(current);
}
