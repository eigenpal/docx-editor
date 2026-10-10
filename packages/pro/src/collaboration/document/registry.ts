/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { subscribeTextReads } from './registry-text-reads.ts';
import { TEXT_DELETIONS_KEY } from './paragraph-text-deletions.ts';
import { keepFormattingMarkers } from './yjs-items.ts';
import { compareDocumentOrder } from './registry-document-order.ts';
import { RegistryHistory } from './registry-history.ts';
import { observeDirtyPaths } from './registry-dirty-paths.ts';
import { captureInsertionBoundary } from './split-text-boundaries.ts';
import { SplitTextSources, type SplitTextRange } from './split-text-sources.ts';
import * as Y from 'yjs';
import type { CanonicalBinaryDescriptor } from '@docx-editor.dev/core/collaboration/replication';
import { partNameKey } from '@docx-editor.dev/core/store';
import { type LogicalId, type NodeIdentityMeta, wordFacingIdsOf } from './identity.ts';
import { SplitDedupIndex, type SplitTextOverlays } from './split-dedup.ts';
import { runIsPresent } from './run-text-reads.ts';
import { mergeLimits, rejectDangerousKey, type DocumentLimits } from './limits.ts';
import {
  NODE_CHILDREN_FIELD,
  NODE_DELETED_FIELD,
  NODE_UNDONE_FIELD,
  NODE_REPLACED_BY_FIELD,
  NODE_SHELL_FIELD,
  NODE_TEXT_FIELD,
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
  nodeRecordReplacedBy,
  nodeRecordSplitFrom,
  nodeRecordSplitLineage,
  nodeRecordTombstoned,
  packNodeShell,
  packageSchemaOf,
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
import { readRelationships, relationshipKey } from './relationship-store.ts';
import { observeRegistrySchema } from './registry-observers.ts';
import {
  assignFirstReachableParents,
  placeParents,
  type ContestContext,
} from './registry-contested-placement.ts';
import {
  applyAttributeMapEvent,
  applyBindingMapEvent,
  deleteSharedAttribute,
  deleteSharedBinding,
  indexSideMaps,
  writeSharedAttribute,
  writeSharedBinding,
} from './registry-side-maps.ts';
import {
  asTrackedType,
  assertNoParentFieldsIn,
  elementRecordOf,
  isLogicalIdKey,
  itemKeyOf,
  keyId,
  nodeKindOf,
  nodeShapeOf,
  readString,
  type NodeShape,
} from './registry-node-reads.ts';
import { addListing, syncChildListings, type ChildListings } from './registry-listings.ts';
import { AdoptionIndex } from './registry-adoption.ts';
import { InlineIndex } from './paragraph-inline-index.ts';
import { INLINE_FIELD } from './paragraph-text.ts';
import {
  readBinaries,
  readContentTypeDefaults,
  readContentTypeOverrides,
  readPartEntries,
} from './registry-package-reads.ts';
import { retainsNumberingInfrastructure } from './undo-numbering.ts';
import { nodeRecordDeleteFilter } from './undo-delete-filter.ts';

/** Child-ID arrays are the only replicated membership and order authority. */
export class DocumentRegistry {
  readonly schema: PackageSchema;
  readonly limits: DocumentLimits;
  /** First reachable preorder parent. Derived, never replicated. */
  private parentIndex = new Map<LogicalId, LogicalId>();
  readonly history = new RegistryHistory();
  /** Ids more than one parent lists. Their placement can move without their listings moving. */
  private contested = new Set<LogicalId>();
  /** Parents a contested child moved from or to since the materializer last asked. */
  private readonly reparented = new Set<LogicalId>();
  /** Every child-array listing. Derived, never replicated. */
  private listings = new Map<LogicalId, Set<LogicalId>>();
  private childrenSnapshot = new Map<LogicalId, readonly LogicalId[]>();
  private readonly adoption: AdoptionIndex;
  /** Which paragraph's shared text holds each inline ID. */
  readonly inline: InlineIndex;
  private readonly stopMarks: () => void;
  private readonly stopKeepingMarkers: () => void;
  private readonly markListeners = new Set<(ids: ReadonlySet<LogicalId>) => void>();
  private attributesByNode = new Map<LogicalId, Map<string, EncodedAttribute>>();
  private bindingsByNode = new Map<LogicalId, Map<string, EncodedBinding>>();
  /** Deterministic dedup of concurrent format splits (#581). */
  private readonly splitDedup: SplitDedupIndex;
  private readonly splitTextSources: SplitTextSources;
  private bulkLoad = 0;
  private unobservedWrites = 0;
  /** Node total as of the last observed event batch. Negative means "not counted yet". */
  private nodeCountCache = -1;
  /** Nodes written since that batch. Yjs delivers a nested transaction's events late. */
  private pendingNodeAdds = 0;
  /** Relationship-record total as of the last decode. Negative means "not counted yet". */
  private relationshipCountCache = -1;
  /** Part-entry total as of the last read. Negative means "not counted yet". */
  private partCountCache = -1;

  private readonly stopObserving: () => void;

  constructor(
    readonly doc: Y.Doc,
    limits?: Partial<DocumentLimits>
  ) {
    this.stopKeepingMarkers = keepFormattingMarkers(doc);
    this.schema = packageSchemaOf(doc);
    this.limits = mergeLimits(limits);
    this.splitDedup = new SplitDedupIndex(this.schema.nodes);
    // A paragraph no parent lists counts as deleted: an undo of a split unlists the new one.
    this.inline = new InlineIndex(
      this.schema.nodes,
      this.limits,
      (id) => this.isTombstoned(id) || !this.parentIndex.has(id),
      (a, b) =>
        compareDocumentOrder(
          {
            parentOf: (id) => this.parentIndex.get(id),
            childrenOf: (id) => this.childrenSnapshot.get(id),
            maxDepth: this.limits.maxTreeDepth,
          },
          a,
          b
        )
    );
    this.adoption = new AdoptionIndex(this.schema.nodes, {
      kindOf: (id) => this.kindOf(id),
      isTombstoned: (id) => this.isTombstoned(id),
      listersOf: (id) => this.listings.get(id) ?? [],
    });
    this.splitTextSources = new SplitTextSources(this.schema.nodes, this.doc, this.limits);
    // A mark or a deletion record can change without its text: an undo's restore marks, or a
    // peer's update that brings them after their text. Those paragraphs read again and rebuild.
    this.stopMarks = subscribeTextReads(doc, {
      inline: this.inline,
      loading: () => this.bulkLoad > 0,
      changed: (ids) => {
        for (const listener of this.markListeners) listener(ids);
      },
    });
    this.stopObserving = observeRegistrySchema(this.schema, {
      onNodeEvents: (events) => {
        if (this.bulkLoad > 0) return;
        this.applyChildArrayEvents(events);
      },
      onAttributeEvent: (event) => {
        if (this.bulkLoad > 0) return;
        this.applyAttributeMapEvent(event);
      },
      onBindingEvent: (event) => {
        if (this.bulkLoad > 0) return;
        this.applyBindingMapEvent(event);
      },
      // Dropping a stale count is safe at any time, so these run even during a bulk load. The
      // deep observers catch a peer on an earlier build writing inside a nested owner map.
      onRelationshipChange: () => {
        this.relationshipCountCache = -1;
      },
      onPartChange: () => {
        this.partCountCache = -1;
      },
    });
  }

  /**
   * Detach this registry's observers from the shared document.
   *
   * The registry does not own `doc`, so teardown has to give the observers back. A registry
   * left observing outlives its consumer: every later transaction pays its handlers, and its
   * derived indexes retain the whole tree. `readCollaborationDocument` builds one registry
   * per call on a long-lived server document, so this detach is load-bearing.
   */
  destroy(): void {
    this.stopObserving();
    this.stopMarks();
    this.stopKeepingMarkers();
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
      // An undo of a deletion withdraws its record, so the text shows again.
      asTrackedType(this.doc.getMap(TEXT_DELETIONS_KEY)),
    ];
  }

  /**
   * The `deleteFilter` an undo manager over {@link trackedTypes} has to be built with.
   *
   * Undo reverses `nodes.set(id, record)` by deleting the record, and a deleted record takes a
   * peer's concurrently typed characters with it, unreachably. See
   * {@link nodeRecordDeleteFilter}. Omitting this is silent data loss, not a missing nicety.
   */
  undoDeleteFilter(): (item: Y.Item) => boolean {
    const nodeFilter = nodeRecordDeleteFilter(this.schema.nodes);
    return (item) => !retainsNumberingInfrastructure(this.schema, item) && nodeFilter(item);
  }

  encodeSnapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  encodeUpdate(remoteStateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, remoteStateVector);
  }

  partEntries(): readonly PartDirectoryEntry[] {
    return readPartEntries(this.schema.parts);
  }

  /**
   * How many XML parts the directory holds.
   *
   * {@link partEntries} decodes and sorts the whole directory. The journal's part cap read it
   * once per `putXmlPart` effect, so admitting N parts walked the directory N times. The
   * count is cached; any write to the part map, local or remote, drops it.
   */
  partCount(): number {
    if (this.partCountCache < 0) this.partCountCache = this.partEntries().length;
    return this.partCountCache;
  }

  /**
   * How many relationship records shared state holds.
   *
   * {@link relationships} decodes and sorts every record. The journal's relationship cap read
   * it once per `putRelationship` effect, so pasting N images decoded the map N times. The
   * count is cached; any write to the relationship map, local or remote, drops it.
   */
  relationshipCount(): number {
    if (this.relationshipCountCache < 0) {
      this.relationshipCountCache = this.relationships().length;
    }
    return this.relationshipCountCache;
  }

  mainDocumentPart(): string {
    return readString(this.schema.meta.get('mainDocumentPart'));
  }

  record(logicalId: LogicalId): SharedRecord | null {
    if (rejectDangerousKey(logicalId)) return null;
    const rec = this.schema.nodes.get(logicalId);
    // A peer can plant a scalar here; treat it as no such node (see #567).
    if (!isNodeMap(rec)) return null;
    if (isTextNodeMap(rec)) {
      const text = rec.get(NODE_TEXT_FIELD);
      const value = text instanceof Y.Text ? text.toString() : '';
      return { logicalId, kind: 'textValue', value } satisfies TextRecord;
    }
    return elementRecordOf(
      logicalId,
      rec,
      this.schema,
      [...(this.attributesByNode.get(logicalId)?.values() ?? [])],
      [...(this.bindingsByNode.get(logicalId)?.values() ?? [])]
    );
  }

  parentOf(logicalId: LogicalId): LogicalId | null {
    // Inline content and embedded nodes are listed by no child array; their paragraph's
    // shared text holds them.
    return this.parentIndex.get(logicalId) ?? this.inline.owner(logicalId);
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
    return nodeRecordTombstoned(this.schema.nodes.get(logicalId));
  }

  replacedByOf(logicalId: LogicalId): LogicalId | null {
    return nodeRecordReplacedBy(this.schema.nodes.get(logicalId));
  }

  adoptedChildren(survivorId: LogicalId): readonly LogicalId[] {
    return this.adoption.adoptees.get(survivorId) ?? [];
  }

  /**
   * Every survivor that adopts children from a tombstone, and what it adopts.
   *
   * Adoption is DERIVED from the tombstone edge and is not a child array, so tombstoning a
   * node dirties the tombstone alone while the survivor is the node that has to grow a
   * child. A consumer that caches per node has to compare this index, or the adopted
   * children silently disappear from the survivor.
   */
  adoptionIndex(): ReadonlyMap<LogicalId, readonly LogicalId[]> {
    return this.adoption.adoptees;
  }

  /**
   * True when shared state has ever interned this namespace URI.
   *
   * Every element and attribute interns its namespace on write, so a URI absent from the
   * table cannot appear anywhere in the document. That answers "does this document use
   * feature X at all" without a walk over every node.
   */
  hasNamespace(uri: string): boolean {
    return this.schema.namespaces.get(namespaceIdOf(uri)) === uri;
  }

  /**
   * Say that shared state was written through this registry.
   *
   * Every derived index here, and every dirty set an observer builds, is maintained from Yjs
   * EVENTS. Yjs delivers the events of a transaction opened during another transaction's
   * cleanup only after that cleanup finishes — which is exactly what a queued local journal
   * flushed on arrival of a remote update does. Between the write and the delivery, shared
   * state holds the edit and every index still describes the state before it. A consumer that
   * trusts the indexes in that window drops the edit.
   */
  noteWrite(): void {
    this.unobservedWrites += 1;
  }

  /** True while a write through this registry is waiting for its Yjs events. */
  hasUnobservedWrites(): boolean {
    return this.unobservedWrites > 0;
  }

  listingParents(logicalId: LogicalId): readonly LogicalId[] {
    return [...(this.listings.get(logicalId) ?? [])];
  }

  allLogicalIds(): readonly LogicalId[] {
    return [...this.schema.nodes.keys()].filter(isLogicalIdKey);
  }

  /**
   * How many nodes shared state holds.
   *
   * `Y.Map.size` walks every key and allocates an array to measure it, and the journal's
   * node cap reads this once per commit. That made a keystroke cost the whole document:
   * 630us on a 200-page fixture, against a whole attached commit of about 4ms. The count is
   * maintained instead, from the same events every other derived index here is built from,
   * plus the writes those events have not described yet.
   */
  nodeCount(): number {
    if (this.nodeCountCache < 0) this.nodeCountCache = this.schema.nodes.size;
    return this.nodeCountCache + this.pendingNodeAdds;
  }

  /** The quantities a bound check reads, without the attribute arrays {@link record} builds. */
  nodeShape(logicalId: LogicalId): NodeShape | null {
    if (rejectDangerousKey(logicalId)) return null;
    return nodeShapeOf(this.schema.nodes, logicalId);
  }

  /** One node's kind, without building its text. */
  kindOf(logicalId: LogicalId): string | null {
    if (rejectDangerousKey(logicalId)) return null;
    return nodeKindOf(this.schema.nodes, logicalId);
  }

  private noteNodeWrite(logicalId: LogicalId): void {
    if (!this.schema.nodes.has(logicalId)) this.pendingNodeAdds += 1;
  }

  putElement(record: Omit<ElementRecord, 'childIds'>): void {
    this.noteNodeWrite(record.logicalId);
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
      writeSharedAttribute(
        this.schema,
        this.limits.maxStringLength,
        record.logicalId,
        attribute,
        attribute.value
      );
    }
    for (const binding of record.bindings) {
      writeSharedBinding(
        this.schema,
        this.limits.maxStringLength,
        record.logicalId,
        binding.prefix,
        binding.namespaceUri
      );
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
    this.noteNodeWrite(logicalId);
    this.schema.nodes.set(logicalId, makeTextRecord(value));
  }

  spliceText(logicalId: LogicalId, utf16Start: number, deleteCount: number, insert: string): void {
    const range = this.splitTextSources.range(logicalId);
    const restoreBoundary = captureInsertionBoundary(
      this.schema.nodes,
      this.splitTextSources,
      logicalId,
      range,
      utf16Start,
      insert
    );
    const text = range?.text ?? this.textOf(logicalId);
    const start = (range?.start ?? 0) + utf16Start;
    // A shared-text insert skips forward past deleted characters, so a replacement written
    // after its delete sat behind the text it replaced: a peer typing at that place landed
    // between them, and undo put the old text before the peer's words. Plain text inserts
    // first. Split-text slices keep delete-first, which their boundary anchors are built on.
    if (range === null && this.splitTextSources.isPlain(logicalId)) {
      if (insert.length > 0) text.insert(start, insert);
      if (deleteCount > 0) text.delete(start + insert.length, deleteCount);
    } else {
      if (deleteCount > 0) text.delete(start, deleteCount);
      if (insert.length > 0) text.insert(start, insert);
    }
    restoreBoundary?.();
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
      deleteSharedAttribute(this.schema, logicalId, attribute.namespaceUri, attribute.localName);
      return;
    }
    writeSharedAttribute(this.schema, this.limits.maxStringLength, logicalId, attribute, value);
  }

  setNamespaceBinding(logicalId: LogicalId, prefix: string, uri: string | null): void {
    if (uri === null) {
      deleteSharedBinding(this.schema, logicalId, prefix);
      return;
    }
    writeSharedBinding(this.schema, this.limits.maxStringLength, logicalId, prefix, uri);
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

  recordRunSplit(root: LogicalId, replaced: LogicalId, runs: readonly LogicalId[]): void {
    this.splitDedup.record(root, replaced, runs);
  }

  /** The run a given run split off from, or null — the caller resolves the chain (#581). */
  splitOriginOf(logicalId: LogicalId): LogicalId | null {
    return nodeRecordSplitFrom(this.schema.nodes.get(logicalId));
  }

  /** The split a run's branch descends from, or null when no concurrent split made it. */
  splitLineageOf(logicalId: LogicalId): LogicalId | null {
    return nodeRecordSplitLineage(this.schema.nodes.get(logicalId));
  }

  /** Runs a concurrent format split superseded and this replica must not materialize (#581). */
  replacementLoserRuns(): ReadonlySet<LogicalId> {
    if (this.hasUnobservedWrites()) this.splitDedup.invalidate();
    return this.splitDedup.loserRuns({ isPresent: (id) => runIsPresent(this, id) });
  }

  splitTextRange(id: LogicalId): SplitTextRange | null {
    return this.splitTextSources.range(id);
  }

  splitTextPending(id: LogicalId): boolean {
    return this.splitTextSources.isPending(id);
  }

  projectedTextValue(id: LogicalId): string | null {
    return this.splitTextSources.value(id);
  }

  registerSplitText(product: LogicalId, source: LogicalId, start: number, end: number): void {
    this.splitTextSources.register(product, source, start, end);
  }

  normalizeRestoredSplitTextAnchors(): void {
    this.splitTextSources.normalizeRestoredAnchors();
  }

  concurrentSplitTextOverlays(): SplitTextOverlays {
    return this.splitTextSources.overlays();
  }

  /**
   * Drop from a node's child array the children this replica had already seen there.
   *
   * Adoption rescues what a CONCURRENT peer put inside a node this replica tombstoned. It must
   * not rescue what this replica's own edit superseded. A run split leaves the replaced `w:t`
   * listed under the run the edit dropped, and adopting it puts the pre-edit text back beside
   * the new text on every replica but the author's.
   *
   * Each id is deleted as many times as the caller saw it, newest occurrence first, so the
   * delete stays item-level: an id a peer inserted concurrently is a different Yjs item, keeps
   * its place in the array, and still reaches the survivor.
   */
  unlistChildren(parentId: LogicalId, childIds: readonly LogicalId[]): void {
    if (childIds.length === 0) return;
    const rec = this.schema.nodes.get(parentId);
    const children = rec ? childArrayOf(rec) : null;
    if (!children) return;
    const remaining = new Map<LogicalId, number>();
    for (const childId of childIds) remaining.set(childId, (remaining.get(childId) ?? 0) + 1);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const value = children.get(index);
      const left = remaining.get(value) ?? 0;
      if (left === 0) continue;
      remaining.set(value, left - 1);
      children.delete(index, 1);
    }
  }

  putXmlPart(entry: PartDirectoryEntry): void {
    // Dropped here as well as in the observer: a nested transaction delivers its events late,
    // and a queued journal can read the count inside that window.
    this.partCountCache = -1;
    this.schema.parts.set(
      entry.name,
      makePartEntry(entry.id, entry.rootLogicalId, entry.contentType)
    );
  }

  deleteXmlPart(name: string): void {
    this.partCountCache = -1;
    this.schema.parts.delete(name);
  }

  /**
   * Write one relationship under a key of its own.
   *
   * Keying by part alone meant two peers adding the FIRST relationship to the same part both
   * took the "create the owner map" branch, and a nested `Y.Map` at one key resolves
   * last-writer-wins: the loser's map went away with its rId inside it, leaving a broken image
   * or a dead hyperlink that no later edit could repair. Part AND id means concurrent writers
   * touch different keys and cannot collide. Two writers of the same id still resolve
   * last-writer-wins, which is the honest answer to one id with two targets.
   *
   * The value stays a map of entries, so a reader also sees owner maps written by a peer on an
   * earlier build.
   */
  putRelationship(record: EncodedRelationship): void {
    if (rejectDangerousKey(record.ownerPart) || rejectDangerousKey(record.id)) return;
    this.relationshipCountCache = -1;
    const holder = new Y.Map<Y.Map<unknown>>();
    holder.set(record.id, makeRelationshipEntry(record));
    this.schema.relationships.set(relationshipKey(record.ownerPart, record.id), holder);
  }

  deleteRelationship(ownerPart: string, relationshipId: string): void {
    this.relationshipCountCache = -1;
    this.schema.relationships.delete(relationshipKey(ownerPart, relationshipId));
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
    return readRelationships(this.schema.relationships);
  }

  contentTypeOverrides(): ReadonlyMap<string, string> {
    return readContentTypeOverrides(this.schema.overrides);
  }

  contentTypeDefaults(): ReadonlyMap<string, string> {
    return readContentTypeDefaults(this.schema.defaults);
  }

  binaries(): readonly CanonicalBinaryDescriptor[] {
    return readBinaries(this.schema.binaries);
  }

  hasNode(logicalId: LogicalId): boolean {
    return this.schema.nodes.has(logicalId);
  }

  /** Whether a view shows the node in a child list: it arrived, is live, and its text is not pending. */
  showsAsChild(logicalId: LogicalId): boolean {
    const record = this.schema.nodes.get(logicalId);
    if (record === undefined || nodeRecordTombstoned(record)) return false;
    return !(isTextNodeMap(record) && this.splitTextPending(logicalId));
  }

  observeDirty(onDirty: (paths: DirtyPaths) => void): () => void {
    const stopPaths = observeDirtyPaths(this.schema, onDirty);
    const onMarks = (logicalIds: ReadonlySet<LogicalId>): void =>
      onDirty({ logicalIds, membershipChanged: false, packageChanged: false });
    this.markListeners.add(onMarks);
    return () => {
      stopPaths();
      this.markListeners.delete(onMarks);
    };
  }

  rebuildDerivedIndexes(): void {
    this.unobservedWrites = 0;
    this.nodeCountCache = -1;
    this.pendingNodeAdds = 0;
    this.relationshipCountCache = -1;
    this.partCountCache = -1;
    this.parentIndex = new Map();
    this.listings = new Map();
    this.childrenSnapshot = new Map();
    this.adoption.reset();
    this.attributesByNode = new Map();
    this.bindingsByNode = new Map();
    this.splitDedup.reset();
    this.splitTextSources.reset();
    this.schema.nodes.forEach((rec, parentId) => {
      if (!isLogicalIdKey(parentId)) return;
      const children = childArrayOf(rec);
      if (!children) return;
      const childIds = children.toArray();
      this.childrenSnapshot.set(parentId, childIds);
      for (const childId of childIds) addListing(this.listingIndex(), childId, parentId);
    });
    this.schema.nodes.forEach((rec, id) => {
      if (nodeRecordTombstoned(rec)) this.adoption.sync(keyId(id));
      this.splitDedup.indexExisting(keyId(id));
    });
    indexSideMaps(this.schema, this.attributesByNode, this.bindingsByNode);
    assignFirstReachableParents(this.placementContext(), null);
    this.contested = new Set();
    for (const [id, listed] of this.listings) if (listed.size > 1) this.contested.add(id);
    // Children no part reaches — under a tombstone, say — get their parent the way child-array
    // events assign it. Otherwise a cold joiner or export resolved them to no parent, counted
    // a concurrently split run as absent, and showed text every live replica hides.
    const unplaced = new Set<LogicalId>();
    for (const id of this.listings.keys()) if (!this.parentIndex.has(id)) unplaced.add(id);
    if (unplaced.size > 0) this.resolveParents(unplaced);
    // Last: a paragraph no parent lists reads as deleted, so placement comes first.
    this.inline.rebuild();
  }

  assertNoParentFields(): void {
    assertNoParentFieldsIn(this.schema.nodes);
  }

  private applyChildArrayEvents(events: Y.YEvent<Y.AbstractType<unknown>>[]): void {
    this.unobservedWrites = 0;
    // These events describe every write, local or remote, so they carry the whole count.
    this.pendingNodeAdds = 0;
    const changed = new Set<LogicalId>();
    let structural = false;
    for (const event of events) {
      // Text and boundary metadata do not change which split branches are reachable.
      if (
        !(event.target instanceof Y.Text) &&
        (event.path.length === 0 ||
          event.target instanceof Y.Array ||
          (event.target instanceof Y.Map &&
            [...event.changes.keys.keys()].some((key) =>
              ['deleted', 'replacedBy', 'splitFrom', 'splitLineage', 'children'].includes(
                String(key)
              )
            )))
      )
        this.splitDedup.invalidate();
      if (event.path.length > 0) this.splitTextSources.noteChanged(keyId(event.path[0]!));
      if (event.target instanceof Y.Text && event.path[1] === INLINE_FIELD) {
        this.inline.paragraphChanged(keyId(event.path[0]!));
        continue;
      }
      // A record's shared text can arrive after the record itself, in a later update, and a
      // deleted paragraph's text shows nothing, or only what follows a move out of it.
      if (
        event.target instanceof Y.Map &&
        event.path.length === 1 &&
        (event.changes.keys.has(INLINE_FIELD) || event.changes.keys.has(NODE_DELETED_FIELD))
      ) {
        this.inline.paragraphChanged(keyId(event.path[0]!));
      }
      // A remote applyUpdate delivers a new element record with its children already filled.
      // Yjs does not emit a child-array event for that initial fill. Skipping it left
      // `parentOf` null, so an attribute-only journal could not dirty the part root and the
      // receiving replica kept the cached `commentsExtended.xml`.
      if (event.path.length === 0 && event.target instanceof Y.Map) {
        structural = true;
        for (const [key, change] of event.changes.keys) {
          if (this.nodeCountCache >= 0 && change.action !== 'update') {
            this.nodeCountCache += change.action === 'add' ? 1 : -1;
          }
          if (rejectDangerousKey(String(key))) continue;
          if (change.action === 'delete') {
            // A removed record's text no longer holds IDs or copies.
            this.inline.paragraphChanged(keyId(key));
            continue;
          }
          // A run a peer split off carries its origin; index it so the loser-dedup sees the
          // concurrent split the moment the remote record arrives, not only after a rebuild.
          this.splitDedup.indexExisting(keyId(key));
          // A new record can be the source a waiting alias names, so its aliases re-read too.
          this.splitTextSources.noteChanged(keyId(key));
          for (const childId of this.syncChildListings(keyId(key))) changed.add(childId);
          this.inline.paragraphChanged(keyId(key));
          this.inline.recordArrived(keyId(key));
          // A record can arrive already joined into another; its survivor adopts from it.
          if (this.isTombstoned(keyId(key))) this.adoption.sync(keyId(key));
          this.adoption.recomputeListerSurvivors(keyId(key));
        }
        continue;
      }
      if (
        event.target instanceof Y.Map &&
        event.path.length === 1 &&
        event.changes.keys.has(NODE_UNDONE_FIELD)
      ) {
        this.history.noteMarkChanged(keyId(event.path[0]!));
      }
      // Undo retains record containers. Redo restores scalar provenance on those existing
      // maps, so a late joiner must index field changes as well as new map entries.
      if (
        event.target instanceof Y.Map &&
        event.path.length === 1 &&
        (event.changes.keys.has('splitFrom') || event.changes.keys.has('splitLineage'))
      ) {
        this.splitDedup.indexExisting(keyId(event.path[0]!));
      }
      if (event.target instanceof Y.Array && event.path.length > 0) {
        structural = true;
        const parentId = keyId(event.path[0]!);
        for (const childId of this.syncChildListings(parentId)) changed.add(childId);
        if (this.isTombstoned(parentId)) this.adoption.sync(parentId);
        continue;
      }
      if (
        event.target instanceof Y.Map &&
        event.path.length === 1 &&
        (event.changes.keys.has(NODE_DELETED_FIELD) ||
          event.changes.keys.has(NODE_REPLACED_BY_FIELD))
      ) {
        structural = true;
        const id = keyId(event.path[0]!);
        this.adoption.sync(id);
        this.adoption.recomputeListerSurvivors(id);
        // A delete or restore changes which lister can place this node's children.
        for (const child of this.childrenSnapshot.get(id) ?? []) changed.add(child);
      }
    }
    // A contested child goes to the lister first in document order. A sibling moving, or a
    // lister's ancestor going away, changes that order without touching the child's own
    // listings, so every contest is decided again after each structural batch.
    if (structural) for (const id of this.contested) changed.add(id);
    if (changed.size > 0) this.resolveParents(changed);
    // The holder that shows a contested copy is the last in document order.
    if (structural) this.inline.orderChanged();
  }

  /** The records that lost their last parent since the last call, and still have none. */
  takeUnlisted(): LogicalId[] {
    return this.history.takeUnlisted((id) => this.parentIndex.has(id));
  }

  /** Parents whose shown children a contest moved since the last call. */
  takeReparented(): readonly LogicalId[] {
    const moved = [...this.reparented];
    this.reparented.clear();
    return moved;
  }

  private applyAttributeMapEvent(event: Y.YMapEvent<string>): void {
    this.unobservedWrites = 0;
    applyAttributeMapEvent(this.schema, this.attributesByNode, event);
  }

  private applyBindingMapEvent(event: Y.YMapEvent<string>): void {
    this.unobservedWrites = 0;
    applyBindingMapEvent(this.schema, this.bindingsByNode, event);
  }

  private syncChildListings(parentId: LogicalId): LogicalId[] {
    const rec = this.schema.nodes.get(parentId);
    const next = rec ? (childArrayOf(rec)?.toArray() ?? []) : [];
    return syncChildListings(this.listingIndex(), parentId, next);
  }

  private listingIndex(): ChildListings {
    return { listings: this.listings, childrenSnapshot: this.childrenSnapshot };
  }

  private resolveParents(ids: ReadonlySet<LogicalId>): void {
    const before = new Map<LogicalId, LogicalId | undefined>();
    for (const id of ids) before.set(id, this.parentIndex.get(id));
    this.placeParents(ids);
    for (const [id, previous] of before) {
      if ((this.listings.get(id)?.size ?? 0) > 1) this.contested.add(id);
      else this.contested.delete(id);
      const next = this.parentIndex.get(id);
      if (next === previous) continue;
      if ((next === undefined) !== (previous === undefined)) {
        this.inline.listingChanged(id);
        if (next === undefined) this.history.noteUnlisted(id);
      }
      if (previous !== undefined) this.reparented.add(previous);
      if (next !== undefined) this.reparented.add(next);
    }
  }

  private placeParents(ids: ReadonlySet<LogicalId>): void {
    placeParents(this.placementContext(), ids);
  }

  private placementContext(): ContestContext {
    return {
      nodes: this.schema.nodes,
      parentIndex: this.parentIndex,
      listings: this.listings,
      childrenSnapshot: this.childrenSnapshot,
      partRoots: this.partEntries().map((entry) => entry.rootLogicalId),
    };
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

  private removeFromArray(array: Y.Array<LogicalId>, id: LogicalId): void {
    for (let index = array.length - 1; index >= 0; index -= 1) {
      if (array.get(index) === id) array.delete(index, 1);
    }
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
