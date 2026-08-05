// Pure package edits: add a part, add a relationship, add a content-type override.
//
// A part-level edit is not enough for anything that introduces a NEW part. A comment write
// creates `comments.xml`, points a relationship at it, and declares its content type; a
// package missing any one of those does not open. So these three belong together, behind one
// transaction, and each is pure in the same way the tree edits are: a new package, structurally
// shared with the old one, and the input untouched.
//
// `[Content_Types].xml` and the `.rels` parts are edited as TREES, never regenerated from the
// parsed index. The index case-folds part names and collapses duplicate defaults, so writing it
// back out would rewrite entries nobody touched. Editing the tree leaves every authored byte of
// every other entry exactly as it was.

import {
  buildContentTypeIndex,
  resolveContentType,
  type ContentTypeIndex,
} from './content-types.ts';
import { insertChildren, replaceChildren } from './ooxml-edit.ts';
import { normalizePartName, partNameKey, resolveInternalTarget } from './opc-names.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlGenericElementNode,
  type OoxmlNode,
  type OoxmlPart,
} from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import type { RelationshipRecord } from './relationships.ts';

/** The OPC content-types part, which every package has exactly one of. */
const CONTENT_TYPES_PART = '/[Content_Types].xml';
const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';

function contentTypesEntryOf(
  partBytes: ReadonlyMap<string, Uint8Array>
): { readonly storageKey: string; readonly bytes: Uint8Array } | null {
  for (const [name, bytes] of partBytes) {
    const normalized = normalizePartName(name);
    if (normalized.ok && partNameKey(normalized.partName) === partNameKey(CONTENT_TYPES_PART)) {
      return { storageKey: name, bytes };
    }
  }
  return null;
}

/** Locate `[Content_Types].xml` bytes regardless of zip key spelling. */
export function contentTypesPartBytes(
  pkg: OoxmlPackage
): { readonly storageKey: string; readonly bytes: Uint8Array } | null {
  return contentTypesEntryOf(pkg.partBytes);
}

export type PackageInvariantCode =
  | 'dangling-relationship'
  | 'missing-content-type'
  /** A part occupies a name OPC reserves for package infrastructure. */
  | 'reserved-part-name'
  /** Two parts whose names differ only by case, which OPC treats as one part. */
  | 'duplicate-part-name'
  /** A part name the OPC screens refuse; `writeZip` would throw on save. */
  | 'unsafe-part-name';

export interface PackageInvariantIssue {
  readonly code: PackageInvariantCode;
  /** The part the issue is about: the missing target, or the part with no type. */
  readonly partName: string;
  /** For a dangling relationship, the owner that points at nothing. */
  readonly ownerPart?: string;
}

export type PackageInvariantResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly PackageInvariantIssue[] };

/** Relationship records owned by one part, in authored order. */
export function relationshipsOf(
  pkg: OoxmlPackage,
  ownerPart: string
): readonly RelationshipRecord[] {
  return pkg.relationships.get(ownerPart) ?? [];
}

/** The content type that resolves for a part name, or null when nothing declares one. */
export function resolveContentTypeOf(pkg: OoxmlPackage, partName: string): string | null {
  const resolved = resolveContentType(pkg.contentTypes, partName);
  return resolved.ok ? resolved.contentType : null;
}

/** The `.rels` part that owns a part's relationships, by OPC convention. */
export function relsPartNameFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  const directory = partName.slice(0, slash);
  const file = partName.slice(slash + 1);
  return `${directory}/_rels/${file}.rels`;
}

function element(
  id: string,
  namespaceUri: string,
  localName: string,
  attributes: Readonly<Record<string, string>>,
  bindings: readonly { prefix: string; namespaceUri: string }[] = []
): OoxmlElement {
  return {
    id,
    kind: 'generic',
    namespaceUri,
    localName,
    namespaceBindings: bindings,
    attributes: Object.entries(attributes).map(([name, value]) => ({
      kind: 'genericExtension' as const,
      namespaceUri: '',
      localName: name,
      value,
    })),
    children: [],
  } as OoxmlElement;
}

/**
 * Part names no edit may ever create or replace.
 *
 * `[Content_Types].xml` and the `.rels` parts are package INFRASTRUCTURE, not content. They are
 * held as bytes and as trees respectively, and `writeOoxmlPackage` writes `parts` over
 * `partBytes` — so creating a "part" at one of those names replaces the real one on save. A
 * document that lost its content types still loads, resolves every part to no type, and opens
 * with zero trees: the user adds a comment, saves, reopens, and the document is empty with
 * nothing anywhere reporting an error.
 *
 * The names are attacker-reachable because a part name can come from a relationship target in
 * the file, and `resolveInternalTarget` will happily resolve `../[Content_Types].xml`.
 */
