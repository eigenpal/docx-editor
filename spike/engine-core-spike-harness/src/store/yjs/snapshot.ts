/** @spike-features yjs-backend */
import * as Y from 'yjs';
import { canonicalJson } from '../../canonical-json';
import {
  readClosedDataObject,
  snapshotDenseArray,
} from '../../contracts/closed-input';
import { isSpikeId } from '../../contracts/ids';
import {
  createReplicationUpdateEnvelope,
  type ReplicationUpdateEnvelope,
} from '../../contracts/replication-update';
import {
  createSnapshotEnvelope,
  snapshotAndValidateSnapshot,
  type SnapshotEnvelope,
} from '../../contracts/snapshot';
import {
  authoredFingerprintPayload,
  fingerprintAuthoredModel,
} from '../../model/fingerprint';
import { createDocumentModel } from '../../model/fixture';
import type { DocumentModel } from '../../model/types';
import {
  createDocOpBatch,
  type DocOpSingle,
} from '../../contracts/doc-op';
import type { OperationEnvironment } from '../operation-environment';
import {
  decodeHistorySnapshotPayload,
  encodeHistorySnapshotPayload,
  type ActorSessionGroupHistoryState,
} from '../history';
import {
  YJS_BACKEND_VERSION,
  YJS_MAX_SNAPSHOT_BYTES,
  YJS_MAX_PENDING_BYTES_PER_SOURCE,
  YJS_MAX_PENDING_UPDATE_BYTES,
  YJS_MAX_PENDING_UPDATES,
  YJS_MAX_PENDING_UPDATES_PER_SOURCE,
  YJS_MAX_RESEED_JOURNAL_BYTES,
  YJS_MAX_RESEED_JOURNAL_ENTRIES,
  YJS_NORMALIZATION_VERSION,
  YJS_SCHEMA_VERSION,
  YJS_SNAPSHOT_KIND,
} from './constants';
import {
  checkpointFor,
  createReplicaYjsDoc,
  getRoot,
  hexDecode,
  hexEncode,
  readAllocatorRecords,
} from './doc-access';
import { decodeYjsDocState } from './doc-decode';
import { deriveAuthoredPackageFromYjs } from './doc-derive';
import type { YjsDocState } from './doc-types';
import { validateDecodedYjsModel } from '../../comparators/yjs-schema-fingerprint';
import { codeUnitCompare } from './identity';

export interface RestoredYjsBackendState {
  readonly identity: {
    readonly documentId: string;
    readonly backendVersion: string;
    readonly schemaVersion: string;
    readonly normalizationVersion: string;
    readonly replicaId: string;
    readonly sessionId: string;
    readonly clientId: number;
  };
  readonly model: DocumentModel;
  readonly yjsState: YjsDocState;
  readonly stateVector: Uint8Array;
  readonly appliedConstituentIds: readonly string[];
  readonly appliedCommitIds: readonly string[];
  readonly appliedUpdateIds: readonly string[];
  readonly appliedSemanticUpdateIds: readonly string[];
  readonly appliedUpdateDigests: readonly {
    readonly updateId: string;
    readonly digest: string;
  }[];
  readonly appliedRepairCanonicalDigests: readonly {
    readonly updateId: string;
    readonly digest: string;
  }[];
  readonly nextRepairSeq: number;
  readonly bufferedUpdates: readonly ReplicationUpdateEnvelope[];
  readonly clientOwners: readonly {
    readonly clientId: number;
    readonly replicaId: string;
    readonly sessionId: string;
  }[];
  readonly publicationJournal: readonly RestoredLocalPublicationJournalEntry[];
  readonly remoteEventsSinceLastLocal: readonly ReplicationUpdateEnvelope[];
  readonly reseedCheckpoint: RestoredReseedCheckpoint;
  readonly env: OperationEnvironment;
  readonly replicaId: string;
  readonly sessionId: string;
  readonly clientId: number;
  readonly actorSessionGroupHistory: ActorSessionGroupHistoryState;
}

export interface RestoredReseedCheckpoint {
  readonly canonicalFingerprint: string;
  readonly stateVector: Uint8Array;
  readonly fullState: Uint8Array;
  readonly revision: number;
  readonly nextJournalSequence: number;
}

export interface RestoredLocalPublicationJournalEntry {
  readonly sequence: number;
  readonly baseRevision: number;
  readonly semanticUpdateId: string;
  readonly attemptUpdateIds: readonly string[];
  readonly constituentIds: readonly string[];
  readonly actorId: string;
  readonly originSessionId: string;
  readonly ops: readonly DocOpSingle[];
  readonly baseFullState: Uint8Array;
  readonly latestAttempt: ReplicationUpdateEnvelope;
  readonly remoteEventsBefore: readonly ReplicationUpdateEnvelope[];
}

