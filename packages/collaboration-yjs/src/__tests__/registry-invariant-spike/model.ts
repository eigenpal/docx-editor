import * as Y from 'yjs';

export const META_KEY = 'registry-spike-v1';
export const NODES_KEY = 'registry-spike-nodes-v1';
export const ROOT_ID = 'root';
export const MAX_DEPTH = 64;
export const REPAIR_VERSION = 1;

export type ModelKind = 'child-array' | 'parent-register';
export type DeleteMode = 'tombstone' | 'unlink' | 'map-delete';

export type IssueCode =
  | 'duplicate-parent'
  | 'duplicate-child'
  | 'cycle'
  | 'unreachable-cycle'
  | 'missing-node'
  | 'stale-child-hint'
  | 'missing-parent-hint'
  | 'deleted-referenced'
  | 'orphan'
  | 'orphan-with-content'
  | 'self-child'
  | 'replaced-by-missing'
  | 'depth-exceeded';

export interface Issue {
  readonly code: IssueCode;
  readonly nodeId: string;
  readonly relatedId?: string;
}

export interface FrozenNode {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly children: readonly FrozenNode[];
}

export interface MaterializeOptions {
  readonly followReplacedBy?: boolean;
}

export interface Materialization {
  readonly root: FrozenNode | null;
  readonly issues: readonly Issue[];
  readonly cache: ReadonlyMap<string, FrozenNode>;
  readonly allocated: number;
  readonly reachable: ReadonlySet<string>;
  readonly fingerprint: string;
  readonly quarantined: boolean;
}

export interface LocalOrigin {
  readonly kind: 'spike-local';
  readonly actorId: string;
}

export const BOOTSTRAP_ORIGIN = Object.freeze({ kind: 'spike-bootstrap' });
export type SpikeOrigin = LocalOrigin | typeof BOOTSTRAP_ORIGIN;

export function isNodeMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map;
}

export function isIdArray(value: unknown): value is Y.Array<string> {
  return value instanceof Y.Array;
}

export function isText(value: unknown): value is Y.Text {
  return value instanceof Y.Text;
}

export function nodeRecord(nodes: Y.Map<unknown>, id: string): Y.Map<unknown> | null {
  const value = nodes.get(id);
  return isNodeMap(value) ? value : null;
}

export function childArray(record: Y.Map<unknown>): Y.Array<string> | null {
  const value = record.get('children');
  return isIdArray(value) ? value : null;
}

export function nodeText(record: Y.Map<unknown>): Y.Text | null {
  const value = record.get('text');
  return isText(value) ? value : null;
}

export function removeAll(array: Y.Array<string>, id: string): void {
  for (let index = array.length - 1; index >= 0; index -= 1) {
    if (array.get(index) === id) array.delete(index, 1);
  }
}

export function unlinkFromAllParents(nodes: Y.Map<unknown>, id: string): void {
  for (const record of nodes.values()) {
    if (!isNodeMap(record)) continue;
    const children = childArray(record);
    if (children) removeAll(children, id);
  }
}

export function insertAt(array: Y.Array<string>, index: number, id: string): void {
  const clamped = Math.max(0, Math.min(index, array.length));
  array.insert(clamped, [id]);
}

export function createNodeRecord(
  name: string,
  text: string,
  parentId: string | null,
  model: ModelKind
): Y.Map<unknown> {
  const record = new Y.Map<unknown>();
  record.set('name', name);
  const ytext = new Y.Text();
  if (text.length > 0) ytext.insert(0, text);
  record.set('text', ytext);
  record.set('children', new Y.Array<string>());
  record.set('deleted', false);
  if (model === 'parent-register') record.set('parentId', parentId);
  return record;
}

export function insertChild(
  nodes: Y.Map<unknown>,
  origin: SpikeOrigin,
  model: ModelKind,
  parentId: string,
  index: number,
  id: string,
  name: string,
  text: string
): void {
  const doc = nodes.doc;
  if (!doc) throw new Error('nodes map has no document');
  doc.transact(() => {
    const parent = nodeRecord(nodes, parentId);
    const children = parent ? childArray(parent) : null;
    if (!parent || !children) throw new Error(`missing parent ${parentId}`);
    nodes.set(id, createNodeRecord(name, text, parentId, model));
    insertAt(children, index, id);
  }, origin);
}

export function insertText(
  nodes: Y.Map<unknown>,
  origin: SpikeOrigin,
  id: string,
  offset: number,
  value: string
): void {
  const doc = nodes.doc;
  if (!doc) throw new Error('nodes map has no document');
  doc.transact(() => {
    const record = nodeRecord(nodes, id);
    const text = record ? nodeText(record) : null;
    if (!record || !text) throw new Error(`missing text ${id}`);
    text.insert(Math.max(0, Math.min(offset, text.length)), value);
  }, origin);
}

