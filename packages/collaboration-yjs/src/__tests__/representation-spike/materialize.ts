import {
  XML_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlTextNode,
} from '@docx-editor.dev/core/store';
import type {
  DirtyPaths,
  ElementRecord,
  EncodedAttribute,
  LogicalId,
  RepresentationBackend,
  SpikeIssueCode,
} from './contract.ts';
import { isTextRecord } from './contract.ts';

export function replaceChildRange(
  previous: readonly OoxmlNode[],
  next: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  if (previous.length === next.length && previous.every((child, index) => child === next[index])) {
    return previous;
  }
  let start = 0;
  const maxStart = Math.min(previous.length, next.length);
  while (start < maxStart && previous[start] === next[start]) start += 1;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return Object.freeze([
    ...previous.slice(0, start),
    ...next.slice(start, nextEnd),
    ...previous.slice(previousEnd),
  ]);
}

function freezeAttribute(attribute: EncodedAttribute): OoxmlAttribute {
  if (attribute.namespaceUri === XML_NAMESPACE_URI && attribute.localName === 'space') {
    const value = attribute.value === 'preserve' ? 'preserve' : 'default';
    return Object.freeze({
      kind: 'xmlSpace',
      namespaceUri: XML_NAMESPACE_URI,
      localName: 'space',
      prefix: 'xml',
      value,
    });
  }
  if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val') {
    return Object.freeze({
      kind: 'wmlVal',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'val',
      prefix: attribute.prefix,
      value: attribute.value,
    });
  }
  return Object.freeze({
    kind: 'genericExtension',
    namespaceUri: attribute.namespaceUri,
    localName: attribute.localName,
    prefix: attribute.prefix,
    value: attribute.value,
  });
}

function freezeText(logicalId: LogicalId, value: string): OoxmlTextNode {
  return Object.freeze({ id: logicalId, kind: 'textValue', value });
}

function freezeElement(record: ElementRecord, children: readonly OoxmlNode[]): OoxmlElement {
  return Object.freeze({
    id: record.logicalId,
    kind: record.kind,
    namespaceUri: record.namespaceUri,
    localName: record.localName,
    prefix: record.prefix,
    namespaceBindings: Object.freeze(
      record.bindings.map((binding) => Object.freeze({ ...binding }))
    ),
    attributes: Object.freeze(record.attributes.map(freezeAttribute)),
    children,
  }) as OoxmlElement;
}

function attributesMatch(node: OoxmlElement, record: ElementRecord): boolean {
  if (node.attributes.length !== record.attributes.length) return false;
  const encoded = new Map(
    record.attributes.map((attribute) => [
      `${attribute.namespaceUri}\n${attribute.localName}`,
      attribute.value,
    ])
  );
  for (const attribute of node.attributes) {
    if (encoded.get(`${attribute.namespaceUri}\n${attribute.localName}`) !== attribute.value) {
      return false;
    }
  }
  return node.localName === record.localName && node.kind === record.kind;
}

export function markPlaced(node: OoxmlNode, placed: Set<LogicalId>): void {
  placed.add(node.id);
  if (node.kind === 'textValue') return;
  for (const child of node.children) markPlaced(child, placed);
}

function expandAncestors(
  backend: RepresentationBackend,
  ids: ReadonlySet<LogicalId>
): Set<LogicalId> {
  const expanded = new Set(ids);
  for (const id of ids) {
    let parent = backend.parentOf(id);
    while (parent) {
      expanded.add(parent);
      parent = backend.parentOf(parent);
    }
  }
  return expanded;
}

export class Materializer {
  private readonly cache = new Map<LogicalId, OoxmlNode>();
  private readonly pendingDirty = new Set<LogicalId>();
  private pendingMembership = false;
  private lastDirty: ReadonlySet<LogicalId> = new Set();
  private part: OoxmlPart | null = null;
  private readonly stop: () => void;
  readonly spikeIssues: SpikeIssueCode[] = [];

  constructor(readonly backend: RepresentationBackend) {
    this.stop = backend.observeDirty((paths: DirtyPaths) => {
      for (const id of paths.logicalIds) this.pendingDirty.add(id);
      if (paths.membershipChanged) this.pendingMembership = true;
    });
  }

  destroy(): void {
    this.stop();
  }

  dirtyPaths(): ReadonlySet<LogicalId> {
    return this.lastDirty;
  }

  current(): OoxmlPart {
    if (this.part && this.pendingDirty.size === 0) return this.part;
    return this.rebuild();
  }