export function encodeYjsBackendSnapshot(input: {
  readonly identity: RestoredYjsBackendState['identity'];
  readonly model: DocumentModel;
  readonly yjsState: YjsDocState;
  readonly appliedConstituentIds: readonly string[];
  readonly appliedCommitIds: readonly string[];
  readonly appliedUpdateIds: readonly string[];
  readonly appliedSemanticUpdateIds: readonly string[];
  readonly appliedUpdateDigests: readonly {
    readonly updateId: string;
    readonly digest: string;
  }[];
  readonly appliedRepairCanonicalDigests: readonly {
    readonly updateId: string;
    readonly digest: string;
  }[];
  readonly nextRepairSeq: number;
  readonly bufferedUpdates: readonly ReplicationUpdateEnvelope[];
  readonly clientOwners: RestoredYjsBackendState['clientOwners'];
  readonly publicationJournal: RestoredYjsBackendState['publicationJournal'];
  readonly remoteEventsSinceLastLocal: readonly ReplicationUpdateEnvelope[];
  readonly reseedCheckpoint: RestoredReseedCheckpoint;
  readonly env: OperationEnvironment;
  readonly replicaId: string;
  readonly sessionId: string;
  readonly clientId: number;
  readonly actorSessionGroupHistory: ActorSessionGroupHistoryState;
}): SnapshotEnvelope {
  const derived = createDocumentModel(
    deriveAuthoredPackageFromYjs(input.yjsState),
    input.model.revision
  );
  const canonicalFingerprint = fingerprintAuthoredModel(input.model);
  if (fingerprintAuthoredModel(derived) !== canonicalFingerprint) {
    throw new TypeError('snapshot canonical/Yjs fingerprint mismatch');
  }
  const decodedErrors = validateDecodedYjsModel(decodeYjsDocState(input.yjsState));
  if (decodedErrors.length > 0) {
    throw new TypeError(`snapshot Yjs schema invalid: ${decodedErrors.join('; ')}`);
  }
  const stateVector = Y.encodeStateVector(input.yjsState.doc);
  const checkpoint = checkpointFor(
    input.model.revision,
    canonicalFingerprint,
    stateVector
  );
  const payload = {
    kind: YJS_SNAPSHOT_KIND,
    backendVersion: input.identity.backendVersion,
    schemaVersion: input.identity.schemaVersion,
    normalizationVersion: input.identity.normalizationVersion,
    documentId: input.identity.documentId,
    checkpoint,
    replicaId: input.replicaId,
    sessionId: input.sessionId,
    clientId: input.clientId,
    localRevision: input.model.revision,
    canonicalState: authoredFingerprintPayload(input.model),
    canonicalFingerprint,
    yjsUpdateHex: hexEncode(Y.encodeStateAsUpdate(input.yjsState.doc)),
    stateVectorHex: hexEncode(stateVector),
    operationEnvironment: {
      actorId: input.env.actorId,
      nextCommitSeq: input.env.nextCommitSeq,
      nextLocalSeq: input.env.nextLocalSeq,
      reservedSemanticIds: [...input.env.reservedSemanticIds].sort(codeUnitCompare),
    },
    appliedConstituentIds: sortedUnique(input.appliedConstituentIds),
    appliedCommitIds: sortedUnique(input.appliedCommitIds),
    appliedUpdateIds: sortedUnique(input.appliedUpdateIds),
    appliedSemanticUpdateIds: sortedUnique(input.appliedSemanticUpdateIds),
    appliedUpdateDigests: [...input.appliedUpdateDigests]
      .sort((left, right) => codeUnitCompare(left.updateId, right.updateId))
      .map((entry) => ({ updateId: entry.updateId, digest: entry.digest })),
    appliedRepairCanonicalDigests: [...input.appliedRepairCanonicalDigests]
      .sort((left, right) => codeUnitCompare(left.updateId, right.updateId))
      .map((entry) => ({ updateId: entry.updateId, digest: entry.digest })),
    nextRepairSeq: input.nextRepairSeq,
    bufferedUpdates: [...input.bufferedUpdates]
      .sort((left, right) => codeUnitCompare(left.updateId, right.updateId))
      .map((update) => ({
        documentId: update.documentId,
        backendVersion: update.backendVersion,
        schemaVersion: update.schemaVersion,
        checkpoint: update.checkpoint,
        updateId: update.updateId,
        semanticUpdateId: update.semanticUpdateId,
        sourceActorId: update.sourceActorId,
        sourceReplicaId: update.sourceReplicaId,
        sourceSessionId: update.sourceSessionId,
        sourceClientId: update.sourceClientId,
        constituentIds: [...update.constituentIds],
        coverage: update.coverage,
        clockRanges: clockRangesFor(update.bytes),
        bytesHex: hexEncode(update.bytes),
      })),
    clientOwners: [...input.clientOwners]
      .sort((left, right) => left.clientId - right.clientId)
      .map((owner) => ({ ...owner })),
    pendingLimits: {
      maxCount: YJS_MAX_PENDING_UPDATES,
      maxAggregateBytes: YJS_MAX_PENDING_UPDATE_BYTES,
      maxCountPerSource: YJS_MAX_PENDING_UPDATES_PER_SOURCE,
      maxBytesPerSource: YJS_MAX_PENDING_BYTES_PER_SOURCE,
    },
    publicationJournal: input.publicationJournal.map((entry) => ({
      sequence: entry.sequence,
      baseRevision: entry.baseRevision,
      semanticUpdateId: entry.semanticUpdateId,
      attemptUpdateIds: [...entry.attemptUpdateIds],
      constituentIds: [...entry.constituentIds],
      actorId: entry.actorId,
      originSessionId: entry.originSessionId,
      ops: entry.ops,
      baseFullStateHex: hexEncode(entry.baseFullState),
      latestAttempt: {
        documentId: entry.latestAttempt.documentId,
        backendVersion: entry.latestAttempt.backendVersion,
        schemaVersion: entry.latestAttempt.schemaVersion,
        checkpoint: entry.latestAttempt.checkpoint,
        updateId: entry.latestAttempt.updateId,
        semanticUpdateId: entry.latestAttempt.semanticUpdateId,
        sourceActorId: entry.latestAttempt.sourceActorId,
        sourceReplicaId: entry.latestAttempt.sourceReplicaId,
        sourceSessionId: entry.latestAttempt.sourceSessionId,
        sourceClientId: entry.latestAttempt.sourceClientId,
        constituentIds: [...entry.latestAttempt.constituentIds],
        coverage: entry.latestAttempt.coverage,
        clockRanges: clockRangesFor(entry.latestAttempt.bytes),
        bytesHex: hexEncode(entry.latestAttempt.bytes),
      },
      remoteEventsBefore: entry.remoteEventsBefore.map(serializeStoredUpdate),
    })),
    remoteEventsSinceLastLocal: input.remoteEventsSinceLastLocal.map(
      serializeStoredUpdate
    ),
    reseedCheckpoint: {
      canonicalFingerprint: input.reseedCheckpoint.canonicalFingerprint,
      stateVectorHex: hexEncode(input.reseedCheckpoint.stateVector),
      fullStateHex: hexEncode(input.reseedCheckpoint.fullState),
      revision: input.reseedCheckpoint.revision,
      nextJournalSequence: input.reseedCheckpoint.nextJournalSequence,
    },
    actorSessionGroupHistory: encodeHistorySnapshotPayload(
      input.actorSessionGroupHistory
    ),
    redoEligibility: input.actorSessionGroupHistory.redoEligibility.map(
      (record) => ({ ...record })
    ),
    safeAuditCursor: { ...input.actorSessionGroupHistory.safeAuditCursor },
  };
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  if (bytes.length > YJS_MAX_SNAPSHOT_BYTES) {
    throw new TypeError('yjs snapshot exceeds maximum size');
  }
  return createSnapshotEnvelope({
    documentId: input.identity.documentId,
    backendVersion: input.identity.backendVersion,
    schemaVersion: input.identity.schemaVersion,
    normalizationVersion: input.identity.normalizationVersion,
    checkpoint,
    bytes,
  });
}

