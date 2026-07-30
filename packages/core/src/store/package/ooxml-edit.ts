// Atomic canonical-tree edit primitives (typed-ooxml-paragraph-editor task 4.5).
//
// The ONLY sanctioned way to mutate an `OoxmlPart`. Every primitive is pure — it returns a
// new part and never mutates the input, which is deep-frozen anyway — and every result is
// re-validated through `validateOoxmlPart` before it is handed back, unless the caller
// explicitly DEFERS that validation to its own commit boundary (see `EditOptions`). An edit
// that would break an invariant returns its issues and NO part, so a caller cannot
// half-apply one.
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

/**
 * How an edit primitive validates its result.
 *
 * By default every primitive runs the full-part invariant validation before handing its
 * result back — the safe reading for an isolated call. A TRANSACTION applying many ops pays
 * that full-tree walk once per primitive, which is what made a hundred-paragraph paste
 * quadratic; it defers instead, and runs the same validation ONCE on the final tree before
 * anything is published. Deferring is only sound for a caller that owns a commit boundary:
 * nothing may escape between the unvalidated intermediate and the validated result.
 */
export interface EditOptions {
  readonly deferValidation?: boolean;
}

/**
 * A node/parent index for one tree state, so lookups stop re-walking the whole part.
 *
 * Keyed WEAKLY on the root: an edit produces a new root, which lazily gets a new index on
 * its first lookup, and superseded revisions release theirs with the tree. Within one tree
 * state — validate, then apply, then rebuild, all against the same part — every lookup
 * after the first is a map hit, which is what turns an op from several full-tree walks
 * into at most one.
 *
 * Duplicate ids keep FIRST-in-document-order semantics, matching the walk this replaces:
 * the validator is what reports duplicates, a lookup just has to be deterministic.
 */
interface PartIndex {
  readonly nodes: Map<string, OoxmlNode>;
  readonly parents: Map<string, OoxmlNode>;
}

const partIndexes = new WeakMap<OoxmlElement, PartIndex>();

function nodeIndexFor(root: OoxmlElement): PartIndex {
  const cached = partIndexes.get(root);
  if (cached) return cached;
  const nodes = new Map<string, OoxmlNode>();
  const parents = new Map<string, OoxmlNode>();
  const walk = (node: OoxmlNode, parent: OoxmlNode | null): void => {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
      if (parent) parents.set(node.id, parent);
    }
    if (node.kind === 'textValue') return;
    for (const child of node.children) walk(child, node);
  };
  walk(root, null);
  const index: PartIndex = { nodes, parents };
  partIndexes.set(root, index);
  return index;
}

/** Every node id currently present in the part. */
export function collectNodeIds(part: OoxmlPart): Set<string> {
  return new Set(nodeIndexFor(part.root).nodes.keys());
}

/**
 * Mint ids for nodes an edit introduces.
 *
 * Deterministic and collision-checked against the whole part: a structural-path id from the
 * original parse (`/word/document.xml#0.1.2`) and a minted one (`/word/document.xml#new:3`)
 * can never coincide, and the counter skips anything already taken so repeated edits in one
 * session stay unique.
 *
 * Checks the part's node index directly rather than copying every id into a fresh set: the
 * copy was O(document) per op, and an allocator is created for every op.
 */
export function createNodeIdAllocator(part: OoxmlPart): () => string {
  const index = nodeIndexFor(part.root);
  const minted = new Set<string>();
  let counter = 0;
  return () => {
    let id = `${part.name}#new:${counter}`;
    while (index.nodes.has(id) || minted.has(id)) {
      counter += 1;
      id = `${part.name}#new:${counter}`;
    }
    minted.add(id);
    counter += 1;
    return id;
  };
}

