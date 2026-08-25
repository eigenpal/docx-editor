import * as Y from 'yjs';
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type {
  BackendKind,
  DirtyPaths,
  ElementRecord,
  EncodedAttribute,
  EncodedBinding,
  LogicalId,
  NodeIdentityMeta,
  PartIdentity,
  RepresentationBackend,
  SharedRecord,
  TextRecord,
} from './contract.ts';
import { isElementRecord } from './contract.ts';
import { wordFacingIdsOf, yjsItemKey } from './identity.ts';
import { writePart, type SeedSink } from './seed.ts';

function itemKeyOf(type: Y.AbstractType<unknown> | Y.Map<unknown> | Y.XmlElement): string | null {
  const item = (type as unknown as { _item?: { id: { client: number; clock: number } } })._item;
  if (!item) return null;
  return yjsItemKey(item.id.client, item.id.clock);
}

function asTrackedType(type: Y.Map<Y.Map<unknown>> | Y.Map<string>): Y.AbstractType<unknown> {
  return type as Y.AbstractType<unknown>;
}

function attrMapKey(namespaceUri: string, localName: string): string {
  return `${namespaceUri}\n${localName}`;
}

function isNodeMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map;
}

function childArrayOf(record: Y.Map<unknown>): Y.Array<string> | null {
  const children = record.get('children');
  return children instanceof Y.Array ? children : null;
}

/** Child-ID arrays are the only membership and order authority. */
export class RegistryBackend implements RepresentationBackend {
  readonly kind: BackendKind = 'registry';
  private readonly nodes: Y.Map<Y.Map<unknown>>;
  private readonly meta: Y.Map<string>;
  /** First reachable preorder parent. Derived, never replicated. */
  private parentIndex = new Map<LogicalId, LogicalId>();
  /** Every child-array listing. Derived, never replicated. */
  private listings = new Map<LogicalId, Set<LogicalId>>();
  private childrenSnapshot = new Map<LogicalId, readonly LogicalId[]>();
  private adoptees = new Map<LogicalId, LogicalId[]>();
  private tombstoneSources = new Map<LogicalId, Set<LogicalId>>();
  private bulkLoad = 0;

  constructor(readonly doc: Y.Doc) {
    this.nodes = doc.getMap('spike-registry-nodes');
    this.meta = doc.getMap('spike-registry-part');
    this.nodes.observeDeep((events) => {
      if (this.bulkLoad > 0) return;
      this.applyChildArrayEvents(events);
    });
  }

  seed(part: OoxmlPart): void {
    this.beginBulkLoad();
    this.doc.transact(() => {
      writePart(this.sink(), part);
    });
    this.endBulkLoad();
  }

  beginBulkLoad(): void {
    this.bulkLoad += 1;
  }

  endBulkLoad(): void {
    this.bulkLoad = Math.max(0, this.bulkLoad - 1);
    if (this.bulkLoad === 0) this.rebuildDerivedIndexes();
  }

  partIdentity(): PartIdentity {
    return {
      id: String(this.meta.get('id') ?? ''),
      name: String(this.meta.get('name') ?? ''),
      contentType: String(this.meta.get('contentType') ?? ''),
    };
  }

  rootLogicalId(): LogicalId {
    const stored = this.meta.get('rootId');
    if (typeof stored !== 'string' || stored.length === 0) {
      throw new Error('registry backend has no root');
    }
    return stored;
  }

  record(logicalId: LogicalId): SharedRecord | null {
    const rec = this.nodes.get(logicalId);
    if (!rec) return null;
    if (rec.get('kind') === 'textValue') {
      const text = rec.get('text');
      const value = text instanceof Y.Text ? text.toString() : '';
      return { logicalId, kind: 'textValue', value } satisfies TextRecord;
    }
    return this.elementRecord(logicalId, rec);
  }

  parentOf(logicalId: LogicalId): LogicalId | null {
    return this.parentIndex.get(logicalId) ?? null;
  }