export function decodeYjsBackendSnapshot(
  snapshotInput: unknown,
  options: {
    readonly replicaId?: string;
    readonly sessionId?: string;
    readonly clientId?: number;
  } = {}
): RestoredYjsBackendState {
  const validation = snapshotAndValidateSnapshot(snapshotInput);
  if (!validation.snapshot || validation.errors.length > 0) {
    throw new TypeError(`invalid yjs snapshot envelope: ${validation.errors.join('; ')}`);
  }
  const snapshot = validation.snapshot;
  if (snapshot.bytes.length > YJS_MAX_SNAPSHOT_BYTES) {
    throw new TypeError('yjs snapshot exceeds maximum size');
  }
  if (
    snapshot.backendVersion !== YJS_BACKEND_VERSION ||
    snapshot.schemaVersion !== YJS_SCHEMA_VERSION ||
    snapshot.normalizationVersion !== YJS_NORMALIZATION_VERSION
  ) {
    throw new TypeError('yjs snapshot version mismatch');
  }
  let decoded: unknown;
  try {
    decoded = parseBoundedSnapshotJson(
      new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes)
    );
  } catch {
    throw new TypeError('invalid yjs snapshot bytes');
  }
  const payload = readClosedDataObject(
    decoded,
    [
      'kind',
      'backendVersion',
      'schemaVersion',
      'normalizationVersion',
      'documentId',
      'checkpoint',
      'replicaId',
      'sessionId',
      'clientId',
      'localRevision',
      'canonicalState',
      'canonicalFingerprint',
      'yjsUpdateHex',
      'stateVectorHex',
      'operationEnvironment',
      'appliedConstituentIds',
      'appliedCommitIds',
      'appliedUpdateIds',
      'appliedSemanticUpdateIds',
      'appliedUpdateDigests',
      'appliedRepairCanonicalDigests',
      'nextRepairSeq',
      'bufferedUpdates',
      'clientOwners',
      'pendingLimits',
      'publicationJournal',
      'remoteEventsSinceLastLocal',
      'reseedCheckpoint',
      'actorSessionGroupHistory',
      'redoEligibility',
      'safeAuditCursor',
    ],
    'yjs snapshot payload'
  );
  if (
    payload.kind !== YJS_SNAPSHOT_KIND ||
    payload.backendVersion !== snapshot.backendVersion ||
    payload.schemaVersion !== snapshot.schemaVersion ||
    payload.normalizationVersion !== snapshot.normalizationVersion ||
    payload.documentId !== snapshot.documentId ||
    payload.checkpoint !== snapshot.checkpoint
  ) {
    throw new TypeError('yjs snapshot metadata mismatch');
  }
  const actorSessionGroupHistory = decodeHistorySnapshotPayload(
    payload.actorSessionGroupHistory
  );
  if (
    actorSessionGroupHistory.normalizationVersion !==
    snapshot.normalizationVersion
  ) {
    throw new TypeError('history normalization version mismatch');
  }
  if (
    canonicalJson(payload.redoEligibility) !==
    canonicalJson(actorSessionGroupHistory.redoEligibility)
  ) {
    throw new TypeError('snapshot redo eligibility mismatch');
  }
  if (
    canonicalJson(payload.safeAuditCursor) !==
    canonicalJson(actorSessionGroupHistory.safeAuditCursor)
  ) {
    throw new TypeError('snapshot safe audit cursor mismatch');
  }
  if (
    !isSpikeId(payload.documentId) ||
    !isSpikeId(payload.replicaId) ||
    !isSpikeId(payload.sessionId) ||
    !Number.isInteger(payload.clientId) ||
    (payload.clientId as number) <= 0 ||
    (payload.clientId as number) > 0xffff_ffff ||
    !Number.isSafeInteger(payload.localRevision) ||
    (payload.localRevision as number) < 0
  ) {
    throw new TypeError('invalid yjs snapshot identity or revision');
  }
  const replicaId = options.replicaId ?? (payload.replicaId as string);
  const sessionId =
    options.sessionId ??
    (options.replicaId === undefined
      ? (payload.sessionId as string)
      : `session-restored-${payload.localRevision as number}`);
  if (!isSpikeId(replicaId) || !isSpikeId(sessionId)) {
    throw new TypeError('invalid restored replica/session identity');
  }
  const doc = createReplicaYjsDoc({
    documentId: snapshot.documentId,
    replicaId,
  });
  const desiredClientId =
    options.clientId ??
    (options.replicaId === undefined && options.sessionId === undefined
      ? (payload.clientId as number)
      : doc.clientID);
  try {
    Y.applyUpdate(doc, hexDecode(payload.yjsUpdateHex as string));
  } catch {
    throw new TypeError('invalid Yjs snapshot update bytes');
  }
  const stateVector = Y.encodeStateVector(doc);
  if (!bytesEqual(stateVector, hexDecode(payload.stateVectorHex as string))) {
    throw new TypeError('Yjs snapshot state vector mismatch');
  }
  doc.clientID = desiredClientId;
  const appliedConstituentIds = readUniqueIds(
    payload.appliedConstituentIds,
    'applied constituent IDs'
  );
  const appliedCommitIds = readUniqueIds(
    payload.appliedCommitIds,
    'applied commit IDs'
  );
  const appliedUpdateIds = readUniqueIds(payload.appliedUpdateIds, 'applied update IDs');
  const appliedSemanticUpdateIds = readUniqueIds(
    payload.appliedSemanticUpdateIds,
    'applied semantic update IDs'
  );
  const appliedUpdateDigests = readAppliedUpdateDigests(payload.appliedUpdateDigests);
  const appliedRepairCanonicalDigests = readAppliedUpdateDigests(
    payload.appliedRepairCanonicalDigests
  );
  if (
    !Number.isSafeInteger(payload.nextRepairSeq) ||
    (payload.nextRepairSeq as number) < 1
  ) {
    throw new TypeError('invalid snapshot repair sequence');
  }
  const nextRepairSeq = payload.nextRepairSeq as number;
  for (const updateId of appliedUpdateIds) {
    if (!appliedUpdateDigests.has(updateId)) {
      throw new TypeError('snapshot applied update digest missing');
    }
  }
  const bufferedUpdates = readBufferedUpdates(payload.bufferedUpdates);
  validatePendingLimits(payload.pendingLimits, bufferedUpdates, doc);
  const clientOwners = readClientOwners(payload.clientOwners);
  const publicationJournal = readPublicationJournal(payload.publicationJournal);
  const remoteEventsSinceLastLocal = readBufferedUpdates(
    payload.remoteEventsSinceLastLocal,
    false
  );
  const reseedCheckpointRecord = readClosedDataObject(
    payload.reseedCheckpoint,
    [
      'canonicalFingerprint',
      'stateVectorHex',
      'fullStateHex',
      'revision',
      'nextJournalSequence',
    ],
    'reseed checkpoint'
  );
  const reseedCheckpoint = {
    canonicalFingerprint: reseedCheckpointRecord.canonicalFingerprint as string,
    stateVector: hexDecode(reseedCheckpointRecord.stateVectorHex as string),
    fullState: hexDecode(reseedCheckpointRecord.fullStateHex as string),
    revision: reseedCheckpointRecord.revision as number,
    nextJournalSequence: reseedCheckpointRecord.nextJournalSequence as number,
  };
  validateReseedCheckpoint(reseedCheckpoint);
  for (const update of bufferedUpdates) {
    if (
      !appliedUpdateIds.includes(update.updateId) ||
      !appliedSemanticUpdateIds.includes(update.semanticUpdateId) ||
      update.constituentIds.some((id) => !appliedConstituentIds.includes(id))
    ) {
      throw new TypeError('snapshot buffered update is not covered');
    }
    try {
      Y.applyUpdate(doc, update.bytes);
    } catch {
      throw new TypeError('invalid buffered Yjs snapshot update');
    }
  }
  if (!bytesEqual(Y.encodeStateVector(doc), stateVector)) {
    throw new TypeError('buffered Yjs snapshot update changed integrated state');
  }
  const restoredOwner = clientOwners.find((owner) => owner.clientId === doc.clientID);
  for (const clientId of Y.decodeStateVector(stateVector).keys()) {
    if (!clientOwners.some((owner) => owner.clientId === clientId)) {
      throw new TypeError('snapshot Yjs client owner missing');
    }
  }
  if (
    restoredOwner &&
    (restoredOwner.replicaId !== replicaId || restoredOwner.sessionId !== sessionId)
  ) {
    throw new TypeError('restored Yjs client ownership collision');
  }
  if (!restoredOwner) {
    clientOwners.push({ clientId: doc.clientID, replicaId, sessionId });
    clientOwners.sort((left, right) => left.clientId - right.clientId);
  }
  for (const update of bufferedUpdates) {
    const owner = clientOwners.find(
      (candidate) => candidate.clientId === update.sourceClientId
    );
    if (
      !owner ||
      owner.replicaId !== update.sourceReplicaId ||
      owner.sessionId !== update.sourceSessionId
    ) {
      throw new TypeError('buffered update client ownership mismatch');
    }
  }
  const yjsState: YjsDocState = Object.freeze({
    doc,
    documentId: snapshot.documentId,
    checkpoint: snapshot.checkpoint,
    replicaId,
  });
  const schemaErrors = validateDecodedYjsModel(decodeYjsDocState(yjsState));
  if (schemaErrors.length > 0) {
    throw new TypeError(`Yjs snapshot schema invalid: ${schemaErrors.join('; ')}`);
  }
  const model = createDocumentModel(
    deriveAuthoredPackageFromYjs(yjsState),
    payload.localRevision as number
  );
  if (actorSessionGroupHistory.safeAuditCursor.sequence !== model.revision) {
    throw new TypeError('history audit cursor/revision mismatch');
  }
  const canonicalFingerprint = fingerprintAuthoredModel(model);
  if (
    payload.canonicalFingerprint !== canonicalFingerprint ||
    canonicalJson(payload.canonicalState) !== canonicalJson(authoredFingerprintPayload(model))
  ) {
    throw new TypeError('snapshot canonical/Yjs fingerprint mismatch');
  }
  const expectedCheckpoint = checkpointFor(
    model.revision,
    canonicalFingerprint,
    stateVector
  );
  if (snapshot.checkpoint !== expectedCheckpoint) {
    throw new TypeError('Yjs snapshot checkpoint mismatch');
  }
  const operationEnvironment = readClosedDataObject(
    payload.operationEnvironment,
    ['actorId', 'nextCommitSeq', 'nextLocalSeq', 'reservedSemanticIds'],
    'snapshot operation environment'
  );
  if (
    !isSpikeId(operationEnvironment.actorId) ||
    !Number.isSafeInteger(operationEnvironment.nextCommitSeq) ||
    (operationEnvironment.nextCommitSeq as number) < 1 ||
    !Number.isSafeInteger(operationEnvironment.nextLocalSeq) ||
    (operationEnvironment.nextLocalSeq as number) < 1
  ) {
    throw new TypeError('invalid snapshot operation environment');
  }
  const reservedSemanticIds = readUniqueIds(
    operationEnvironment.reservedSemanticIds,
    'reserved semantic IDs'
  );
  const allocator = readAllocatorRecords(doc).get(operationEnvironment.actorId as string);
  if (
    allocator &&
    (allocator.nextCommitSeq !== operationEnvironment.nextCommitSeq ||
      allocator.nextLocalSeq !== operationEnvironment.nextLocalSeq ||
      [...allocator.observedSemanticIds].some(
        (semanticId) => !reservedSemanticIds.includes(semanticId)
      ))
  ) {
    throw new TypeError('snapshot operation allocator mismatch');
  }
  const env: OperationEnvironment = Object.freeze({
    actorId: operationEnvironment.actorId as string,
    nextCommitSeq: operationEnvironment.nextCommitSeq as number,
    nextLocalSeq: operationEnvironment.nextLocalSeq as number,
    reservedSemanticIds: new Set(reservedSemanticIds),
  });
  return Object.freeze({
    identity: Object.freeze({
      documentId: snapshot.documentId,
      backendVersion: snapshot.backendVersion,
      schemaVersion: snapshot.schemaVersion,
      normalizationVersion: snapshot.normalizationVersion,
      replicaId,
      sessionId,
      clientId: doc.clientID,
    }),
    model,
    yjsState,
    stateVector,
    appliedConstituentIds,
    appliedCommitIds,
    appliedUpdateIds,
    appliedSemanticUpdateIds,
    appliedUpdateDigests: [...appliedUpdateDigests].map(([updateId, digest]) =>
      Object.freeze({ updateId, digest })
    ),
    appliedRepairCanonicalDigests: [...appliedRepairCanonicalDigests].map(
      ([updateId, digest]) => Object.freeze({ updateId, digest })
    ),
    nextRepairSeq,
    bufferedUpdates,
    clientOwners,
    publicationJournal,
    remoteEventsSinceLastLocal,
    reseedCheckpoint,
    env,
    replicaId,
    sessionId,
    clientId: doc.clientID,
    actorSessionGroupHistory,
  });
}