function isReservedForCreation(canonical: string): boolean {
  const key = partNameKey(canonical);
  return key === partNameKey(CONTENT_TYPES_PART) || /\/_rels\/[^/]*\.rels$/.test(key);
}

/**
 * The narrower check the COMMIT boundary applies.
 *
 * `.rels` parts are legitimately modelled as trees in `pkg.parts` — that is how a relationship
 * gets added at all — so flagging them here would reject every real package. Only
 * `[Content_Types].xml` must never appear as a tree: it is held as bytes, and a tree at that
 * name would be serialized over the real one on save.
 */
function isReservedAsTree(canonical: string): boolean {
  return partNameKey(canonical) === partNameKey(CONTENT_TYPES_PART);
}

/** True when the package already holds a part OPC considers the same name. */
function hasEquivalentPart(pkg: OoxmlPackage, canonical: string): boolean {
  const key = partNameKey(canonical);
  for (const name of pkg.parts.keys()) if (partNameKey(name) === key) return true;
  return false;
}

/**
 * A part name an edit is allowed to write, or null.
 *
 * Fail CLOSED where `normalizePartName` refuses: its `unsafe-key` screen exists to keep
 * `__proto__`-style segments out of the part map, and falling back to the raw name defeats it
 * — the name then survives into the package and `writeZip` throws on save, which strands the
 * session with unsaveable work.
 */
function writablePartName(canonical: string): string | null {
  const normalized = normalizePartName(canonical);
  if (!normalized.ok) return null;
  if (isReservedForCreation(normalized.partName)) return null;
  return normalized.partName;
}

/** A node id that cannot collide with a structural-path id in the target part. */
function mintedId(part: OoxmlPart, hint: string): string {
  return `${part.name}#minted-${hint}`;
}

function readUnqualifiedGenericAttribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find(
    (attribute) => attribute.localName === localName && attribute.namespaceUri === ''
  )?.value;
}

function isContentTypeOverrideNode(node: OoxmlNode, canonical: string): boolean {
  if (node.kind !== 'generic') return false;
  if (node.namespaceUri !== CONTENT_TYPES_NAMESPACE || node.localName !== 'Override') return false;
  const partName = readUnqualifiedGenericAttribute(node, 'PartName');
  const contentType = readUnqualifiedGenericAttribute(node, 'ContentType');
  return (
    partName !== undefined &&
    contentType !== undefined &&
    partNameKey(partName) === partNameKey(canonical)
  );
}

function withGenericAttributeValue(
  node: OoxmlGenericElementNode,
  localName: string,
  value: string
): OoxmlGenericElementNode {
  return {
    ...node,
    attributes: node.attributes.map((attribute) =>
      attribute.localName === localName && attribute.namespaceUri === ''
        ? ({ ...attribute, value } satisfies OoxmlAttribute)
        : attribute
    ),
  };
}

function upsertContentTypeOverrideChildren(
  part: OoxmlPart,
  canonical: string,
  contentType: string
): { readonly part: OoxmlPart; readonly changed: boolean } {
  const root = part.root;
  if (root.kind !== 'generic') return { part, changed: false };

  let matched = false;
  let changed = false;
  const nextChildren: OoxmlNode[] = [];

  for (const child of root.children) {
    if (!isContentTypeOverrideNode(child, canonical)) {
      nextChildren.push(child);
      continue;
    }
    if (matched) {
      changed = true;
      continue;
    }
    matched = true;
    if (child.kind !== 'generic') continue;
    const existingType = readUnqualifiedGenericAttribute(child, 'ContentType');
    if (existingType === contentType) {
      nextChildren.push(child);
      continue;
    }
    changed = true;
    nextChildren.push(withGenericAttributeValue(child, 'ContentType', contentType));
  }

  if (!matched) {
    changed = true;
    nextChildren.push(
      element(mintedId(part, `override-${canonical}`), CONTENT_TYPES_NAMESPACE, 'Override', {
        PartName: canonical,
        ContentType: contentType,
      })
    );
  }

  if (!changed) return { part, changed: false };
  const replaced = replaceChildren(part, root.id, nextChildren, { deferValidation: true });
  if (!replaced.ok) return { part, changed: false };
  return { part: replaced.part, changed: true };
}

