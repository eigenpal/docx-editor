/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  CUSTOM_XML_PROPS_REL,
  CUSTOM_XML_PROPS_TYPE,
  CUSTOM_XML_REL,
  DATASTORE_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  partNameKey,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { LogicalId } from './identity.ts';
import { isElementRecord, type ElementRecord, type EncodedRelationship } from './schema.ts';
import type { DocumentRegistry } from './registry.ts';

const ITEM_PART_RE = /^\/customXml\/item(\d+)\.xml$/i;
const PROPS_PART_RE = /^\/customXml\/itemProps(\d+)\.xml$/i;

export function isCustomXmlItemPartName(name: string): boolean {
  return ITEM_PART_RE.test(name);
}

export function isCustomXmlPropsPartName(name: string): boolean {
  return PROPS_PART_RE.test(name);
}

function itemIndexOf(name: string): number | null {
  const match = ITEM_PART_RE.exec(name);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index > 0 ? index : null;
}

function itemNames(index: number): { readonly item: string; readonly props: string } {
  return {
    item: `/customXml/item${String(index)}.xml`,
    props: `/customXml/itemProps${String(index)}.xml`,
  };
}

function attributeValue(
  record: ElementRecord,
  localName: string,
  namespaceUri: string
): string | null {
  const found = record.attributes.find(
    (attribute) => attribute.localName === localName && attribute.namespaceUri === namespaceUri
  );
  return found && found.value.length > 0 ? found.value : null;
}

function payloadNodeId(registry: DocumentRegistry, logicalId: LogicalId): string {
  const record = registry.record(logicalId);
  if (!record || !isElementRecord(record)) return logicalId;
  const found = record.attributes.find(
    (attribute) => attribute.localName === 'id' && attribute.value.length > 0
  );
  return found?.value ?? logicalId;
}

function schemaUriOf(registry: DocumentRegistry, propsRootId: LogicalId): string | null {
  const record = registry.record(propsRootId);
  if (!record || !isElementRecord(record)) return null;
  for (const childId of record.childIds) {
    const child = registry.record(childId);
    if (!child || !isElementRecord(child) || child.localName !== 'schemaRefs') continue;
    if (child.namespaceUri !== DATASTORE_NAMESPACE_URI) continue;
    for (const refId of child.childIds) {
      const ref = registry.record(refId);
      if (!ref || !isElementRecord(ref) || ref.localName !== 'schemaRef') continue;
      const uri = attributeValue(ref, 'uri', DATASTORE_NAMESPACE_URI);
      if (uri) return uri;
    }
  }
  return null;
}

function hasNodeChild(registry: DocumentRegistry, record: ElementRecord): boolean {
  return record.childIds.some((childId) => {
    const child = registry.record(childId);
    return (
      !!child &&
      isElementRecord(child) &&
      child.localName === 'node' &&
      child.namespaceUri === record.namespaceUri
    );
  });
}

function isCustomXmlDataRoot(registry: DocumentRegistry, record: ElementRecord): boolean {
  if (record.localName === 'node') return false;
  if (record.namespaceUri === WML_NAMESPACE_URI) return false;
  if (record.namespaceUri === DATASTORE_NAMESPACE_URI) return false;
  if (record.namespaceUri.length === 0) return false;
  if (registry.parentOf(record.logicalId) !== null) return false;
  return hasNodeChild(registry, record);
}

function isDatastoreItemRoot(registry: DocumentRegistry, record: ElementRecord): boolean {
  if (record.localName !== 'datastoreItem') return false;
  if (record.namespaceUri !== DATASTORE_NAMESPACE_URI) return false;
  return registry.parentOf(record.logicalId) === null;
}

export interface CustomXmlStorePlan {
  readonly dataRootId: LogicalId;
  readonly propsRootId: LogicalId;
  readonly namespaceUri: string;
  readonly itemName: string;
  readonly propsName: string;
  readonly nodeIds: readonly LogicalId[];
}

/**
 * Pair every customXml data root with the props root that names its namespace.
 *
 * Concurrent first-create of `item1.xml` is last-write-wins on the part map, so one
 * namespace's root can occupy `item1.xml` while the other namespace's props occupy
 * `itemProps1.xml`. Pairing by namespace, then assigning names in logical-id order,
 * is what makes both stores reachable regardless of which write landed last.
 */