  identityMeta(logicalId: LogicalId): NodeIdentityMeta | null {
    const rec = this.nodes.get(logicalId);
    if (!rec) return null;
    const shared = this.record(logicalId);
    const attributes = shared && isElementRecord(shared) ? shared.attributes : [];
    return {
      logicalId,
      yjsItemKey: itemKeyOf(rec),
      wordFacingIds: wordFacingIdsOf(attributes),
    };
  }

  insertText(logicalId: LogicalId, offset: number, text: string): void {
    this.doc.transact(() => {
      this.textOf(logicalId).insert(offset, text);
    });
  }

  deleteText(logicalId: LogicalId, offset: number, length: number): void {
    this.doc.transact(() => {
      this.textOf(logicalId).delete(offset, length);
    });
  }

  setAttribute(logicalId: LogicalId, attribute: EncodedAttribute): void {
    this.doc.transact(() => {
      this.attrMap(logicalId).set(attrMapKey(attribute.namespaceUri, attribute.localName), {
        namespaceUri: attribute.namespaceUri,
        localName: attribute.localName,
        prefix: attribute.prefix ?? '',
        value: attribute.value,
      });
    });
  }

  removeAttribute(logicalId: LogicalId, namespaceUri: string, localName: string): void {
    this.doc.transact(() => {
      this.attrMap(logicalId).delete(attrMapKey(namespaceUri, localName));
    });
  }

  createElement(record: Omit<ElementRecord, 'childIds'>): void {
    this.doc.transact(() => {
      this.nodes.set(record.logicalId, this.makeElement(record));
    });
  }

  createText(logicalId: LogicalId, value: string): void {
    this.doc.transact(() => {
      this.nodes.set(logicalId, this.makeText(value));
    });
  }

  spliceChildren(
    parentId: LogicalId,
    index: number,
    deleteCount: number,
    insertIds: readonly LogicalId[]
  ): void {
    this.doc.transact(() => {
      const children = this.childArray(parentId);
      if (deleteCount > 0) children.delete(index, deleteCount);
      if (insertIds.length > 0) children.insert(index, [...insertIds]);
    });
  }

  moveNode(nodeId: LogicalId, destParentId: LogicalId, destIndex: number): void {
    this.doc.transact(() => {
      this.unlinkFromAllParents(nodeId);
      const dest = this.childArray(destParentId);
      dest.insert(Math.max(0, Math.min(destIndex, dest.length)), [nodeId]);
    });
  }

  tombstone(logicalId: LogicalId): void {
    this.doc.transact(() => {
      this.unlinkFromAllParents(logicalId);
      this.require(logicalId).set('deleted', true);
    });
  }

  joinNodes(survivorId: LogicalId, removedId: LogicalId): void {
    this.doc.transact(() => {
      const survivor = this.childArray(survivorId);
      const removed = this.childArray(removedId);
      const moved = removed.toArray().filter((childId) => childId !== survivorId);
      for (const childId of moved) this.removeFromArray(removed, childId);
      if (moved.length > 0) survivor.push(moved);
      const rec = this.require(removedId);
      rec.set('deleted', true);
      rec.set('replacedBy', survivorId);
      this.unlinkFromAllParents(removedId);
    });
  }

  isTombstoned(logicalId: LogicalId): boolean {
    return this.nodes.get(logicalId)?.get('deleted') === true;
  }