function validatePendingLimits(
  value: unknown,
  updates: readonly ReplicationUpdateEnvelope[],
  doc: Y.Doc
): void {
  const limits = readClosedDataObject(
    value,
    ['maxCount', 'maxAggregateBytes', 'maxCountPerSource', 'maxBytesPerSource'],
    'snapshot pending limits'
  );
  if (
    limits.maxCount !== YJS_MAX_PENDING_UPDATES ||
    limits.maxAggregateBytes !== YJS_MAX_PENDING_UPDATE_BYTES ||
    limits.maxCountPerSource !== YJS_MAX_PENDING_UPDATES_PER_SOURCE ||
    limits.maxBytesPerSource !== YJS_MAX_PENDING_BYTES_PER_SOURCE
  ) {
    throw new TypeError('snapshot pending limits mismatch');
  }
  const vector = Y.decodeStateVector(Y.encodeStateVector(doc));
  const pendingUpdates = updates.filter((update) => {
    const structs = Y.decodeUpdate(update.bytes).structs;
    if (structs.length === 0) {
      return doc.store.pendingStructs !== null || doc.store.pendingDs !== null;
    }
    return structs.some(
      (struct) =>
        (vector.get(struct.id.client) ?? 0) < struct.id.clock + struct.length
    );
  });
  if (pendingUpdates.length > YJS_MAX_PENDING_UPDATES) {
    throw new TypeError('snapshot pending count exceeds limit');
  }
  let total = 0;
  const sources = new Map<number, { count: number; bytes: number }>();
  for (const update of pendingUpdates) {
    total += update.bytes.length;
    const source = sources.get(update.sourceClientId) ?? { count: 0, bytes: 0 };
    source.count += 1;
    source.bytes += update.bytes.length;
    sources.set(update.sourceClientId, source);
  }
  if (total > YJS_MAX_PENDING_UPDATE_BYTES) {
    throw new TypeError('snapshot pending bytes exceed limit');
  }
  if (
    [...sources.values()].some(
      (source) =>
        source.count > YJS_MAX_PENDING_UPDATES_PER_SOURCE ||
        source.bytes > YJS_MAX_PENDING_BYTES_PER_SOURCE
    )
  ) {
    throw new TypeError('snapshot pending per-source quota exceeded');
  }
}

