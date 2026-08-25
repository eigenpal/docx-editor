import {
  XML_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  buildRelationshipSet,
  relsPartNameFor,
  resolveRelationship,
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
  isTextRecord,
  type ElementRecord,
  type EncodedAttribute,
  type EncodedRelationship,
  type RepairIssue,
  type RepairIssueCode,
} from './schema.ts';
import type { DocumentRegistry } from './registry.ts';
import type { BlobBytesStore } from './seed.ts';

const PACKAGE_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const RELATIONSHIPS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const RELS_PART_NAME_RE = /^(.*)\/_rels\/([^/]*)\.rels$/;

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

  /**
   * Project each `.rels` part from the relationship map.
   *
   * The map is the replicated source of truth. The node tree is not, because
   * `putRelationship` does not splice a Relationship child.
   */
  private projectRelsParts(parts: Map<string, OoxmlPart>): void {
    const byOwner = relationshipsByOwner(this.registry.relationships());
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

  private assemblePackage(parts: Map<string, OoxmlPart>): MaterializeResult {
    const relationships = this.registry.relationships() as RelationshipRecord[];
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
    const contentTypes: ContentTypeIndex = {
      defaults: this.registry.contentTypeDefaults(),
      overrides: this.registry.contentTypeOverrides(),
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