/** Locate a node and the chain of ancestors from the root down to it. */
function pathToNode(root: OoxmlNode, nodeId: string): OoxmlNode[] | null {
  // Through the index: the target by id, then the parent chain climbed back to the root.
  // The recursive walk this replaces visited every node in every preceding subtree on
  // every lookup, which multiplied by ops-per-transaction made big pastes quadratic.
  const index = nodeIndexFor(root as OoxmlElement);
  const target = index.nodes.get(nodeId);
  if (!target) return null;
  const path: OoxmlNode[] = [target];
  let current: OoxmlNode | undefined = target;
  while (current && current !== root) {
    current = index.parents.get(current.id);
    if (current) path.push(current);
  }
  if (current !== root) return null;
  path.reverse();
  return path;
}

/** Whether a node id exists in the part. */
export function hasNode(part: OoxmlPart, nodeId: string): boolean {
  return nodeIndexFor(part.root).nodes.has(nodeId);
}

/** Read a node back out of a part by id. */
export function findNode(part: OoxmlPart, nodeId: string): OoxmlNode | null {
  return nodeIndexFor(part.root).nodes.get(nodeId) ?? null;
}

/** The element that holds a node, or null for the root and for unknown ids. */
export function parentNodeOf(part: OoxmlPart, nodeId: string): OoxmlElement | null {
  const index = nodeIndexFor(part.root);
  if (!index.nodes.has(nodeId)) return null;
  const parent = index.parents.get(nodeId);
  return parent && parent.kind !== 'textValue' ? (parent as OoxmlElement) : null;
}

function withChildren(element: OoxmlElement, children: readonly OoxmlNode[]): OoxmlElement {
  // Spread preserves kind, identity, namespace, prefix, bindings and attributes; only the
  // child list differs. Casting is confined here because the typed unions constrain child
  // types per kind and the invariant validator re-checks the result.
  return Object.freeze({ ...element, children }) as OoxmlElement;
}

/**
 * Carry the old tree's index onto a rebuilt root by DIFFING, not re-walking.
 *
 * An edit shares every untouched subtree by reference, so almost all of the new tree is
 * object-identical to the old one — and an identical subtree needs nothing but its parent
 * pointer refreshed, which is O(1). Only the rebuilt spine and the replaced subtree are
 * actually visited, so a paragraph edit patches in O(spine fan-out) instead of walking the
 * whole document; rebuilding the index per op is what made big multi-op transactions scale
 * with document size.
 *
 * The old index is STOLEN — mutated in place and re-keyed to the new root. The old root's
 * entry is dropped; a later lookup against it (undo walking history) rebuilds by full walk.
 * Removals are processed before additions at each level, so a node MOVED between siblings
 * in one rebuild (a join re-parenting runs) is never deleted after being re-added.
 * Exactness is guaranteed for trees without duplicate ids, which is an invariant the
 * commit-boundary validation enforces before any tree is published.
 */
function stealPatchedIndex(oldRoot: OoxmlElement, newRoot: OoxmlElement): void {
  const index = partIndexes.get(oldRoot);
  if (!index) return;
  partIndexes.delete(oldRoot);
  diffPatch(index, oldRoot, newRoot, null);
  partIndexes.set(newRoot, index);
}

function removeIndexedSubtree(index: PartIndex, node: OoxmlNode): void {
  // Only when the entry still names THIS object: a moved node re-indexed under its new
  // parent must survive the removal sweep of its old position.
  if (index.nodes.get(node.id) === node) {
    index.nodes.delete(node.id);
    index.parents.delete(node.id);
  }
  if (node.kind === 'textValue') return;
  for (const child of node.children) removeIndexedSubtree(index, child);
}

function addIndexedSubtree(index: PartIndex, node: OoxmlNode, parent: OoxmlNode): void {
  index.nodes.set(node.id, node);
  index.parents.set(node.id, parent);
  if (node.kind === 'textValue') return;
  for (const child of node.children) addIndexedSubtree(index, child, node);
}