function readAppliedUpdateDigests(value: unknown): Map<string, string> {
  const records = snapshotDenseArray(value, 'applied update digests');
  const digests = new Map<string, string>();
  for (const [index, record] of records.entries()) {
    const entry = readClosedDataObject(
      record,
      ['updateId', 'digest'],
      `applied update digest ${index}`
    );
    if (
      !isSpikeId(entry.updateId) ||
      typeof entry.digest !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.digest)
    ) {
      throw new TypeError('invalid applied update digest entry');
    }
    if (digests.has(entry.updateId as string)) {
      throw new TypeError('duplicate applied update digest entry');
    }
    digests.set(entry.updateId as string, entry.digest as string);
  }
  return digests;
}

function readClientOwners(
  value: unknown
): Array<{ clientId: number; replicaId: string; sessionId: string }> {
  const records = snapshotDenseArray(value, 'client owners');
  const owners = records.map((record, index) => {
    const owner = readClosedDataObject(
      record,
      ['clientId', 'replicaId', 'sessionId'],
      `client owner ${index}`
    );
    if (
      !Number.isInteger(owner.clientId) ||
      (owner.clientId as number) <= 0 ||
      (owner.clientId as number) > 0xffff_ffff ||
      !isSpikeId(owner.replicaId) ||
      !isSpikeId(owner.sessionId)
    ) {
      throw new TypeError('invalid snapshot client owner');
    }
    return {
      clientId: owner.clientId as number,
      replicaId: owner.replicaId as string,
      sessionId: owner.sessionId as string,
    };
  });
  if (
    owners.some(
      (owner, index) =>
        index > 0 && owners[index - 1]!.clientId >= owner.clientId
    )
  ) {
    throw new TypeError('snapshot client owners must be uniquely ordered');
  }
  return owners;
}

