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
  customXmlDirectoryChanged,
  customXmlPropsOverrides,
  customXmlRepairNeeded,
  customXmlRepairRelationships,
  isCustomXmlItemPartName,
  isCustomXmlPropsPartName,
  mergeCustomXmlRelationships,
  planCustomXmlStores,
} from './materialize-custom-xml.ts';

const PACKAGE_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const RELATIONSHIPS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const RELS_PART_NAME_RE = /^(.*)\/_rels\/([^/]*)\.rels$/;
const W15_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2012/wordml';

function isRelsPartName(name: string): boolean {
  return RELS_PART_NAME_RE.test(name);
}

function relsOwnerOf(relsName: string): string | null {
  const match = RELS_PART_NAME_RE.exec(relsName);
  if (!match) return null;
  return match[2] === '' ? '/' : `${match[1]}/${match[2]}`;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function payloadIdOfNode(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.id;
  return attributeValue(node, 'id') ?? node.id;
}

function freezeRelationshipAttribute(localName: string, value: string): OoxmlAttribute {
  return Object.freeze({
    kind: 'genericExtension',
    namespaceUri: '',
    localName,
    value,
  });
}

/**
 * Build one Relationship element the way `readOoxmlPackage` models a `.rels` child.
 *
 * The relationship map is the source of truth. This tree is a projection for save.
 */
function freezeRelationshipElement(
  logicalId: LogicalId,
  record: EncodedRelationship
): OoxmlElement {
  const attributes: OoxmlAttribute[] = [
    freezeRelationshipAttribute('Id', record.id),
    freezeRelationshipAttribute('Type', record.type),
    freezeRelationshipAttribute('Target', record.rawTarget),
  ];
  if (record.targetMode === 'External') {
    attributes.push(freezeRelationshipAttribute('TargetMode', 'External'));
  }
  return Object.freeze({
    id: logicalId,
    kind: 'generic',
    namespaceUri: PACKAGE_RELATIONSHIPS_NAMESPACE,
    localName: 'Relationship',
    namespaceBindings: Object.freeze([]),
    attributes: Object.freeze(attributes),
    children: Object.freeze([]),
  }) as OoxmlElement;
}

function relationshipMatchesRecord(node: OoxmlNode, record: EncodedRelationship): boolean {
  if (node.kind === 'textValue') return false;
  if (node.namespaceUri !== PACKAGE_RELATIONSHIPS_NAMESPACE) return false;
  if (node.localName !== 'Relationship') return false;
  if (attributeValue(node, 'Id') !== record.id) return false;
  if (attributeValue(node, 'Type') !== record.type) return false;
  if (attributeValue(node, 'Target') !== record.rawTarget) return false;
  const mode = attributeValue(node, 'TargetMode');
  return record.targetMode === 'External' ? mode === 'External' : mode === undefined;
}

function childrenMatchRecords(
  root: OoxmlElement,
  records: readonly EncodedRelationship[]
): boolean {
  if (root.children.length !== records.length) return false;
  return root.children.every((child, index) => relationshipMatchesRecord(child, records[index]!));
}

function relsShellMatches(left: OoxmlElement, right: OoxmlElement): boolean {
  if (left.id !== right.id || left.kind !== right.kind) return false;
  if (left.namespaceUri !== right.namespaceUri || left.localName !== right.localName) return false;
  if (left.prefix !== right.prefix) return false;
  if (left.attributes.length !== right.attributes.length) return false;
  for (let index = 0; index < left.attributes.length; index += 1) {
    const a = left.attributes[index]!;
    const b = right.attributes[index]!;
    if (
      a.namespaceUri !== b.namespaceUri ||
      a.localName !== b.localName ||
      a.value !== b.value ||
      a.prefix !== b.prefix
    ) {
      return false;
    }
  }
  if (left.namespaceBindings.length !== right.namespaceBindings.length) return false;
  return left.namespaceBindings.every((binding, index) => {
    const other = right.namespaceBindings[index]!;
    return binding.prefix === other.prefix && binding.namespaceUri === other.namespaceUri;
  });
}

function relationshipChildrenOf(
  previous: readonly OoxmlNode[],
  records: readonly EncodedRelationship[],
  relsName: string
): readonly OoxmlNode[] {
  const next: OoxmlNode[] = [];
  for (const record of records) {
    if (rejectDangerousKey(record.id)) continue;
    const existing = previous.find(
      (child) => child.kind !== 'textValue' && attributeValue(child, 'Id') === record.id
    );
    if (existing && relationshipMatchesRecord(existing, record)) {
      next.push(existing);
      continue;
    }
    const logicalId =
      existing && existing.kind !== 'textValue' ? existing.id : `${relsName}#rel-${record.id}`;
    if (rejectDangerousKey(logicalId)) continue;
    next.push(freezeRelationshipElement(logicalId, record));
  }
  return next;
}

function emptyRelationshipsRoot(relsName: string): OoxmlElement {
  return Object.freeze({
    id: `${relsName}#root`,
    kind: 'generic',
    namespaceUri: PACKAGE_RELATIONSHIPS_NAMESPACE,
    localName: 'Relationships',
    namespaceBindings: Object.freeze([
      Object.freeze({ prefix: '', namespaceUri: PACKAGE_RELATIONSHIPS_NAMESPACE }),
    ]),
    attributes: Object.freeze([]),
    children: Object.freeze([]),
  }) as OoxmlElement;
}

function emptyRelsPart(relsName: string): OoxmlPart {
  return Object.freeze({
    id: relsName,
    name: relsName,
    contentType: RELATIONSHIPS_CONTENT_TYPE,
    root: emptyRelationshipsRoot(relsName),
  });
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

function relationshipsByOwner(
  records: readonly EncodedRelationship[]
): Map<string, EncodedRelationship[]> {
  const byOwner = new Map<string, EncodedRelationship[]>();
  for (const record of records) {
    if (rejectDangerousKey(record.id)) continue;
    if (record.ownerPart !== '/' && rejectPartName(record.ownerPart)) continue;
    const list = byOwner.get(record.ownerPart) ?? [];
    list.push(record);
    byOwner.set(record.ownerPart, list);
  }
  return byOwner;
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
  private readonly partCache = new Map<string, OoxmlPart>();
  /** Last `.rels` projection. The node tree is not the relationship authority. */
  private readonly relsProjection = new Map<string, OoxmlPart>();
  private readonly pendingDirty = new Set<LogicalId>();
  private pendingMembership = false;
  private pendingPackage = false;
  private lastDirty: ReadonlySet<LogicalId> = new Set();
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

  rebuild(): MaterializeResult {
    this.issues.length = 0;
    const rawDirty = new Set(this.pendingDirty);
    const membershipChanged = this.pendingMembership;
    const packageChanged = this.pendingPackage;
    this.pendingDirty.clear();
    this.pendingMembership = false;
    this.pendingPackage = false;
    this.lastDirty = expandAncestors(this.registry, rawDirty);
    this.customXmlRels = [];
    this.customXmlOverrides.clear();
    // A relationship-only change dirties no nodes. Reuse the node cache, then project `.rels`.
    const incremental =
      this.pkg !== null && !membershipChanged && (this.lastDirty.size > 0 || packageChanged);
    const collectOrphans =
      membershipChanged ||
      !this.pkg ||
      [...this.lastDirty].some(
        (id) => this.registry.isTombstoned(id) || this.registry.parentOf(id) === null
      );
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
      if (cached) {
        if (collectOrphans) markPlaced(cached, placed);
        else placed.add(logicalId);
        return cached;
      }
    }
    if (this.registry.isTombstoned(logicalId)) return null;
    placed.add(logicalId);
    const record = this.registry.record(logicalId);
    if (!record) {
      this.push('missing-node', logicalId);
      return null;
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
      if (!this.registry.record(childId)) {
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
    const next = freezeElement(record, replaceChildRange(previousChildren, children));
    this.cache.set(logicalId, next);
    return next;
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
      const nextRoot = freezeElement(record, nextChildren);
      this.cache.set(part.root.id, nextRoot);
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
    const nextRoot = freezeElement(record, nextChildren);
    this.cache.set(rootId, nextRoot);
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
