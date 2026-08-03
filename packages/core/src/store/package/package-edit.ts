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
import { insertChildren } from './ooxml-edit.ts';
import { normalizePartName, partNameKey, resolveInternalTarget } from './opc-names.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
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

export type PackageInvariantCode = 'dangling-relationship' | 'missing-content-type';

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

/** A node id that cannot collide with a structural-path id in the target part. */
function mintedId(part: OoxmlPart, hint: string): string {
  return `${part.name}#minted-${hint}`;
}

/**
 * Declare a content type for a part, by appending an `<Override>` to the content-types tree.
 *
 * A no-op when the part already resolves to the same type, so repeating a write does not append
 * a duplicate entry. Resolving to a DIFFERENT type is a caller error and overwrites, because a
 * part with two declared types does not open.
 */
export function withContentTypeOverride(
  pkg: OoxmlPackage,
  partName: string,
  contentType: string
): OoxmlPackage {
  const normalized = normalizePartName(partName);
  const canonical = normalized.ok ? normalized.partName : partName;
  if (resolveContentTypeOf(pkg, canonical) === contentType) return pkg;

  const bytes = pkg.partBytes.get(CONTENT_TYPES_PART);
  if (bytes === undefined) return pkg;
  const parsed = readOoxmlPart(new TextDecoder().decode(bytes), {
    name: CONTENT_TYPES_PART,
    contentType: 'application/xml',
  });
  if (!parsed.ok) return pkg;

  const override = element(
    mintedId(parsed.part, `override-${canonical}`),
    CONTENT_TYPES_NAMESPACE,
    'Override',
    { PartName: canonical, ContentType: contentType }
  );
  const appended = insertChildren(
    parsed.part,
    parsed.part.root.id,
    parsed.part.root.children.length,
    [override],
    { deferValidation: true }
  );
  if (!appended.ok) return pkg;

  const overrides = new Map(pkg.contentTypes.overrides);
  overrides.set(partNameKey(canonical), contentType);
  const partBytes = new Map(pkg.partBytes);
  partBytes.set(CONTENT_TYPES_PART, new TextEncoder().encode(serializeOoxmlPart(appended.part)));
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
export function withRelationship(
  pkg: OoxmlPackage,
  ownerPart: string,
  type: string,
  rawTarget: string
): { readonly pkg: OoxmlPackage; readonly relationshipId: string } {
  const existing = relationshipsOf(pkg, ownerPart);
  const used = new Set(existing.map((record) => record.id));
  let next = existing.length + 1;
  while (used.has(`rId${next}`)) next += 1;
  const relationshipId = `rId${next}`;

  const relsName = relsPartNameFor(ownerPart);
  const relsPart = pkg.parts.get(relsName);
  if (!relsPart) return { pkg, relationshipId };

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
  if (!appended.ok) return { pkg, relationshipId };

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
  const normalized = normalizePartName(partName);
  const canonical = normalized.ok ? normalized.partName : partName;
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

  for (const name of pkg.parts.keys()) {
    if (resolveContentTypeOf(pkg, name) === null) {
      issues.push({ code: 'missing-content-type', partName: name });
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/** Rebuild the content-type index from records, for callers that parsed their own. */
export { buildContentTypeIndex };

/** Nodes of a part, for callers that need to walk one without importing the tree module. */
export type PackageNode = OoxmlNode;