/**
 * Declare a content type for a part, by upserting an `<Override>` in the content-types tree.
 *
 * A no-op when the part already resolves to the same type, so repeating a write does not append
 * a duplicate entry. Resolving to a DIFFERENT type replaces the existing Override in place.
 * `forceOverride` writes an explicit Override even when a Default already matches.
 */
export function withContentTypeOverride(
  pkg: OoxmlPackage,
  partName: string,
  contentType: string,
  options?: { readonly forceOverride?: boolean }
): OoxmlPackage {
  const canonical = writablePartName(partName);
  if (canonical === null) return pkg;
  const overrideKey = partNameKey(canonical);
  if (!options?.forceOverride) {
    if (resolveContentTypeOf(pkg, canonical) === contentType) return pkg;
  } else if (pkg.contentTypes.overrides.get(overrideKey) === contentType) {
    const contentTypesEntry = contentTypesEntryOf(pkg.partBytes);
    if (contentTypesEntry !== null) {
      const parsed = readOoxmlPart(new TextDecoder().decode(contentTypesEntry.bytes), {
        name: CONTENT_TYPES_PART,
        contentType: 'application/xml',
      });
      if (parsed.ok) {
        const upserted = upsertContentTypeOverrideChildren(parsed.part, canonical, contentType);
        if (!upserted.changed) return pkg;
      }
    }
  }

  const contentTypesEntry = contentTypesEntryOf(pkg.partBytes);
  if (contentTypesEntry === null) return pkg;
  const parsed = readOoxmlPart(new TextDecoder().decode(contentTypesEntry.bytes), {
    name: CONTENT_TYPES_PART,
    contentType: 'application/xml',
  });
  if (!parsed.ok) return pkg;

  const upserted = upsertContentTypeOverrideChildren(parsed.part, canonical, contentType);
  if (!upserted.changed) return pkg;

  const overrides = new Map(pkg.contentTypes.overrides);
  overrides.set(overrideKey, contentType);
  const partBytes = new Map(pkg.partBytes);
  partBytes.set(
    contentTypesEntry.storageKey,
    new TextEncoder().encode(serializeOoxmlPart(upserted.part))
  );
  return Object.freeze({
    ...pkg,
    partBytes,
    contentTypes: { defaults: pkg.contentTypes.defaults, overrides } satisfies ContentTypeIndex,
  });
}

/**
 * Point a relationship from one part at another, minting an unused `rId`.
 *
 * Returns the id as well as the package: the story that references a new part has to write that
 * id into its own markup, and inventing it separately would risk the two disagreeing.
 */
function relationshipIdAttribute(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  return node.attributes.find(
    (attribute) => attribute.localName === 'Id' && attribute.namespaceUri === ''
  )?.value;
}

/** Every `Id` on an owner's `.rels` tree, including external relationships. */
export function relationshipIdsForOwner(pkg: OoxmlPackage, ownerPart: string): ReadonlySet<string> {
  const used = new Set(relationshipsOf(pkg, ownerPart).map((record) => record.id));
  const relsPart = pkg.parts.get(relsPartNameFor(ownerPart));
  if (relsPart) {
    const walk = (node: OoxmlNode): void => {
      if (node.kind !== 'textValue' && node.localName === 'Relationship') {
        const id = relationshipIdAttribute(node);
        if (id !== undefined && id.length > 0) used.add(id);
      }
      if (node.kind === 'textValue') return;
      for (const child of node.children) walk(child);
    };
    walk(relsPart.root);
  }
  return used;
}