  rebuild(): OoxmlPart {
    this.spikeIssues.length = 0;
    const rawDirty = new Set(this.pendingDirty);
    const membershipChanged = this.pendingMembership;
    this.pendingDirty.clear();
    this.pendingMembership = false;
    this.lastDirty = expandAncestors(this.backend, rawDirty);
    const incremental = this.part !== null && this.lastDirty.size > 0 && !membershipChanged;
    const collectOrphans =
      membershipChanged ||
      !this.part ||
      [...this.lastDirty].some(
        (id) =>
          this.backend.isTombstoned(id) ||
          (id !== this.backend.rootLogicalId() && this.backend.parentOf(id) === null)
      );
    const placed = new Set<LogicalId>();
    const path = new Set<LogicalId>();
    const root = this.materialize(
      this.backend.rootLogicalId(),
      placed,
      path,
      incremental,
      collectOrphans
    ) as OoxmlElement;
    if (collectOrphans) this.collectOrphans(placed);
    const identity = this.backend.partIdentity();
    if (this.part && this.part.root === root) return this.part;
    this.part = Object.freeze({
      id: identity.id,
      name: identity.name,
      contentType: identity.contentType,
      root,
    });
    return this.part;
  }

  private collectOrphans(placed: ReadonlySet<LogicalId>): void {
    for (const id of this.backend.allLogicalIds()) {
      if (placed.has(id) || this.backend.isTombstoned(id)) continue;
      const record = this.backend.record(id);
      const hasContent =
        !!record &&
        (isTextRecord(record)
          ? record.value.length > 0
          : record.childIds.length > 0 || record.attributes.length > 0);
      this.spikeIssues.push(hasContent ? 'orphan-with-content' : 'orphan');
    }
  }

  private materialize(
    logicalId: LogicalId,
    placed: Set<LogicalId>,
    path: Set<LogicalId>,
    incremental: boolean,
    collectOrphans: boolean
  ): OoxmlNode | null {
    if (path.has(logicalId)) {
      this.spikeIssues.push('cycle');
      return null;
    }
    if (placed.has(logicalId)) {
      this.spikeIssues.push('duplicate-parent');
      return null;
    }
    if (incremental && !this.lastDirty.has(logicalId)) {
      const cached = this.cache.get(logicalId);
      if (cached) {
        if (collectOrphans) markPlaced(cached, placed);
        else placed.add(logicalId);
        return cached;
      }
    }
    if (this.backend.isTombstoned(logicalId)) return null;
    placed.add(logicalId);
    const record = this.backend.record(logicalId);
    if (!record) {
      this.spikeIssues.push('missing-node');
      throw new Error(`missing shared record ${logicalId}`);
    }
    if (isTextRecord(record)) {
      const previous = this.cache.get(logicalId);
      if (previous?.kind === 'textValue' && previous.value === record.value) return previous;
      const next = freezeText(logicalId, record.value);
      this.cache.set(logicalId, next);
      return next;
    }
    path.add(logicalId);
    const seenChildren = new Set<LogicalId>();
    const childIds = [...record.childIds];
    for (const extra of this.backend.adoptedChildren(logicalId)) {
      if (!childIds.includes(extra)) childIds.push(extra);
    }
    const children: OoxmlNode[] = [];
    for (const childId of childIds) {
      if (childId === logicalId) {
        this.spikeIssues.push('self-child');
        continue;
      }
      if (seenChildren.has(childId)) {
        this.spikeIssues.push('duplicate-child');
        continue;
      }
      seenChildren.add(childId);
      if (this.backend.isTombstoned(childId)) {
        this.spikeIssues.push('deleted-referenced');
        continue;
      }
      if (!this.backend.record(childId)) {
        this.spikeIssues.push('child-id-not-in-registry');
        continue;
      }
      const child = this.materialize(childId, placed, path, incremental, collectOrphans);
      if (child) children.push(child);
    }
    path.delete(logicalId);
    const previous = this.cache.get(logicalId);
    if (
      previous &&
      previous.kind !== 'textValue' &&
      previous.children.length === children.length &&
      previous.children.every((child, index) => child === children[index]) &&
      attributesMatch(previous, record)
    ) {
      return previous;
    }
    const previousChildren = previous && previous.kind !== 'textValue' ? previous.children : [];
    const next = freezeElement(record, replaceChildRange(previousChildren, children));
    this.cache.set(logicalId, next);
    return next;
  }
}
