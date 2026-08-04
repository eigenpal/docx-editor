// Package shell helpers for footnote/endnote lifecycle.
// Mirrors hf-lifecycle-shell but admits footnotes/endnotes part targets.

import { createNodeIdAllocator, insertChildren } from './ooxml-edit.ts';
import { readOoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { RelationshipRecord } from './relationships.ts';
import { withFreshIds } from './hf-lifecycle-shell.ts';

export {
  freeRelationshipId,
  removeRelationship,
  withContentTypeOverride,
  withoutContentTypeOverride,
  withFreshIds,
} from './hf-lifecycle-shell.ts';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';

function relsPartNameFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return `${partName.slice(0, slash)}/_rels/${partName.slice(slash + 1)}.rels`;
}

/**
 * Add an Internal relationship from the main document to a notes part.
 * Target must be a relative safe notes filename (`footnotes.xml` / `endnotes.xml`).
 */
export function withNotesRelationship(
  pkg: OoxmlPackage,
  id: string,
  typeUri: string,
  target: string
): OoxmlPackage | null {
  if (!/^(footnotes|endnotes)\.xml$/.test(target)) return null;
  const owner = pkg.mainDocumentPart;
  const relsName = relsPartNameFor(owner);
  const existing = pkg.parts.get(relsName);
  const authored = readOoxmlPart(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="${id}" Type="${typeUri}" Target="${target}"/>` +
      '</Relationships>',
    { name: relsName, contentType: RELS_CONTENT_TYPE }
  );
  if (!authored.ok) return null;

  const owned = pkg.relationships.get(owner) ?? [];
  if (owned.some((entry) => entry.id === id)) return null;
  const record: RelationshipRecord = {
    ownerPart: owner,
    id,
    type: typeUri,
    rawTarget: target,
    targetMode: 'Internal',
    order: owned.reduce((max, entry) => Math.max(max, entry.order), -1) + 1,
  };
  const relationships = new Map([...pkg.relationships, [owner, [...owned, record]]]);

  if (!existing) {
    return Object.freeze({
      ...pkg,
      parts: new Map([...pkg.parts, [relsName, authored.part]]),
      relationships,
    });
  }
  const nextId = createNodeIdAllocator(existing);
  const node = authored.part.root.children[0];
  if (!node) return null;
  const inserted = insertChildren(existing, existing.root.id, existing.root.children.length, [
    withFreshIds(node, nextId),
  ]);
  if (!inserted.ok) return null;
  return Object.freeze({
    ...pkg,
    parts: new Map([...pkg.parts, [relsName, inserted.part]]),
    relationships,
  });
}
