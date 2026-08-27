/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Which elements are DIRECTORY MEMBERS of a part, and what order they sit in.
//
// `putXmlPart` writes the part map, and that map is last-write-wins. So when two replicas
// create the same part for the first time — neither has seen the other's root yet — one root
// wins the name and the loser's children are left reachable from no part at all. The elements
// themselves survive under their own keys; only the edge to a part is gone. Adoption is how
// they get an edge back.
//
// Membership is decided by ELEMENT IDENTITY, never by which part a node used to sit in,
// because shared state records no such provenance. That is what bounds this mechanism: it
// covers parts whose members are elements that appear nowhere else in a document. `w:comment`,
// `w:footnote`, `w:endnote`, `w:abstractNum` and `w:num` each live in exactly one part, so a
// stray one can only have come from there.
//
// Two part kinds are deliberately absent.
//
// A header's members are `w:p` and `w:tbl`, which occur in every story, so a scan for orphaned
// blocks cannot tell a lost header paragraph from a body paragraph that some other defect
// unparented — and adopting a body paragraph into a header is worse than the loss it repairs.
// Headers and footers need per-node part provenance in shared state first.
//
// The customXml stores are excluded for the opposite reason: identity is not enough to say
// WHICH store a `dsp:node` belongs to. A document can hold several, one per namespace, and a
// concurrent first-create leaves `item1.xml` occupied by whichever root landed last — so the
// namespace of the part currently sitting at a name says nothing about the namespace of the
// nodes stranded next to it. Adopting by that rule merges two stores into one. Custom XML is
// therefore repaired by `planCustomXmlStores`, which pairs data roots to props roots by
// namespace and hands each store its own nodes.

import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { ElementRecord } from './schema.ts';

export const W15_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2012/wordml';

export interface PartMemberSpec {
  /** True when this element belongs directly under the part root as a directory member. */
  readonly isMember: (record: ElementRecord) => boolean;
  /**
   * Sibling order for members, computed identically on every replica.
   *
   * Applied only when a pass actually adopts something, so that a replica which lost nothing
   * reproduces the order its author wrote.
   */
  readonly sortKey: (node: OoxmlElement) => string;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/**
 * Order key for an OOXML integer id.
 *
 * String comparison puts `w:id="10"` before `w:id="9"`, and the notes parts reserve negative
 * ids for the separator and continuation notices that Word requires first. Signed numeric
 * order, rendered as a fixed-width string, gives both. A non-integer id keeps a deterministic
 * place at the end rather than being dropped.
 */
function numericKey(value: string | undefined): string {
  const parsed = Number(value);
  if (value === undefined || value.length === 0 || !Number.isSafeInteger(parsed)) {
    return `2${value ?? ''}`;
  }
  return `${parsed < 0 ? '0' : '1'}${String(Math.abs(parsed)).padStart(12, '0')}`;
}

function wmlMember(localName: string): (record: ElementRecord) => boolean {
  return (record) => record.localName === localName && record.namespaceUri === WML_NAMESPACE_URI;
}

/**
 * The numbering part's members, in the order `CT_Numbering` requires.
 *
 * `w:abstractNum` must precede every `w:num`, so the key leads with the element's rank and
 * only then with its id. `w:numPicBullet` is not adopted: it is referenced by index from a
 * level, so re-homing one silently repoints a bullet at the wrong picture.
 */
function numberingSortKey(node: OoxmlElement): string {
  if (node.localName === 'abstractNum') {
    return `0${numericKey(attributeValue(node, 'abstractNumId'))}`;
  }
  return `1${numericKey(attributeValue(node, 'numId'))}`;
}

function isNumberingMember(record: ElementRecord): boolean {
  if (record.namespaceUri !== WML_NAMESPACE_URI) return false;
  return record.localName === 'abstractNum' || record.localName === 'num';
}

export function partMemberSpecFor(root: OoxmlElement): PartMemberSpec | null {
  if (root.localName === 'comments') {
    return {
      isMember: (record) => record.kind === 'comment',
      sortKey: (node) => node.id,
    };
  }
  if (root.localName === 'commentsEx') {
    return {
      isMember: (record) =>
        record.localName === 'commentEx' && record.namespaceUri === W15_NAMESPACE_URI,
      sortKey: (node) => node.id,
    };
  }
  if (root.localName === 'footnotes' && root.namespaceUri === WML_NAMESPACE_URI) {
    return {
      isMember: wmlMember('footnote'),
      sortKey: (node) => numericKey(attributeValue(node, 'id')),
    };
  }
  if (root.localName === 'endnotes' && root.namespaceUri === WML_NAMESPACE_URI) {
    return {
      isMember: wmlMember('endnote'),
      sortKey: (node) => numericKey(attributeValue(node, 'id')),
    };
  }
  if (root.localName === 'numbering' && root.namespaceUri === WML_NAMESPACE_URI) {
    return {
      isMember: isNumberingMember,
      sortKey: numberingSortKey,
    };
  }
  return null;
}
