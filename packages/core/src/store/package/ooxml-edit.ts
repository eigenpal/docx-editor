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
import { isCanonicalPrimitiveCaptureActive } from './canonical-primitive-capture.ts';
import {
  captureInsertChildren,
  captureRemoveNode,
  captureReplaceChildren,
  captureReplaceNode,
} from './canonical-primitive-lower.ts';

/** An edited part, or the invariant violations that rejected the edit. */
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
  /**
   * A shared minter for `@w:id` on a NEW revision, for the ops of one transaction.
   *
   * `nextRevisionId` walks the whole part to find the highest id in use, and a formatting
   * write emits one op per run — so a Select All + Bold in suggesting mode paid a
   * document-wide walk thousands of times over. The transaction hands its ops one minter
   * instead, and it is DROPPED the moment an op that can import foreign revision ids runs
   * (a paste carries its own), because a stale minter would hand out an id the document had
   * just started using — and two revisions sharing an address are one card in the pane.
   *
   * Absent means "mint your own": every applier falls back to its own walk, which is what a
   * caller outside a transaction gets.
   */
  readonly revisionIds?: () => string;
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
  /**
   * Child id to PARENT ID — the id, not the object. A rebuilt ancestor keeps its id, so
   * the thousands of untouched siblings under it keep valid parent entries with no work
   * at all; storing the parent object meant every rebuild of a wide element (the body,
   * on every paragraph edit) had to rewrite one entry per child.
   */
  readonly parents: Map<string, string>;
  /**
   * The next minted-id counter known to be past every allocation so far.
   *
   * Carried on the index — which the diff patch hands from tree state to tree state — so
   * each allocator resumes where the last one stopped. Restarting at zero made every mint
   * probe the whole run of previously minted ids: in a document built by editing, that was
   * millions of taken-id checks per paste. Monotone, so freed counters are never reused,
   * which no correctness property depends on. A rebuilt index starts at zero again and
   * pays one skip-forward walk on its first allocation.
   */
  mintFrontier: number;
}

const partIndexes = new WeakMap<OoxmlElement, PartIndex>();

let nodeIndexCompleteBuilds = 0;
let nodeIndexCompleteVisits = 0;

/** @internal Warm-path recorder for root node-index complete builds used by `findNode`. */
export function nodeIndexTestRecorder(): {
  readonly completeBuilds: number;
  readonly completeVisits: number;
  reset(): void;
} {
  return {
    get completeBuilds() {
      return nodeIndexCompleteBuilds;
    },
    get completeVisits() {
      return nodeIndexCompleteVisits;
    },
    reset() {
      nodeIndexCompleteBuilds = 0;
      nodeIndexCompleteVisits = 0;
    },
  };
}

function nodeIndexFor(root: OoxmlElement): PartIndex {
  const cached = partIndexes.get(root);
  if (cached) return cached;
  nodeIndexCompleteBuilds += 1;
  const nodes = new Map<string, OoxmlNode>();
  const parents = new Map<string, string>();
  const walk = (node: OoxmlNode, parentId: string | null): void => {
    nodeIndexCompleteVisits += 1;
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
      if (parentId !== null) parents.set(node.id, parentId);
    }
    if (node.kind === 'textValue') return;
    for (const child of node.children) walk(child, node.id);
  };
  walk(root, null);
  const index: PartIndex = { nodes, parents, mintFrontier: 0 };
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
 * The collision check only sees nodes that are IN the tree. A caller that clones a subtree
 * and attaches it LATER — after other ops have replaced the root and reset the counter —
 * must mint in its own `family`: two `new`-family allocators over different roots can hand
 * out the same id, one to a detached clone and one to the tree, and the clone's insertion
 * then fails the duplicate-id invariant.
 *
 * Checks the part's node index directly rather than copying every id into a fresh set: the
 * copy was O(document) per op, and an allocator is created for every op.
 */