function diffPatch(
  index: PartIndex,
  oldNode: OoxmlNode,
  newNode: OoxmlNode,
  newParent: OoxmlNode | null
): void {
  if (oldNode === newNode) {
    // Identical subtree: every interior parent pointer targets nodes INSIDE the shared
    // subtree and is already right; only the link to the rebuilt parent above changed.
    if (newParent) index.parents.set(newNode.id, newParent);
    return;
  }
  if (oldNode.id !== newNode.id) {
    removeIndexedSubtree(index, oldNode);
    if (newParent) addIndexedSubtree(index, newNode, newParent);
    return;
  }
  index.nodes.set(newNode.id, newNode);
  if (newParent) index.parents.set(newNode.id, newParent);
  const oldChildren = oldNode.kind === 'textValue' ? [] : oldNode.children;
  const newChildren = newNode.kind === 'textValue' ? [] : newNode.children;
  const oldById = new Map<string, OoxmlNode>();
  for (const child of oldChildren) if (!oldById.has(child.id)) oldById.set(child.id, child);
  const kept = new Set<string>();
  for (const child of newChildren) kept.add(child.id);
  // REMOVALS FIRST: a node moved between siblings appears in both a removed child's old
  // position and a new child's subtree, and deleting after adding would strip it.
  for (const [id, child] of oldById) if (!kept.has(id)) removeIndexedSubtree(index, child);
  for (const child of newChildren) {
    const previous = oldById.get(child.id);
    if (previous) diffPatch(index, previous, child, newNode);
    else addIndexedSubtree(index, child, newNode);
  }
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
    stealPatchedIndex(part.root, replacement as OoxmlElement);
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
  stealPatchedIndex(part.root, current as OoxmlElement);
  return Object.freeze({ ...part, root: current as OoxmlElement });
}

function finish(part: OoxmlPart | null, options?: EditOptions): OoxmlEditResult {
  if (!part) {
    return { ok: false, issues: [{ code: 'known-node-invariant', path: '(edit target)' }] };
  }
  // Deferred: the caller owns a commit boundary and validates the FINAL tree there with
  // `validateOoxmlPart` — same check, run once per transaction instead of once per
  // primitive. Nothing unvalidated is ever published either way.
  if (options?.deferValidation) return { ok: true, part };
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
  children: readonly OoxmlNode[],
  options?: EditOptions
): OoxmlEditResult {
  const target = findNode(part, nodeId);
  if (!target || target.kind === 'textValue') {
    return { ok: false, issues: [{ code: 'known-node-invariant', path: nodeId, nodeId }] };
  }
  return finish(rebuild(part, nodeId, withChildren(target, children)), options);
}

/** Insert children into a node at `index` (clamped to the child list). */
export function insertChildren(
  part: OoxmlPart,
  nodeId: string,
  index: number,
  children: readonly OoxmlNode[],
  options?: EditOptions
): OoxmlEditResult {
  const target = findNode(part, nodeId);
  if (!target || target.kind === 'textValue') {
    return { ok: false, issues: [{ code: 'known-node-invariant', path: nodeId, nodeId }] };
  }
  const at = Math.max(0, Math.min(index, target.children.length));
  const next = [...target.children.slice(0, at), ...children, ...target.children.slice(at)];
  return finish(rebuild(part, nodeId, withChildren(target, next)), options);
}

/** Replace one node with another, keeping its position among its siblings. */
export function replaceNode(
  part: OoxmlPart,
  nodeId: string,
  replacement: OoxmlNode,
  options?: EditOptions
): OoxmlEditResult {
  if (!hasNode(part, nodeId)) {
    return { ok: false, issues: [{ code: 'known-node-invariant', path: nodeId, nodeId }] };
  }
  return finish(rebuild(part, nodeId, replacement), options);
}

/** Remove a node and its subtree. */
export function removeNode(
  part: OoxmlPart,
  nodeId: string,
  options?: EditOptions
): OoxmlEditResult {
  if (!hasNode(part, nodeId)) {
    return { ok: false, issues: [{ code: 'known-node-invariant', path: nodeId, nodeId }] };
  }
  return finish(rebuild(part, nodeId, null), options);
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
  edits: readonly ((current: OoxmlPart) => OoxmlEditResult)[],
  options?: EditOptions
): OoxmlEditResult {
  let current = part;
  for (const edit of edits) {
    const result = edit(current);
    if (!result.ok) return result;
    current = result.part;
  }
  return finish(current, options);
}