/** First unused `rIdN` on one owner part — collision-safe against internal and external ids. */
export function allocateOwnerRelationshipId(pkg: OoxmlPackage, ownerPart: string): string {
  const used = relationshipIdsForOwner(pkg, ownerPart);
  let max = 0;
  for (const id of used) {
    const match = /^rId(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  let next = max + 1;
  while (used.has(`rId${next}`)) next += 1;
  return `rId${next}`;
}

export function withRelationship(
  pkg: OoxmlPackage,
  ownerPart: string,
  type: string,
  rawTarget: string
): { readonly pkg: OoxmlPackage; readonly relationshipId: string; readonly ok: boolean } {
  const existing = relationshipsOf(pkg, ownerPart);
  const relationshipId = allocateOwnerRelationshipId(pkg, ownerPart);

  const relsName = relsPartNameFor(ownerPart);
  const relsPart = pkg.parts.get(relsName);
  // A package whose `.rels` parts are not modelled as trees — one omitting the `rels` content
  // default, which still loads because relationships are read from the zip entries — cannot
  // gain a relationship here. Reporting it is the point: writing the comment body and the
  // story markers with nothing pointing at the part leaves a reference Word repairs away, and
  // a silent identity return is indistinguishable from "no work needed".
  if (!relsPart) return { pkg, relationshipId, ok: false };

  const record = element(
    mintedId(relsPart, relationshipId),
    RELATIONSHIPS_NAMESPACE,
    'Relationship',
    { Id: relationshipId, Type: type, Target: rawTarget }
  );
  const appended = insertChildren(
    relsPart,
    relsPart.root.id,
    relsPart.root.children.length,
    [record],
    { deferValidation: true }
  );
  if (!appended.ok) return { pkg, relationshipId, ok: false };

  const relationships = new Map(pkg.relationships);
  relationships.set(ownerPart, [
    ...existing,
    {
      ownerPart,
      id: relationshipId,
      type,
      rawTarget,
      targetMode: 'Internal',
      order: existing.length,
    },
  ]);
  return {
    pkg: Object.freeze({ ...withPart(pkg, appended.part), relationships }),
    relationshipId,
    ok: true,
  };
}

/**
 * Add a part that does not exist yet, with the content-type override it needs to be openable.
 *
 * Deliberately does NOT create a relationship: a part is reachable because something points at
 * it, and which part points at it is the caller's decision. Creating one here would guess.
 */
export function withNewPart(
  pkg: OoxmlPackage,
  partName: string,
  root: OoxmlElement,
  contentType: string
): OoxmlPackage {
  const canonical = writablePartName(partName);
  // Refusing by returning the package unchanged keeps the primitive pure, and the caller sees
  // it as "nothing to do". The transaction that wanted the part then fails its own invariant
  // check rather than publishing a package with a story pointing at a part nobody created.
  if (canonical === null) return pkg;
  // OPC part names are case-insensitive, so a `Comments.xml` beside `comments.xml` is a
  // DUPLICATE, and `writeZip` refuses the whole package on save — after the transaction has
  // already committed, which strands the session.
  if (hasEquivalentPart(pkg, canonical)) return pkg;
  const part: OoxmlPart = { id: canonical, name: canonical, contentType, root };
  return withContentTypeOverride(withPart(pkg, part), canonical, contentType);
}

/** Resolve a relationship's target to a canonical part name, or null when it is not internal. */
function targetPartName(record: RelationshipRecord): string | null {
  if (record.targetMode === 'External') return null;
  const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
  return resolved.ok ? resolved.partName : null;
}

/**
 * The two invariants a package must satisfy before it is published.
 *
 * Both describe the half-written state that splitting a multi-part write across transactions
 * produces, and both make a package Word refuses to open:
 *
 *  - a relationship pointing at a part nobody created;
 *  - a part with no content type, which is unopenable even though the XML is well formed.
 *
 * Checked at the commit boundary rather than inside each primitive, for the same reason part
 * validation moved there: a transaction is allowed to pass through an inconsistent intermediate
 * as long as nothing can observe it.
 */
export function validatePackageInvariants(pkg: OoxmlPackage): PackageInvariantResult {
  const issues: PackageInvariantIssue[] = [];

  for (const [ownerPart, records] of pkg.relationships) {
    for (const record of records) {
      const target = targetPartName(record);
      if (target === null) continue;
      if (pkg.parts.has(target) || pkg.partBytes.has(target)) continue;
      issues.push({ code: 'dangling-relationship', partName: target, ownerPart });
    }
  }

  const seen = new Map<string, string>();
  for (const name of pkg.parts.keys()) {
    if (resolveContentTypeOf(pkg, name) === null) {
      issues.push({ code: 'missing-content-type', partName: name });
    }
    // The same three screens `writablePartName` applies, re-run at the commit boundary. A
    // primitive can be bypassed; this is what nothing gets published without.
    if (isReservedAsTree(name)) issues.push({ code: 'reserved-part-name', partName: name });
    if (!normalizePartName(name).ok) issues.push({ code: 'unsafe-part-name', partName: name });
    const key = partNameKey(name);
    const previous = seen.get(key);
    if (previous !== undefined) {
      issues.push({ code: 'duplicate-part-name', partName: name, ownerPart: previous });
    } else {
      seen.set(key, name);
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/** Rebuild the content-type index from records, for callers that parsed their own. */
export { buildContentTypeIndex };

/** Nodes of a part, for callers that need to walk one without importing the tree module. */
export type PackageNode = OoxmlNode;
