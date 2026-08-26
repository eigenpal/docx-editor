// Lower existing tree primitives to the D3 journal without changing the returned part.
// Runs only while capture is active, so the disabled path never walks attributes or children.

import type { OoxmlAttribute, OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import {
  isCanonicalPrimitiveCaptureActive,
  recordPutNode,
  recordPutXmlPart,
  recordSetAttribute,
  recordSetNamespaceBinding,
  recordSpliceChildren,
  recordSpliceText,
} from './canonical-primitive-capture.ts';
import type {
  CanonicalAttributeName,
  CanonicalNodeDescriptor,
} from './canonical-primitive-journal.ts';

function attributeNameOf(attribute: OoxmlAttribute): CanonicalAttributeName {
  return attribute.prefix === undefined
    ? { namespaceUri: attribute.namespaceUri, localName: attribute.localName }
    : {
        namespaceUri: attribute.namespaceUri,
        localName: attribute.localName,
        prefix: attribute.prefix,
      };
}

function attributeKey(attribute: OoxmlAttribute): string {
  return `${attribute.namespaceUri}\0${attribute.localName}`;
}

function textSplice(
  previous: string,
  next: string
): {
  readonly utf16Start: number;
  readonly deleteCount: number;
  readonly insert: string;
} {
  let prefix = 0;
  const shared = Math.min(previous.length, next.length);
  while (prefix < shared && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous.charCodeAt(previous.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix += 1;
  }
  return {
    utf16Start: prefix,
    deleteCount: previous.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

function lowerAttributes(logicalId: string, previous: OoxmlElement, next: OoxmlElement): void {
  const before = new Map<string, OoxmlAttribute>();
  for (const attribute of previous.attributes) before.set(attributeKey(attribute), attribute);
  const seen = new Set<string>();
  for (const attribute of next.attributes) {
    const key = attributeKey(attribute);
    seen.add(key);
    const prior = before.get(key);
    if (prior && prior.value === attribute.value && prior.prefix === attribute.prefix) continue;
    recordSetAttribute(logicalId, attributeNameOf(attribute), attribute.value);
  }
  for (const [key, attribute] of before) {
    if (!seen.has(key)) recordSetAttribute(logicalId, attributeNameOf(attribute), null);
  }
}

function lowerNamespaceBindings(
  logicalId: string,
  previous: OoxmlElement,
  next: OoxmlElement
): void {
  const before = new Map<string, string>();
  for (const binding of previous.namespaceBindings) {
    before.set(binding.prefix, binding.namespaceUri);
  }
  const seen = new Set<string>();
  for (const binding of next.namespaceBindings) {
    seen.add(binding.prefix);
    if (before.get(binding.prefix) === binding.namespaceUri) continue;
    recordSetNamespaceBinding(logicalId, binding.prefix, binding.namespaceUri);
  }
  for (const prefix of before.keys()) {
    if (!seen.has(prefix)) recordSetNamespaceBinding(logicalId, prefix, null);
  }
}

function nodeDescriptor(node: OoxmlNode): CanonicalNodeDescriptor {
  if (node.kind === 'textValue') return { logicalId: node.id, kind: 'textValue' };
  return {
    logicalId: node.id,
    kind: node.kind,
    qname:
      node.prefix === undefined
        ? { namespaceUri: node.namespaceUri, localName: node.localName }
        : {
            namespaceUri: node.namespaceUri,
            localName: node.localName,
            prefix: node.prefix,
          },
  };
}

function expandInserted(node: OoxmlNode, knownIds?: ReadonlySet<string>): void {
  if (knownIds?.has(node.id)) return;
  recordPutNode(nodeDescriptor(node));
  if (node.kind === 'textValue') {
    // Initial fill of a shell this journal put. Apply replaces the node's current value,
    // because `deleteCount: 0` would insert again if the same journal ran twice.
    if (node.value.length > 0) recordSpliceText(node.id, 0, 0, node.value);
    return;
  }
  for (const attribute of node.attributes) {
    recordSetAttribute(node.id, attributeNameOf(attribute), attribute.value);
  }
  for (const binding of node.namespaceBindings) {
    recordSetNamespaceBinding(node.id, binding.prefix, binding.namespaceUri);
  }
  if (node.children.length === 0) return;
  for (const child of node.children) expandInserted(child, knownIds);
  recordSpliceChildren(
    node.id,
    0,
    0,
    node.children.map((child) => child.id)
  );
}

function qnameChanged(previous: OoxmlElement, next: OoxmlElement): boolean {
  return (
    previous.kind !== next.kind ||
    previous.namespaceUri !== next.namespaceUri ||
    previous.localName !== next.localName ||
    previous.prefix !== next.prefix
  );
}

function indexSubtree(node: OoxmlNode, into: Map<string, OoxmlNode>): void {
  into.set(node.id, node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) indexSubtree(child, into);
}

function lowerSameIdentity(
  previous: OoxmlNode,
  next: OoxmlNode,
  knownIds?: ReadonlySet<string>,
  previousNodes?: ReadonlyMap<string, OoxmlNode>
): void {
  if (previous === next) return;
  if (previous.kind === 'textValue' || next.kind === 'textValue') {
    const before = previous.kind === 'textValue' ? previous.value : '';
    const after = next.kind === 'textValue' ? next.value : '';
    const splice = textSplice(before, after);
    recordSpliceText(previous.id, splice.utf16Start, splice.deleteCount, splice.insert);
    return;
  }
  if (qnameChanged(previous, next)) recordPutNode(nodeDescriptor(next));
  lowerAttributes(previous.id, previous, next);
  lowerNamespaceBindings(previous.id, previous, next);
  lowerChildList(previous.id, previous.children, next.children, knownIds, previousNodes);
}

function lowerChildList(
  parentLogicalId: string,
  previous: readonly OoxmlNode[],
  next: readonly OoxmlNode[],
  knownIds?: ReadonlySet<string>,
  previousNodes?: ReadonlyMap<string, OoxmlNode>
): void {
  if (previous === next) return;
  const previousById = new Map<string, OoxmlNode>();
  for (const child of previous) previousById.set(child.id, child);

  let start = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start]!.id === next[start]!.id
  ) {
    lowerSameIdentity(previous[start]!, next[start]!, knownIds, previousNodes);
    start += 1;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1]!.id === next[nextEnd - 1]!.id
  ) {
    lowerSameIdentity(previous[previousEnd - 1]!, next[nextEnd - 1]!, knownIds, previousNodes);
    previousEnd -= 1;
    nextEnd -= 1;
  }

  const deleted = previous.slice(start, previousEnd);
  const inserted = next.slice(start, nextEnd);
  for (const node of inserted) {
    const prior = previousById.get(node.id) ?? previousNodes?.get(node.id);
    if (prior) {
      // A rejected deletion unwraps `w:del` and turns `w:delText` into `w:t` on the same id.
      // That run was a grandchild, so a parent-only previous list skipped the qname change.
      // Replay then kept `w:delText` outside any wrapper.
      if (prior !== node) lowerSameIdentity(prior, node, knownIds, previousNodes);
      continue;
    }
    // Existing document nodes that MOVE into this parent must not be re-expanded. Re-emitting
    // putNode/spliceText for a joined run duplicates its text on replay.
    if (!knownIds?.has(node.id)) expandInserted(node, knownIds);
  }
  recordSpliceChildren(
    parentLogicalId,
    start,
    deleted.length,
    inserted.map((child) => child.id)
  );
}

/** Lower `replaceChildren` after a successful edit. */
export function captureReplaceChildren(
  target: OoxmlElement,
  children: readonly OoxmlNode[],
  knownIds?: ReadonlySet<string>
): void {
  if (!isCanonicalPrimitiveCaptureActive()) return;
  const previousNodes = new Map<string, OoxmlNode>();
  indexSubtree(target, previousNodes);
  lowerChildList(target.id, target.children, children, knownIds, previousNodes);
}

/** Lower `insertChildren` after a successful edit. */
export function captureInsertChildren(
  target: OoxmlElement,
  index: number,
  children: readonly OoxmlNode[],
  knownIds?: ReadonlySet<string>
): void {
  if (!isCanonicalPrimitiveCaptureActive() || children.length === 0) return;
  const at = Math.max(0, Math.min(index, target.children.length));
  const existing = new Set(target.children.map((child) => child.id));
  for (const child of children) {
    if (existing.has(child.id) || knownIds?.has(child.id)) continue;
    expandInserted(child, knownIds);
  }
  recordSpliceChildren(
    target.id,
    at,
    0,
    children.map((child) => child.id)
  );
}

/** Lower `removeNode` after a successful edit. */
export function captureRemoveNode(parent: OoxmlElement, nodeId: string): void {
  if (!isCanonicalPrimitiveCaptureActive()) return;
  const index = parent.children.findIndex((child) => child.id === nodeId);
  if (index < 0) return;
  recordSpliceChildren(parent.id, index, 1, []);
}

/** Lower `replaceNode` after a successful edit. */
export function captureReplaceNode(
  previous: OoxmlNode,
  parent: OoxmlElement | null,
  replacement: OoxmlNode,
  knownIds?: ReadonlySet<string>
): void {
  if (!isCanonicalPrimitiveCaptureActive()) return;
  if (previous.id === replacement.id) {
    const previousNodes = new Map<string, OoxmlNode>();
    indexSubtree(previous, previousNodes);
    lowerSameIdentity(previous, replacement, knownIds, previousNodes);
    return;
  }
  if (!parent) return;
  const index = parent.children.findIndex((child) => child.id === previous.id);
  if (index < 0) return;
  if (!knownIds?.has(replacement.id)) expandInserted(replacement, knownIds);
  recordSpliceChildren(parent.id, index, 1, [replacement.id]);
}

/** Lower a new or replaced XML part root before `putXmlPart`. */
export function captureXmlPartRoot(part: OoxmlPart, knownIds?: ReadonlySet<string>): void {
  if (!isCanonicalPrimitiveCaptureActive()) return;
  expandInserted(part.root, knownIds);
  recordPutXmlPart(part.name, part.root.id);
}
