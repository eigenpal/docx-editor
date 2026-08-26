/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import type { CanonicalBinaryDescriptor } from '@docx-editor.dev/core/collaboration';
import { partNameKey } from '@docx-editor.dev/core/store';
import { yjsItemKey, type LogicalId, type NodeIdentityMeta, wordFacingIdsOf } from './identity.ts';
import {
  DEFAULT_DOCUMENT_LIMITS,
  mergeLimits,
  rejectDangerousKey,
  type DocumentLimits,
} from './limits.ts';
import {
  NODE_CHILDREN_FIELD,
  NODE_DELETED_FIELD,
  NODE_REPLACED_BY_FIELD,
  NODE_SHELL_FIELD,
  NODE_TEXT_FIELD,
  FIELD_SEP,
  attributeMapKey,
  bindingMapKey,
  childArrayOf,
  internNamespace,
  namespaceIdOf,
  isElementRecord,
  isNodeMap,
  isTextNodeMap,
  makeBinaryEntry,
  makeElementRecord,
  makePartEntry,
  makeRelationshipEntry,
  makeTextRecord,
  namespaceUriOf,
  packAttributeValue,
  packNodeShell,
  packageSchemaOf,
  parseAttributeMapKey,
  parseBindingMapKey,
  unpackAttributeValue,
  unpackNodeShell,
  type DirtyPaths,
  type ElementRecord,
  type EncodedAttribute,
  type EncodedBinding,
  type EncodedRelationship,
  type PackageSchema,
  type PartDirectoryEntry,
  type SharedRecord,
  type TextRecord,
} from './schema.ts';

function itemKeyOf(type: Y.Map<unknown>): string | null {
  const item = (type as unknown as { _item?: { id: { client: number; clock: number } } })._item;
  if (!item) return null;
  return yjsItemKey(item.id.client, item.id.clock);
}