function readPublicationJournal(
  value: unknown
): RestoredLocalPublicationJournalEntry[] {
  const records = snapshotDenseArray(value, 'publication journal');
  if (records.length > YJS_MAX_RESEED_JOURNAL_ENTRIES) {
    throw new TypeError('snapshot publication journal count exceeds limit');
  }
  const entries = records.map((record, index) => {
    const entry = readClosedDataObject(
      record,
      [
        'sequence',
        'baseRevision',
        'semanticUpdateId',
        'attemptUpdateIds',
        'constituentIds',
        'actorId',
        'originSessionId',
        'ops',
        'baseFullStateHex',
        'latestAttempt',
        'remoteEventsBefore',
      ],
      `publication journal entry ${index}`
    );
    const attemptUpdateIds = readUniqueIds(
      entry.attemptUpdateIds,
      'journal attempt update IDs'
    );
    const constituentIds = readUniqueIds(
      entry.constituentIds,
      'journal constituent IDs'
    );
    const rawOps = snapshotDenseArray(entry.ops, 'journal operations') as DocOpSingle[];
    const baseFullState = hexDecode(entry.baseFullStateHex as string);
    const latestAttempt = readBufferedUpdates([entry.latestAttempt])[0]!;
    const remoteEventsBefore = readBufferedUpdates(entry.remoteEventsBefore, false);
    if (
      !Number.isSafeInteger(entry.sequence) ||
      (entry.sequence as number) <= 0 ||
      !Number.isSafeInteger(entry.baseRevision) ||
      (entry.baseRevision as number) < 0 ||
      !isSpikeId(entry.semanticUpdateId) ||
      !isSpikeId(entry.actorId) ||
      !isSpikeId(entry.originSessionId) ||
      rawOps.length === 0 ||
      rawOps.length !== constituentIds.length ||
      latestAttempt.semanticUpdateId !== entry.semanticUpdateId ||
      !attemptUpdateIds.includes(latestAttempt.updateId) ||
      canonicalJson(latestAttempt.constituentIds) !== canonicalJson(constituentIds)
    ) {
      throw new TypeError('invalid publication journal entry');
    }
    const ops = createDocOpBatch({
      ops: rawOps,
      transaction: {
        actorId: entry.actorId as string,
        sessionId: 'session-journal-restore',
        groupId: `group-journal-${entry.sequence as number}`,
        constituentIds,
      },
    }).ops;
    const probe = new Y.Doc({ gc: false });
    probe.getMap('root');
    try {
      Y.applyUpdate(probe, baseFullState);
      getRoot(probe);
    } catch {
      throw new TypeError('invalid publication journal base state');
    }
    return {
      sequence: entry.sequence as number,
      baseRevision: entry.baseRevision as number,
      semanticUpdateId: entry.semanticUpdateId as string,
      attemptUpdateIds,
      constituentIds,
      actorId: entry.actorId as string,
      originSessionId: entry.originSessionId as string,
      ops,
      baseFullState,
      latestAttempt,
      remoteEventsBefore,
    };
  });
  if (
    entries.some(
      (entry, index) =>
        index > 0 && entries[index - 1]!.sequence >= entry.sequence
    )
  ) {
    throw new TypeError('publication journal sequence is not ordered');
  }
  const bytes = entries.reduce(
    (total, entry) =>
      total +
      entry.baseFullState.length +
      new TextEncoder().encode(
        canonicalJson({
          sequence: entry.sequence,
          baseRevision: entry.baseRevision,
          semanticUpdateId: entry.semanticUpdateId,
          attemptUpdateIds: entry.attemptUpdateIds,
          constituentIds: entry.constituentIds,
          actorId: entry.actorId,
          originSessionId: entry.originSessionId,
          ops: entry.ops,
          latestAttemptId: entry.latestAttempt.updateId,
          remoteEventIds: entry.remoteEventsBefore.map((event) => event.updateId),
        })
      ).length +
      entry.latestAttempt.bytes.length +
      entry.remoteEventsBefore.reduce(
        (total, event) => total + event.bytes.length,
        0
      ),
    0
  );
  if (bytes > YJS_MAX_RESEED_JOURNAL_BYTES) {
    throw new TypeError('snapshot publication journal bytes exceed limit');
  }
  return entries;
}

