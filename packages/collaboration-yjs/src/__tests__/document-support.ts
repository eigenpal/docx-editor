import * as Y from 'yjs';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  semanticDigest,
  writeOoxmlPackage,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
  type OoxmlTextNode,
  type SemanticDigest,
} from '@docx-editor.dev/core/store';
import type { CanonicalPrimitiveJournal } from '@docx-editor.dev/core/collaboration';
import {
  DocumentRegistry,
  LogicalIdAllocator,
  MemoryBlobStore,
  PackageMaterializer,
  applyPrimitiveJournal,
  seedPackage,
  type BlobBytesStore,
  type LogicalId,
} from '../document/index.ts';

export const WML = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

export function loadPackage(bytes: Uint8Array): OoxmlPackage {
  const opened = readOoxmlPackage(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return opened.package;
}

export async function loadFixture(name: string): Promise<OoxmlPackage> {
  const bytes = await Bun.file(
    new URL(`../../../../e2e/fixtures/${name}`, import.meta.url)
  ).bytes();
  return loadPackage(bytes);
}

export function packageFingerprint(pkg: OoxmlPackage): string {
  return [...pkg.parts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, part]) => `${name}:${canonicalOoxmlFingerprint(part)}`)
    .join('\n');
}

export function packageDigest(pkg: OoxmlPackage): SemanticDigest {
  const parts = [...pkg.parts.values()].sort((left, right) => left.name.localeCompare(right.name));
  return semanticDigest(parts);
}

export function saveReopenDigest(pkg: OoxmlPackage): SemanticDigest {
  const bytes = writeOoxmlPackage(pkg);
  return packageDigest(loadPackage(bytes));
}

export function walk(node: OoxmlNode, visit: (node: OoxmlNode) => void): void {
  visit(node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) walk(child, visit);
}

export function collectKind(pkg: OoxmlPackage, kind: OoxmlElement['kind']): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  for (const part of pkg.parts.values()) {
    walk(part.root, (node) => {
      if (node.kind === kind) found.push(node);
    });
  }
  return found;
}

export function nodeText(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return node.children.map(nodeText).join('');
}

export function findText(pkg: OoxmlPackage, value: string): OoxmlTextNode {
  for (const part of pkg.parts.values()) {
    let found: OoxmlTextNode | null = null;
    walk(part.root, (node) => {
      if (node.kind === 'textValue' && node.value === value) found = node;
    });
    if (found) return found;
  }
  throw new Error(`text ${value} not found`);
}

export function findTextContaining(pkg: OoxmlPackage, value: string): OoxmlTextNode {
  for (const part of pkg.parts.values()) {
    let found: OoxmlTextNode | null = null;
    walk(part.root, (node) => {
      if (node.kind === 'textValue' && node.value.includes(value) && !found) found = node;
    });
    if (found) return found;
  }
  throw new Error(`text containing ${value} not found`);
}

export function mainPart(pkg: OoxmlPackage): OoxmlPart {
  const part = pkg.parts.get(pkg.mainDocumentPart);
  if (!part) throw new Error('main document part missing');
  return part;
}

export function parentOf(registry: DocumentRegistry, start: LogicalId, kind: string): LogicalId {
  let current: LogicalId | null = start;
  while (current) {
    const record = registry.record(current);
    if (record && record.kind === kind) return current;
    current = registry.parentOf(current);
  }
  throw new Error(`${kind} parent missing`);
}

export interface Replica {
  readonly doc: Y.Doc;
  readonly registry: DocumentRegistry;
  readonly materializer: PackageMaterializer;
  readonly mint: LogicalIdAllocator;
  readonly blobs: BlobBytesStore;
}