export function moveNode(
  nodes: Y.Map<unknown>,
  origin: SpikeOrigin,
  model: ModelKind,
  id: string,
  destParentId: string,
  destIndex: number
): void {
  const doc = nodes.doc;
  if (!doc) throw new Error('nodes map has no document');
  doc.transact(() => {
    if (id === destParentId) throw new Error('cannot parent a node under itself');
    const dest = nodeRecord(nodes, destParentId);
    const destChildren = dest ? childArray(dest) : null;
    if (!dest || !destChildren) throw new Error(`missing dest ${destParentId}`);
    unlinkFromAllParents(nodes, id);
    insertAt(destChildren, destIndex, id);
    const record = nodeRecord(nodes, id);
    if (model === 'parent-register' && record) record.set('parentId', destParentId);
  }, origin);
}

export function deleteNode(
  nodes: Y.Map<unknown>,
  origin: SpikeOrigin,
  model: ModelKind,
  id: string,
  mode: DeleteMode
): void {
  const doc = nodes.doc;
  if (!doc) throw new Error('nodes map has no document');
  doc.transact(() => {
    unlinkFromAllParents(nodes, id);
    if (mode === 'map-delete') {
      nodes.delete(id);
      return;
    }
    const record = nodeRecord(nodes, id);
    if (!record) return;
    if (mode === 'tombstone') record.set('deleted', true);
    if (model === 'parent-register') record.set('parentId', null);
  }, origin);
}

export function joinNodes(
  nodes: Y.Map<unknown>,
  origin: SpikeOrigin,
  model: ModelKind,
  firstId: string,
  secondId: string
): void {
  const doc = nodes.doc;
  if (!doc) throw new Error('nodes map has no document');
  doc.transact(() => {
    const first = nodeRecord(nodes, firstId);
    const second = nodeRecord(nodes, secondId);
    const firstChildren = first ? childArray(first) : null;
    const secondChildren = second ? childArray(second) : null;
    if (!first || !second || !firstChildren || !secondChildren) {
      throw new Error('join requires two node records');
    }
    const moved = secondChildren.toArray().filter((childId) => childId !== firstId);
    for (const childId of moved) {
      removeAll(secondChildren, childId);
      firstChildren.push([childId]);
      const child = nodeRecord(nodes, childId);
      if (model === 'parent-register' && child) child.set('parentId', firstId);
    }
    second.set('deleted', true);
    second.set('replacedBy', firstId);
    unlinkFromAllParents(nodes, secondId);
    if (model === 'parent-register') second.set('parentId', null);
  }, origin);
}