export function planCustomXmlStores(
  registry: DocumentRegistry,
  parts: Map<string, OoxmlPart>
): readonly CustomXmlStorePlan[] {
  // Every plan pairs a data root with a props root, and a props root is only ever
  // recognized through a `schemaRefs` child in the datastore namespace. A document that
  // never interned that namespace therefore has no custom XML to repair, and the scan below
  // would visit every node in the document to conclude exactly that — on every received
  // character, for a file that has no custom XML part at all.
  if (!registry.hasNamespace(DATASTORE_NAMESPACE_URI)) return [];
  const dataById = new Map<LogicalId, ElementRecord>();
  const propsById = new Map<LogicalId, ElementRecord>();
  for (const [name, part] of parts) {
    const record = registry.record(part.root.id);
    if (!record || !isElementRecord(record)) continue;
    if (isCustomXmlItemPartName(name)) dataById.set(record.logicalId, record);
    if (isCustomXmlPropsPartName(name)) propsById.set(record.logicalId, record);
  }
  for (const id of registry.allLogicalIds()) {
    if (registry.isTombstoned(id) || dataById.has(id) || propsById.has(id)) continue;
    const record = registry.record(id);
    if (!record || !isElementRecord(record)) continue;
    if (isCustomXmlDataRoot(registry, record)) dataById.set(id, record);
    else if (isDatastoreItemRoot(registry, record)) propsById.set(id, record);
  }
  if (dataById.size === 0) return [];

  const dataByNs = new Map<string, ElementRecord[]>();
  for (const record of dataById.values()) {
    const list = dataByNs.get(record.namespaceUri) ?? [];
    list.push(record);
    dataByNs.set(record.namespaceUri, list);
  }
  const propsByNs = new Map<string, ElementRecord[]>();
  for (const record of propsById.values()) {
    const uri = schemaUriOf(registry, record.logicalId);
    if (!uri) continue;
    const list = propsByNs.get(uri) ?? [];
    list.push(record);
    propsByNs.set(uri, list);
  }

  const unpaired: {
    readonly data: ElementRecord;
    readonly props: ElementRecord;
    readonly nodeIds: LogicalId[];
  }[] = [];
  for (const [namespaceUri, dataRoots] of dataByNs) {
    const propsRoots = propsByNs.get(namespaceUri);
    if (!propsRoots || propsRoots.length === 0) continue;
    dataRoots.sort((left, right) => left.logicalId.localeCompare(right.logicalId));
    propsRoots.sort((left, right) => left.logicalId.localeCompare(right.logicalId));
    const survivor = dataRoots[0]!;
    const props = propsRoots[0]!;
    const nodeIds: LogicalId[] = [];
    const seen = new Set<LogicalId>();
    for (const root of dataRoots) {
      for (const childId of root.childIds) {
        if (seen.has(childId)) continue;
        const child = registry.record(childId);
        if (!child || !isElementRecord(child)) continue;
        if (child.localName !== 'node' || child.namespaceUri !== namespaceUri) continue;
        seen.add(childId);
        nodeIds.push(childId);
      }
    }
    for (const id of registry.allLogicalIds()) {
      if (seen.has(id) || registry.isTombstoned(id)) continue;
      const child = registry.record(id);
      if (!child || !isElementRecord(child)) continue;
      if (child.localName !== 'node' || child.namespaceUri !== namespaceUri) continue;
      seen.add(id);
      nodeIds.push(id);
    }
    nodeIds.sort((left, right) =>
      payloadNodeId(registry, left).localeCompare(payloadNodeId(registry, right))
    );
    unpaired.push({ data: survivor, props, nodeIds });
  }
  unpaired.sort((left, right) => left.data.logicalId.localeCompare(right.data.logicalId));

  const taken = new Set<number>();
  const assigned: CustomXmlStorePlan[] = [];
  const usedData = new Set<LogicalId>();
  const usedProps = new Set<LogicalId>();
  for (const [name, part] of parts) {
    const index = itemIndexOf(name);
    if (index === null) continue;
    const match = unpaired.find(
      (store) => store.data.logicalId === part.root.id && !usedData.has(store.data.logicalId)
    );
    if (!match) continue;
    const propsName = itemNames(index).props;
    const currentProps = parts.get(propsName);
    if (currentProps && currentProps.root.id !== match.props.logicalId) continue;
    taken.add(index);
    usedData.add(match.data.logicalId);
    usedProps.add(match.props.logicalId);
    assigned.push({
      dataRootId: match.data.logicalId,
      propsRootId: match.props.logicalId,
      namespaceUri: match.data.namespaceUri,
      itemName: name,
      propsName,
      nodeIds: match.nodeIds,
    });
  }
  let next = 1;
  for (const store of unpaired) {
    if (usedData.has(store.data.logicalId)) continue;
    while (taken.has(next)) next += 1;
    taken.add(next);
    const names = itemNames(next);
    assigned.push({
      dataRootId: store.data.logicalId,
      propsRootId: store.props.logicalId,
      namespaceUri: store.data.namespaceUri,
      itemName: names.item,
      propsName: names.props,
      nodeIds: store.nodeIds,
    });
    next += 1;
  }
  assigned.sort((left, right) => left.itemName.localeCompare(right.itemName));
  return assigned;
}

