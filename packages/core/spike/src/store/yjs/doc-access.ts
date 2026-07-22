/** @spike-features yjs-backend */
import * as Y from 'yjs';
import type { BootstrapContext, YjsAllocatorRecord } from './doc-types';
import {
  codeUnitCompare,
  creationIdFor,
  parseCommitSeq,
  parseCreationId,
  yjsCommitIdFor,
} from './identity';

export const YJS_ROOT_NAME = 'root';
const REPLICA_COMMIT_STRIDE = 1_048_576;
export const YJS_ROOT_KEYS = [
  'meta',
  'storyOrder',
  'stories',
  'blocks',
  'texts',
  'marks',
  'capsules',
  'allocator',
] as const;

type YjsRootKey = (typeof YJS_ROOT_KEYS)[number];

export function hexEncode(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hexDecode(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) {
    throw new TypeError('invalid hex bytes');
  }
  return Uint8Array.from(
    Array.from({ length: value.length / 2 }, (_, index) =>
      Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
    )
  );
}

export function checkpointFor(
  revision: number,
  canonicalFingerprint: string,
  stateVector: Uint8Array = new Uint8Array()
): string {
  const vectorHash = new Bun.CryptoHasher('sha256').update(stateVector).digest('hex');
  return `yjs-${revision}-${canonicalFingerprint.slice(0, 16)}-${vectorHash.slice(0, 16)}`;
}

export function createReplicaYjsDoc(input: {
  readonly documentId: string;
  readonly replicaId: string;
  readonly clientId?: number;
}): Y.Doc {
  const doc = new Y.Doc({ gc: false });
  if (input.clientId !== undefined) {
    if (!Number.isInteger(input.clientId) || input.clientId <= 0 || input.clientId > 0xffff_ffff) {
      throw new TypeError('Yjs client ID must be a nonzero uint32');
    }
    doc.clientID = input.clientId;
  }
  doc.getMap(YJS_ROOT_NAME);
  return doc;
}

export function createYjsDoc(
  options: {
    readonly documentId?: string;
    readonly replicaId?: string;
    readonly clientId?: number;
  } = {}
): Y.Doc {
  return createReplicaYjsDoc({
    documentId: options.documentId ?? 'doc-spike-0',
    replicaId: options.replicaId ?? 'replica-default',
    clientId: options.clientId,
  });
}

export function initializeRoot(doc: Y.Doc): Y.Map<unknown> {
  const root = doc.getMap<unknown>(YJS_ROOT_NAME);
  if (root.size > 0) return root;
  doc.transact(() => {
    root.set('meta', new Y.Map<unknown>());
    root.set('storyOrder', new Y.Array<string>());
    root.set('stories', new Y.Map<Y.Map<unknown>>());
    root.set('blocks', new Y.Map<Y.Map<unknown>>());
    root.set('texts', new Y.Map<Y.Map<unknown>>());
    root.set('marks', new Y.Map<Y.Map<unknown>>());
    root.set('capsules', new Y.Map<Y.Map<unknown>>());
    root.set('allocator', new Y.Map<Y.Map<unknown>>());
  });
  return root;
}

export function getRoot(doc: Y.Doc): Y.Map<unknown> {
  const root = doc.share.get(YJS_ROOT_NAME);
  if (!(root instanceof Y.Map)) throw new TypeError('Yjs root must be Y.Map');
  if (
    doc.share.size !== 1 ||
    [...doc.share.keys()][0] !== YJS_ROOT_NAME ||
    root.size !== YJS_ROOT_KEYS.length
  ) {
    throw new TypeError('Yjs document must contain exactly one frozen root map');
  }
  return root;
}

export function setRecordField(map: Y.Map<unknown>, key: string, value: unknown): void {
  map.set(key, value);
}

export function getRecordField<T>(map: Y.Map<unknown>, key: string): T {
  return map.get(key) as T;
}

export function getRootMap(doc: Y.Doc, key: Exclude<YjsRootKey, 'storyOrder'>): Y.Map<unknown> {
  const value = getRoot(doc).get(key);
  if (!(value instanceof Y.Map)) throw new TypeError(`${key} must be Y.Map`);
  return value;
}

export function getRootArray(doc: Y.Doc, key: 'storyOrder'): Y.Array<string> {
  const value = getRoot(doc).get(key);
  if (!(value instanceof Y.Array)) throw new TypeError(`${key} must be Y.Array`);
  return value as Y.Array<string>;
}

