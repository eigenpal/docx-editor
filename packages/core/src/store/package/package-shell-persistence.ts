// Session-persistent package shell resources across historical package snapshot installs.
//
// Numbering definitions and hyperlink relationships are minted outside tree history
// (`replacePackageShell`). Lifecycle undo/redo restores full package snapshots that may
// predate those writes. Replaying the snapshot alone would drop the shell resources while
// a later story redo restores `w:numId` / `r:id` references — dead ids.
//
// Furniture and notes lifecycle parts stay snapshot-owned: undo must remove them. Only
// monotonic shell resources (numbering part + hyperlink externals) are re-applied, and only
// when their relationship ids do not collide with internals the snapshot already declares.

import { strFromU8, strToU8 } from 'fflate';
import { createNodeIdAllocator, insertChildren } from './ooxml-edit.ts';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from './ooxml-tree.ts';
import { withPart, type OoxmlExternalTarget, type OoxmlPackage } from './ooxml-package.ts';
import { escapeXmlChecked } from './sinks.ts';
import { HYPERLINK_RELATIONSHIP_TYPE } from './hyperlink.ts';
import type { RelationshipRecord } from './relationships.ts';
import { readXml, type XmlNode } from './xml-reader.ts';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const CONTENT_TYPES_PART = '/[Content_Types].xml';
const NUMBERING_PART = '/word/numbering.xml';
const NUMBERING_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const NUMBERING_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const NUMBERING_OVERRIDE = `<Override PartName="${NUMBERING_PART}" ContentType="${NUMBERING_CONTENT_TYPE}"/>`;

/**
 * Re-apply session shell resources from `live` onto a historical `snapshot`.
 *
 * Pure: neither argument is mutated. Returns `snapshot` by identity when nothing to merge.
 */
export function mergePersistentPackageShell(
  snapshot: OoxmlPackage,
  live: OoxmlPackage
): OoxmlPackage {
  if (snapshot === live) return snapshot;
  let next = mergeNumberingShell(snapshot, live);
  next = mergeHyperlinkShell(next, live);
  return next;
}

function mergeNumberingShell(snapshot: OoxmlPackage, live: OoxmlPackage): OoxmlPackage {
  const liveNumbering = live.parts.get(NUMBERING_PART);
  if (!liveNumbering) return snapshot;

  let next: OoxmlPackage = withPart(snapshot, liveNumbering);

  const liveRel = (live.relationships.get(live.mainDocumentPart) ?? []).find(
    (record) => record.type === NUMBERING_REL_TYPE
  );
  const snapRels = next.relationships.get(next.mainDocumentPart) ?? [];
  if (liveRel && !snapRels.some((record) => record.type === NUMBERING_REL_TYPE)) {
    // Prefer live's id so freeRelationshipId high-water stays coherent; skip on collision.
    if (!snapRels.some((record) => record.id === liveRel.id)) {
      const related = withInternalRelationship(next, {
        ...liveRel,
        ownerPart: next.mainDocumentPart,
      });
      if (related) next = related;
    }
  }

  if (next.contentTypes.overrides.get(NUMBERING_PART.toLowerCase()) !== NUMBERING_CONTENT_TYPE) {
    const declared = withNumberingContentTypeOverride(next);
    if (declared) next = declared;
  }

  return next;
}