export function createNodeIdAllocator(
  part: OoxmlPart,
  family: 'new' | 'paste' = 'new'
): () => string {
  const index = nodeIndexFor(part.root);
  const minted = new Set<string>();
  let counter = index.mintFrontier;
  return () => {
    let id = `${part.name}#${family}:${counter}`;
    while (index.nodes.has(id) || minted.has(id)) {
      counter += 1;
      id = `${part.name}#${family}:${counter}`;
    }
    minted.add(id);
    counter += 1;
    // Published back, so the next allocator — this op's successor in the same transaction,
    // or the next transaction entirely — starts past everything ever taken.
    index.mintFrontier = counter;
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
    const parentId = index.parents.get(current.id);
    current = parentId === undefined ? undefined : index.nodes.get(parentId);
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
  const parentId = index.parents.get(nodeId);
  const parent = parentId === undefined ? undefined : index.nodes.get(parentId);
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

/**
 * Carry the index across a root rebuilt OUTSIDE the op executors.
 *
 * Every op executor moves the index with `stealPatchedIndex`, so the mint frontier and the
 * diffed entries survive its root replacement. A helper that rebuilds the root directly —
 * the fragment lane binding namespace prefixes — must do the same, or the new root starts
 * an orphaned index: the next lookup re-walks the whole part, and the mint frontier
 * restarts at 0 underneath ids already handed out.
 */
export function carryIndexToRebuiltRoot(oldRoot: OoxmlElement, newRoot: OoxmlElement): void {
  stealPatchedIndex(oldRoot, newRoot);
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

function addIndexedSubtree(index: PartIndex, node: OoxmlNode, parentId: string): void {
  index.nodes.set(node.id, node);
  index.parents.set(node.id, parentId);
  if (node.kind === 'textValue') return;
  for (const child of node.children) addIndexedSubtree(index, child, node.id);
}

function diffPatch(
  index: PartIndex,
  oldNode: OoxmlNode,
  newNode: OoxmlNode,
  newParentId: string | null
): void {
  if (oldNode === newNode) {
    // Identical subtree: every entry inside it is already right. Even its own parent EDGE
    // usually is — the parent kept its id through the rebuild — so only a genuine move to a
    // differently-identified parent writes anything.
    if (newParentId !== null && index.parents.get(newNode.id) !== newParentId) {
      index.parents.set(newNode.id, newParentId);
    }
    return;
  }
  if (oldNode.id !== newNode.id) {
    removeIndexedSubtree(index, oldNode);
    if (newParentId !== null) addIndexedSubtree(index, newNode, newParentId);
    return;
  }
  index.nodes.set(newNode.id, newNode);
  if (newParentId !== null && index.parents.get(newNode.id) !== newParentId) {
    index.parents.set(newNode.id, newParentId);
  }
  const oldChildren = oldNode.kind === 'textValue' ? [] : oldNode.children;
  const newChildren = newNode.kind === 'textValue' ? [] : newNode.children;

  // Trim the identical prefix and suffix by OBJECT identity before pairing anything. An
  // edit to a wide element replaces one child among thousands — the body loses or gains a
  // paragraph — and an identical child under the same parent id needs no entry touched at
  // all. Pairing maps are then built only over the changed window, so a rebuild costs the
  // window plus pointer comparisons, not one map operation per sibling.
  const shorter = Math.min(oldChildren.length, newChildren.length);
  let first = 0;
  while (first < shorter && oldChildren[first] === newChildren[first]) first += 1;
  let oldPast = oldChildren.length;
  let newPast = newChildren.length;
  while (
    oldPast > first &&
    newPast > first &&
    oldChildren[oldPast - 1] === newChildren[newPast - 1]
  ) {
    oldPast -= 1;
    newPast -= 1;
  }

  const oldById = new Map<string, OoxmlNode>();
  for (let at = first; at < oldPast; at += 1) {
    const child = oldChildren[at]!;
    if (!oldById.has(child.id)) oldById.set(child.id, child);
  }
  const kept = new Set<string>();
  for (let at = first; at < newPast; at += 1) kept.add(newChildren[at]!.id);
  // REMOVALS FIRST: a node moved between siblings appears in both a removed child's old
  // position and a new child's subtree, and deleting after adding would strip it.
  for (const [id, child] of oldById) if (!kept.has(id)) removeIndexedSubtree(index, child);
  for (let at = first; at < newPast; at += 1) {
    const child = newChildren[at]!;
    const previous = oldById.get(child.id);
    if (previous) diffPatch(index, previous, child, newNode.id);
    else addIndexedSubtree(index, child, newNode.id);
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

/**
 * Pre-edit membership for journal lowering, restricted to the subtrees the edit introduces.
 *
 * Lowering only ever asks `knownIds.has(...)` for ids inside the incoming subtrees, so
 * probing the cached pre-edit index for exactly those ids costs the size of the edit.
 * Copying every id in the part was O(part) per primitive — the "cost the document" shape
 * the journal work removed elsewhere — and the live index map cannot stand in for the
 * copy because `rebuild` steals and patches it to post-edit membership before capture runs.
 */
function knownIdsIfCapturing(
  part: OoxmlPart,
  introduced: readonly OoxmlNode[]
): Set<string> | undefined {
  if (!isCanonicalPrimitiveCaptureActive()) return undefined;
  const preEdit = nodeIndexFor(part.root).nodes;
  const known = new Set<string>();
  const walk = (node: OoxmlNode): void => {
    if (preEdit.has(node.id)) known.add(node.id);
    if (node.kind === 'textValue') return;
    for (const child of node.children) walk(child);
  };
  for (const node of introduced) walk(node);
  return known;
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
  const knownIds = knownIdsIfCapturing(part, children);
  const result = finish(rebuild(part, nodeId, withChildren(target, children)), options);
  if (result.ok) captureReplaceChildren(target, children, knownIds);
  return result;
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
  const knownIds = knownIdsIfCapturing(part, children);
  const result = finish(rebuild(part, nodeId, withChildren(target, next)), options);
  if (result.ok) captureInsertChildren(target, at, children, knownIds);
  return result;
}

/** Replace one node with another, keeping its position among its siblings. */
export function replaceNode(
  part: OoxmlPart,
  nodeId: string,
  replacement: OoxmlNode,
  options?: EditOptions
): OoxmlEditResult {
  const previous = findNode(part, nodeId);
  if (!previous) {
    return { ok: false, issues: [{ code: 'known-node-invariant', path: nodeId, nodeId }] };
  }
  const knownIds = knownIdsIfCapturing(part, [replacement]);
  const parent = isCanonicalPrimitiveCaptureActive() ? parentNodeOf(part, nodeId) : null;
  const result = finish(rebuild(part, nodeId, replacement), options);
  if (result.ok) captureReplaceNode(previous, parent, replacement, knownIds);
  return result;
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
  const parent = isCanonicalPrimitiveCaptureActive() ? parentNodeOf(part, nodeId) : null;
  const result = finish(rebuild(part, nodeId, null), options);
  if (result.ok && parent) captureRemoveNode(parent, nodeId);
  return result;
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