export function getMetaMap(doc: Y.Doc, key: 'collisionCandidates' | 'tombstones'): Y.Map<unknown> {
  const meta = getRootMap(doc, 'meta');
  const value = meta.get(key);
  if (!(value instanceof Y.Map)) throw new TypeError(`meta.${key} must be Y.Map`);
  return value;
}

export function writeProvenance(
  record: Y.Map<unknown>,
  creationId: string,
  semanticId: string,
  ctx: BootstrapContext
): void {
  setRecordField(record, 'creationId', creationId);
  setRecordField(record, 'semanticId', semanticId);
  setRecordField(record, 'proposedSemanticId', semanticId);
  setRecordField(record, 'actorId', ctx.actorId);
  setRecordField(record, 'commitId', yjsCommitIdFor(ctx.commitSeq));
}

export function nextCreation(ctx: BootstrapContext): string {
  const creationId = creationIdFor(ctx.actorId, ctx.commitSeq, ctx.localSeq);
  ctx.localSeq += 1;
  return creationId;
}

export function registerSemantic(ctx: BootstrapContext, semanticId: string): void {
  ctx.observedSemanticIds.add(semanticId);
}

export function findRecordCreationId(
  doc: Y.Doc,
  mapName: 'stories' | 'blocks' | 'texts' | 'marks' | 'capsules',
  semanticId: string
): string | undefined {
  for (const [creationId, record] of getRootMap(doc, mapName)) {
    if (getRecordField<string>(record as Y.Map<unknown>, 'semanticId') === semanticId) {
      return creationId;
    }
  }
  return undefined;
}

export function findBlockCreationId(doc: Y.Doc, blockId: string): string | undefined {
  return findRecordCreationId(doc, 'blocks', blockId);
}

export function readAllocatorRecords(doc: Y.Doc): Map<string, YjsAllocatorRecord> {
  const records = new Map<string, YjsAllocatorRecord>();
  for (const [actorId, value] of getRootMap(doc, 'allocator')) {
    const record = value as Y.Map<unknown>;
    const observed = getRecordField<Y.Map<boolean>>(record, 'observedSemanticIds');
    if (!(observed instanceof Y.Map)) throw new TypeError('allocator observed IDs must be Y.Map');
    records.set(actorId, {
      actorId,
      nextLocalSeq: getRecordField<number>(record, 'nextLocalSeq'),
      nextCommitSeq: getRecordField<number>(record, 'nextCommitSeq'),
      observedSemanticIds: new Set(observed.keys()),
    });
  }
  return records;
}

export function createActorContext(
  doc: Y.Doc,
  actorId: string,
  requestedCommitSeq?: number
): BootstrapContext {
  const existing = readAllocatorRecords(doc).get(actorId);
  const observedSemanticIds = new Set(existing?.observedSemanticIds ?? []);
  let maxLocalSeq = 0;
  let maxCommitSeq = 0;
  for (const mapName of ['stories', 'blocks', 'texts', 'marks', 'capsules'] as const) {
    for (const [creationId, value] of getRootMap(doc, mapName)) {
      const record = value as Y.Map<unknown>;
      observedSemanticIds.add(getRecordField<string>(record, 'semanticId'));
      observedSemanticIds.add(getRecordField<string>(record, 'proposedSemanticId'));
      const parsed = parseCreationId(creationId);
      if (parsed?.actorId === actorId) {
        maxLocalSeq = Math.max(maxLocalSeq, parsed.localSeq);
        maxCommitSeq = Math.max(maxCommitSeq, parsed.commitSeq);
      }
      if (getRecordField<string>(record, 'actorId') === actorId) {
        maxCommitSeq = Math.max(
          maxCommitSeq,
          parseCommitSeq(getRecordField<string>(record, 'commitId')) ?? 0
        );
      }
    }
  }
  const commitSeq = requestedCommitSeq ?? Math.max(existing?.nextCommitSeq ?? 1, maxCommitSeq + 1);
  return {
    actorId,
    commitSeq,
    localSeq: Math.max(existing?.nextLocalSeq ?? 1, maxLocalSeq + 1),
    sourceClientId: doc.clientID,
    observedSemanticIds,
  };
}