function readBufferedUpdates(
  value: unknown,
  requireSorted = true
): ReplicationUpdateEnvelope[] {
  const records = snapshotDenseArray(value, 'buffered updates');
  const updates = records.map((record, index) => {
    const buffered = readClosedDataObject(
      record,
      [
        'documentId',
        'backendVersion',
        'schemaVersion',
        'checkpoint',
        'updateId',
        'semanticUpdateId',
        'sourceActorId',
        'sourceReplicaId',
        'sourceSessionId',
        'sourceClientId',
        'constituentIds',
        'coverage',
        'clockRanges',
        'bytesHex',
      ],
      `buffered update ${index}`
    );
    const bytes = hexDecode(buffered.bytesHex as string);
    if (
      canonicalJson(buffered.clockRanges) !==
      canonicalJson(clockRangesFor(bytes))
    ) {
      throw new TypeError('buffered update clock range mismatch');
    }
    return createReplicationUpdateEnvelope({
      documentId: buffered.documentId as string,
      backendVersion: buffered.backendVersion as string,
      schemaVersion: buffered.schemaVersion as string,
      checkpoint: buffered.checkpoint as string,
      updateId: buffered.updateId as string,
      semanticUpdateId: buffered.semanticUpdateId as string,
      sourceActorId: buffered.sourceActorId as string,
      sourceReplicaId: buffered.sourceReplicaId as string,
      sourceSessionId: buffered.sourceSessionId as string,
      sourceClientId: buffered.sourceClientId as number,
      constituentIds: snapshotDenseArray(
        buffered.constituentIds,
        `buffered update ${index} constituent IDs`
      ) as string[],
      coverage: buffered.coverage as 'incremental',
      bytes,
    });
  });
  if (
    requireSorted &&
    updates.some(
      (update, index) =>
        index > 0 &&
        codeUnitCompare(updates[index - 1]!.updateId, update.updateId) >= 0
    )
  ) {
    throw new TypeError('buffered updates must be uniquely ordered');
  }
  return updates;
}