function mergeHyperlinkShell(snapshot: OoxmlPackage, live: OoxmlPackage): OoxmlPackage {
  // Persist hyperlink externals for every owning part (body, furniture, notes), not only
  // the main document — a scoped insert mints onto the story's own `.rels`.
  const liveLinks = live.externalTargets.filter(
    (entry) => entry.type === HYPERLINK_RELATIONSHIP_TYPE
  );
  if (liveLinks.length === 0) return snapshot;

  let next = snapshot;

  for (const link of liveLinks) {
    const owner = remapOwnerPart(snapshot, live, link.ownerPart);
    if (!owner) continue;
    if (next.externalTargets.some((entry) => entry.ownerPart === owner && entry.id === link.id)) {
      continue;
    }
    // Snapshot lifecycle owns this id — do not collide. Leftover hyperlink persistence plus
    // max-based allocation normally prevent this; prefer coherent furniture over a forced merge.
    const snapInternals = new Set((next.relationships.get(owner) ?? []).map((record) => record.id));
    if (snapInternals.has(link.id)) continue;

    const merged = withExternalHyperlink(
      next,
      {
        ownerPart: owner,
        id: link.id,
        type: HYPERLINK_RELATIONSHIP_TYPE,
        rawTarget: link.rawTarget,
        sinkSafe: link.sinkSafe,
      },
      owner
    );
    if (!merged) continue;
    next = merged;
  }

  return next;
}

/** Map a live owner part name onto the snapshot package (main-document name may differ). */
function remapOwnerPart(
  snapshot: OoxmlPackage,
  live: OoxmlPackage,
  liveOwner: string
): string | null {
  if (liveOwner === live.mainDocumentPart) return snapshot.mainDocumentPart;
  if (snapshot.parts.has(liveOwner)) return liveOwner;
  return null;
}

function withInternalRelationship(
  pkg: OoxmlPackage,
  record: RelationshipRecord
): OoxmlPackage | null {
  const owner = pkg.mainDocumentPart;
  const relsName = relsPartNameFor(owner);
  const existing = pkg.parts.get(relsName);
  const authored = readOoxmlPart(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="${escapeXmlChecked(record.id, 'relationship id')}"` +
      ` Type="${escapeXmlChecked(record.type, 'relationship type')}"` +
      ` Target="${escapeXmlChecked(record.rawTarget, 'relationship target')}"/>` +
      '</Relationships>',
    { name: relsName, contentType: RELS_CONTENT_TYPE }
  );
  if (!authored.ok) return null;

  const owned = pkg.relationships.get(owner) ?? [];
  if (owned.some((entry) => entry.id === record.id)) return null;
  const nextRecord: RelationshipRecord = {
    ...record,
    ownerPart: owner,
    order: owned.reduce((max, entry) => Math.max(max, entry.order), -1) + 1,
  };
  const relationships = new Map([...pkg.relationships, [owner, [...owned, nextRecord]]]);

  if (!existing) {
    return Object.freeze({
      ...pkg,
      parts: new Map([...pkg.parts, [relsName, authored.part]]),
      relationships,
    });
  }
  return appendRelsChild(pkg, existing, authored.part.root.children[0], relationships);
}

function withExternalHyperlink(
  pkg: OoxmlPackage,
  link: OoxmlExternalTarget,
  ownerPart: string = pkg.mainDocumentPart
): OoxmlPackage | null {
  const owner = ownerPart;
  if (typeof owner !== 'string' || owner.length === 0) return null;
  if (owner !== pkg.mainDocumentPart && !pkg.parts.has(owner)) return null;
  const relsName = relsPartNameFor(owner);
  const existing = pkg.parts.get(relsName);
  const authored = readOoxmlPart(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="${escapeXmlChecked(link.id, 'relationship id')}"` +
      ` Type="${HYPERLINK_RELATIONSHIP_TYPE}"` +
      ` Target="${escapeXmlChecked(link.rawTarget, 'relationship target')}"` +
      ' TargetMode="External"/>' +
      '</Relationships>',
    { name: relsName, contentType: RELS_CONTENT_TYPE }
  );
  if (!authored.ok) return null;

  const externalTargets = [...pkg.externalTargets, link];

  if (!existing) {
    return Object.freeze({
      ...pkg,
      parts: new Map([...pkg.parts, [relsName, authored.part]]),
      externalTargets,
    });
  }
  const appended = appendRelsChild(
    pkg,
    existing,
    authored.part.root.children[0],
    pkg.relationships
  );
  if (!appended) return null;
  return Object.freeze({ ...appended, externalTargets });
}

