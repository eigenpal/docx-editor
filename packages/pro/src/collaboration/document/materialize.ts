/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  XML_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  buildRelationshipSet,
  relsPartNameFor,
  resolveRelationship,
  CUSTOM_XML_PROPS_TYPE,
  DATASTORE_NAMESPACE_URI,
  type ContentTypeIndex,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlExternalTarget,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
  type OoxmlTextNode,
  type RelationshipRecord,
} from '@docx-editor.dev/core/store';
import type { LogicalId } from './identity.ts';
import { rejectDangerousKey, rejectPartName } from './limits.ts';
import {
  isElementRecord,
  isTextRecord,
  type ElementRecord,
  type EncodedAttribute,
  type EncodedRelationship,
  type RepairIssue,
  type RepairIssueCode,
} from './schema.ts';
import type { DocumentRegistry } from './registry.ts';
import type { BlobBytesStore } from './seed.ts';
import {
  childrenMatchRecords,
  emptyRelsPart,
  isRelsPartName,
  relationshipChildrenOf,
  relationshipsByOwner,
  relsOwnerOf,
  relsShellMatches,
} from './materialize-rels.ts';
import {
  customXmlDirectoryChanged,
  customXmlPropsOverrides,
  customXmlRepairNeeded,
  customXmlRepairRelationships,
  isCustomXmlItemPartName,
  isCustomXmlPropsPartName,
  mergeCustomXmlRelationships,
  planCustomXmlStores,
} from './materialize-custom-xml.ts';

const W15_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2012/wordml';

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function payloadIdOfNode(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.id;
  return attributeValue(node, 'id') ?? node.id;
}

/**
 * A comment or `commentEx` that belongs under this part root.
 *
 * Concurrent first-time `putXmlPart` of `comments.xml` mints a different logical root on
 * each replica. The part map is last-write-wins, so one root vanishes from the directory
 * and its comment children are no longer reachable from a part. Markers in the story still
 * name them. Adopting by KIND, not by canonical id prefix, is required because new nodes
 * are translated into `lid:` space before they hit shared state. CustomXml `node` children
 * use the same scan: two first-creates both mint `item1.xml`, and last-write-wins would
 * otherwise hide one payload. Sibling order is payload `@id`, so a later local insert
 * and the peer's rematerialize land on the same sequence.
 */
function isDirectoryMemberOrphan(record: ElementRecord, part: OoxmlPart): boolean {
  if (record.logicalId === part.root.id) return false;
  if (part.root.localName === 'comments') return record.kind === 'comment';
  if (
    part.root.localName === 'commentsEx' &&
    record.namespaceUri === W15_NAMESPACE_URI &&
    record.localName === 'commentEx'
  ) {
    return true;
  }
  if (isCustomXmlItemPartName(part.name)) {
    return record.localName === 'node' && record.namespaceUri === part.root.namespaceUri;
  }
  return (
    isCustomXmlPropsPartName(part.name) &&
    record.localName === 'schemaRefs' &&
    record.namespaceUri === DATASTORE_NAMESPACE_URI
  );
}

function withRelsChildren(part: OoxmlPart, children: readonly OoxmlNode[]): OoxmlPart {
  const root = part.root;
  if (
    root.children.length === children.length &&
    root.children.every((child, index) => child === children[index])
  ) {
    return part;
  }
  const nextRoot = Object.freeze({
    ...root,
    children: replaceChildRange(root.children, children),
  }) as OoxmlElement;
  return Object.freeze({ ...part, root: nextRoot });
}

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

/**
 * Nodes this process has read out of shared state and frozen into canonical form.
 *
 * Receiving one remote character must cost the size of the edit, not the size of the
 * document. A duration cannot say which of the two happened on a loaded machine; this
 * counter can, so the receive gates assert against it.
 */
let materializedBuilds = 0;
let materializedReads = 0;

/** Test-observable count of canonical nodes the materializer has frozen. */
export function materializedNodeBuilds(): number {
  return materializedBuilds;
}

/** Test-observable count of shared-state records the materializer has read. */
export function materializedNodeReads(): number {
  return materializedReads;
}

function freezeText(logicalId: LogicalId, value: string): OoxmlTextNode {
  materializedBuilds += 1;
  return Object.freeze({ id: logicalId, kind: 'textValue', value });
}