export function nextReplicaCommitSeq(doc: Y.Doc, actorId: string): number {
  let nextOrdinal = 1;
  const namespace = doc.clientID;
  const allocator = getRootMap(doc, 'allocator').get(actorId);
  if (allocator instanceof Y.Map) {
    const allocatorNext = getRecordField<unknown>(allocator, 'nextCommitSeq');
    if (
      typeof allocatorNext === 'number' &&
      Number.isSafeInteger(allocatorNext) &&
      Math.floor(allocatorNext / REPLICA_COMMIT_STRIDE) === namespace
    ) {
      nextOrdinal = Math.max(nextOrdinal, allocatorNext % REPLICA_COMMIT_STRIDE);
    }
  }
  for (const mapName of ['stories', 'blocks', 'texts', 'marks', 'capsules'] as const) {
    for (const [creationId] of getRootMap(doc, mapName)) {
      const parsed = parseCreationId(creationId);
      if (
        parsed?.actorId === actorId &&
        Math.floor(parsed.commitSeq / REPLICA_COMMIT_STRIDE) === namespace
      ) {
        nextOrdinal = Math.max(nextOrdinal, (parsed.commitSeq % REPLICA_COMMIT_STRIDE) + 1);
      }
    }
  }
  for (const value of getMetaMap(doc, 'tombstones').values()) {
    const tombstone = value as { actorId?: unknown; commitId?: unknown };
    if (tombstone.actorId !== actorId || typeof tombstone.commitId !== 'string') continue;
    const commitSeq = parseCommitSeq(tombstone.commitId);
    if (commitSeq !== null && Math.floor(commitSeq / REPLICA_COMMIT_STRIDE) === namespace) {
      nextOrdinal = Math.max(nextOrdinal, (commitSeq % REPLICA_COMMIT_STRIDE) + 1);
    }
  }
  if (nextOrdinal >= REPLICA_COMMIT_STRIDE) {
    throw new TypeError('replica commit namespace exhausted');
  }
  const commitSeq = namespace * REPLICA_COMMIT_STRIDE + nextOrdinal;
  if (!Number.isSafeInteger(commitSeq)) {
    throw new TypeError('replica commit sequence exceeds safe integer range');
  }
  return commitSeq;
}

export function writeAllocator(doc: Y.Doc, ctx: BootstrapContext): void {
  const allocator = getRootMap(doc, 'allocator');
  const existing = allocator.get(ctx.actorId) as Y.Map<unknown> | undefined;
  const record = existing ?? new Y.Map<unknown>();
  const observed =
    existing && getRecordField<unknown>(record, 'observedSemanticIds') instanceof Y.Map
      ? getRecordField<Y.Map<boolean>>(record, 'observedSemanticIds')
      : new Y.Map<boolean>();
  for (const semanticId of [...ctx.observedSemanticIds].sort(codeUnitCompare)) {
    if (!existing || !observed.has(semanticId)) observed.set(semanticId, true);
  }
  if (!existing || getRecordField<string>(record, 'actorId') !== ctx.actorId) {
    setRecordField(record, 'actorId', ctx.actorId);
  }
  const nextLocalSeq = Math.max(
    ctx.localSeq,
    existing ? getRecordField<number>(record, 'nextLocalSeq') : 1
  );
  if (!existing || getRecordField<number>(record, 'nextLocalSeq') !== nextLocalSeq) {
    setRecordField(record, 'nextLocalSeq', nextLocalSeq);
  }
  const nextCommitSeq = Math.max(
    ctx.commitSeq + 1,
    existing ? getRecordField<number>(record, 'nextCommitSeq') : 1
  );
  if (!existing || getRecordField<number>(record, 'nextCommitSeq') !== nextCommitSeq) {
    setRecordField(record, 'nextCommitSeq', nextCommitSeq);
  }
  if (!existing) {
    setRecordField(record, 'observedSemanticIds', observed);
    allocator.set(ctx.actorId, record);
  }
}

export function rewriteAllocatorRecord(doc: Y.Doc, actorId: string): void {
  const allocator = getRootMap(doc, 'allocator');
  const existing = allocator.get(actorId) as Y.Map<unknown> | undefined;
  if (!existing) return;
  const existingObserved = getRecordField<Y.Map<boolean>>(existing, 'observedSemanticIds');
  const record = new Y.Map<unknown>();
  const observed = new Y.Map<boolean>();
  for (const semanticId of [...existingObserved.keys()].sort(codeUnitCompare)) {
    observed.set(semanticId, true);
  }
  setRecordField(record, 'actorId', actorId);
  setRecordField(record, 'nextLocalSeq', getRecordField<number>(existing, 'nextLocalSeq'));
  setRecordField(record, 'nextCommitSeq', getRecordField<number>(existing, 'nextCommitSeq'));
  setRecordField(record, 'observedSemanticIds', observed);
  allocator.set(actorId, record);
}
