// Package shell helpers for footnote/endnote lifecycle.
// Mirrors hf-lifecycle-shell but admits footnotes/endnotes part targets.

import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { isContentRevisionKind, isInlineRunContainer } from './ooxml-shared.ts';
import type { RelationshipRecord } from './relationships.ts';
import { appendFixedRelationship } from './hf-lifecycle-shell.ts';

export {
  freeRelationshipId,
  removeRelationship,
  withContentTypeOverride,
  withoutContentTypeOverride,
  withFreshIds,
} from './hf-lifecycle-shell.ts';

/** Whether a neutral inline owner and its ancestor path can receive a note citation. */
export function canHoldNoteCitation(
  node: OoxmlNode | null,
  ancestors: readonly OoxmlNode[] = []
): node is OoxmlElement {
  return Boolean(
    node &&
    !ancestors.some((ancestor) => isContentRevisionKind(ancestor.kind)) &&
    (node.kind === 'contentControlContent' ||
      (isInlineRunContainer(node) && !isContentRevisionKind(node.kind)))
  );
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
  return appendFixedRelationship(pkg, owner, record);
}