function isCustomXmlRelationship(record: EncodedRelationship): boolean {
  if (record.type === CUSTOM_XML_REL) return true;
  if (record.type === CUSTOM_XML_PROPS_REL) return true;
  return isCustomXmlItemPartName(record.ownerPart);
}

function relationshipNumber(id: string): number {
  const match = /^rId(\d+)$/.exec(id);
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : 0;
}

function relativeFromStory(storyPartName: string, itemName: string): string {
  const fromParts = storyPartName.split('/').slice(1, -1);
  const toParts = itemName.split('/').slice(1);
  let shared = 0;
  while (
    shared < fromParts.length &&
    shared < toParts.length - 1 &&
    fromParts[shared] === toParts[shared]
  ) {
    shared += 1;
  }
  return `${'../'.repeat(fromParts.length - shared)}${toParts.slice(shared).join('/')}`;
}

export function customXmlRepairRelationships(
  registry: DocumentRegistry,
  stores: readonly CustomXmlStorePlan[]
): readonly EncodedRelationship[] {
  if (stores.length === 0) return [];
  const story = registry.mainDocumentPart();
  if (!story) return [];
  const existing = registry.relationships();
  const storyRels = existing
    .filter((record) => record.ownerPart === story && record.type === CUSTOM_XML_REL)
    .sort((left, right) => left.id.localeCompare(right.id));
  let nextNumber = 0;
  for (const record of existing) {
    nextNumber = Math.max(nextNumber, relationshipNumber(record.id));
  }
  const repaired: EncodedRelationship[] = [];
  for (let index = 0; index < stores.length; index += 1) {
    const store = stores[index]!;
    const reused = storyRels[index];
    const storyId = reused?.id ?? `rId${String((nextNumber += 1))}`;
    repaired.push({
      ownerPart: story,
      id: storyId,
      type: CUSTOM_XML_REL,
      rawTarget: relativeFromStory(story, store.itemName),
      targetMode: 'Internal',
      order: reused?.order ?? index,
    });
    repaired.push({
      ownerPart: store.itemName,
      id: 'rId1',
      type: CUSTOM_XML_PROPS_REL,
      rawTarget: store.propsName.slice(store.propsName.lastIndexOf('/') + 1),
      targetMode: 'Internal',
      order: 0,
    });
  }
  return repaired;
}

export function mergeCustomXmlRelationships(
  base: readonly EncodedRelationship[],
  repaired: readonly EncodedRelationship[]
): EncodedRelationship[] {
  if (repaired.length === 0) return [...base];
  return [...base.filter((record) => !isCustomXmlRelationship(record)), ...repaired];
}

export function customXmlPropsOverrides(
  stores: readonly CustomXmlStorePlan[]
): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const store of stores) {
    overrides.set(partNameKey(store.propsName), CUSTOM_XML_PROPS_TYPE);
  }
  return overrides;
}

export function customXmlDirectoryChanged(
  parts: Map<string, OoxmlPart>,
  stores: readonly CustomXmlStorePlan[]
): boolean {
  if (stores.length === 0) return false;
  const currentItems = [...parts.keys()].filter(isCustomXmlItemPartName).sort();
  const plannedItems = stores.map((store) => store.itemName).sort();
  if (currentItems.length !== plannedItems.length) return true;
  if (currentItems.some((name, index) => name !== plannedItems[index])) return true;
  for (const store of stores) {
    const item = parts.get(store.itemName);
    const props = parts.get(store.propsName);
    if (!item || item.root.id !== store.dataRootId) return true;
    if (!props || props.root.id !== store.propsRootId) return true;
  }
  return false;
}

export function customXmlRepairNeeded(
  parts: Map<string, OoxmlPart>,
  stores: readonly CustomXmlStorePlan[]
): boolean {
  if (customXmlDirectoryChanged(parts, stores)) return true;
  for (const store of stores) {
    const item = parts.get(store.itemName);
    if (!item) return true;
    const have = new Set(item.root.children.map((child) => child.id));
    if (store.nodeIds.some((id) => !have.has(id))) return true;
    const actual: string[] = [];
    for (const child of item.root.children) {
      if (child.kind === 'textValue') continue;
      actual.push(
        child.attributes.find((attribute) => attribute.localName === 'id')?.value ?? child.id
      );
    }
    const expected = [...actual].sort((left, right) => left.localeCompare(right));
    if (actual.some((id, index) => id !== expected[index])) return true;
  }
  return false;
}
