import type { OoxmlElement, OoxmlPackage, OoxmlTextNode } from '@docx-editor.dev/core/store';
import type { CanonicalBinaryDescriptor } from '@docx-editor.dev/core/collaboration';
import {
  DEFAULT_DOCUMENT_LIMITS,
  rejectDangerousKey,
  rejectPartName,
  rejectString,
  type LimitCode,
} from './limits.ts';
import {
  BOOTSTRAP_ORIGIN,
  writeSchemaVersions,
  type EncodedAttribute,
  type EncodedBinding,
} from './schema.ts';
import type { DocumentRegistry } from './registry.ts';

export interface BlobBytesStore {
  get(digest: string): Uint8Array | null;
  put(digest: string, bytes: Uint8Array): void;
}

export type SeedResult = { readonly ok: true } | { readonly ok: false; readonly code: LimitCode };

export class MemoryBlobStore implements BlobBytesStore {
  private readonly blobs = new Map<string, Uint8Array>();
  get(digest: string): Uint8Array | null {
    const bytes = this.blobs.get(digest);
    return bytes ? bytes.slice() : null;
  }
  put(digest: string, bytes: Uint8Array): void {
    this.blobs.set(digest, bytes.slice());
  }
}

export async function sha256Digest(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    bytes.slice().buffer as ArrayBuffer
  );
  return `sha256:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function encodedAttributesOf(node: OoxmlElement): EncodedAttribute[] {
  return node.attributes.map((attribute) => ({
    namespaceUri: attribute.namespaceUri,
    localName: attribute.localName,
    prefix: attribute.prefix,
    value: attribute.value,
  }));
}

function encodedBindingsOf(node: OoxmlElement): EncodedBinding[] {
  return node.namespaceBindings.map((binding) => ({
    prefix: binding.prefix,
    namespaceUri: binding.namespaceUri,
  }));
}

function visitNode(
  registry: DocumentRegistry,
  node: OoxmlElement | OoxmlTextNode,
  parentId: string | null,
  depth: number,
  counts: { nodes: number }
): LimitCode | null {
  if (depth > registry.limits.maxTreeDepth) return 'tree-too-deep';
  if (rejectDangerousKey(node.id)) return 'prototype-key';
  counts.nodes += 1;
  if (counts.nodes > registry.limits.maxNodes) return 'too-many-nodes';
  if (node.kind === 'textValue') {
    if (node.value.length > registry.limits.maxTextLength) return 'text-too-long';
    registry.putText(node.id, node.value);
  } else {
    if (node.attributes.length > registry.limits.maxAttributes) return 'too-many-attributes';
    if (node.children.length > registry.limits.maxChildren) return 'too-many-children';
    if (rejectString(node.namespaceUri, registry.limits.maxStringLength)) return 'invalid-string';
    for (const attribute of node.attributes) {
      if (rejectDangerousKey(attribute.localName)) return 'prototype-key';
      if (rejectString(attribute.namespaceUri, registry.limits.maxStringLength)) {
        return 'invalid-string';
      }
    }
    for (const binding of node.namespaceBindings) {
      if (rejectDangerousKey(binding.prefix)) return 'prototype-key';
      if (rejectString(binding.namespaceUri, registry.limits.maxStringLength)) {
        return 'invalid-string';
      }
    }
    registry.putElement({
      logicalId: node.id,
      kind: node.kind,
      namespaceUri: node.namespaceUri,
      localName: node.localName,
      prefix: node.prefix,
      attributes: encodedAttributesOf(node),
      bindings: encodedBindingsOf(node),
    });
    for (const child of node.children) {
      const error = visitNode(registry, child, node.id, depth + 1, counts);
      if (error) return error;
    }
  }
  if (parentId) registry.childArray(parentId).push([node.id]);
  return null;
}

async function describeBinaries(
  pkg: OoxmlPackage,
  blobs: BlobBytesStore
): Promise<
  | { readonly ok: true; readonly descriptors: CanonicalBinaryDescriptor[] }
  | { readonly ok: false; readonly code: LimitCode }
> {
  const descriptors: CanonicalBinaryDescriptor[] = [];
  for (const [name, bytes] of pkg.partBytes) {
    if (pkg.parts.has(name)) continue;
    const resolved = pkg.contentTypes.overrides.get(name);
    const contentType = resolved ?? 'application/octet-stream';
    const partError = rejectPartName(name);
    if (partError) return { ok: false, code: partError };
    if (bytes.byteLength > DEFAULT_DOCUMENT_LIMITS.maxBlobBytes) {
      return { ok: false, code: 'blob-too-large' };
    }
    const digest = await sha256Digest(bytes);
    blobs.put(digest, bytes);
    descriptors.push({
      digest,
      size: bytes.byteLength,
      mediaType: contentType,
      storageKey: name,
    });
  }
  return { ok: true, descriptors };
}

/**
 * Seed complete shared state from a validated package in one Yjs transaction.
 * Binary bytes stay in `blobs`. Shared state stores descriptors only.
 */
export async function seedPackage(
  registry: DocumentRegistry,
  pkg: OoxmlPackage,
  blobs: BlobBytesStore = new MemoryBlobStore()
): Promise<SeedResult> {
  if (pkg.parts.size > registry.limits.maxParts) return { ok: false, code: 'too-many-parts' };
  const binaries = await describeBinaries(pkg, blobs);
  if (!binaries.ok) return binaries;
  let error: LimitCode | null = null;
  registry.beginBulkLoad();
  try {
    registry.doc.transact(() => {
      writeSchemaVersions(registry.schema.meta);
      registry.schema.meta.set('mainDocumentPart', pkg.mainDocumentPart);
      const counts = { nodes: 0 };
      for (const [name, part] of pkg.parts) {
        const partError = rejectPartName(name);
        if (partError) {
          error = partError;
          return;
        }
        if (rejectString(part.contentType, registry.limits.maxMediaTypeLength)) {
          error = 'invalid-string';
          return;
        }
        const visitError = visitNode(registry, part.root, null, 0, counts);
        if (visitError) {
          error = visitError;
          return;
        }
        registry.putXmlPart({
          name,
          id: part.id,
          rootLogicalId: part.root.id,
          contentType: part.contentType,
        });
      }
      let relationshipCount = 0;
      for (const records of pkg.relationships.values()) {
        for (const record of records) {
          relationshipCount += 1;
          if (relationshipCount > registry.limits.maxRelationships) {
            error = 'too-many-relationships';
            return;
          }
          if (record.ownerPart !== '/') {
            const ownerError = rejectPartName(record.ownerPart);
            if (ownerError) {
              error = ownerError;
              return;
            }
          }
          if (rejectDangerousKey(record.id)) {
            error = 'prototype-key';
            return;
          }
          registry.putRelationship({
            ownerPart: record.ownerPart,
            id: record.id,
            type: record.type,
            rawTarget: record.rawTarget,
            targetMode: record.targetMode,
            order: record.order,
          });
        }
      }
      for (const [extension, mediaType] of pkg.contentTypes.defaults) {
        if (rejectDangerousKey(extension)) {
          error = 'prototype-key';
          return;
        }
        registry.putContentTypeDefault(extension, mediaType);
      }
      for (const [partName, mediaType] of pkg.contentTypes.overrides) {
        const partError = rejectPartName(partName);
        if (partError) {
          error = partError;
          return;
        }
        registry.putContentTypeOverride(partName, mediaType);
      }
      for (const descriptor of binaries.descriptors) {
        registry.putBinary(descriptor);
      }
    }, BOOTSTRAP_ORIGIN);
  } finally {
    registry.endBulkLoad();
  }
  return error ? { ok: false, code: error } : { ok: true };
}