  replacedByOf(logicalId: LogicalId): LogicalId | null {
    const value = this.nodes.get(logicalId)?.get('replacedBy');
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  adoptedChildren(survivorId: LogicalId): readonly LogicalId[] {
    return this.adoptees.get(survivorId) ?? [];
  }

  listingParents(logicalId: LogicalId): readonly LogicalId[] {
    return [...(this.listings.get(logicalId) ?? [])];
  }

  allLogicalIds(): readonly LogicalId[] {
    return [...this.nodes.keys()];
  }

  trackedTypes(): readonly Y.AbstractType<unknown>[] {
    return [asTrackedType(this.nodes), asTrackedType(this.meta)];
  }

  observeDirty(onDirty: (paths: DirtyPaths) => void): () => void {
    const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
      const logicalIds = new Set<LogicalId>();
      let membershipChanged = false;
      for (const event of events) {
        const path = event.path;
        if (path.length === 0) {
          for (const key of event.changes.keys.keys()) logicalIds.add(String(key));
          membershipChanged = true;
          continue;
        }
        logicalIds.add(String(path[0]));
        if (event.target instanceof Y.Array) membershipChanged = true;
        if (
          event.target instanceof Y.Map &&
          (event.changes.keys.has('deleted') || event.changes.keys.has('replacedBy'))
        ) {
          membershipChanged = true;
        }
      }
      if (logicalIds.size > 0) onDirty({ logicalIds, backend: 'registry', membershipChanged });
    };
    this.nodes.observeDeep(handler);
    return () => {
      this.nodes.unobserveDeep(handler);
    };
  }

  encodeSnapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  encodeUpdate(remoteStateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, remoteStateVector);
  }

  private rebuildDerivedIndexes(): void {
    this.parentIndex = new Map();
    this.listings = new Map();
    this.childrenSnapshot = new Map();
    this.adoptees = new Map();
    this.tombstoneSources = new Map();
    this.nodes.forEach((rec, parentId) => {
      const children = childArrayOf(rec);
      if (!children) return;
      const childIds = children.toArray();
      this.childrenSnapshot.set(parentId, childIds);
      for (const childId of childIds) this.addListing(childId, parentId);
    });
    this.nodes.forEach((rec, id) => {
      if (rec.get('deleted') === true) this.syncAdoptee(id);
    });
    this.assignFirstReachable(null);
  }

  private applyChildArrayEvents(events: Y.YEvent<Y.AbstractType<unknown>>[]): void {
    const changed = new Set<LogicalId>();
    for (const event of events) {
      if (event.target instanceof Y.Array && event.path.length > 0) {
        const parentId = String(event.path[0]);
        for (const childId of this.syncChildListings(parentId)) changed.add(childId);
        if (this.isTombstoned(parentId)) this.syncAdoptee(parentId);
        continue;
      }
      if (
        event.target instanceof Y.Map &&
        event.path.length === 1 &&
        (event.changes.keys.has('deleted') || event.changes.keys.has('replacedBy'))
      ) {
        this.syncAdoptee(String(event.path[0]));
      }
    }
    if (changed.size > 0) this.resolveParents(changed);
  }

  private syncChildListings(parentId: LogicalId): LogicalId[] {
    const rec = this.nodes.get(parentId);
    const next = rec ? (childArrayOf(rec)?.toArray() ?? []) : [];
    const prev = this.childrenSnapshot.get(parentId) ?? [];
    const affected: LogicalId[] = [];
    for (const childId of prev) {
      if (next.includes(childId)) continue;
      this.removeListing(childId, parentId);
      affected.push(childId);
    }
    for (const childId of next) {
      this.addListing(childId, parentId);
      if (!prev.includes(childId)) affected.push(childId);
    }
    this.childrenSnapshot.set(parentId, next);
    return affected;
  }

  private addListing(childId: LogicalId, parentId: LogicalId): void {
    const listed = this.listings.get(childId) ?? new Set<LogicalId>();
    listed.add(parentId);
    this.listings.set(childId, listed);
  }

  private removeListing(childId: LogicalId, parentId: LogicalId): void {
    const listed = this.listings.get(childId);
    if (!listed) return;
    listed.delete(parentId);
    if (listed.size === 0) this.listings.delete(childId);
  }

  private resolveParents(ids: ReadonlySet<LogicalId>): void {
    const multi: LogicalId[] = [];
    for (const id of ids) {
      const listed = this.listings.get(id);
      if (!listed || listed.size === 0) {
        this.parentIndex.delete(id);
        continue;
      }
      if (listed.size === 1) {
        this.parentIndex.set(id, [...listed][0]!);
        continue;
      }
      multi.push(id);
    }
    if (multi.length > 0) this.assignFirstReachable(new Set(multi));
  }

  private assignFirstReachable(only: ReadonlySet<LogicalId> | null): void {
    if (only) {
      for (const id of only) this.parentIndex.delete(id);
    }
    const walk = (id: LogicalId, path: Set<LogicalId>): void => {
      if (path.has(id)) return;
      const rec = this.nodes.get(id);
      if (!rec || rec.get('deleted') === true) return;
      const children = this.childrenSnapshot.get(id) ?? childArrayOf(rec)?.toArray() ?? [];
      path.add(id);
      const seen = new Set<string>();
      for (const childId of children) {
        if (seen.has(childId) || childId === id) continue;
        seen.add(childId);
        if (only === null || only.has(childId)) {
          if (!this.parentIndex.has(childId)) this.parentIndex.set(childId, id);
        }
        walk(childId, path);
      }
      path.delete(id);
    };
    walk(this.rootLogicalId(), new Set());
  }

  private syncAdoptee(removedId: LogicalId): void {
    for (const sources of this.tombstoneSources.values()) sources.delete(removedId);
    const rec = this.nodes.get(removedId);
    const survivor = rec?.get('replacedBy');
    const targets = new Set<LogicalId>();
    if (rec?.get('deleted') === true && typeof survivor === 'string' && survivor.length > 0) {
      const sources = this.tombstoneSources.get(survivor) ?? new Set<LogicalId>();
      sources.add(removedId);
      this.tombstoneSources.set(survivor, sources);
      targets.add(survivor);
    }
    for (const [existing, sources] of this.tombstoneSources) {
      if (sources.has(removedId) || existing === survivor) targets.add(existing);
    }
    for (const target of targets) this.recomputeAdoptees(target);
  }

  private recomputeAdoptees(survivorId: LogicalId): void {
    const extras: LogicalId[] = [];
    for (const tombstoneId of this.tombstoneSources.get(survivorId) ?? []) {
      const rec = this.nodes.get(tombstoneId);
      if (!rec) continue;
      for (const childId of childArrayOf(rec)?.toArray() ?? []) {
        if (!this.isTombstoned(childId) && this.nodes.has(childId)) extras.push(childId);
      }
    }
    if (extras.length > 0) this.adoptees.set(survivorId, extras);
    else this.adoptees.delete(survivorId);
  }

  private unlinkFromAllParents(id: LogicalId): void {
    const parents = [...(this.listings.get(id) ?? [])];
    if (parents.length === 0) {
      this.nodes.forEach((rec) => {
        const children = childArrayOf(rec);
        if (children) this.removeFromArray(children, id);
      });
      return;
    }
    for (const parentId of parents) {
      const children = childArrayOf(this.require(parentId));
      if (children) this.removeFromArray(children, id);
    }
  }

  private removeFromArray(array: Y.Array<string>, id: string): void {
    for (let index = array.length - 1; index >= 0; index -= 1) {
      if (array.get(index) === id) array.delete(index, 1);
    }
  }

  private sink(): SeedSink {
    return {
      writePartIdentity: (part) => {
        this.meta.set('id', part.id);
        this.meta.set('name', part.name);
        this.meta.set('contentType', part.contentType);
      },
      writeElement: (node, attributes, bindings) => {
        this.nodes.set(
          node.id,
          this.makeElement({
            logicalId: node.id,
            kind: node.kind,
            namespaceUri: node.namespaceUri,
            localName: node.localName,
            prefix: node.prefix,
            attributes,
            bindings,
          })
        );
      },
      writeText: (node) => {
        this.nodes.set(node.id, this.makeText(node.value));
      },
      appendChild: (parentId, childId) => {
        this.childArray(parentId).push([childId]);
      },
      setRoot: (id) => {
        this.meta.set('rootId', id);
      },
    };
  }

  private makeElement(record: Omit<ElementRecord, 'childIds'>): Y.Map<unknown> {
    const rec = new Y.Map<unknown>();
    rec.set('kind', record.kind);
    rec.set('ns', record.namespaceUri);
    rec.set('localName', record.localName);
    rec.set('prefix', record.prefix ?? '');
    rec.set('deleted', false);
    const attributes = new Y.Map<unknown>();
    for (const attribute of record.attributes) {
      attributes.set(attrMapKey(attribute.namespaceUri, attribute.localName), {
        namespaceUri: attribute.namespaceUri,
        localName: attribute.localName,
        prefix: attribute.prefix ?? '',
        value: attribute.value,
      });
    }
    rec.set('attributes', attributes);
    const bindings = new Y.Map<string>();
    for (const binding of record.bindings) bindings.set(binding.prefix, binding.namespaceUri);
    rec.set('bindings', bindings);
    rec.set('children', new Y.Array<string>());
    return rec;
  }

  private makeText(value: string): Y.Map<unknown> {
    const rec = new Y.Map<unknown>();
    rec.set('kind', 'textValue');
    rec.set('deleted', false);
    rec.set('text', new Y.Text(value));
    return rec;
  }

  private elementRecord(logicalId: LogicalId, rec: Y.Map<unknown>): ElementRecord {
    const attributes: EncodedAttribute[] = [];
    const attrMap = rec.get('attributes');
    if (attrMap instanceof Y.Map) {
      attrMap.forEach((value) => {
        if (!value || typeof value !== 'object') return;
        const row = value as EncodedAttribute & { prefix?: string };
        attributes.push({
          namespaceUri: String(row.namespaceUri ?? ''),
          localName: String(row.localName ?? ''),
          prefix: row.prefix ? String(row.prefix) : undefined,
          value: String(row.value ?? ''),
        });
      });
    }
    const bindings: EncodedBinding[] = [];
    const bindingMap = rec.get('bindings');
    if (bindingMap instanceof Y.Map) {
      bindingMap.forEach((namespaceUri, prefix) => {
        if (typeof namespaceUri === 'string') bindings.push({ prefix, namespaceUri });
      });
    }
    const prefix = rec.get('prefix');
    return {
      logicalId,
      kind: String(rec.get('kind') ?? 'generic'),
      namespaceUri: String(rec.get('ns') ?? ''),
      localName: String(rec.get('localName') ?? ''),
      prefix: typeof prefix === 'string' && prefix.length > 0 ? prefix : undefined,
      attributes,
      bindings,
      childIds: this.childArray(logicalId).toArray(),
    };
  }

  private textOf(logicalId: LogicalId): Y.Text {
    const text = this.require(logicalId).get('text');
    if (!(text instanceof Y.Text)) throw new Error(`no text at ${logicalId}`);
    return text;
  }

  private attrMap(logicalId: LogicalId): Y.Map<unknown> {
    const attributes = this.require(logicalId).get('attributes');
    if (!(attributes instanceof Y.Map)) throw new Error(`no attributes at ${logicalId}`);
    return attributes;
  }

  private childArray(logicalId: LogicalId): Y.Array<string> {
    const children = this.require(logicalId).get('children');
    if (!(children instanceof Y.Array)) throw new Error(`no children at ${logicalId}`);
    return children;
  }

  private require(logicalId: LogicalId): Y.Map<unknown> {
    const rec = this.nodes.get(logicalId);
    if (!rec) throw new Error(`registry node ${logicalId} missing`);
    return rec;
  }
}

export function assertNoParentField(record: Y.Map<unknown>): void {
  if (record.has('parent') || record.has('parentId')) {
    throw new Error('registry record must not replicate a parent field');
  }
}

export function assertRegistryHasNoParentFields(backend: RegistryBackend): void {
  const nodes = backend.doc.getMap('spike-registry-nodes');
  nodes.forEach((value) => {
    if (isNodeMap(value)) assertNoParentField(value);
  });
}