function appendRelsChild(
  pkg: OoxmlPackage,
  existing: OoxmlPart,
  node: OoxmlNode | undefined,
  relationships: ReadonlyMap<string, readonly RelationshipRecord[]>
): OoxmlPackage | null {
  if (!node) return null;
  const nextId = createNodeIdAllocator(existing);
  const inserted = insertChildren(existing, existing.root.id, existing.root.children.length, [
    withFreshIds(node, nextId),
  ]);
  if (!inserted.ok) return null;
  return Object.freeze({
    ...pkg,
    parts: new Map([...pkg.parts, [existing.name, inserted.part]]),
    relationships,
  });
}

function withFreshIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: nextId() } as OoxmlNode;
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => withFreshIds(child, nextId)),
  } as OoxmlNode;
}

function relsPartNameFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return `${partName.slice(0, slash)}/_rels/${partName.slice(slash + 1)}.rels`;
}

/**
 * Surgical numbering content-type override on snapshot bytes — never copy live CT wholesale,
 * or deleted furniture overrides would resurrect with the shell merge.
 */
function withNumberingContentTypeOverride(pkg: OoxmlPackage): OoxmlPackage | null {
  const declared = pkg.contentTypes.overrides.get(NUMBERING_PART.toLowerCase());
  if (declared === NUMBERING_CONTENT_TYPE) return pkg;
  if (declared !== undefined) return null;

  const bytes = pkg.partBytes.get(CONTENT_TYPES_PART);
  if (!bytes) return null;
  const xml = strFromU8(bytes);
  const before = contentTypesShape(xml);
  if (!before) return null;

  const close = xml.lastIndexOf(`</${before.rootName}>`);
  if (close === -1) return null;
  const patched = xml.slice(0, close) + NUMBERING_OVERRIDE + xml.slice(close);

  const after = contentTypesShape(patched);
  if (!after || after.rootName !== before.rootName) return null;
  const expected = [
    ...before.children,
    childSignature('Override', {
      PartName: NUMBERING_PART,
      ContentType: NUMBERING_CONTENT_TYPE,
    }),
  ];
  if (after.children.length !== expected.length) return null;
  if (after.children.some((child, index) => child !== expected[index])) return null;

  return Object.freeze({
    ...pkg,
    partBytes: new Map([...pkg.partBytes, [CONTENT_TYPES_PART, strToU8(patched)]]),
    contentTypes: Object.freeze({
      defaults: pkg.contentTypes.defaults,
      overrides: new Map([
        ...pkg.contentTypes.overrides,
        [NUMBERING_PART.toLowerCase(), NUMBERING_CONTENT_TYPE],
      ]),
    }),
  });
}

interface ContentTypesShape {
  readonly rootName: string;
  readonly children: readonly string[];
}

function contentTypesShape(xml: string): ContentTypesShape | null {
  const parsed = readXml(xml);
  if (!parsed.ok) return null;
  const roots = parsed.nodes.filter(
    (node): node is Extract<XmlNode, { type: 'element' }> => node.type === 'element'
  );
  if (roots.length !== 1) return null;
  const root = roots[0]!;
  const colon = root.name.indexOf(':');
  const prefix = colon === -1 ? '' : root.name.slice(0, colon);
  if (root.name.slice(colon + 1) !== 'Types') return null;
  if (root.attributes[prefix ? `xmlns:${prefix}` : 'xmlns'] !== CONTENT_TYPES_NS) return null;
  const children: string[] = [];
  for (const child of root.children) {
    if (child.type !== 'element') continue;
    children.push(childSignature(child.name, child.attributes));
  }
  return { rootName: root.name, children };
}

function childSignature(name: string, attributes: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(attributes)
    .map(([attribute, value]) => `${attribute}=${value}`)
    .sort();
  return [name, ...pairs].join('\u0001');
}
