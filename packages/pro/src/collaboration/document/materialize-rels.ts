/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Projection of `.rels` parts from the replicated relationship map.
//
// The map is the source of truth: `putRelationship` writes a record and never splices a
// `Relationship` child, so the node tree cannot answer what a `.rels` part contains. These
// helpers rebuild that tree from the records, reusing every child element whose record still
// says the same thing, because the part object's identity is a cache key downstream.

import type {
  OoxmlAttribute,
  OoxmlElement,
  OoxmlNode,
  OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { LogicalId } from './identity.ts';
import { rejectDangerousKey, rejectPartName } from './limits.ts';
import type { EncodedRelationship } from './schema.ts';

export const PACKAGE_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships';
export const RELATIONSHIPS_CONTENT_TYPE =
  'application/vnd.openxmlformats-package.relationships+xml';

const RELS_PART_NAME_RE = /^(.*)\/_rels\/([^/]*)\.rels$/;

export function isRelsPartName(name: string): boolean {
  return RELS_PART_NAME_RE.test(name);
}

export function relsOwnerOf(relsName: string): string | null {
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

export function relationshipMatchesRecord(node: OoxmlNode, record: EncodedRelationship): boolean {
  if (node.kind === 'textValue') return false;
  if (node.namespaceUri !== PACKAGE_RELATIONSHIPS_NAMESPACE) return false;
  if (node.localName !== 'Relationship') return false;
  if (attributeValue(node, 'Id') !== record.id) return false;
  if (attributeValue(node, 'Type') !== record.type) return false;
  if (attributeValue(node, 'Target') !== record.rawTarget) return false;
  const mode = attributeValue(node, 'TargetMode');
  return record.targetMode === 'External' ? mode === 'External' : mode === undefined;
}

export function childrenMatchRecords(
  root: OoxmlElement,
  records: readonly EncodedRelationship[]
): boolean {
  if (root.children.length !== records.length) return false;
  return root.children.every((child, index) => relationshipMatchesRecord(child, records[index]!));
}

export function relsShellMatches(left: OoxmlElement, right: OoxmlElement): boolean {
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

export function relationshipChildrenOf(
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

export function emptyRelsPart(relsName: string): OoxmlPart {
  return Object.freeze({
    id: relsName,
    name: relsName,
    contentType: RELATIONSHIPS_CONTENT_TYPE,
    root: emptyRelationshipsRoot(relsName),
  });
}

export function relationshipsByOwner(
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