function stringField(record: Y.Map<unknown>, key: string): string | null {
  const value = record.get(key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isDeleted(record: Y.Map<unknown>): boolean {
  return record.get('deleted') === true;
}

function parentIdOf(record: Y.Map<unknown>): string | null {
  const value = record.get('parentId');
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nodeHasContent(record: Y.Map<unknown>): boolean {
  const text = nodeText(record);
  if (text && text.length > 0) return true;
  const children = childArray(record);
  return !!children && children.length > 0;
}

function replaceTarget(
  nodes: Y.Map<unknown>,
  startId: string,
  follow: boolean
): { readonly targetId: string | null; readonly missing: boolean } {
  if (!follow) return { targetId: null, missing: false };
  const seen = new Set<string>();
  let current = startId;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (seen.has(current)) return { targetId: null, missing: true };
    seen.add(current);
    const record = nodeRecord(nodes, current);
    if (!record) return { targetId: null, missing: true };
    if (!isDeleted(record)) return { targetId: current, missing: false };
    const next = stringField(record, 'replacedBy');
    if (!next) return { targetId: null, missing: false };
    current = next;
  }
  return { targetId: null, missing: true };
}

function childIdsFor(
  nodes: Y.Map<unknown>,
  model: ModelKind,
  parentId: string,
  issues: Issue[]
): string[] {
  const record = nodeRecord(nodes, parentId);
  if (!record) return [];
  const children = childArray(record);
  const listed = children ? children.toArray() : [];
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const childId of listed) {
    if (childId === parentId) {
      issues.push({ code: 'self-child', nodeId: parentId, relatedId: childId });
      continue;
    }
    if (seen.has(childId)) {
      issues.push({ code: 'duplicate-child', nodeId: parentId, relatedId: childId });
      continue;
    }
    seen.add(childId);
    const child = nodeRecord(nodes, childId);
    if (!child) {
      issues.push({ code: 'missing-node', nodeId: parentId, relatedId: childId });
      continue;
    }
    if (isDeleted(child)) {
      issues.push({ code: 'deleted-referenced', nodeId: parentId, relatedId: childId });
      continue;
    }
    if (model === 'parent-register' && parentIdOf(child) !== parentId) {
      issues.push({ code: 'stale-child-hint', nodeId: parentId, relatedId: childId });
      continue;
    }
    ordered.push(childId);
  }
  if (model !== 'parent-register') return ordered;
  const missing: string[] = [];
  for (const [childId, value] of nodes.entries()) {
    if (!isNodeMap(value) || isDeleted(value) || parentIdOf(value) !== parentId) continue;
    if (seen.has(childId) || childId === parentId) continue;
    issues.push({ code: 'missing-parent-hint', nodeId: parentId, relatedId: childId });
    missing.push(childId);
  }
  missing.sort();
  return [...ordered, ...missing];
}

function appendJoinOrphans(
  nodes: Y.Map<unknown>,
  followReplacedBy: boolean,
  adopted: Map<string, string[]>,
  issues: Issue[]
): void {
  if (!followReplacedBy) return;
  for (const [id, value] of nodes.entries()) {
    if (!isNodeMap(value) || !isDeleted(value)) continue;
    const replacedBy = stringField(value, 'replacedBy');
    if (!replacedBy) continue;
    const target = replaceTarget(nodes, id, true);
    if (target.missing || !target.targetId) {
      issues.push({ code: 'replaced-by-missing', nodeId: id, relatedId: replacedBy });
      continue;
    }
    const children = childArray(value);
    const leftovers = children ? children.toArray() : [];
    for (const childId of leftovers) {
      const child = nodeRecord(nodes, childId);
      if (!child || isDeleted(child)) continue;
      const bucket = adopted.get(target.targetId) ?? [];
      if (!bucket.includes(childId)) bucket.push(childId);
      adopted.set(target.targetId, bucket);
    }
  }
}

export function materialize(
  nodes: Y.Map<unknown>,
  rootId: string,
  model: ModelKind,
  previous: ReadonlyMap<string, FrozenNode> | null,
  options: MaterializeOptions = {}
): Materialization {
  const followReplacedBy = options.followReplacedBy !== false;
  const issues: Issue[] = [];
  const adopted = new Map<string, string[]>();
  appendJoinOrphans(nodes, followReplacedBy, adopted, issues);
  const reachable = new Set<string>();
  const path = new Set<string>();
  const produced = new Map<string, FrozenNode>();
  let allocated = 0;

  const walk = (id: string, depth: number): FrozenNode | null => {
    if (depth > MAX_DEPTH) {
      issues.push({ code: 'depth-exceeded', nodeId: id });
      return null;
    }
    if (path.has(id)) {
      issues.push({ code: 'cycle', nodeId: id });
      return null;
    }
    if (reachable.has(id)) {
      issues.push({ code: 'duplicate-parent', nodeId: id });
      return null;
    }
    const record = nodeRecord(nodes, id);
    if (!record) {
      issues.push({ code: 'missing-node', nodeId: id });
      return null;
    }
    if (isDeleted(record) && id !== rootId) return null;
    path.add(id);
    reachable.add(id);
    const childIds = [...childIdsFor(nodes, model, id, issues)];
    for (const extra of adopted.get(id) ?? []) {
      if (!childIds.includes(extra)) childIds.push(extra);
    }
    const children: FrozenNode[] = [];
    for (const childId of childIds) {
      const child = walk(childId, depth + 1);
      if (child) children.push(child);
    }
    path.delete(id);
    const text = nodeText(record)?.toString() ?? '';
    const name = stringField(record, 'name') ?? 'generic';
    const prev = previous?.get(id);
    const sameChildren =
      !!prev &&
      prev.children.length === children.length &&
      prev.children.every((child, index) => child === children[index]);
    if (prev && prev.name === name && prev.text === text && sameChildren) {
      produced.set(id, prev);
      return prev;
    }
    const next = Object.freeze({
      id,
      name,
      text,
      children: Object.freeze(children),
    });
    allocated += 1;
    produced.set(id, next);
    return next;
  };

  const root = walk(rootId, 0);
  const orphanIds: string[] = [];
  for (const [id, value] of nodes.entries()) {
    if (!isNodeMap(value) || isDeleted(value) || reachable.has(id)) continue;
    orphanIds.push(id);
    const content = nodeHasContent(value);
    issues.push({
      code: content ? 'orphan-with-content' : 'orphan',
      nodeId: id,
    });
  }
  if (orphanIds.length > 0) {
    const orphanSet = new Set(orphanIds);
    const pointsInside = orphanIds.some((id) => {
      const record = nodeRecord(nodes, id);
      const children = record ? childArray(record) : null;
      return children?.toArray().some((childId) => orphanSet.has(childId)) === true;
    });
    if (pointsInside) {
      for (const id of orphanIds) issues.push({ code: 'unreachable-cycle', nodeId: id });
    }
  }
  const quarantined = issues.some(
    (issue) =>
      issue.code === 'orphan-with-content' ||
      issue.code === 'unreachable-cycle' ||
      issue.code === 'depth-exceeded'
  );
  const fingerprint = root ? fingerprintOf(root) : 'null';
  return { root, issues, cache: produced, allocated, reachable, fingerprint, quarantined };
}

export function fingerprintOf(node: FrozenNode): string {
  return JSON.stringify({
    id: node.id,
    name: node.name,
    text: node.text,
    children: node.children.map(fingerprintOf),
  });
}

export function findNode(node: FrozenNode, id: string): FrozenNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const match = findNode(child, id);
    if (match) return match;
  }
  return null;
}

export function parentOf(node: FrozenNode, id: string): FrozenNode | null {
  for (const child of node.children) {
    if (child.id === id) return node;
    const nested = parentOf(child, id);
    if (nested) return nested;
  }
  return null;
}

export function issueCodes(issues: readonly Issue[]): string[] {
  return [...issues.map((issue) => issue.code)].sort();
}
