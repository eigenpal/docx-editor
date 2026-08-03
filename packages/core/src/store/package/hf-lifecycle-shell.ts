// Package shell helpers for header/footer lifecycle: relationships, content-types overrides.
// Internal to hf-lifecycle — not re-exported from package/index.ts.

import { strFromU8, strToU8 } from 'fflate';
import { createNodeIdAllocator, insertChildren, removeNode } from './ooxml-edit.ts';
import { readOoxmlPart, type OoxmlNode } from './ooxml-tree.ts';
import type { OoxmlExternalTarget, OoxmlPackage } from './ooxml-package.ts';
import { resolveInternalTarget, validateExternalTarget } from './opc-names.ts';
import type { RelationshipRecord } from './relationships.ts';
import { readXml, type XmlNode } from './xml-reader.ts';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const CONTENT_TYPES_PART = '/[Content_Types].xml';
/** Cap on owned relationships cloned with an unlinked furniture part. */
const MAX_OWNED_RELATIONSHIPS = 4_096;

export function freeRelationshipId(pkg: OoxmlPackage): string {
  let max = 0;
  for (const records of pkg.relationships.values()) {
    for (const record of records) {
      const match = /^rId(\d{1,9})$/.exec(record.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `rId${max + 1}`;
}

export function relsPartNameFor(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return `${partName.slice(0, slash)}/_rels/${partName.slice(slash + 1)}.rels`;
}

export function withStoryRelationship(
  pkg: OoxmlPackage,
  id: string,
  typeUri: string,
  target: string
): OoxmlPackage | null {
  // Target is always an engine-allocated relative name; refuse anything else.
  if (!/^(header|footer|settings)\d*\.xml$/.test(target) && target !== 'settings.xml') {
    return null;
  }
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

export function withFreshIds(node: OoxmlNode, nextId: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: nextId() };
  return {
    ...node,
    id: nextId(),
    children: node.children.map((child) => withFreshIds(child, nextId)),
  } as OoxmlNode;
}

function attributeOf(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

export function removeRelationship(pkg: OoxmlPackage, rId: string): OoxmlPackage | null {
  const owner = pkg.mainDocumentPart;
  const owned = pkg.relationships.get(owner) ?? [];
  const record = owned.find((entry) => entry.id === rId);
  if (!record) return pkg;
  const nextOwned = owned.filter((entry) => entry.id !== rId);
  const relationships = new Map([...pkg.relationships, [owner, nextOwned]]);

  const relsName = relsPartNameFor(owner);
  const relsPart = pkg.parts.get(relsName);
  if (!relsPart) {
    return Object.freeze({ ...pkg, relationships });
  }

  const node = relsPart.root.children.find(
    (child) =>
      child.kind !== 'textValue' &&
      child.localName === 'Relationship' &&
      attributeOf(child, 'Id') === rId
  );
  if (!node) {
    return Object.freeze({ ...pkg, relationships });
  }
  const removed = removeNode(relsPart, node.id);
  if (!removed.ok) return null;
  return Object.freeze({
    ...pkg,
    parts: new Map([...pkg.parts, [relsName, removed.part]]),
    relationships,
  });
}

/**
 * Clone every relationship owned by `sourceOwner` under `destOwner`.
 *
 * Preserves authored ids, types, raw targets, modes, and order. Internal targets are
 * re-checked against the new owner (same folder for headerN/footerN → same resolution);
 * unsafe traversal fails closed. External targets are copied as inert metadata only —
 * never fetched. Updates the `.rels` tree/bytes, the relationships map, and externalTargets.
 */
export function cloneOwnedRelationships(
  pkg: OoxmlPackage,
  sourceOwner: string,
  destOwner: string
): OoxmlPackage | null {
  if (sourceOwner === destOwner) return pkg;

  const sourceRecords = pkg.relationships.get(sourceOwner) ?? [];
  const sourceExternal = pkg.externalTargets.filter((entry) => entry.ownerPart === sourceOwner);
  const sourceRelsName = relsPartNameFor(sourceOwner);
  const destRelsName = relsPartNameFor(destOwner);
  const sourceRelsPart = pkg.parts.get(sourceRelsName);
  const sourceRelsBytes = pkg.partBytes.get(sourceRelsName);

  if (
    sourceRecords.length === 0 &&
    sourceExternal.length === 0 &&
    !sourceRelsPart &&
    !sourceRelsBytes
  ) {
    return pkg;
  }
  if (sourceRecords.length > MAX_OWNED_RELATIONSHIPS) return null;

  const clonedRecords: RelationshipRecord[] = [];
  for (const record of sourceRecords) {
    if (record.targetMode === 'Internal') {
      const resolved = resolveInternalTarget(destOwner, record.rawTarget);
      if (!resolved.ok) return null;
    }
    clonedRecords.push(
      Object.freeze({
        ownerPart: destOwner,
        id: record.id,
        type: record.type,
        rawTarget: record.rawTarget,
        targetMode: record.targetMode,
        order: record.order,
      })
    );
  }

  // External index entries may exist without a matching relationships-map row (authoring
  // lane). Preserve them under the new owner without inventing fetches.
  const coveredIds = new Set(clonedRecords.map((record) => record.id));
  const clonedExternal: OoxmlExternalTarget[] = [];
  for (const entry of sourceExternal) {
    const sinkSafe = validateExternalTarget(entry.rawTarget).ok;
    clonedExternal.push(
      Object.freeze({
        ownerPart: destOwner,
        id: entry.id,
        type: entry.type,
        rawTarget: entry.rawTarget,
        sinkSafe,
      })
    );
    if (coveredIds.has(entry.id)) continue;
    if (clonedRecords.length >= MAX_OWNED_RELATIONSHIPS) return null;
    clonedRecords.push(
      Object.freeze({
        ownerPart: destOwner,
        id: entry.id,
        type: entry.type,
        rawTarget: entry.rawTarget,
        targetMode: 'External' as const,
        order: clonedRecords.length === 0 ? 0 : clonedRecords[clonedRecords.length - 1]!.order + 1,
      })
    );
  }

  let next = pkg;

  if (sourceRelsPart) {
    const cloned = cloneRelsPart(sourceRelsPart, destRelsName);
    if (!cloned) return null;
    next = Object.freeze({
      ...next,
      parts: new Map([...next.parts, [destRelsName, cloned]]),
    });
  } else if (clonedRecords.length > 0) {
    const authored = authorRelsPart(destRelsName, clonedRecords);
    if (!authored) return null;
    next = Object.freeze({
      ...next,
      parts: new Map([...next.parts, [destRelsName, authored]]),
    });
  } else if (sourceRelsBytes) {
    // Bytes-only shell with no modeled records — copy verbatim under the new name.
    next = Object.freeze({
      ...next,
      partBytes: new Map([...next.partBytes, [destRelsName, sourceRelsBytes]]),
    });
  }

  const relationships = new Map(next.relationships);
  if (clonedRecords.length > 0) {
    relationships.set(destOwner, Object.freeze(clonedRecords));
  } else {
    relationships.delete(destOwner);
  }

  const externalTargets =
    clonedExternal.length > 0
      ? Object.freeze([...next.externalTargets, ...clonedExternal])
      : next.externalTargets;

  return Object.freeze({ ...next, relationships, externalTargets });
}

/** Drop an orphaned furniture part's owned relationship indexes and `.rels` entry. */
export function withoutOwnedRelationships(pkg: OoxmlPackage, ownerPart: string): OoxmlPackage {
  const relsName = relsPartNameFor(ownerPart);
  const parts = new Map(pkg.parts);
  parts.delete(relsName);
  const partBytes = new Map(pkg.partBytes);
  partBytes.delete(relsName);
  const relationships = new Map(pkg.relationships);
  relationships.delete(ownerPart);
  const externalTargets = Object.freeze(
    pkg.externalTargets.filter((entry) => entry.ownerPart !== ownerPart)
  );
  return Object.freeze({ ...pkg, parts, partBytes, relationships, externalTargets });
}

function cloneRelsPart(
  source: import('./ooxml-tree.ts').OoxmlPart,
  partName: string
): import('./ooxml-tree.ts').OoxmlPart | null {
  let counter = 0;
  const nextId = (): string => {
    counter += 1;
    return `${partName}#clone:${counter}`;
  };
  const cloned = withFreshIds(source.root, nextId);
  if (cloned.kind === 'textValue') return null;
  return Object.freeze({
    id: `part:${partName}`,
    name: partName,
    contentType: RELS_CONTENT_TYPE,
    root: cloned,
  });
}

function authorRelsPart(
  partName: string,
  records: readonly RelationshipRecord[]
): import('./ooxml-tree.ts').OoxmlPart | null {
  const body = records
    .map((record) => {
      const mode = record.targetMode === 'External' ? ' TargetMode="External"' : '';
      return (
        `<Relationship Id="${escapeXml(record.id)}" Type="${escapeXml(record.type)}" ` +
        `Target="${escapeXml(record.rawTarget)}"${mode}/>`
      );
    })
    .join('');
  const authored = readOoxmlPart(`<Relationships xmlns="${REL}">${body}</Relationships>`, {
    name: partName,
    contentType: RELS_CONTENT_TYPE,
  });
  return authored.ok ? authored.part : null;
}

export function withContentTypeOverride(
  pkg: OoxmlPackage,
  partName: string,
  contentType: string
): OoxmlPackage | null {
  const key = partName.toLowerCase();
  const declared = pkg.contentTypes.overrides.get(key);
  if (declared === contentType) return pkg;
  if (declared !== undefined) return null;

  const bytes = pkg.partBytes.get(CONTENT_TYPES_PART);
  if (!bytes) return null;
  const xml = strFromU8(bytes);
  const before = contentTypesShape(xml);
  if (!before) return null;

  const override = `<Override PartName="${partName}" ContentType="${contentType}"/>`;
  const close = xml.lastIndexOf(`</${before.rootName}>`);
  if (close === -1) return null;
  const patched = xml.slice(0, close) + override + xml.slice(close);

  const after = contentTypesShape(patched);
  if (!after || after.rootName !== before.rootName) return null;
  const expected = [
    ...before.children,
    childSignature('Override', { PartName: partName, ContentType: contentType }),
  ];
  if (after.children.length !== expected.length) return null;
  if (after.children.some((child, index) => child !== expected[index])) return null;

  return Object.freeze({
    ...pkg,
    partBytes: new Map([...pkg.partBytes, [CONTENT_TYPES_PART, strToU8(patched)]]),
    contentTypes: Object.freeze({
      defaults: pkg.contentTypes.defaults,
      overrides: new Map([...pkg.contentTypes.overrides, [key, contentType]]),
    }),
  });
}

export function withoutContentTypeOverride(
  pkg: OoxmlPackage,
  partName: string
): OoxmlPackage | null {
  const key = partName.toLowerCase();
  if (!pkg.contentTypes.overrides.has(key)) return pkg;

  const bytes = pkg.partBytes.get(CONTENT_TYPES_PART);
  if (!bytes) return null;
  const xml = strFromU8(bytes);
  const before = contentTypesShape(xml);
  if (!before) return null;

  const parsed = readXml(xml);
  if (!parsed.ok) return null;
  const roots = parsed.nodes.filter(
    (node): node is Extract<XmlNode, { type: 'element' }> => node.type === 'element'
  );
  if (roots.length !== 1) return null;
  const root = roots[0]!;

  // Rebuild children excluding the matching Override — never regex-splice attacker XML.
  const kept: XmlNode[] = [];
  let removed = false;
  for (const child of root.children) {
    if (child.type !== 'element') {
      kept.push(child);
      continue;
    }
    const local = child.name.includes(':')
      ? child.name.slice(child.name.indexOf(':') + 1)
      : child.name;
    if (
      local === 'Override' &&
      (child.attributes.PartName === partName || child.attributes.PartName?.toLowerCase() === key)
    ) {
      removed = true;
      continue;
    }
    kept.push(child);
  }
  if (!removed) return pkg;

  const rebuiltRoot = { ...root, children: kept };
  const rebuilt = serializeContentTypes({ ...parsed, nodes: [rebuiltRoot] }, before.rootName);
  if (!rebuilt) return null;
  const after = contentTypesShape(rebuilt);
  if (!after || after.rootName !== before.rootName) return null;
  if (after.children.length !== before.children.length - 1) return null;

  const overrides = new Map(pkg.contentTypes.overrides);
  overrides.delete(key);
  return Object.freeze({
    ...pkg,
    partBytes: new Map([...pkg.partBytes, [CONTENT_TYPES_PART, strToU8(rebuilt)]]),
    contentTypes: Object.freeze({
      defaults: pkg.contentTypes.defaults,
      overrides,
    }),
  });
}

function serializeContentTypes(
  parsed: { readonly nodes: readonly XmlNode[] },
  rootName: string
): string | null {
  const root = parsed.nodes.find(
    (node): node is Extract<XmlNode, { type: 'element' }> =>
      node.type === 'element' && node.name === rootName
  );
  if (!root) return null;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + serializeXmlElement(root);
}

function serializeXmlElement(node: Extract<XmlNode, { type: 'element' }>): string {
  const attrs = Object.entries(node.attributes)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join('');
  if (node.children.length === 0) return `<${node.name}${attrs}/>`;
  const body = node.children
    .map((child) => {
      if (child.type === 'element') return serializeXmlElement(child);
      if (child.type === 'text') return escapeXml(child.value);
      return '';
    })
    .join('');
  return `<${node.name}${attrs}>${body}</${node.name}>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
