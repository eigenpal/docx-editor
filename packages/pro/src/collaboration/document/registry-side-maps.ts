/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The attribute and namespace-binding side maps: how shared state is written, and the
 * per-node indexes the registry derives from their events.
 *
 * Both maps key by node id plus name, so a write touches one shared key and the derived
 * index mirrors it bucket by bucket. Nothing here reads the node map.
 */

import { rejectDangerousKey } from './limits.ts';
import {
  FIELD_SEP,
  attributeMapKey,
  bindingMapKey,
  internNamespace,
  namespaceIdOf,
  namespaceUriOf,
  packAttributeValue,
  parseAttributeMapKey,
  parseBindingMapKey,
  unpackAttributeValue,
  type EncodedAttribute,
  type EncodedBinding,
  type PackageSchema,
} from './schema.ts';
import type { LogicalId } from './identity.ts';

export type AttributeIndex = Map<LogicalId, Map<string, EncodedAttribute>>;
export type BindingIndex = Map<LogicalId, Map<string, EncodedBinding>>;

export function attrIdentity(namespaceId: string, localName: string): string {
  return `${namespaceId}${FIELD_SEP}${localName}`;
}

export function writeSharedAttribute(
  schema: PackageSchema,
  maxStringLength: number,
  logicalId: LogicalId,
  attribute: {
    readonly namespaceUri: string;
    readonly localName: string;
    readonly prefix?: string;
  },
  value: string
): void {
  if (rejectDangerousKey(logicalId) || rejectDangerousKey(attribute.localName)) return;
  const namespaceId = internNamespace(schema.namespaces, attribute.namespaceUri, maxStringLength);
  const key = attributeMapKey(logicalId, namespaceId, attribute.localName);
  if (rejectDangerousKey(key)) return;
  schema.attributes.set(key, packAttributeValue(attribute.prefix ?? '', value));
}

export function deleteSharedAttribute(
  schema: PackageSchema,
  logicalId: LogicalId,
  namespaceUri: string,
  localName: string
): void {
  schema.attributes.delete(attributeMapKey(logicalId, namespaceIdOf(namespaceUri), localName));
}

export function writeSharedBinding(
  schema: PackageSchema,
  maxStringLength: number,
  logicalId: LogicalId,
  prefix: string,
  uri: string
): void {
  if (rejectDangerousKey(logicalId) || rejectDangerousKey(prefix)) return;
  const namespaceId = internNamespace(schema.namespaces, uri, maxStringLength);
  const key = bindingMapKey(logicalId, prefix);
  if (rejectDangerousKey(key)) return;
  schema.bindings.set(key, namespaceId);
}

export function deleteSharedBinding(
  schema: PackageSchema,
  logicalId: LogicalId,
  prefix: string
): void {
  schema.bindings.delete(bindingMapKey(logicalId, prefix));
}

export function upsertIndexedAttribute(
  schema: PackageSchema,
  index: AttributeIndex,
  logicalId: LogicalId,
  namespaceId: string,
  localName: string,
  packed: string
): void {
  const { prefix, value } = unpackAttributeValue(packed);
  let bucket = index.get(logicalId);
  if (!bucket) {
    bucket = new Map();
    index.set(logicalId, bucket);
  }
  bucket.set(attrIdentity(namespaceId, localName), {
    namespaceUri: namespaceUriOf(schema.namespaces, namespaceId),
    localName,
    prefix: prefix.length > 0 ? prefix : undefined,
    value,
  });
}

export function removeIndexedAttribute(
  index: AttributeIndex,
  logicalId: LogicalId,
  namespaceId: string,
  localName: string
): void {
  const bucket = index.get(logicalId);
  if (!bucket) return;
  bucket.delete(attrIdentity(namespaceId, localName));
  if (bucket.size === 0) index.delete(logicalId);
}

export function upsertIndexedBinding(
  schema: PackageSchema,
  index: BindingIndex,
  logicalId: LogicalId,
  prefix: string,
  namespaceId: string
): void {
  let bucket = index.get(logicalId);
  if (!bucket) {
    bucket = new Map();
    index.set(logicalId, bucket);
  }
  bucket.set(prefix, {
    prefix,
    namespaceUri: namespaceUriOf(schema.namespaces, namespaceId),
  });
}

export function removeIndexedBinding(
  index: BindingIndex,
  logicalId: LogicalId,
  prefix: string
): void {
  const bucket = index.get(logicalId);
  if (!bucket) return;
  bucket.delete(prefix);
  if (bucket.size === 0) index.delete(logicalId);
}

/** Apply one attribute-map event to the derived index. Peer-controlled keys are skipped. */
export function applyAttributeMapEvent(
  schema: PackageSchema,
  index: AttributeIndex,
  event: import('yjs').YMapEvent<string>
): void {
  for (const [key, change] of event.changes.keys) {
    const parsed = parseAttributeMapKey(String(key));
    if (!parsed || rejectDangerousKey(parsed.logicalId) || rejectDangerousKey(parsed.localName)) {
      continue;
    }
    if (change.action === 'delete') {
      removeIndexedAttribute(index, parsed.logicalId, parsed.namespaceId, parsed.localName);
      continue;
    }
    const packed = schema.attributes.get(String(key));
    if (typeof packed !== 'string') continue;
    upsertIndexedAttribute(
      schema,
      index,
      parsed.logicalId,
      parsed.namespaceId,
      parsed.localName,
      packed
    );
  }
}

/** Apply one binding-map event to the derived index. Peer-controlled keys are skipped. */
export function applyBindingMapEvent(
  schema: PackageSchema,
  index: BindingIndex,
  event: import('yjs').YMapEvent<string>
): void {
  for (const [key, change] of event.changes.keys) {
    const parsed = parseBindingMapKey(String(key));
    if (!parsed || rejectDangerousKey(parsed.logicalId) || rejectDangerousKey(parsed.prefix)) {
      continue;
    }
    if (change.action === 'delete') {
      removeIndexedBinding(index, parsed.logicalId, parsed.prefix);
      continue;
    }
    const namespaceId = schema.bindings.get(String(key));
    if (typeof namespaceId !== 'string') continue;
    upsertIndexedBinding(schema, index, parsed.logicalId, parsed.prefix, namespaceId);
  }
}