function asTrackedType(type: unknown): Y.AbstractType<unknown> {
  return type as Y.AbstractType<unknown>;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function attrIdentity(namespaceId: string, localName: string): string {
  return `${namespaceId}${FIELD_SEP}${localName}`;
}

/** Child-ID arrays are the only replicated membership and order authority. */
export class DocumentRegistry {
  readonly schema: PackageSchema;
  readonly limits: DocumentLimits;
  /** First reachable preorder parent. Derived, never replicated. */
  private parentIndex = new Map<LogicalId, LogicalId>();
  /** Every child-array listing. Derived, never replicated. */
  private listings = new Map<LogicalId, Set<LogicalId>>();
  private childrenSnapshot = new Map<LogicalId, readonly LogicalId[]>();
  private adoptees = new Map<LogicalId, LogicalId[]>();
  private tombstoneSources = new Map<LogicalId, Set<LogicalId>>();
  private attributesByNode = new Map<LogicalId, Map<string, EncodedAttribute>>();
  private bindingsByNode = new Map<LogicalId, Map<string, EncodedBinding>>();
  private bulkLoad = 0;

  constructor(
    readonly doc: Y.Doc,
    limits?: Partial<DocumentLimits>
  ) {
    this.schema = packageSchemaOf(doc);
    this.limits = mergeLimits(limits);
    this.schema.nodes.observeDeep((events) => {
      if (this.bulkLoad > 0) return;
      this.applyChildArrayEvents(events);
    });
    this.schema.attributes.observe((event) => {
      if (this.bulkLoad > 0) return;
      this.applyAttributeMapEvent(event);
    });
    this.schema.bindings.observe((event) => {
      if (this.bulkLoad > 0) return;
      this.applyBindingMapEvent(event);
    });
  }

  beginBulkLoad(): void {
    this.bulkLoad += 1;
  }

  endBulkLoad(): void {
    this.bulkLoad = Math.max(0, this.bulkLoad - 1);
    if (this.bulkLoad === 0) this.rebuildDerivedIndexes();
  }

  trackedTypes(): readonly Y.AbstractType<unknown>[] {
    return [
      asTrackedType(this.schema.meta),
      asTrackedType(this.schema.nodes),
      asTrackedType(this.schema.parts),
      asTrackedType(this.schema.relationships),
      asTrackedType(this.schema.overrides),
      asTrackedType(this.schema.defaults),
      asTrackedType(this.schema.binaries),
      asTrackedType(this.schema.attributes),
      asTrackedType(this.schema.bindings),
    ];
  }

  encodeSnapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  encodeUpdate(remoteStateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, remoteStateVector);
  }

  partEntries(): readonly PartDirectoryEntry[] {
    const entries: PartDirectoryEntry[] = [];
    this.schema.parts.forEach((value, name) => {
      if (!isNodeMap(value) || rejectDangerousKey(name)) return;
      const rootLogicalId = readString(value.get('rootId'));
      if (rootLogicalId.length === 0) return;
      entries.push({
        name,
        id: readString(value.get('id')),
        rootLogicalId,
        contentType: readString(value.get('contentType')),
      });
    });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    return entries;
  }

  mainDocumentPart(): string {
    return readString(this.schema.meta.get('mainDocumentPart'));
  }

  record(logicalId: LogicalId): SharedRecord | null {
    if (rejectDangerousKey(logicalId)) return null;
    const rec = this.schema.nodes.get(logicalId);
    if (!rec) return null;
    if (isTextNodeMap(rec)) {
      const text = rec.get(NODE_TEXT_FIELD);
      const value = text instanceof Y.Text ? text.toString() : '';
      return { logicalId, kind: 'textValue', value } satisfies TextRecord;
    }
    return this.elementRecord(logicalId, rec);
  }

  parentOf(logicalId: LogicalId): LogicalId | null {
    return this.parentIndex.get(logicalId) ?? null;
  }

  identityMeta(logicalId: LogicalId): NodeIdentityMeta | null {
    const rec = this.schema.nodes.get(logicalId);
    if (!rec) return null;
    const shared = this.record(logicalId);
    const attributes = shared && isElementRecord(shared) ? shared.attributes : [];
    return {
      logicalId,
      yjsItemKey: itemKeyOf(rec),
      wordFacingIds: wordFacingIdsOf(attributes),
    };
  }

  isTombstoned(logicalId: LogicalId): boolean {
    return this.schema.nodes.get(logicalId)?.get(NODE_DELETED_FIELD) === true;
  }

  replacedByOf(logicalId: LogicalId): LogicalId | null {
    const value = this.schema.nodes.get(logicalId)?.get(NODE_REPLACED_BY_FIELD);
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  adoptedChildren(survivorId: LogicalId): readonly LogicalId[] {
    return this.adoptees.get(survivorId) ?? [];
  }

  listingParents(logicalId: LogicalId): readonly LogicalId[] {
    return [...(this.listings.get(logicalId) ?? [])];
  }

  allLogicalIds(): readonly LogicalId[] {
    return [...this.schema.nodes.keys()].filter((key) => !rejectDangerousKey(key));
  }

  nodeCount(): number {
    return this.schema.nodes.size;
  }

  putElement(record: Omit<ElementRecord, 'childIds'>): void {
    const namespaceId = internNamespace(
      this.schema.namespaces,
      record.namespaceUri,
      this.limits.maxStringLength
    );
    this.schema.nodes.set(
      record.logicalId,
      makeElementRecord({
        logicalId: record.logicalId,
        kind: record.kind,
        namespaceUri: record.namespaceUri,
        namespaceId,
        localName: record.localName,
        prefix: record.prefix,
      })
    );
    for (const attribute of record.attributes) {
      this.writeAttribute(record.logicalId, attribute, attribute.value);
    }
    for (const binding of record.bindings) {
      this.writeBinding(record.logicalId, binding.prefix, binding.namespaceUri);
    }
  }

  /**
   * Rename one existing element in place.
   *
   * A note conversion changes `w:footnoteReference` to `w:endnoteReference` and keeps the
   * node, its children and its attributes. Replacing the record instead would drop the
   * children, and minting a new id would leave the old element in the tree unchanged.
   */
  updateElementShell(
    logicalId: LogicalId,
    shell: {
      readonly kind: string;
      readonly namespaceUri: string;
      readonly localName: string;
      readonly prefix?: string;
    }
  ): void {
    const rec = this.require(logicalId);
    const namespaceId = internNamespace(
      this.schema.namespaces,
      shell.namespaceUri,
      this.limits.maxStringLength
    );
    rec.set(
      NODE_SHELL_FIELD,
      packNodeShell(shell.kind, namespaceId, shell.localName, shell.prefix ?? '')
    );
  }

  putText(logicalId: LogicalId, value: string): void {
    this.schema.nodes.set(logicalId, makeTextRecord(value));
  }

  spliceText(logicalId: LogicalId, utf16Start: number, deleteCount: number, insert: string): void {
    const text = this.textOf(logicalId);
    if (deleteCount > 0) text.delete(utf16Start, deleteCount);
    if (insert.length > 0) text.insert(utf16Start, insert);
  }

  setAttribute(
    logicalId: LogicalId,
    attribute: {
      readonly namespaceUri: string;
      readonly localName: string;
      readonly prefix?: string;
    },
    value: string | null
  ): void {
    if (value === null) {
      this.deleteAttribute(logicalId, attribute.namespaceUri, attribute.localName);
      return;
    }
    this.writeAttribute(logicalId, attribute, value);
  }

  setNamespaceBinding(logicalId: LogicalId, prefix: string, uri: string | null): void {
    if (uri === null) {
      this.deleteBinding(logicalId, prefix);
      return;
    }
    this.writeBinding(logicalId, prefix, uri);
  }

  spliceChildren(
    parentId: LogicalId,
    index: number,
    deleteCount: number,
    insertIds: readonly LogicalId[]
  ): void {
    const children = this.childArray(parentId);
    if (deleteCount > 0) children.delete(index, deleteCount);
    if (insertIds.length > 0) children.insert(index, [...insertIds]);
  }

  moveNode(nodeId: LogicalId, destParentId: LogicalId, destIndex: number): void {
    this.unlinkFromAllParents(nodeId);
    const dest = this.childArray(destParentId);
    dest.insert(Math.max(0, Math.min(destIndex, dest.length)), [nodeId]);
  }

  tombstone(logicalId: LogicalId, replacedBy?: LogicalId): void {
    this.unlinkFromAllParents(logicalId);
    const rec = this.require(logicalId);
    rec.set(NODE_DELETED_FIELD, true);
    if (replacedBy) rec.set(NODE_REPLACED_BY_FIELD, replacedBy);
  }

  putXmlPart(entry: PartDirectoryEntry): void {
    this.schema.parts.set(
      entry.name,
      makePartEntry(entry.id, entry.rootLogicalId, entry.contentType)
    );
  }

  deleteXmlPart(name: string): void {
    this.schema.parts.delete(name);
  }

  putRelationship(record: EncodedRelationship): void {
    let owner = this.schema.relationships.get(record.ownerPart);
    if (!owner) {
      owner = new Y.Map<Y.Map<unknown>>();
      this.schema.relationships.set(record.ownerPart, owner);
    }
    owner.set(record.id, makeRelationshipEntry(record));
  }

  deleteRelationship(ownerPart: string, relationshipId: string): void {
    this.schema.relationships.get(ownerPart)?.delete(relationshipId);
  }

  putContentTypeOverride(partName: string, mediaType: string): void {
    this.schema.overrides.set(partNameKey(partName), mediaType);
  }

  deleteContentTypeOverride(partName: string): void {
    this.schema.overrides.delete(partNameKey(partName));
  }

  putContentTypeDefault(extension: string, mediaType: string): void {
    this.schema.defaults.set(extension, mediaType);
  }

  putBinary(descriptor: CanonicalBinaryDescriptor): void {
    this.schema.binaries.set(descriptor.storageKey, makeBinaryEntry(descriptor));
  }

  deleteBinary(storageKey: string): void {
    this.schema.binaries.delete(storageKey);
  }

  relationships(): readonly EncodedRelationship[] {
    const records: EncodedRelationship[] = [];
    this.schema.relationships.forEach((ownerMap, ownerPart) => {
      if (!isNodeMap(ownerMap) || rejectDangerousKey(ownerPart)) return;
      ownerMap.forEach((value) => {
        if (!isNodeMap(value)) return;
        const id = readString(value.get('id'));
        const type = readString(value.get('type'));
        if (id.length === 0 || type.length === 0) return;
        const targetMode = value.get('targetMode') === 'External' ? 'External' : 'Internal';
        const order = value.get('order');
        records.push({
          ownerPart: readString(value.get('ownerPart')) || ownerPart,
          id,
          type,
          rawTarget: readString(value.get('rawTarget')),
          targetMode,
          order: typeof order === 'number' && Number.isSafeInteger(order) ? order : 0,
        });
      });
    });
    records.sort((left, right) => left.order - right.order);
    return records;
  }

  contentTypeOverrides(): ReadonlyMap<string, string> {
    const overrides = new Map<string, string>();
    this.schema.overrides.forEach((mediaType, partName) => {
      if (typeof mediaType === 'string' && !rejectDangerousKey(partName)) {
        // Journals captured the authored spelling (`/customXml/itemProps1.xml`).
        // Resolution looks up the OPC-folded key; keep the index that way.
        overrides.set(partNameKey(partName), mediaType);
      }
    });
    return overrides;
  }

  contentTypeDefaults(): ReadonlyMap<string, string> {
    const defaults = new Map<string, string>();
    this.schema.defaults.forEach((mediaType, extension) => {
      if (typeof mediaType === 'string' && !rejectDangerousKey(extension)) {
        defaults.set(extension, mediaType);
      }
    });
    return defaults;
  }

  binaries(): readonly CanonicalBinaryDescriptor[] {
    const descriptors: CanonicalBinaryDescriptor[] = [];
    this.schema.binaries.forEach((value, storageKey) => {
      if (!isNodeMap(value) || rejectDangerousKey(storageKey)) return;
      const digest = readString(value.get('digest'));
      const size = value.get('size');
      const mediaType = readString(value.get('mediaType'));
      const key = readString(value.get('storageKey')) || storageKey;
      if (digest.length === 0 || typeof size !== 'number') return;
      descriptors.push({ digest, size, mediaType, storageKey: key });
    });
    return descriptors;
  }

  hasNode(logicalId: LogicalId): boolean {
    return this.schema.nodes.has(logicalId);
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
          (event.changes.keys.has(NODE_DELETED_FIELD) ||
            event.changes.keys.has(NODE_REPLACED_BY_FIELD))
        ) {
          membershipChanged = true;
        }
      }
      if (logicalIds.size > 0 || membershipChanged) {
        onDirty({ logicalIds, membershipChanged, packageChanged: false });
      }
    };
    const sideMapHandler = (event: Y.YMapEvent<string>): void => {
      const logicalIds = new Set<LogicalId>();
      for (const key of event.changes.keys.keys()) {
        const parsed = parseAttributeMapKey(String(key)) ?? parseBindingMapKey(String(key));
        if (!parsed || rejectDangerousKey(parsed.logicalId)) continue;
        logicalIds.add(parsed.logicalId);
      }
      if (logicalIds.size > 0) {
        onDirty({ logicalIds, membershipChanged: false, packageChanged: false });
      }
    };
    const packageHandler = (): void => {
      onDirty({ logicalIds: new Set(), membershipChanged: false, packageChanged: true });
    };
    this.schema.nodes.observeDeep(handler);
    this.schema.attributes.observe(sideMapHandler);
    this.schema.bindings.observe(sideMapHandler);
    this.schema.parts.observeDeep(packageHandler);
    this.schema.relationships.observeDeep(packageHandler);
    this.schema.overrides.observe(packageHandler);
    this.schema.defaults.observe(packageHandler);
    this.schema.binaries.observeDeep(packageHandler);
    return () => {
      this.schema.nodes.unobserveDeep(handler);
      this.schema.attributes.unobserve(sideMapHandler);
      this.schema.bindings.unobserve(sideMapHandler);
      this.schema.parts.unobserveDeep(packageHandler);
      this.schema.relationships.unobserveDeep(packageHandler);
      this.schema.overrides.unobserve(packageHandler);
      this.schema.defaults.unobserve(packageHandler);
      this.schema.binaries.unobserveDeep(packageHandler);
    };
  }

  rebuildDerivedIndexes(): void {
    this.parentIndex = new Map();
    this.listings = new Map();
    this.childrenSnapshot = new Map();
    this.adoptees = new Map();
    this.tombstoneSources = new Map();
    this.attributesByNode = new Map();
    this.bindingsByNode = new Map();
    this.schema.nodes.forEach((rec, parentId) => {
      if (rejectDangerousKey(parentId)) return;
      const children = childArrayOf(rec);
      if (!children) return;
      const childIds = children.toArray();
      this.childrenSnapshot.set(parentId, childIds);
      for (const childId of childIds) this.addListing(childId, parentId);
    });
    this.schema.nodes.forEach((rec, id) => {
      if (rec.get(NODE_DELETED_FIELD) === true) this.syncAdoptee(id);
    });
    this.schema.attributes.forEach((packed, key) => {
      if (typeof packed !== 'string' || rejectDangerousKey(key)) return;
      const parsed = parseAttributeMapKey(key);
      if (!parsed || rejectDangerousKey(parsed.logicalId) || rejectDangerousKey(parsed.localName)) {
        return;
      }
      this.upsertIndexedAttribute(parsed.logicalId, parsed.namespaceId, parsed.localName, packed);
    });
    this.schema.bindings.forEach((namespaceId, key) => {
      if (typeof namespaceId !== 'string' || rejectDangerousKey(key)) return;
      const parsed = parseBindingMapKey(key);
      if (!parsed || rejectDangerousKey(parsed.logicalId) || rejectDangerousKey(parsed.prefix)) {
        return;
      }
      this.upsertIndexedBinding(parsed.logicalId, parsed.prefix, namespaceId);
    });
    this.assignFirstReachable(null);
  }

  assertNoParentFields(): void {
    this.schema.nodes.forEach((value) => {
      if (isNodeMap(value) && (value.has('parent') || value.has('parentId'))) {
        throw new Error('registry record must not replicate a parent field');
      }
    });
  }

  private applyChildArrayEvents(events: Y.YEvent<Y.AbstractType<unknown>>[]): void {
    const changed = new Set<LogicalId>();
    for (const event of events) {
      // A remote applyUpdate delivers a new element record with its children already filled.
      // Yjs does not emit a child-array event for that initial fill. Skipping it left
      // `parentOf` null, so an attribute-only journal could not dirty the part root and the
      // receiving replica kept the cached `commentsExtended.xml`.
      if (event.path.length === 0 && event.target instanceof Y.Map) {
        for (const [key, change] of event.changes.keys) {
          if (change.action === 'delete' || rejectDangerousKey(String(key))) continue;
          for (const childId of this.syncChildListings(String(key))) changed.add(childId);
        }
        continue;
      }
      if (event.target instanceof Y.Array && event.path.length > 0) {
        const parentId = String(event.path[0]);
        for (const childId of this.syncChildListings(parentId)) changed.add(childId);
        if (this.isTombstoned(parentId)) this.syncAdoptee(parentId);
        continue;
      }
      if (
        event.target instanceof Y.Map &&
        event.path.length === 1 &&
        (event.changes.keys.has(NODE_DELETED_FIELD) ||
          event.changes.keys.has(NODE_REPLACED_BY_FIELD))
      ) {
        this.syncAdoptee(String(event.path[0]));
      }
    }
    if (changed.size > 0) this.resolveParents(changed);
  }

  private applyAttributeMapEvent(event: Y.YMapEvent<string>): void {
    for (const [key, change] of event.changes.keys) {
      const parsed = parseAttributeMapKey(String(key));
      if (!parsed || rejectDangerousKey(parsed.logicalId) || rejectDangerousKey(parsed.localName)) {
        continue;
      }
      if (change.action === 'delete') {
        this.removeIndexedAttribute(parsed.logicalId, parsed.namespaceId, parsed.localName);
        continue;
      }
      const packed = this.schema.attributes.get(String(key));
      if (typeof packed !== 'string') continue;
      this.upsertIndexedAttribute(parsed.logicalId, parsed.namespaceId, parsed.localName, packed);
    }
  }

  private applyBindingMapEvent(event: Y.YMapEvent<string>): void {
    for (const [key, change] of event.changes.keys) {
      const parsed = parseBindingMapKey(String(key));
      if (!parsed || rejectDangerousKey(parsed.logicalId) || rejectDangerousKey(parsed.prefix)) {
        continue;
      }
      if (change.action === 'delete') {
        this.removeIndexedBinding(parsed.logicalId, parsed.prefix);
        continue;
      }
      const namespaceId = this.schema.bindings.get(String(key));
      if (typeof namespaceId !== 'string') continue;
      this.upsertIndexedBinding(parsed.logicalId, parsed.prefix, namespaceId);
    }
  }

  private syncChildListings(parentId: LogicalId): LogicalId[] {
    const rec = this.schema.nodes.get(parentId);
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
      const rec = this.schema.nodes.get(id);
      if (!rec || rec.get(NODE_DELETED_FIELD) === true) return;
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
    for (const part of this.partEntries()) walk(part.rootLogicalId, new Set());
  }

  private syncAdoptee(removedId: LogicalId): void {
    for (const sources of this.tombstoneSources.values()) sources.delete(removedId);
    const rec = this.schema.nodes.get(removedId);
    const survivor = rec?.get(NODE_REPLACED_BY_FIELD);
    const targets = new Set<LogicalId>();
    if (
      rec?.get(NODE_DELETED_FIELD) === true &&
      typeof survivor === 'string' &&
      survivor.length > 0
    ) {
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

  private isContentWitness(id: LogicalId): boolean {
    const record = this.record(id);
    if (!record) return false;
    if (!isElementRecord(record)) return record.kind === 'textValue';
    return !record.kind.endsWith('Properties');
  }

  private recomputeAdoptees(survivorId: LogicalId): void {
    const extras: LogicalId[] = [];
    for (const tombstoneId of this.tombstoneSources.get(survivorId) ?? []) {
      const rec = this.schema.nodes.get(tombstoneId);
      if (!rec) continue;
      for (const childId of childArrayOf(rec)?.toArray() ?? []) {
        if (this.isTombstoned(childId) || !this.schema.nodes.has(childId)) continue;
        // A join drops the removed paragraph's `w:pPr`. Adopting that property node onto the
        // survivor produced two `paragraphProperties` children, which `known-node-invariant`
        // refused, so the receiving replica never installed the joined tree.
        if (!this.isContentWitness(childId)) continue;
        extras.push(childId);
      }
    }
    if (extras.length > 0) this.adoptees.set(survivorId, extras);
    else this.adoptees.delete(survivorId);
  }

  unlinkFromAllParents(id: LogicalId): void {
    const parents = [...(this.listings.get(id) ?? [])];
    if (parents.length === 0) {
      this.schema.nodes.forEach((rec) => {
        const children = childArrayOf(rec);
        if (children) this.removeFromArray(children, id);
      });
      return;
    }
    for (const parentId of parents) {
      const rec = this.schema.nodes.get(parentId);
      const children = rec ? childArrayOf(rec) : null;
      if (children) this.removeFromArray(children, id);
    }
  }

  private removeFromArray(array: Y.Array<string>, id: string): void {
    for (let index = array.length - 1; index >= 0; index -= 1) {
      if (array.get(index) === id) array.delete(index, 1);
    }
  }

  private writeAttribute(
    logicalId: LogicalId,
    attribute: {
      readonly namespaceUri: string;
      readonly localName: string;
      readonly prefix?: string;
    },
    value: string
  ): void {
    if (rejectDangerousKey(logicalId) || rejectDangerousKey(attribute.localName)) return;
    const namespaceId = internNamespace(
      this.schema.namespaces,
      attribute.namespaceUri,
      this.limits.maxStringLength
    );
    const key = attributeMapKey(logicalId, namespaceId, attribute.localName);
    if (rejectDangerousKey(key)) return;
    this.schema.attributes.set(key, packAttributeValue(attribute.prefix ?? '', value));
  }

  private deleteAttribute(logicalId: LogicalId, namespaceUri: string, localName: string): void {
    const namespaceId = namespaceIdOf(namespaceUri);
    this.schema.attributes.delete(attributeMapKey(logicalId, namespaceId, localName));
  }

  private writeBinding(logicalId: LogicalId, prefix: string, uri: string): void {
    if (rejectDangerousKey(logicalId) || rejectDangerousKey(prefix)) return;
    const namespaceId = internNamespace(this.schema.namespaces, uri, this.limits.maxStringLength);
    const key = bindingMapKey(logicalId, prefix);
    if (rejectDangerousKey(key)) return;
    this.schema.bindings.set(key, namespaceId);
  }

  private deleteBinding(logicalId: LogicalId, prefix: string): void {
    this.schema.bindings.delete(bindingMapKey(logicalId, prefix));
  }

  private upsertIndexedAttribute(
    logicalId: LogicalId,
    namespaceId: string,
    localName: string,
    packed: string
  ): void {
    const { prefix, value } = unpackAttributeValue(packed);
    let bucket = this.attributesByNode.get(logicalId);
    if (!bucket) {
      bucket = new Map();
      this.attributesByNode.set(logicalId, bucket);
    }
    bucket.set(attrIdentity(namespaceId, localName), {
      namespaceUri: namespaceUriOf(this.schema.namespaces, namespaceId),
      localName,
      prefix: prefix.length > 0 ? prefix : undefined,
      value,
    });
  }

  private removeIndexedAttribute(
    logicalId: LogicalId,
    namespaceId: string,
    localName: string
  ): void {
    const bucket = this.attributesByNode.get(logicalId);
    if (!bucket) return;
    bucket.delete(attrIdentity(namespaceId, localName));
    if (bucket.size === 0) this.attributesByNode.delete(logicalId);
  }

  private upsertIndexedBinding(logicalId: LogicalId, prefix: string, namespaceId: string): void {
    let bucket = this.bindingsByNode.get(logicalId);
    if (!bucket) {
      bucket = new Map();
      this.bindingsByNode.set(logicalId, bucket);
    }
    bucket.set(prefix, {
      prefix,
      namespaceUri: namespaceUriOf(this.schema.namespaces, namespaceId),
    });
  }

  private removeIndexedBinding(logicalId: LogicalId, prefix: string): void {
    const bucket = this.bindingsByNode.get(logicalId);
    if (!bucket) return;
    bucket.delete(prefix);
    if (bucket.size === 0) this.bindingsByNode.delete(logicalId);
  }

  private elementRecord(logicalId: LogicalId, rec: Y.Map<unknown>): ElementRecord {
    const shell = unpackNodeShell(readString(rec.get(NODE_SHELL_FIELD)));
    const attributes = [...(this.attributesByNode.get(logicalId)?.values() ?? [])];
    const bindings = [...(this.bindingsByNode.get(logicalId)?.values() ?? [])];
    return {
      logicalId,
      kind: shell.kind,
      namespaceUri: namespaceUriOf(this.schema.namespaces, shell.namespaceId),
      localName: shell.localName,
      prefix: shell.prefix.length > 0 ? shell.prefix : undefined,
      attributes,
      bindings,
      childIds: this.childArray(logicalId).toArray(),
    };
  }

  textOf(logicalId: LogicalId): Y.Text {
    const text = this.require(logicalId).get(NODE_TEXT_FIELD);
    if (!(text instanceof Y.Text)) throw new Error(`no text at ${logicalId}`);
    return text;
  }

  childArray(logicalId: LogicalId): Y.Array<string> {
    const children = this.require(logicalId).get(NODE_CHILDREN_FIELD);
    if (!(children instanceof Y.Array)) throw new Error(`no children at ${logicalId}`);
    return children;
  }

  private require(logicalId: LogicalId): Y.Map<unknown> {
    const rec = this.schema.nodes.get(logicalId);
    if (!rec) throw new Error(`registry node ${logicalId} missing`);
    return rec;
  }
}

export const DOCUMENT_LIMITS = DEFAULT_DOCUMENT_LIMITS;