function clockRangesFor(
  bytes: Uint8Array
): readonly { clientId: number; start: number; end: number }[] {
  const byClient = new Map<number, { start: number; end: number }>();
  for (const struct of Y.decodeUpdate(bytes).structs) {
    const current = byClient.get(struct.id.client);
    const end = struct.id.clock + struct.length;
    byClient.set(struct.id.client, {
      start: Math.min(current?.start ?? struct.id.clock, struct.id.clock),
      end: Math.max(current?.end ?? end, end),
    });
  }
  return [...byClient]
    .sort(([left], [right]) => left - right)
    .map(([clientId, range]) => ({ clientId, ...range }));
}

function serializeStoredUpdate(update: ReplicationUpdateEnvelope) {
  return {
    documentId: update.documentId,
    backendVersion: update.backendVersion,
    schemaVersion: update.schemaVersion,
    checkpoint: update.checkpoint,
    updateId: update.updateId,
    semanticUpdateId: update.semanticUpdateId,
    sourceActorId: update.sourceActorId,
    sourceReplicaId: update.sourceReplicaId,
    sourceSessionId: update.sourceSessionId,
    sourceClientId: update.sourceClientId,
    constituentIds: [...update.constituentIds],
    coverage: update.coverage,
    clockRanges: clockRangesFor(update.bytes),
    bytesHex: hexEncode(update.bytes),
  };
}

function validateReseedCheckpoint(checkpoint: RestoredReseedCheckpoint): void {
  if (
    typeof checkpoint.canonicalFingerprint !== 'string' ||
    !Number.isSafeInteger(checkpoint.revision) ||
    checkpoint.revision < 0 ||
    !Number.isSafeInteger(checkpoint.nextJournalSequence) ||
    checkpoint.nextJournalSequence < 1
  ) {
    throw new TypeError('snapshot reseed checkpoint metadata invalid');
  }
  const doc = new Y.Doc({ gc: false });
  doc.getMap('root');
  try {
    Y.applyUpdate(doc, checkpoint.fullState);
  } catch {
    throw new TypeError('snapshot reseed checkpoint Yjs state invalid');
  }
  if (
    canonicalJson([...Y.decodeStateVector(Y.encodeStateVector(doc))]) !==
    canonicalJson([...Y.decodeStateVector(checkpoint.stateVector)])
  ) {
    throw new TypeError('snapshot reseed checkpoint state vector mismatch');
  }
  const model = createDocumentModel(
    deriveAuthoredPackageFromYjs({
      doc,
      documentId: 'checkpoint-validation',
      checkpoint: 'checkpoint-validation',
    }),
    checkpoint.revision
  );
  if (fingerprintAuthoredModel(model) !== checkpoint.canonicalFingerprint) {
    throw new TypeError('snapshot reseed checkpoint fingerprint mismatch');
  }
}

function readUniqueIds(value: unknown, label: string): string[] {
  const ids = snapshotDenseArray(value, label);
  if (ids.some((id) => !isSpikeId(id)) || new Set(ids).size !== ids.length) {
    throw new TypeError(`invalid ${label}`);
  }
  const strings = ids as string[];
  if (
    strings.some(
      (id, index) => index > 0 && codeUnitCompare(strings[index - 1]!, id) >= 0
    )
  ) {
    throw new TypeError(`${label} must be canonically ordered`);
  }
  return strings;
}

function sortedUnique(values: readonly string[]): string[] {
  const result = [...new Set(values)].sort(codeUnitCompare);
  if (result.some((value) => !isSpikeId(value))) throw new TypeError('invalid snapshot ID');
  return result;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function parseBoundedSnapshotJson(text: string): unknown {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') {
      depth += 1;
      if (depth > 64) throw new TypeError('snapshot nesting exceeds quota');
    } else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth < 0) throw new TypeError('invalid snapshot nesting');
    }
  }
  if (depth !== 0 || inString) throw new TypeError('invalid snapshot nesting');
  return JSON.parse(text);
}