export async function seedReplica(
  pkg: OoxmlPackage,
  blobs: BlobBytesStore = new MemoryBlobStore(),
  clientID = 1,
  replicaId?: string
): Promise<Replica> {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  const registry = new DocumentRegistry(doc);
  const seeded = await seedPackage(registry, pkg, blobs);
  if (!seeded.ok) throw new Error(seeded.code);
  const materializer = new PackageMaterializer(registry, blobs);
  const rebuilt = materializer.rebuild();
  if (!rebuilt.ok) throw new Error(rebuilt.code);
  return {
    doc,
    registry,
    materializer,
    mint: new LogicalIdAllocator(replicaId),
    blobs,
  };
}

export function joinReplica(source: Replica, clientID = 2, replicaId?: string): Replica {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  const registry = new DocumentRegistry(doc);
  registry.beginBulkLoad();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source.doc), 'join');
  registry.endBulkLoad();
  const materializer = new PackageMaterializer(registry, source.blobs);
  const rebuilt = materializer.rebuild();
  if (!rebuilt.ok) throw new Error(rebuilt.code);
  return {
    doc,
    registry,
    materializer,
    mint: new LogicalIdAllocator(replicaId),
    blobs: source.blobs,
  };
}

export function destroyReplica(replica: Replica): void {
  replica.materializer.destroy();
  replica.doc.destroy();
}

export function packageOf(replica: Replica): OoxmlPackage {
  const result = replica.materializer.current();
  if (!result.ok) throw new Error(result.code);
  return result.package;
}

export function applyJournal(replica: Replica, journal: CanonicalPrimitiveJournal): void {
  const result = applyPrimitiveJournal(replica.registry, journal);
  if (!result.ok) throw new Error(result.code);
  const materialized = replica.materializer.rebuild();
  if (!materialized.ok) throw new Error(materialized.code);
}

export function spliceTextJournal(
  logicalId: string,
  utf16Start: number,
  insert: string,
  deleteCount = 0
): CanonicalPrimitiveJournal {
  return {
    effects: [{ kind: 'spliceText', logicalId, utf16Start, deleteCount, insert }],
  };
}

export function syncOne(source: Replica, target: Replica): Uint8Array {
  const update = Y.encodeStateAsUpdate(source.doc, Y.encodeStateVector(target.doc));
  Y.applyUpdate(target.doc, update, 'sync');
  const materialized = target.materializer.rebuild();
  if (!materialized.ok) throw new Error(materialized.code);
  return update;
}

export function syncBoth(left: Replica, right: Replica): void {
  syncOne(left, right);
  syncOne(right, left);
}

export function concurrent(
  left: Replica,
  right: Replica,
  leftEdit: () => void,
  rightEdit: () => void,
  order: 'left-right' | 'right-left' = 'left-right'
): { leftUpdate: Uint8Array; rightUpdate: Uint8Array } {
  const leftVector = Y.encodeStateVector(left.doc);
  const rightVector = Y.encodeStateVector(right.doc);
  leftEdit();
  rightEdit();
  const leftUpdate = Y.encodeStateAsUpdate(left.doc, rightVector);
  const rightUpdate = Y.encodeStateAsUpdate(right.doc, leftVector);
  if (order === 'left-right') {
    Y.applyUpdate(right.doc, leftUpdate, 'sync');
    Y.applyUpdate(left.doc, rightUpdate, 'sync');
  } else {
    Y.applyUpdate(left.doc, rightUpdate, 'sync');
    Y.applyUpdate(right.doc, leftUpdate, 'sync');
  }
  const leftResult = left.materializer.rebuild();
  const rightResult = right.materializer.rebuild();
  if (!leftResult.ok) throw new Error(leftResult.code);
  if (!rightResult.ok) throw new Error(rightResult.code);
  return { leftUpdate, rightUpdate };
}

export function expectConverged(left: Replica, right: Replica): void {
  const leftPrint = packageFingerprint(packageOf(left));
  const rightPrint = packageFingerprint(packageOf(right));
  if (leftPrint !== rightPrint) {
    throw new Error('replicas did not converge');
  }
}