function sameBindings(previous: OoxmlElement, record: ElementRecord): boolean {
  if (previous.namespaceBindings.length !== record.bindings.length) return false;
  return previous.namespaceBindings.every((binding, index) => {
    const encoded = record.bindings[index]!;
    return binding.prefix === encoded.prefix && binding.namespaceUri === encoded.namespaceUri;
  });
}

function sameAttributes(previous: OoxmlElement, record: ElementRecord): boolean {
  if (previous.attributes.length !== record.attributes.length) return false;
  return previous.attributes.every((attribute, index) => {
    const encoded = record.attributes[index]!;
    return (
      attribute.namespaceUri === encoded.namespaceUri &&
      attribute.localName === encoded.localName &&
      attribute.value === encoded.value &&
      attribute.prefix === (encoded.prefix?.length ? encoded.prefix : undefined)
    );
  });
}

/**
 * Freeze one element, keeping every array the predecessor can still vouch for.
 *
 * A rebuilt node is rebuilt because its CHILDREN moved. Handing it a newly allocated
 * bindings array anyway forfeits every downstream shortcut that keys on that array's
 * identity to prove the inherited namespace context did not change — the delta validator
 * stops pruning at the document element and revalidates the whole part for one keystroke.
 */
function freezeElement(
  record: ElementRecord,
  children: readonly OoxmlNode[],
  previous?: OoxmlNode
): OoxmlElement {
  materializedBuilds += 1;
  const prior = previous && previous.kind !== 'textValue' ? previous : undefined;
  return Object.freeze({
    id: record.logicalId,
    kind: record.kind,
    namespaceUri: record.namespaceUri,
    localName: record.localName,
    prefix: record.prefix,
    namespaceBindings:
      prior && sameBindings(prior, record)
        ? prior.namespaceBindings
        : Object.freeze(record.bindings.map((binding) => Object.freeze({ ...binding }))),
    attributes:
      prior && sameAttributes(prior, record)
        ? prior.attributes
        : Object.freeze(record.attributes.map(freezeAttribute)),
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

/**
 * Claim a whole reused subtree, and say whether the claim was uncontested.
 *
 * Reusing a cached subtree skips the per-node `placed` check that refuses a second parent,
 * so the claim has to be made for the descendants too. `false` means some node of this
 * subtree is already in the tree under another parent: two child arrays list the same id
 * and the cached answer disagrees with the rebuilt one. Emitting the node twice is a silent
 * corruption, so the caller redoes the pass without the cache instead.
 */
export function markPlaced(node: OoxmlNode, placed: Set<LogicalId>): boolean {
  // One `add` instead of `has` then `add`: this runs once per node of every reused subtree,
  // so a second hash of an already-long logical id is a measurable share of a receive.
  const before = placed.size;
  placed.add(node.id);
  let uncontested = placed.size !== before;
  if (node.kind === 'textValue') return uncontested;
  for (const child of node.children) {
    if (!markPlaced(child, placed)) uncontested = false;
  }
  return uncontested;
}

function expandAncestors(registry: DocumentRegistry, ids: ReadonlySet<LogicalId>): Set<LogicalId> {
  const expanded = new Set(ids);
  for (const id of ids) {
    let parent = registry.parentOf(id);
    while (parent) {
      expanded.add(parent);
      parent = registry.parentOf(parent);
    }
  }
  return expanded;
}

export type MaterializeFailureCode = 'missing-blob' | 'missing-root' | 'invalid-relationships';

export type MaterializeResult =
  | { readonly ok: true; readonly package: OoxmlPackage; readonly issues: readonly RepairIssue[] }
  | {
      readonly ok: false;
      readonly code: MaterializeFailureCode;
      readonly issues: readonly RepairIssue[];
    };

/**
 * Incremental package materializer. Repair is pure: it does not write Yjs.
 * Child-ID arrays remain membership authority. The derived parent index is not replicated.
 */
export class PackageMaterializer {
  private readonly cache = new Map<LogicalId, OoxmlNode>();
  /** Depth of each cached subtree, so reuse cannot smuggle a node past `maxTreeDepth`. */
  private readonly heights = new Map<LogicalId, number>();
  private readonly partCache = new Map<string, OoxmlPart>();
  /** Last `.rels` projection. The node tree is not the relationship authority. */
  private readonly relsProjection = new Map<string, OoxmlPart>();
  private readonly pendingDirty = new Set<LogicalId>();
  private pendingMembership = false;
  private pendingPackage = false;
  private lastDirty: ReadonlySet<LogicalId> = new Set();
  /** Adoptee signature per survivor at the end of the last pass. */
  private lastAdoption = new Map<LogicalId, string>();
  private placementContested = false;
  private pkg: OoxmlPackage | null = null;
  private customXmlRels: readonly EncodedRelationship[] = [];
  private customXmlOverrides = new Map<string, string>();
  private readonly stop: () => void;
  readonly issues: RepairIssue[] = [];

  constructor(
    readonly registry: DocumentRegistry,
    readonly blobs: BlobBytesStore
  ) {
    this.stop = registry.observeDirty((paths) => {
      for (const id of paths.logicalIds) this.pendingDirty.add(id);
      if (paths.membershipChanged) this.pendingMembership = true;
      if (paths.packageChanged) this.pendingPackage = true;
    });
  }

  destroy(): void {
    this.stop();
  }

  dirtyLogicalIds(): ReadonlySet<LogicalId> {
    return this.lastDirty;
  }

  current(): MaterializeResult {
    if (
      this.pkg &&
      this.pendingDirty.size === 0 &&
      !this.pendingPackage &&
      !this.pendingMembership
    ) {
      return { ok: true, package: this.pkg, issues: [...this.issues] };
    }
    return this.rebuild();
  }

  /**
   * Survivors whose derived adoption set moved since the last pass.
   *
   * A join tombstones one node with a replacement and the survivor grows the orphaned
   * children. Nothing about the survivor's own record changes, so no observer names it: the
   * only witness is this index. The node cache would hand the survivor back untouched and
   * the joined content would vanish, which is why the whole document used to rebuild
   * whenever membership moved. The index holds one entry per join survivor, so comparing it
   * costs nothing next to the walk it replaces.
   */
  private adoptionChanges(): readonly LogicalId[] {
    const moved: LogicalId[] = [];
    const next = new Map<LogicalId, string>();
    for (const [survivor, adopted] of this.registry.adoptionIndex()) {
      const signature = adopted.join('\u0001');
      next.set(survivor, signature);
      if (this.lastAdoption.get(survivor) !== signature) moved.push(survivor);
    }
    for (const survivor of this.lastAdoption.keys()) {
      if (!next.has(survivor)) moved.push(survivor);
    }
    this.lastAdoption = next;
    return moved;
  }

  rebuild(): MaterializeResult {
    const rawDirty = new Set(this.pendingDirty);
    const membershipChanged = this.pendingMembership;
    const packageChanged = this.pendingPackage;
    this.pendingDirty.clear();
    this.pendingMembership = false;
    this.pendingPackage = false;
    // A write whose Yjs events are still queued is invisible to every derived index and to
    // the dirty set: shared state already holds the edit, while `parentOf` and the adoption
    // index still describe the tree without it. That happens on the one path that matters
    // most — a queued local keystroke flushed the moment a remote update arrives. Reusing a
    // cached subtree there would publish the document as it was BEFORE the author's own
    // character, so the pass rebuilds the indexes and reads everything from shared state.
    const unobserved = this.registry.hasUnobservedWrites();
    if (unobserved) this.registry.rebuildDerivedIndexes();
    for (const survivor of this.adoptionChanges()) rawDirty.add(survivor);
    const dirty = expandAncestors(this.registry, rawDirty);
    // A relationship-only change dirties no nodes. Reuse the node cache, then project `.rels`.
    //
    // Membership does NOT disqualify the cache. Every child array that moved names its own
    // parent, `expandAncestors` names that parent's ancestors, and both the adoption index
    // and the recorded subtree heights are checked, so a rebuilt spine over cached children
    // reaches the same tree a full pass does — proven by the equivalence oracle in
    // `remote-receive-equivalence.test.ts`.
    const incremental = this.pkg !== null && !unobserved && (dirty.size > 0 || packageChanged);
    // Orphan collection has to see the WHOLE placement, because a move or a tombstone can
    // leave a node reachable from no part at all, and the cache cannot see that.
    const collectOrphans =
      membershipChanged ||
      unobserved ||
      !this.pkg ||
      [...dirty].some(
        (id) => this.registry.isTombstoned(id) || this.registry.parentOf(id) === null
      );
    const first = this.materializePass(dirty, packageChanged, incremental, collectOrphans);
    if (!this.placementContested) return first;
    // Two child arrays list one id and the cache disagrees with the rebuilt parent about
    // which one owns it. A full pass decides it the one deterministic way: first preorder
    // placement wins, the rest report `duplicate-parent`.
    return this.materializePass(dirty, packageChanged, false, true);
  }

  private materializePass(
    dirty: ReadonlySet<LogicalId>,
    packageChanged: boolean,
    incremental: boolean,
    collectOrphans: boolean
  ): MaterializeResult {
    this.issues.length = 0;
    this.lastDirty = dirty;
    this.placementContested = false;
    this.customXmlRels = [];
    this.customXmlOverrides.clear();
    const placed = new Set<LogicalId>();
    const parts = new Map<string, OoxmlPart>();
    for (const entry of this.registry.partEntries()) {
      const path = new Set<LogicalId>();
      const root = this.materialize(entry.rootLogicalId, placed, path, incremental, collectOrphans);
      if (!root || root.kind === 'textValue') {
        return { ok: false, code: 'missing-root', issues: [...this.issues] };
      }
      const previous = this.partCache.get(entry.name);
      if (previous && previous.root === root && previous.contentType === entry.contentType) {
        parts.set(entry.name, previous);
        continue;
      }
      const part = Object.freeze({
        id: entry.id || entry.name,
        name: entry.name,
        contentType: entry.contentType,
        root,
      });
      parts.set(entry.name, part);
      this.partCache.set(entry.name, part);
    }
    this.projectRelsParts(parts);
    this.adoptOrphanPartMembers(parts, placed, incremental, collectOrphans);
    this.applyCustomXmlStores(parts, placed, incremental, collectOrphans);
    for (const name of [...this.partCache.keys()]) {
      if (!parts.has(name)) this.partCache.delete(name);
    }
    for (const name of [...this.relsProjection.keys()]) {
      if (!parts.has(name)) this.relsProjection.delete(name);
    }
    if (collectOrphans) this.collectOrphans(placed);
    const assembled = this.assemblePackage(parts);
    if (!assembled.ok) return assembled;
    if (
      this.pkg &&
      !packageChanged &&
      this.pkg.parts.size === parts.size &&
      [...parts].every(([name, part]) => this.pkg?.parts.get(name) === part)
    ) {
      return { ok: true, package: this.pkg, issues: [...this.issues] };
    }
    this.pkg = assembled.package;
    return { ok: true, package: this.pkg, issues: [...this.issues] };
  }

  private push(code: RepairIssueCode, logicalId?: LogicalId): void {
    this.issues.push(logicalId ? { code, logicalId } : { code });
  }

  private collectOrphans(placed: ReadonlySet<LogicalId>): void {
    for (const id of this.registry.allLogicalIds()) {
      if (placed.has(id) || this.registry.isTombstoned(id)) continue;
      const record = this.registry.record(id);
      const hasContent =
        !!record &&
        (isTextRecord(record)
          ? record.value.length > 0
          : record.childIds.length > 0 || record.attributes.length > 0);
      this.push(hasContent ? 'orphan-with-content' : 'orphan', id);
    }
  }

  private materialize(
    logicalId: LogicalId,
    placed: Set<LogicalId>,
    path: Set<LogicalId>,
    incremental: boolean,
    collectOrphans: boolean
  ): OoxmlNode | null {
    if (path.has(logicalId) || path.size >= this.registry.limits.maxTreeDepth) {
      this.push('cycle', logicalId);
      return null;
    }
    if (placed.has(logicalId)) {
      this.push('duplicate-parent', logicalId);
      return null;
    }
    if (incremental && !this.lastDirty.has(logicalId)) {
      const cached = this.cache.get(logicalId);
      // A cached subtree carries the depth it was built at. Grafting it under a deeper
      // parent is how a peer would push the tree past `maxTreeDepth` without any walk ever
      // reaching the bottom, and every downstream oracle — validate, fingerprint, save —
      // recurses. So the recorded height is checked before the reuse, not after.
      if (cached && path.size + this.heightOf(cached) <= this.registry.limits.maxTreeDepth) {
        if (!markPlaced(cached, placed)) this.placementContested = true;
        return cached;
      }
    }
    if (this.registry.isTombstoned(logicalId)) return null;
    placed.add(logicalId);
    materializedReads += 1;
    const record = this.registry.record(logicalId);
    if (!record) {
      this.push('missing-node', logicalId);
      return null;
    }
    if (isTextRecord(record)) {
      const previous = this.cache.get(logicalId);
      if (previous?.kind === 'textValue' && previous.value === record.value) return previous;
      const next = freezeText(logicalId, record.value);
      this.remember(logicalId, next);
      return next;
    }
    path.add(logicalId);
    const seenChildren = new Set<LogicalId>();
    const childIds = [...record.childIds];
    for (const extra of this.registry.adoptedChildren(logicalId)) {
      if (!childIds.includes(extra)) childIds.push(extra);
    }
    const children: OoxmlNode[] = [];
    for (const childId of childIds) {
      if (childId === logicalId) {
        this.push('self-child', childId);
        continue;
      }
      if (seenChildren.has(childId)) {
        this.push('duplicate-child', childId);
        continue;
      }
      seenChildren.add(childId);
      if (this.registry.isTombstoned(childId)) {
        this.push('deleted-referenced', childId);
        continue;
      }
      // Existence only. Decoding the child's whole record here — attributes, bindings and
      // its own child array — for every entry of every rebuilt child list is the same cost
      // as materializing it, and a cached child never needs it decoded at all.
      if (rejectDangerousKey(childId) || !this.registry.hasNode(childId)) {
        this.push('child-id-not-in-registry', childId);
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
    const next = freezeElement(record, replaceChildRange(previousChildren, children), previous);
    this.remember(logicalId, next);
    return next;
  }

  private remember(logicalId: LogicalId, node: OoxmlNode): void {
    this.cache.set(logicalId, node);
    this.heights.delete(logicalId);
  }

  /**
   * Depth of one cached subtree, memoized.
   *
   * A rebuilt node forgets its height, and a node whose height moved is necessarily rebuilt
   * with a new identity, which rebuilds every ancestor. So a surviving entry is current.
   */
  private heightOf(node: OoxmlNode): number {
    const known = this.heights.get(node.id);
    if (known !== undefined) return known;
    let height = 1;
    if (node.kind !== 'textValue') {
      for (const child of node.children) height = Math.max(height, this.heightOf(child) + 1);
    }
    this.heights.set(node.id, height);
    return height;
  }

  private projectedRelationships(): EncodedRelationship[] {
    return mergeCustomXmlRelationships(this.registry.relationships(), this.customXmlRels);
  }

  /**
   * Project each `.rels` part from the relationship map.
   *
   * The map is the replicated source of truth. The node tree is not, because
   * `putRelationship` does not splice a Relationship child.
   */
  private projectRelsParts(parts: Map<string, OoxmlPart>): void {
    const byOwner = relationshipsByOwner(this.projectedRelationships());
    const projected = new Set<string>();
    for (const [owner, records] of byOwner) {
      const relsName = relsPartNameFor(owner);
      if (relsName !== '/_rels/.rels' && rejectPartName(relsName)) continue;
      projected.add(relsName);
      const next = this.projectOneRelsPart(relsName, parts.get(relsName), records);
      if (!next) continue;
      parts.set(relsName, next);
      this.partCache.set(relsName, next);
    }
    for (const [name, part] of parts) {
      if (projected.has(name) || !isRelsPartName(name)) continue;
      const owner = relsOwnerOf(name);
      if (owner === null) continue;
      const next = this.projectOneRelsPart(name, part, byOwner.get(owner) ?? []);
      if (!next || next === part) continue;
      parts.set(name, next);
      this.partCache.set(name, next);
    }
  }

  private projectOneRelsPart(
    relsName: string,
    existing: OoxmlPart | undefined,
    records: readonly EncodedRelationship[]
  ): OoxmlPart | null {
    if (!existing && records.length === 0) {
      this.relsProjection.delete(relsName);
      return null;
    }
    const cached = this.relsProjection.get(relsName);
    const shellOk = !!cached && (!existing || relsShellMatches(cached.root, existing.root));
    const base = shellOk && cached ? cached : (existing ?? emptyRelsPart(relsName));
    if (childrenMatchRecords(base.root, records)) {
      this.relsProjection.set(relsName, base);
      return base;
    }
    const previous = base.root.children;
    const next = withRelsChildren(base, relationshipChildrenOf(previous, records, relsName));
    this.relsProjection.set(relsName, next);
    return next;
  }

  /**
   * Re-parent comment nodes the children-array LWW dropped.
   *
   * Both replicas mint `/word/comments.xml#0` when the file has no comments part yet.
   * `nodes.set(id, newMap)` is last-write-wins, so one replica's nested children array
   * vanishes on merge. The comment element itself is a different key and still exists.
   */
  private adoptOrphanPartMembers(
    parts: Map<string, OoxmlPart>,
    placed: Set<LogicalId>,
    incremental: boolean,
    collectOrphans: boolean
  ): void {
    for (const [name, part] of parts) {
      if (
        part.root.localName !== 'comments' &&
        part.root.localName !== 'commentsEx' &&
        !isCustomXmlItemPartName(name) &&
        !isCustomXmlPropsPartName(name)
      ) {
        continue;
      }
      const members: OoxmlNode[] = [];
      const seen = new Set<LogicalId>();
      for (const child of part.root.children) {
        if (child.kind === 'textValue') continue;
        const record = this.registry.record(child.id);
        if (!record || !isElementRecord(record)) continue;
        if (!isDirectoryMemberOrphan(record, part)) continue;
        members.push(child);
        seen.add(child.id);
      }
      let adopted = 0;
      for (const id of this.registry.allLogicalIds()) {
        if (placed.has(id) || seen.has(id) || this.registry.isTombstoned(id)) continue;
        const record = this.registry.record(id);
        if (!record || !isElementRecord(record)) continue;
        if (!isDirectoryMemberOrphan(record, part)) continue;
        const node = this.materialize(id, placed, new Set(), incremental, collectOrphans);
        if (!node || node.kind === 'textValue') continue;
        members.push(node);
        seen.add(id);
        adopted += 1;
      }
      if (isCustomXmlItemPartName(name) || isCustomXmlPropsPartName(name)) {
        members.sort((left, right) => payloadIdOfNode(left).localeCompare(payloadIdOfNode(right)));
      } else {
        if (adopted === 0) continue;
        members.sort((left, right) => left.id.localeCompare(right.id));
      }
      const kept: OoxmlNode[] = [];
      for (const child of part.root.children) {
        if (seen.has(child.id)) continue;
        kept.push(child);
      }
      const nextChildren = replaceChildRange(part.root.children, [...kept, ...members]);
      if (nextChildren === part.root.children) continue;
      const record = this.registry.record(part.root.id);
      if (!record || !isElementRecord(record)) continue;
      const nextRoot = freezeElement(record, nextChildren, part.root);
      this.remember(part.root.id, nextRoot);
      const nextPart = Object.freeze({ ...part, root: nextRoot });
      parts.set(name, nextPart);
      this.partCache.set(name, nextPart);
    }
  }

  private adoptNodesIntoRoot(
    rootId: LogicalId,
    nodeIds: readonly LogicalId[],
    placed: Set<LogicalId>,
    incremental: boolean,
    collectOrphans: boolean
  ): OoxmlElement | null {
    const existing = this.cache.get(rootId);
    const root =
      existing && existing.kind !== 'textValue'
        ? existing
        : this.materialize(rootId, placed, new Set(), incremental, collectOrphans);
    if (!root || root.kind === 'textValue') return null;
    const members: OoxmlNode[] = [...root.children];
    const seen = new Set(members.map((child) => child.id));
    let adopted = 0;
    for (const id of nodeIds) {
      if (seen.has(id)) continue;
      const cached = this.cache.get(id);
      if (cached && cached.kind !== 'textValue') {
        members.push(cached);
        seen.add(id);
        adopted += 1;
        continue;
      }
      const node = this.materialize(id, placed, new Set(), incremental, collectOrphans);
      if (!node || node.kind === 'textValue') continue;
      members.push(node);
      seen.add(id);
      adopted += 1;
    }
    members.sort((left, right) => payloadIdOfNode(left).localeCompare(payloadIdOfNode(right)));
    if (adopted === 0 && members.every((child, index) => child === root.children[index])) {
      return root;
    }
    const record = this.registry.record(rootId);
    if (!record || !isElementRecord(record)) return root;
    const nextChildren = replaceChildRange(root.children, members);
    const nextRoot = freezeElement(record, nextChildren, root);
    this.remember(rootId, nextRoot);
    return nextRoot;
  }

  private applyCustomXmlStores(
    parts: Map<string, OoxmlPart>,
    placed: Set<LogicalId>,
    incremental: boolean,
    collectOrphans: boolean
  ): void {
    const stores = planCustomXmlStores(this.registry, parts);
    if (stores.length === 0 || !customXmlRepairNeeded(parts, stores)) return;
    const remap = customXmlDirectoryChanged(parts, stores);
    const planned = new Set<string>();
    for (const store of stores) {
      planned.add(store.itemName);
      planned.add(store.propsName);
      const dataRoot = this.adoptNodesIntoRoot(
        store.dataRootId,
        store.nodeIds,
        placed,
        incremental,
        collectOrphans
      );
      const propsRoot = this.materialize(
        store.propsRootId,
        placed,
        new Set(),
        incremental,
        collectOrphans
      );
      if (!dataRoot || !propsRoot || propsRoot.kind === 'textValue') continue;
      const dataPart = Object.freeze({
        id: store.itemName,
        name: store.itemName,
        contentType: 'application/xml',
        root: dataRoot,
      });
      const propsPart = Object.freeze({
        id: store.propsName,
        name: store.propsName,
        contentType: CUSTOM_XML_PROPS_TYPE,
        root: propsRoot,
      });
      parts.set(store.itemName, dataPart);
      parts.set(store.propsName, propsPart);
      this.partCache.set(store.itemName, dataPart);
      this.partCache.set(store.propsName, propsPart);
    }
    if (!remap) return;
    for (const name of [...parts.keys()]) {
      if (!isCustomXmlItemPartName(name) && !isCustomXmlPropsPartName(name)) continue;
      if (planned.has(name)) continue;
      parts.delete(name);
      this.partCache.delete(name);
    }
    this.customXmlRels = customXmlRepairRelationships(this.registry, stores);
    this.customXmlOverrides = customXmlPropsOverrides(stores);
    this.projectRelsParts(parts);
  }

  private assemblePackage(parts: Map<string, OoxmlPart>): MaterializeResult {
    const relationships = this.projectedRelationships() as RelationshipRecord[];
    const set = buildRelationshipSet(relationships);
    if (!set.ok) return { ok: false, code: 'invalid-relationships', issues: [...this.issues] };
    const externalTargets: OoxmlExternalTarget[] = [];
    for (const record of relationships) {
      const resolved = resolveRelationship(record);
      if (resolved.mode === 'External') {
        externalTargets.push({
          ownerPart: record.ownerPart,
          id: record.id,
          type: record.type,
          rawTarget: record.rawTarget,
          sinkSafe: resolved.sinkSafe.ok,
        });
      }
    }
    const partBytes = new Map<string, Uint8Array>();
    for (const descriptor of this.registry.binaries()) {
      const bytes = this.blobs.get(descriptor.digest);
      if (!bytes) return { ok: false, code: 'missing-blob', issues: [...this.issues] };
      partBytes.set(descriptor.storageKey, bytes);
    }
    const overrides = new Map(this.registry.contentTypeOverrides());
    for (const [name, mediaType] of this.customXmlOverrides) overrides.set(name, mediaType);
    const contentTypes: ContentTypeIndex = {
      defaults: this.registry.contentTypeDefaults(),
      overrides,
    };
    const mainDocumentPart =
      this.registry.mainDocumentPart() ||
      [...parts.keys()].find((name) => name.endsWith('document.xml')) ||
      '';
    return {
      ok: true,
      package: Object.freeze({
        parts,
        partBytes,
        relationships: set.byOwner,
        externalTargets: Object.freeze(externalTargets),
        contentTypes,
        mainDocumentPart,
      }),
      issues: [...this.issues],
    };
  }
}
