/** @spike-features yjs-backend */
import * as Y from 'yjs';
import { canonicalJson } from '../../canonical-json';
import type { DocOpSingle } from '../../contracts/doc-op';
import type { DecodedYjsModel } from '../../comparators/yjs-schema-fingerprint';
import { validateDecodedYjsModel } from '../../comparators/yjs-schema-fingerprint';
import {
  hasUniqueStrings,
  readClosedDataObject,
  snapshotDenseArray,
} from '../../contracts/closed-input';
import { isSpikeId } from '../../contracts/ids';
import {
  createReplicationUpdateEnvelope,
  snapshotAndValidateReplicationUpdate,
  type ReplicationUpdateEnvelope,
} from '../../contracts/replication-update';
import type { SnapshotEnvelope } from '../../contracts/snapshot';
import { fingerprintAuthoredModel } from '../../model/fingerprint';
import { createDocumentModel } from '../../model/fixture';
import type { DocumentModel } from '../../model/types';
import { validateDocumentModel } from '../../model/validators';
import {
  compactDerivedId,
  commitIdFor,
  createOperationEnvironment,
  type OperationEnvironment,
} from '../operation-environment';
import {
  dedupeIdentityMappings,
  dirtyDependenciesFor,
  structuralRangesForAffectedDraft,
} from '../publish-metadata';
import { extractIdentityTombstones, serializeDraftSnapshot } from '../history';
import {
  createEmptyActorSessionGroupHistoryState,
  createSafeAuditCursor,
  type ActorSessionGroupHistoryState,
} from '../history';
import type { BackendHistoryCommitRecord } from './types';
import {
  applyAuthoredTransition,
  bootstrapYjsDocFromModel,
  checkpointFor,
  cloneYjsDocState,
  decodeYjsDocState,
  deriveAuthoredPackageFromYjs,
  nextReplicaCommitSeq,
  readAllocatorRecords,
} from '../yjs/doc';
import { repairYjsDocumentInPlace } from '../yjs/doc-repair';
import { rewriteAllocatorRecord } from '../yjs/doc-access';
import {
  YJS_BACKEND_VERSION,
  YJS_MAX_PENDING_BYTES_PER_SOURCE,
  YJS_MAX_PENDING_UPDATE_BYTES,
  YJS_MAX_PENDING_UPDATES,
  YJS_MAX_PENDING_UPDATES_PER_SOURCE,
  YJS_MAX_RESEED_JOURNAL_BYTES,
  YJS_MAX_RESEED_JOURNAL_ENTRIES,
  YJS_MAX_UPDATE_BYTES,
  YJS_NORMALIZATION_VERSION,
  YJS_SCHEMA_VERSION,
} from '../yjs/constants';
import type { YjsDocState } from '../yjs/doc-types';
import type { AuthoredTextEditEvent } from '../yjs/token-sequence';
import {
  decodeYjsBackendSnapshot,
  encodeYjsBackendSnapshot,
  type RestoredYjsBackendState,
} from '../yjs/snapshot';
import {
  createBackendCoverage,
  immutableStringSet,
  nextBackendCoverage,
  snapshotBackendCoverage,
  type BackendCoverageState,
} from './coverage';
import { stageSemanticMutation, type InternalStagedMutation } from './staging';
import type {
  BackendCommitInput,
  BackendCommitResult,
  BackendCoverageBookkeeping,
  BackendIdentity,
  BackendStageInput,
  BackendStageResult,
  BackendStagedMutation,
  BackendStateInspection,
  OperationEnvironmentSnapshot,
  SemanticStoreBackend,
} from './types';
import { createRemoteCommitResult } from './remote-diff';

const TRUSTED_LOCAL_STAGES = new WeakSet<object>();
const TRUSTED_LOCAL_PUBLICATIONS = new WeakSet<object>();
const TRUSTED_REMOTE_PUBLICATIONS = new WeakSet<object>();
const TRUSTED_BUFFERED_PUBLICATIONS = new WeakSet<object>();
let nextStageToken = 1;
let nextReplicaSequence = 1;

export interface YjsStoreBackendOptions {
  readonly documentId?: string;
  readonly actorId?: string;
  readonly replicaId?: string;
  readonly sessionId?: string;
  readonly clientId?: number;
}

export interface YjsBackendIdentity extends BackendIdentity {
  readonly replicaId: string;
  readonly sessionId: string;
  readonly clientId: number;
}

export interface YjsReplicationInspection {
  readonly clientId: number;
  readonly stateVector: Uint8Array;
  readonly fullState: Uint8Array;
  readonly appliedUpdateIds: readonly string[];
  readonly appliedSemanticUpdateIds: readonly string[];
  readonly bufferedUpdateIds: readonly string[];
  readonly clientOwners: readonly {
    readonly clientId: number;
    readonly replicaId: string;
    readonly sessionId: string;
  }[];
  readonly pendingUpdateCount: number;
  readonly pendingUpdateBytes: number;
  readonly checkpoint: string;
}

export interface PreparedYjsLocalPublication {
  readonly result: BackendCommitResult;
  readonly update: ReplicationUpdateEnvelope;
}

export interface PreparedYjsRemotePublication {
  readonly result: BackendCommitResult;
  readonly repairUpdate?: ReplicationUpdateEnvelope;
  readonly appliedRepair: boolean;
  readonly constituentIds: readonly string[];
  readonly causalUpdateIds: readonly string[];
  readonly historyOps: readonly DocOpSingle[];
}

export interface PreparedYjsBufferedPublication {
  readonly updateId: string;
  readonly constituentIds: readonly string[];
}

export type YjsReseedResult =
  | {
      readonly status: 'reseeded';
      readonly update: ReplicationUpdateEnvelope;
      readonly updates: readonly ReplicationUpdateEnvelope[];
    }
  | YjsSnapshotResyncRequirement
  | { readonly status: 'failed'; readonly code: string; readonly reason: string };

export interface YjsSnapshotResyncRequirement {
  readonly status: 'fullSnapshotResyncRequired';
  readonly snapshot: SnapshotEnvelope;
  readonly precondition: {
    readonly documentId: string;
    readonly canonicalFingerprint: string;
    readonly stateVector: Uint8Array;
  };
}

export type YjsSnapshotResyncResult =
  | {
      readonly status: 'applied';
      readonly change?: BackendCommitResult;
      readonly resyncConstituentId?: string;
    }
  | {
      readonly status: 'conflict';
      readonly code: 'receiver-diverged';
      readonly manualResolutionRequired: true;
    }
  | { readonly status: 'unauthorized' }
  | { readonly status: 'failed'; readonly code: string; readonly reason: string };

export interface YjsClientCollision {
  readonly sourceClientId: number;
  readonly attemptedReplicaId: string;
  readonly attemptedSessionId: string;
  readonly boundReplicaId: string;
  readonly boundSessionId: string;
  readonly semanticUpdateId: string;
}

export type YjsRemoteStageResult =
  | { readonly status: 'staged'; readonly prepared: PreparedYjsRemotePublication }
  | { readonly status: 'buffered'; readonly prepared: PreparedYjsBufferedPublication }
  | { readonly status: 'duplicate'; readonly reason: string }
  | { readonly status: 'noOp'; readonly reason: string }
  | { readonly status: 'clientCollision'; readonly collision: YjsClientCollision }
  | { readonly status: 'failed'; readonly code: string; readonly reason: string };

export interface YjsStoreBackend extends SemanticStoreBackend {
  readonly identity: YjsBackendIdentity;
  inspectYjsModel(): DecodedYjsModel;
  inspectReplicationState(): YjsReplicationInspection;
  encodeReplicationUpdate(): ReplicationUpdateEnvelope;
  prepareLocalPublication(
    staged: BackendStagedMutation,
    input: BackendCommitInput
  ): PreparedYjsLocalPublication;
  publishLocalPublication(prepared: PreparedYjsLocalPublication): void;
  stageRemoteReplicationUpdate(update: unknown): YjsRemoteStageResult;
  publishRemotePublication(prepared: PreparedYjsRemotePublication): void;
  publishBufferedRemote(prepared: PreparedYjsBufferedPublication): void;
  reseedLocalUpdate(
    updateId: string,
    input: { readonly clientId?: number; readonly sessionId: string }
  ): YjsReseedResult;
  applySnapshotResync(requirement: YjsSnapshotResyncRequirement): YjsSnapshotResyncResult;
}

interface RuntimeState {
  readonly model: DocumentModel;
  readonly env: OperationEnvironment;
  readonly coverage: BackendCoverageState;
  readonly yjsState: YjsDocState;
  readonly appliedUpdateIds: ReadonlySet<string>;
  readonly appliedSemanticUpdateIds: ReadonlySet<string>;
  readonly appliedUpdateDigests: ReadonlyMap<string, string>;
  readonly appliedRepairCanonicalDigests: ReadonlyMap<string, string>;
  readonly nextRepairSeq: number;
  readonly bufferedUpdates: ReadonlyMap<string, ReplicationUpdateEnvelope>;
  readonly clientOwners: ReadonlyMap<number, ClientOwner>;
  readonly publicationJournal: readonly LocalPublicationJournalEntry[];
  readonly remoteEventsSinceLastLocal: readonly ReplicationUpdateEnvelope[];
  readonly reseedCheckpoint: RestoredYjsBackendState['reseedCheckpoint'];
  readonly lastUpdate?: ReplicationUpdateEnvelope;
}

interface LocalPublicationJournalEntry {
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

interface ClientOwner {
  readonly replicaId: string;
  readonly sessionId: string;
}

interface LocalStageRecord {
  status: 'pending' | 'committed' | 'rolledBack';
  readonly data: InternalStagedMutation;
  readonly actorId: string;
  readonly commitSeq: number;
  readonly constituentIds: readonly string[];
  readonly stagedYjsState: YjsDocState;
  readonly baseStateVector: Uint8Array;
  readonly incrementalBytes: Uint8Array;
  readonly ops: readonly DocOpSingle[];
  readonly baseFullState: Uint8Array;
  readonly includeReplicationClosure: boolean;
}

interface InternalPreparedLocal extends PreparedYjsLocalPublication {
  readonly record: LocalStageRecord;
  readonly baseState: RuntimeState;
  readonly nextState: RuntimeState;
}

interface InternalPreparedRemote extends PreparedYjsRemotePublication {
  readonly baseState: RuntimeState;
  readonly nextState: RuntimeState;
}

interface InternalPreparedBuffered extends PreparedYjsBufferedPublication {
  readonly baseState: RuntimeState;
  readonly nextState: RuntimeState;
}

export function createYjsStoreBackend(
  initialModel: DocumentModel | unknown,
  options: YjsStoreBackendOptions = {}
): YjsStoreBackend {
  const errors = validateDocumentModel(initialModel);
  if (errors.length > 0) throw new TypeError(errors.join('; '));
  const initial = initialModel as DocumentModel;
  const documentId = options.documentId ?? 'doc-spike-0';
  const actorId = options.actorId ?? 'actor-local';
  const replicaId = options.replicaId ?? `replica-${actorId}-${nextReplicaSequence++}`;
  const sessionId = options.sessionId ?? replicaId;
  if (
    !isSpikeId(documentId) ||
    !isSpikeId(actorId) ||
    !isSpikeId(replicaId) ||
    !isSpikeId(sessionId)
  ) {
    throw new TypeError('invalid Yjs backend identity');
  }
  const model = createDocumentModel(initial.authored, initial.revision);
  const yjsState = bootstrapYjsDocFromModel(
    model.authored,
    documentId,
    fingerprintAuthoredModel(model),
    replicaId,
    options.clientId
  );
  const env = operationEnvironmentForActor(yjsState, actorId, model);
  return createYjsStoreBackendFromState({
    identity: createBackendIdentity(documentId, replicaId, sessionId, yjsState.doc.clientID),
    model,
    yjsState,
    stateVector: Y.encodeStateVector(yjsState.doc),
    appliedConstituentIds: [],
    appliedCommitIds: [],
    appliedUpdateIds: [],
    appliedSemanticUpdateIds: [],
    appliedUpdateDigests: [],
    appliedRepairCanonicalDigests: [],
    nextRepairSeq: 1,
    bufferedUpdates: [],
    clientOwners: initialClientOwners(yjsState.doc, replicaId, sessionId),
    publicationJournal: [],
    remoteEventsSinceLastLocal: [],
    reseedCheckpoint: {
      canonicalFingerprint: fingerprintAuthoredModel(model),
      stateVector: Y.encodeStateVector(yjsState.doc),
      fullState: Y.encodeStateAsUpdate(yjsState.doc),
      revision: model.revision,
      nextJournalSequence: 1,
    },
    env,
    replicaId,
    sessionId,
    clientId: yjsState.doc.clientID,
    actorSessionGroupHistory: createEmptyActorSessionGroupHistoryState(YJS_NORMALIZATION_VERSION),
  });
}

export function restoreYjsStoreBackend(
  snapshot: unknown,
  options: Pick<YjsStoreBackendOptions, 'replicaId' | 'sessionId' | 'clientId'> = {}
): YjsStoreBackend {
  return createYjsStoreBackendFromState(decodeYjsBackendSnapshot(snapshot, options));
}

export function isYjsBackendStagedMutation(value: unknown): value is BackendStagedMutation {
  return typeof value === 'object' && value !== null && TRUSTED_LOCAL_STAGES.has(value);
}

function createYjsStoreBackendFromState(initial: RestoredYjsBackendState): YjsStoreBackend {
  let identity = Object.freeze({ ...initial.identity });
  const replicaId = initial.replicaId;
  let sessionId = initial.sessionId;
  let state: RuntimeState = Object.freeze({
    model: initial.model,
    env: initial.env,
    coverage: createBackendCoverage(initial.appliedConstituentIds, initial.appliedCommitIds),
    yjsState: initial.yjsState,
    appliedUpdateIds: new Set(initial.appliedUpdateIds),
    appliedSemanticUpdateIds: new Set(initial.appliedSemanticUpdateIds),
    appliedUpdateDigests: new Map(
      initial.appliedUpdateDigests.map((entry) => [entry.updateId, entry.digest])
    ),
    appliedRepairCanonicalDigests: new Map(
      initial.appliedRepairCanonicalDigests.map((entry) => [entry.updateId, entry.digest])
    ),
    nextRepairSeq: initial.nextRepairSeq,
    bufferedUpdates: new Map(initial.bufferedUpdates.map((update) => [update.updateId, update])),
    clientOwners: new Map(
      initial.clientOwners.map((owner) => [
        owner.clientId,
        clientOwnerRecord({
          replicaId: owner.replicaId,
          sessionId: owner.sessionId,
        }),
      ])
    ),
    publicationJournal: initial.publicationJournal.map(snapshotJournalEntry),
    remoteEventsSinceLastLocal: Object.freeze([...initial.remoteEventsSinceLastLocal]),
    reseedCheckpoint: Object.freeze({
      ...initial.reseedCheckpoint,
      stateVector: initial.reseedCheckpoint.stateVector.slice(),
      fullState: initial.reseedCheckpoint.fullState.slice(),
    }),
  });
  const stages = new WeakMap<BackendStagedMutation, LocalStageRecord>();
  const localPublications = new Map<string, InternalPreparedLocal>();
  const restoredHistory = initial.actorSessionGroupHistory;

  const backend: YjsStoreBackend = {
    get identity() {
      return identity;
    },
    get model() {
      return state.model;
    },
    get operationEnvironment() {
      return snapshotOperationEnvironment(state.env);
    },
    get coverage(): BackendCoverageBookkeeping {
      return snapshotBackendCoverage(state.coverage);
    },
    stageLocalMutation(input: BackendStageInput): BackendStageResult {
      const allowedKeys = [
        'ops',
        'constituentIds',
        ...(input.actorId === undefined ? [] : ['actorId']),
        ...(input.identityRestoration === undefined ? [] : ['identityRestoration']),
        ...(input.includeReplicationClosure === undefined ? [] : ['includeReplicationClosure']),
      ];
      const closed = readClosedDataObject(input, allowedKeys, 'Yjs backend stage input');
      const ops = snapshotDenseArray(closed.ops, 'Yjs backend stage operations');
      const constituentIds = snapshotConstituentIds(
        closed.constituentIds,
        'Yjs backend stage constituent IDs'
      );
      if (constituentIds.length !== ops.length) {
        throw new TypeError('constituent ID count must equal operation count');
      }
      if (constituentIds.some((id) => state.coverage.constituentIds.has(id))) {
        return Object.freeze({
          status: 'noOp',
          reason: 'constituent coverage overlap rejects atomic batch',
        });
      }
      const actorId = typeof closed.actorId === 'string' ? closed.actorId : state.env.actorId;
      if (!isSpikeId(actorId)) throw new TypeError('invalid local stage actorId');
      const actorEnv = operationEnvironmentForActor(state.yjsState, actorId, state.model);
      const semantic = stageSemanticMutation(
        state.model,
        actorEnv,
        ops as BackendStageInput['ops'],
        (closed.identityRestoration as BackendStageInput['identityRestoration']) ?? []
      );
      if (semantic.status !== 'staged') return semantic;

      const baseStateVector = Y.encodeStateVector(state.yjsState.doc);
      const stagedYjsState = cloneYjsDocState(state.yjsState, replicaId);
      const commitSeq = nextReplicaCommitSeq(stagedYjsState.doc, actorId);
      const provisionalCheckpoint = checkpointFor(
        semantic.data.revisionAfter,
        semantic.data.stagedFingerprint
      );
      applyAuthoredTransition(
        stagedYjsState,
        state.model.authored,
        semantic.data.stagedModel.authored,
        actorId,
        commitSeq,
        provisionalCheckpoint,
        semantic.data.trace
      );
      if (closed.includeReplicationClosure === true) {
        rewriteAllocatorRecord(stagedYjsState.doc, actorId);
      }
      validateStagedParity(stagedYjsState, semantic.data.stagedModel);
      const includeReplicationClosure = closed.includeReplicationClosure === true;
      const incrementalBytes = includeReplicationClosure
        ? Y.encodeStateAsUpdate(stagedYjsState.doc)
        : Y.encodeStateAsUpdate(stagedYjsState.doc, baseStateVector);
      if (incrementalBytes.length === 0 || incrementalBytes.length > YJS_MAX_UPDATE_BYTES) {
        throw new TypeError('local incremental update bytes invalid');
      }
      const staged = Object.freeze({
        preview: Object.freeze({
          stageToken: `yjs-stage-${nextStageToken++}`,
          baseRevision: semantic.data.baseRevision,
          baseFingerprint: semantic.data.baseFingerprint,
          revisionAfter: semantic.data.revisionAfter,
          stagedFingerprint: semantic.data.stagedFingerprint,
        }),
      });
      TRUSTED_LOCAL_STAGES.add(staged);
      stages.set(staged, {
        status: 'pending',
        data: semantic.data,
        actorId,
        commitSeq,
        constituentIds: Object.freeze([...constituentIds]),
        stagedYjsState,
        baseStateVector,
        incrementalBytes,
        ops: Object.freeze([...(ops as readonly DocOpSingle[])]),
        baseFullState: Y.encodeStateAsUpdate(state.yjsState.doc),
        includeReplicationClosure,
      });
      return Object.freeze({ status: 'staged', staged });
    },
    previewStagedMutation(staged, input) {
      return prepareLocalPublication(staged, input).result;
    },
    commitStagedMutation(staged, input) {
      const prepared = prepareLocalPublication(staged, input);
      publishLocalPublication(prepared);
      return prepared.result;
    },
    rollbackStagedMutation(staged) {
      const record = getStageRecord(staged);
      if (record.status === 'committed') throw new TypeError('cannot roll back committed stage');
      if (record.status === 'rolledBack') return;
      record.status = 'rolledBack';
    },
    encodeSnapshot(history?: ActorSessionGroupHistoryState): SnapshotEnvelope {
      const fallbackHistory =
        restoredHistory.safeAuditCursor.sequence === state.model.revision
          ? restoredHistory
          : Object.freeze({
              ...createEmptyActorSessionGroupHistoryState(YJS_NORMALIZATION_VERSION),
              safeAuditCursor: createSafeAuditCursor(state.model.revision),
            });
      return encodeYjsBackendSnapshot({
        identity,
        model: state.model,
        yjsState: state.yjsState,
        appliedConstituentIds: [...state.coverage.constituentIds],
        appliedCommitIds: [...state.coverage.commitIds],
        appliedUpdateIds: [...state.appliedUpdateIds],
        appliedSemanticUpdateIds: [...state.appliedSemanticUpdateIds],
        appliedUpdateDigests: [...state.appliedUpdateDigests].map(([updateId, digest]) =>
          Object.freeze({ updateId, digest })
        ),
        appliedRepairCanonicalDigests: [...state.appliedRepairCanonicalDigests].map(
          ([updateId, digest]) => Object.freeze({ updateId, digest })
        ),
        nextRepairSeq: state.nextRepairSeq,
        bufferedUpdates: [...state.bufferedUpdates.values()],
        clientOwners: [...state.clientOwners].map(([clientId, owner]) => ({
          clientId,
          replicaId: owner.replicaId,
          sessionId: owner.sessionId,
        })),
        publicationJournal: state.publicationJournal,
        remoteEventsSinceLastLocal: state.remoteEventsSinceLastLocal,
        reseedCheckpoint: state.reseedCheckpoint,
        env: state.env,
        replicaId,
        sessionId,
        clientId: state.yjsState.doc.clientID,
        actorSessionGroupHistory: history ?? fallbackHistory,
      });
    },
    inspectState(): BackendStateInspection {
      return Object.freeze({
        identity,
        revision: state.model.revision,
        canonicalFingerprint: fingerprintAuthoredModel(state.model),
        operationEnvironment: Object.freeze({
          actorId: state.env.actorId,
          nextCommitSeq: state.env.nextCommitSeq,
          nextLocalSeq: state.env.nextLocalSeq,
          reservedSemanticIds: Object.freeze(
            [...state.env.reservedSemanticIds].sort(codeUnitCompare)
          ),
        }),
        coverage: Object.freeze({
          constituentIds: Object.freeze([...state.coverage.constituentIds].sort(codeUnitCompare)),
          commitIds: Object.freeze([...state.coverage.commitIds].sort(codeUnitCompare)),
        }),
      });
    },
    hasConstituentCoverage(id) {
      return state.coverage.constituentIds.has(id);
    },
    hasCommitCoverage(id) {
      return state.coverage.commitIds.has(id);
    },
    inspectYjsModel() {
      return decodeYjsDocState(state.yjsState);
    },
    inspectReplicationState() {
      const vector = Y.encodeStateVector(state.yjsState.doc);
      const full = Y.encodeStateAsUpdate(state.yjsState.doc);
      const pendingUpdates = [...state.bufferedUpdates.values()].filter((update) =>
        updateHasUnintegratedStructs(update, state.yjsState.doc)
      );
      return Object.freeze({
        clientId: state.yjsState.doc.clientID,
        stateVector: vector.slice(),
        fullState: full.slice(),
        appliedUpdateIds: Object.freeze([...state.appliedUpdateIds].sort(codeUnitCompare)),
        appliedSemanticUpdateIds: Object.freeze(
          [...state.appliedSemanticUpdateIds].sort(codeUnitCompare)
        ),
        bufferedUpdateIds: Object.freeze([...state.bufferedUpdates.keys()].sort(codeUnitCompare)),
        clientOwners: Object.freeze(
          [...state.clientOwners]
            .sort(([left], [right]) => left - right)
            .map(([clientId, owner]) =>
              Object.freeze({
                clientId,
                replicaId: owner.replicaId,
                sessionId: owner.sessionId,
              })
            )
        ),
        pendingUpdateCount: pendingUpdates.length,
        pendingUpdateBytes: pendingUpdates.reduce(
          (total, update) => total + update.bytes.length,
          0
        ),
        checkpoint: state.yjsState.checkpoint,
      });
    },
    encodeReplicationUpdate() {
      if (!state.lastUpdate) throw new TypeError('no committed replication update available');
      return state.lastUpdate;
    },
    prepareLocalPublication,
    publishLocalPublication,
    stageRemoteReplicationUpdate,
    publishRemotePublication,
    publishBufferedRemote,
    reseedLocalUpdate,
    applySnapshotResync,
  };
  return backend;

  function getStageRecord(staged: BackendStagedMutation): LocalStageRecord {
    if (!isYjsBackendStagedMutation(staged)) throw new TypeError('untrusted stage');
    const record = stages.get(staged);
    if (!record) throw new TypeError('stage belongs to another backend');
    return record;
  }

  function prepareLocalPublication(
    staged: BackendStagedMutation,
    input: BackendCommitInput
  ): PreparedYjsLocalPublication {
    const record = getStageRecord(staged);
    if (record.status !== 'pending') throw new TypeError(`${record.status} stage`);
    assertCurrentBase(record.data, state);
    const commitInput = snapshotCommitInput(input);
    if (
      commitInput.actorId !== record.actorId ||
      !sameStrings(commitInput.constituentIds, record.constituentIds)
    ) {
      throw new TypeError('commit metadata does not match local stage');
    }
    if (commitInput.constituentIds.some((id) => state.coverage.constituentIds.has(id))) {
      throw new TypeError('constituent coverage overlap');
    }
    const commitId = commitIdFor(
      record.actorId,
      record.data.baseRevision >= 10 ? record.data.revisionAfter : record.commitSeq
    );
    if (state.coverage.commitIds.has(commitId)) {
      throw new TypeError('commit ID already covered');
    }
    const result = createCommitResult(record.data, commitId, record.ops);
    const finalVector = Y.encodeStateVector(record.stagedYjsState.doc);
    const checkpoint = checkpointFor(
      record.data.revisionAfter,
      record.data.stagedFingerprint,
      finalVector
    );
    const stagedYjsState = Object.freeze({
      ...record.stagedYjsState,
      checkpoint,
    });
    const updateId = stableUpdateId('update', replicaId, commitId, commitInput.constituentIds);
    const update = createReplicationUpdateEnvelope({
      documentId: identity.documentId,
      backendVersion: identity.backendVersion,
      schemaVersion: identity.schemaVersion,
      checkpoint,
      updateId,
      semanticUpdateId: updateId,
      sourceActorId: record.actorId,
      sourceReplicaId: replicaId,
      sourceSessionId: sessionId,
      sourceClientId: stagedYjsState.doc.clientID,
      constituentIds: commitInput.constituentIds,
      coverage: 'incremental',
      bytes: record.incrementalBytes,
    });
    assertTrustedUpdate(update);
    const nextCoverage = nextBackendCoverage(state.coverage, commitInput.constituentIds, commitId);
    const appliedUpdateIds = new Set(state.appliedUpdateIds);
    const appliedUpdateDigests = new Map(state.appliedUpdateDigests);
    recordAppliedUpdate(appliedUpdateIds, appliedUpdateDigests, update);
    const appliedSemanticUpdateIds = new Set(state.appliedSemanticUpdateIds);
    appliedSemanticUpdateIds.add(update.semanticUpdateId);
    const nextEnv = operationEnvironmentForActor(
      stagedYjsState,
      record.actorId,
      record.data.stagedModel
    );
    const prepared = Object.freeze({
      result,
      update,
      record,
      baseState: state,
      nextState: Object.freeze({
        model: record.data.stagedModel,
        env: nextEnv,
        coverage: nextCoverage,
        yjsState: stagedYjsState,
        appliedUpdateIds,
        appliedSemanticUpdateIds,
        appliedUpdateDigests,
        appliedRepairCanonicalDigests: state.appliedRepairCanonicalDigests,
        nextRepairSeq: state.nextRepairSeq,
        bufferedUpdates: state.bufferedUpdates,
        clientOwners: withClientOwner(state.clientOwners, update),
        publicationJournal: state.publicationJournal,
        remoteEventsSinceLastLocal: state.remoteEventsSinceLastLocal,
        reseedCheckpoint: state.reseedCheckpoint,
        lastUpdate: update,
      }),
    }) as InternalPreparedLocal;
    TRUSTED_LOCAL_PUBLICATIONS.add(prepared);
    return prepared;
  }

  function publishLocalPublication(preparedInput: PreparedYjsLocalPublication): void {
    if (
      typeof preparedInput !== 'object' ||
      preparedInput === null ||
      !TRUSTED_LOCAL_PUBLICATIONS.has(preparedInput)
    ) {
      throw new TypeError('untrusted local publication');
    }
    const prepared = preparedInput as InternalPreparedLocal;
    if (prepared.baseState !== state) throw new TypeError('stale local publication');
    if (prepared.record.status !== 'pending') {
      throw new TypeError('local publication stage is not pending');
    }
    const entry: LocalPublicationJournalEntry = Object.freeze({
      sequence:
        state.publicationJournal.at(-1)?.sequence !== undefined
          ? state.publicationJournal.at(-1)!.sequence + 1
          : state.reseedCheckpoint.nextJournalSequence,
      baseRevision: prepared.record.data.baseRevision,
      semanticUpdateId: prepared.update.semanticUpdateId,
      attemptUpdateIds: Object.freeze([prepared.update.updateId]),
      constituentIds: Object.freeze([...prepared.update.constituentIds]),
      actorId: prepared.record.actorId,
      originSessionId: prepared.update.sourceSessionId,
      ops: Object.freeze([...prepared.record.ops]),
      baseFullState: prepared.record.baseFullState.slice(),
      latestAttempt: prepared.update,
      remoteEventsBefore: Object.freeze([...state.remoteEventsSinceLastLocal]),
    });
    const publicationJournal = appendJournalEntry(state.publicationJournal, entry);
    state = Object.freeze({
      ...prepared.nextState,
      publicationJournal,
      remoteEventsSinceLastLocal: Object.freeze([]),
      reseedCheckpoint: state.reseedCheckpoint,
    });
    prepared.record.status = 'committed';
    localPublications.set(prepared.update.updateId, prepared);
  }

  function stageRemoteReplicationUpdate(updateInput: unknown): YjsRemoteStageResult {
    try {
      const validation = snapshotAndValidateReplicationUpdate(updateInput);
      if (!validation.snapshot || validation.errors.length > 0) {
        return failedRemote('invalid-update', validation.errors.join('; '));
      }
      const update = validation.snapshot;
      if (
        update.documentId !== identity.documentId ||
        update.backendVersion !== identity.backendVersion ||
        update.schemaVersion !== identity.schemaVersion ||
        update.bytes.length === 0 ||
        update.bytes.length > YJS_MAX_UPDATE_BYTES
      ) {
        return failedRemote('invalid-update', 'remote update identity or size mismatch');
      }
      if (state.appliedUpdateIds.has(update.updateId)) {
        const storedDigest = state.appliedUpdateDigests.get(update.updateId);
        const incomingDigest = updatePayloadDigest(update);
        if (storedDigest === incomingDigest) {
          return Object.freeze({ status: 'duplicate', reason: 'update ID already covered' });
        }
        if (update.sourceActorId !== 'actor-repair') {
          return failedRemote('update-id-collision', 'same update ID carries a different payload');
        }
      }
      if (state.appliedSemanticUpdateIds.has(update.semanticUpdateId)) {
        return Object.freeze({
          status: 'duplicate',
          reason: 'semantic update attempt already covered',
        });
      }
      const coveredConstituents = update.constituentIds.filter((id) =>
        state.coverage.constituentIds.has(id)
      );
      if (coveredConstituents.length === update.constituentIds.length) {
        return Object.freeze({
          status: 'duplicate',
          reason: 'all semantic constituents are already covered',
        });
      }
      if (coveredConstituents.length > 0) {
        return failedRemote(
          'constituent-overlap',
          'mixed covered and uncovered constituents reject the atomic remote batch'
        );
      }
      let updateClients: readonly number[];
      try {
        const decodedUpdate = Y.decodeUpdate(update.bytes);
        updateClients = [
          ...new Set([
            ...decodedUpdate.structs.map((struct) => struct.id.client),
            ...decodedUpdate.ds.clients.keys(),
          ]),
        ];
      } catch {
        return failedRemote('malformed-yjs-update', 'Yjs update vector decode failed');
      }
      const receiverVector = Y.decodeStateVector(Y.encodeStateVector(state.yjsState.doc));
      if (
        !updateClients.includes(update.sourceClientId) ||
        Y.decodeUpdate(update.bytes).structs.some(
          (struct) =>
            struct.id.client !== update.sourceClientId &&
            struct.id.clock + struct.length > (receiverVector.get(struct.id.client) ?? 0)
        )
      ) {
        return failedRemote(
          'source-client-mismatch',
          'replication envelope introduces structs not owned by sourceClientId'
        );
      }
      const boundOwner =
        state.clientOwners.get(update.sourceClientId) ??
        (Y.decodeStateVector(Y.encodeStateVector(state.yjsState.doc)).has(update.sourceClientId)
          ? {
              replicaId: 'replica-unregistered-client',
              sessionId: 'session-unregistered-client',
            }
          : undefined);
      if (
        boundOwner &&
        (boundOwner.replicaId !== update.sourceReplicaId ||
          boundOwner.sessionId !== update.sourceSessionId)
      ) {
        return Object.freeze({
          status: 'clientCollision',
          collision: Object.freeze({
            sourceClientId: update.sourceClientId,
            attemptedReplicaId: update.sourceReplicaId,
            attemptedSessionId: update.sourceSessionId,
            boundReplicaId: boundOwner.replicaId,
            boundSessionId: boundOwner.sessionId,
            semanticUpdateId: update.semanticUpdateId,
          }),
        });
      }
      const baseState = state;
      const staged = cloneYjsDocState(state.yjsState, replicaId);
      const beforeDecoded = decodeYjsDocState(staged);
      const beforeVector = Y.encodeStateVector(staged.doc);
      let mergedVector = beforeVector;
      let repairIdentity = '';
      const repairSteps: string[] = [];
      let repairChanged = false;
      try {
        Y.applyUpdate(staged.doc, update.bytes, {
          kind: 'remote',
          updateId: update.updateId,
        });
      } catch {
        return failedRemote('malformed-yjs-update', 'Yjs update decode failed');
      }
      mergedVector = Y.encodeStateVector(staged.doc);
      repairIdentity = repairIdentityFor(decodeYjsDocState(staged));
      const beforeRepair = Y.encodeStateVector(staged.doc);
      staged.doc.transact(
        () => {
          repairYjsDocumentInPlace(staged, repairSteps);
        },
        { kind: 'repair', owner: repairIdentity }
      );
      repairChanged = !stateVectorsEqual(beforeRepair, Y.encodeStateVector(staged.doc));
      const afterDecoded = decodeYjsDocState(staged);
      const suppressRepairEmit = update.sourceActorId === 'actor-repair';
      const bindingErrors = validateRemoteAuthoredEditBindings(
        beforeDecoded,
        afterDecoded,
        update,
        withClientOwner(state.clientOwners, update)
      );
      if (bindingErrors.length > 0) {
        return failedRemote('provenance-binding-mismatch', bindingErrors.join('; '));
      }
      if (update.sourceActorId === 'actor-repair' && state.appliedUpdateIds.has(update.updateId)) {
        const canonicalDigest = repairCanonicalDigest(mergedVector, repairSteps, afterDecoded);
        const storedCanonical = state.appliedRepairCanonicalDigests.get(update.updateId);
        if (storedCanonical !== canonicalDigest) {
          return failedRemote(
            'update-id-collision',
            'same repair update ID carries a different payload'
          );
        }
        return Object.freeze({ status: 'duplicate', reason: 'repair update already covered' });
      }
      const repair = Object.freeze({
        changed: repairChanged,
        repairSteps: Object.freeze(repairSteps),
      });
      const repairedVector = Y.encodeStateVector(staged.doc);
      const repairBytes = repair.changed
        ? Y.encodeStateAsUpdate(staged.doc, mergedVector)
        : undefined;
      const allBufferedUpdates = new Map(state.bufferedUpdates);
      allBufferedUpdates.set(update.updateId, update);
      const physicallyUnresolved = new Set(
        hasPendingYjsState(staged.doc)
          ? [...allBufferedUpdates.values()]
              .filter((candidate) => updateHasUnintegratedStructs(candidate, staged.doc))
              .map((candidate) => candidate.updateId)
          : []
      );
      const unresolvedSourceClients = new Set(
        [...allBufferedUpdates.values()]
          .filter((candidate) => physicallyUnresolved.has(candidate.updateId))
          .map((candidate) => candidate.sourceClientId)
      );
      const bufferedUpdates = new Map(
        [...allBufferedUpdates].filter(
          ([, candidate]) =>
            physicallyUnresolved.has(candidate.updateId) ||
            unresolvedSourceClients.has(candidate.sourceClientId)
        )
      );
      const newlyVisibleUpdates = [...allBufferedUpdates.values()].filter(
        (candidate) => !bufferedUpdates.has(candidate.updateId)
      );
      if (newlyVisibleUpdates.length === 0) {
        if (staged.doc.store.pendingDs === null) {
          try {
            assertBufferedCanonicalParity(staged, state.model);
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === 'buffered Yjs state changed integrated canonical model'
            ) {
              bufferedUpdates.delete(update.updateId);
              newlyVisibleUpdates.push(update);
            } else {
              throw error;
            }
          }
        }
      }
      if (newlyVisibleUpdates.length === 0) {
        const nextCoverage = nextBackendCoverage(
          state.coverage,
          update.constituentIds,
          update.updateId
        );
        const appliedUpdateIds = new Set(state.appliedUpdateIds);
        const appliedUpdateDigests = new Map(state.appliedUpdateDigests);
        recordAppliedUpdate(appliedUpdateIds, appliedUpdateDigests, update);
        const appliedSemanticUpdateIds = new Set(state.appliedSemanticUpdateIds);
        appliedSemanticUpdateIds.add(update.semanticUpdateId);
        const quotaError = pendingQuotaError(bufferedUpdates, staged.doc);
        if (quotaError) return failedRemote('pending-quota', quotaError);
        const clientOwners = withClientOwner(state.clientOwners, update);
        const prepared = Object.freeze({
          updateId: update.updateId,
          constituentIds: Object.freeze([...update.constituentIds]),
          baseState,
          nextState: Object.freeze({
            ...state,
            coverage: nextCoverage,
            yjsState: staged,
            appliedUpdateIds,
            appliedSemanticUpdateIds,
            appliedUpdateDigests,
            bufferedUpdates,
            clientOwners,
            remoteEventsSinceLastLocal: Object.freeze([
              ...state.remoteEventsSinceLastLocal,
              update,
            ]),
          }),
        }) as InternalPreparedBuffered;
        TRUSTED_BUFFERED_PUBLICATIONS.add(prepared);
        return Object.freeze({ status: 'buffered', prepared });
      }
      const authored = deriveAuthoredPackageFromYjs(staged);
      const model = createDocumentModel(authored, state.model.revision + 1);
      validateStagedParity(staged, model);
      const canonicalFingerprint = fingerprintAuthoredModel(model);
      if (
        authoredContentSignature(model) === authoredContentSignature(state.model) &&
        stateVectorsEqual(beforeVector, mergedVector)
      ) {
        return Object.freeze({
          status: 'noOp',
          reason: 'wire bytes add no Yjs state and do not prove coverage',
        });
      }
      const checkpoint = checkpointFor(model.revision, canonicalFingerprint, repairedVector);
      const stagedState = Object.freeze({ ...staged, checkpoint });
      const quotaError = pendingQuotaError(bufferedUpdates, staged.doc);
      if (quotaError) return failedRemote('pending-quota', quotaError);
      const causalUpdateIds = [...new Set(newlyVisibleUpdates.map((item) => item.updateId))].sort(
        codeUnitCompare
      );
      const visibleConstituentIds = [
        ...new Set(newlyVisibleUpdates.flatMap((item) => [...item.constituentIds])),
      ].sort(codeUnitCompare);
      const appliedRepairForPublication = repair.changed && !suppressRepairEmit;
      const historyOps = Object.freeze([]) as readonly DocOpSingle[];
      const result = createRemoteCommitResult({
        commitId: commitIdFor(update.sourceActorId, model.revision),
        beforeModel: state.model,
        afterModel: model,
        beforeYjs: beforeDecoded,
        afterYjs: decodeYjsDocState(staged),
        appliedRepair: appliedRepairForPublication,
      });
      let repairUpdate: ReplicationUpdateEnvelope | undefined;
      let repairConstituent: string | undefined;
      let nextRepairSeq = state.nextRepairSeq;
      if (repairBytes && repairBytes.length > 0 && !suppressRepairEmit) {
        const canonicalDigest = repairCanonicalDigest(mergedVector, repairSteps, afterDecoded);
        const repairIdentity = createRepairUpdateIdentity(canonicalDigest, mergedVector);
        if (!state.appliedUpdateIds.has(repairIdentity.updateId)) {
          repairConstituent = repairIdentity.constituentId;
          repairUpdate = createReplicationUpdateEnvelope({
            documentId: identity.documentId,
            backendVersion: identity.backendVersion,
            schemaVersion: identity.schemaVersion,
            checkpoint,
            updateId: repairIdentity.updateId,
            semanticUpdateId: repairIdentity.semanticUpdateId,
            sourceActorId: 'actor-repair',
            sourceReplicaId: replicaId,
            sourceSessionId: sessionId,
            sourceClientId: staged.doc.clientID,
            constituentIds: [repairConstituent],
            coverage: 'incremental',
            bytes: repairBytes,
          });
          assertTrustedUpdate(repairUpdate);
          nextRepairSeq += 1;
        }
      }
      const coverageConstituents = repairConstituent
        ? [...update.constituentIds, repairConstituent]
        : [...update.constituentIds];
      const nextCoverage = nextBackendCoverage(
        state.coverage,
        coverageConstituents,
        update.updateId
      );
      const appliedUpdateIds = new Set(state.appliedUpdateIds);
      const appliedUpdateDigests = new Map(state.appliedUpdateDigests);
      const appliedRepairCanonicalDigests = new Map(state.appliedRepairCanonicalDigests);
      recordAppliedUpdate(appliedUpdateIds, appliedUpdateDigests, update);
      if (update.sourceActorId === 'actor-repair') {
        appliedRepairCanonicalDigests.set(
          update.updateId,
          repairCanonicalDigest(mergedVector, repairSteps, afterDecoded)
        );
      }
      if (repairUpdate) {
        recordAppliedUpdate(appliedUpdateIds, appliedUpdateDigests, repairUpdate);
        appliedRepairCanonicalDigests.set(
          repairUpdate.updateId,
          repairCanonicalDigest(mergedVector, repairSteps, afterDecoded)
        );
      }
      const appliedSemanticUpdateIds = new Set(state.appliedSemanticUpdateIds);
      appliedSemanticUpdateIds.add(update.semanticUpdateId);
      if (repairUpdate) {
        appliedSemanticUpdateIds.add(repairUpdate.semanticUpdateId);
      }
      const clientOwners = withClientOwner(state.clientOwners, update);
      const nextEnv = operationEnvironmentForActor(stagedState, state.env.actorId, model);
      const remoteEvents = Object.freeze([...state.remoteEventsSinceLastLocal, update]);
      const compactRemoteJournal =
        remoteEvents.length > YJS_MAX_RESEED_JOURNAL_ENTRIES ||
        remoteEvents.reduce((total, event) => total + event.bytes.length, 0) >
          YJS_MAX_RESEED_JOURNAL_BYTES;
      const reseedCheckpoint = compactRemoteJournal
        ? checkpointFromState(
            stagedState,
            model,
            (state.publicationJournal.at(-1)?.sequence ?? 0) + 1
          )
        : state.reseedCheckpoint;
      const prepared = Object.freeze({
        result,
        repairUpdate,
        appliedRepair: appliedRepairForPublication,
        constituentIds: Object.freeze(visibleConstituentIds),
        causalUpdateIds: Object.freeze(causalUpdateIds),
        historyOps,
        baseState,
        nextState: Object.freeze({
          model,
          env: nextEnv,
          coverage: nextCoverage,
          yjsState: stagedState,
          appliedUpdateIds,
          appliedSemanticUpdateIds,
          appliedUpdateDigests,
          appliedRepairCanonicalDigests,
          nextRepairSeq,
          bufferedUpdates,
          clientOwners,
          publicationJournal: compactRemoteJournal ? Object.freeze([]) : state.publicationJournal,
          remoteEventsSinceLastLocal: compactRemoteJournal ? Object.freeze([]) : remoteEvents,
          reseedCheckpoint,
          lastUpdate: repairUpdate,
        }),
      }) as InternalPreparedRemote;
      TRUSTED_REMOTE_PUBLICATIONS.add(prepared);
      return Object.freeze({ status: 'staged', prepared });
    } catch (error) {
      return failedRemote(
        'remote-stage-failed',
        error instanceof Error ? error.message : 'remote stage failed'
      );
    }
  }

  function publishRemotePublication(preparedInput: PreparedYjsRemotePublication): void {
    if (
      typeof preparedInput !== 'object' ||
      preparedInput === null ||
      !TRUSTED_REMOTE_PUBLICATIONS.has(preparedInput)
    ) {
      throw new TypeError('untrusted remote publication');
    }
    const prepared = preparedInput as InternalPreparedRemote;
    if (prepared.baseState !== state) throw new TypeError('stale remote publication');
    state = prepared.nextState;
  }

  function publishBufferedRemote(preparedInput: PreparedYjsBufferedPublication): void {
    if (
      typeof preparedInput !== 'object' ||
      preparedInput === null ||
      !TRUSTED_BUFFERED_PUBLICATIONS.has(preparedInput)
    ) {
      throw new TypeError('untrusted buffered publication');
    }
    const prepared = preparedInput as InternalPreparedBuffered;
    if (prepared.baseState !== state) throw new TypeError('stale buffered publication');
    state = prepared.nextState;
  }

  function reseedLocalUpdate(
    updateId: string,
    input: { readonly clientId?: number; readonly sessionId: string }
  ): YjsReseedResult {
    try {
      const closed = readClosedDataObject(
        input,
        input.clientId === undefined ? ['sessionId'] : ['clientId', 'sessionId'],
        'Yjs reseed input'
      );
      if (!isSpikeId(closed.sessionId)) {
        return Object.freeze({
          status: 'failed',
          code: 'invalid-reseed',
          reason: 'invalid reseed sessionId',
        });
      }
      const targetIndex = state.publicationJournal.findIndex(
        (entry) => entry.semanticUpdateId === updateId || entry.attemptUpdateIds.includes(updateId)
      );
      if (targetIndex < 0 || state.publicationJournal.length === 0) {
        return snapshotResyncRequirement();
      }
      const targetEntry = state.publicationJournal[targetIndex]!;
      if (state.publicationJournal[0]!.sequence !== 1) {
        const retainedBase = new Y.Doc({ gc: false });
        retainedBase.getMap('root');
        Y.applyUpdate(retainedBase, state.publicationJournal[0]!.baseFullState);
        const targetClientClock =
          Y.decodeStateVector(Y.encodeStateVector(retainedBase)).get(
            targetEntry.latestAttempt.sourceClientId
          ) ?? 0;
        if (targetClientClock > 0) return snapshotResyncRequirement();
      }
      if (
        updateId === targetEntry.semanticUpdateId &&
        targetEntry.latestAttempt.updateId !== targetEntry.semanticUpdateId &&
        targetEntry.latestAttempt.sourceClientId === identity.clientId
      ) {
        const retainedUpdates = Object.freeze(
          state.publicationJournal.slice(0, targetIndex + 1).map((entry) => entry.latestAttempt)
        );
        return Object.freeze({
          status: 'reseeded',
          update: retainedUpdates.at(-1)!,
          updates: retainedUpdates,
        });
      }
      const nextClientId =
        closed.clientId === undefined
          ? new Y.Doc({ gc: false }).clientID
          : (closed.clientId as number);
      if (!Number.isInteger(nextClientId) || nextClientId <= 0 || nextClientId > 0xffff_ffff) {
        return Object.freeze({
          status: 'failed',
          code: 'invalid-reseed',
          reason: 'reseed clientId must be a nonzero uint32',
        });
      }
      const existingOwner = state.clientOwners.get(nextClientId);
      if (
        existingOwner &&
        (existingOwner.replicaId !== replicaId || existingOwner.sessionId !== closed.sessionId)
      ) {
        return Object.freeze({
          status: 'failed',
          code: 'client-collision',
          reason: 'reseed clientId is already owned by another replica/session',
        });
      }
      const firstEntry = state.publicationJournal[0]!;
      const replayDoc = new Y.Doc({ gc: false });
      replayDoc.getMap('root');
      Y.applyUpdate(replayDoc, firstEntry.baseFullState);
      const staged: YjsDocState = {
        doc: replayDoc,
        documentId: identity.documentId,
        checkpoint: state.yjsState.checkpoint,
        replicaId,
      };
      staged.doc.clientID = nextClientId;
      let replayModel = createDocumentModel(
        deriveAuthoredPackageFromYjs(staged),
        Math.max(0, state.model.revision - state.publicationJournal.length)
      );
      const updates: ReplicationUpdateEnvelope[] = [];
      const replayedJournal: LocalPublicationJournalEntry[] = [];
      const replayCommitIds: string[] = [];
      for (const entry of state.publicationJournal) {
        for (const remoteEvent of entry.remoteEventsBefore) {
          Y.applyUpdate(staged.doc, remoteEvent.bytes);
          replayModel = createDocumentModel(
            deriveAuthoredPackageFromYjs(staged),
            replayModel.revision
          );
        }
        const baseFullState = Y.encodeStateAsUpdate(staged.doc);
        const semantic = stageSemanticMutation(
          replayModel,
          operationEnvironmentForActor(staged, entry.actorId, replayModel),
          entry.ops
        );
        if (semantic.status !== 'staged') {
          return Object.freeze({
            status: 'failed',
            code: 'reseed-replay-failed',
            reason: 'retained semantic publication no longer replays',
          });
        }
        const commitSeq = nextReplicaCommitSeq(staged.doc, entry.actorId);
        const baseVector = Y.encodeStateVector(staged.doc);
        const provisionalCheckpoint = checkpointFor(
          semantic.data.revisionAfter,
          semantic.data.stagedFingerprint
        );
        applyAuthoredTransition(
          staged,
          replayModel.authored,
          semantic.data.stagedModel.authored,
          entry.actorId,
          commitSeq,
          provisionalCheckpoint,
          semantic.data.trace
        );
        validateStagedParity(staged, semantic.data.stagedModel);
        const bytes = Y.encodeStateAsUpdate(staged.doc, baseVector);
        if (bytes.length === 0 || bytes.length > YJS_MAX_UPDATE_BYTES) {
          return Object.freeze({
            status: 'failed',
            code: 'invalid-reseed',
            reason: 'reseeded Yjs delta is invalid',
          });
        }
        const checkpoint = checkpointFor(
          semantic.data.revisionAfter,
          semantic.data.stagedFingerprint,
          Y.encodeStateVector(staged.doc)
        );
        const attemptId = compactDerivedId(
          `attempt-${entry.semanticUpdateId}-${nextClientId}-${entry.sequence}`,
          `attempt\u0000${entry.semanticUpdateId}\u0000${nextClientId}\u0000${entry.sequence}\u0000${closed.sessionId as string}`
        );
        const replayUpdate = createReplicationUpdateEnvelope({
          documentId: identity.documentId,
          backendVersion: identity.backendVersion,
          schemaVersion: identity.schemaVersion,
          checkpoint,
          updateId: attemptId,
          semanticUpdateId: entry.semanticUpdateId,
          sourceActorId: entry.actorId,
          sourceReplicaId: replicaId,
          sourceSessionId: closed.sessionId as string,
          sourceClientId: nextClientId,
          constituentIds: entry.constituentIds,
          coverage: 'incremental',
          bytes,
        });
        updates.push(replayUpdate);
        replayCommitIds.push(commitIdFor(entry.actorId, commitSeq));
        replayedJournal.push(
          snapshotJournalEntry({
            ...entry,
            attemptUpdateIds: [...entry.attemptUpdateIds, attemptId],
            baseFullState,
            latestAttempt: replayUpdate,
          })
        );
        replayModel = semantic.data.stagedModel;
      }
      for (const remoteEvent of state.remoteEventsSinceLastLocal) {
        Y.applyUpdate(staged.doc, remoteEvent.bytes);
        replayModel = createDocumentModel(
          deriveAuthoredPackageFromYjs(staged),
          replayModel.revision
        );
      }
      const finalModel = createDocumentModel(replayModel.authored, state.model.revision);
      if (authoredContentSignature(finalModel) !== authoredContentSignature(state.model)) {
        return snapshotResyncRequirement();
      }
      if (
        replayedJournal.length > YJS_MAX_RESEED_JOURNAL_ENTRIES ||
        replayedJournal.reduce((total, entry) => total + journalEntryBytes(entry), 0) >
          YJS_MAX_RESEED_JOURNAL_BYTES
      ) {
        return snapshotResyncRequirement();
      }
      const checkpoint = checkpointFor(
        finalModel.revision,
        fingerprintAuthoredModel(finalModel),
        Y.encodeStateVector(staged.doc)
      );
      const stagedState = Object.freeze({ ...staged, checkpoint });
      const clientOwners = new Map(state.clientOwners);
      clientOwners.set(
        nextClientId,
        clientOwnerRecord({
          replicaId,
          sessionId: closed.sessionId as string,
        })
      );
      const appliedUpdateIds = new Set(state.appliedUpdateIds);
      const appliedUpdateDigests = new Map(state.appliedUpdateDigests);
      for (const replayUpdate of updates) {
        recordAppliedUpdate(appliedUpdateIds, appliedUpdateDigests, replayUpdate);
      }
      const coverage = createBackendCoverage(state.coverage.constituentIds, [
        ...state.coverage.commitIds,
        ...replayCommitIds,
      ]);
      const nextState = Object.freeze({
        ...state,
        model: finalModel,
        yjsState: stagedState,
        coverage,
        appliedUpdateIds,
        appliedSemanticUpdateIds: state.appliedSemanticUpdateIds,
        appliedUpdateDigests,
        nextRepairSeq: state.nextRepairSeq,
        clientOwners,
        publicationJournal: Object.freeze(replayedJournal),
        env: operationEnvironmentForActor(stagedState, state.env.actorId, finalModel),
        lastUpdate: updates.at(-1),
      });
      const nextIdentity = createBackendIdentity(
        identity.documentId,
        replicaId,
        closed.sessionId as string,
        nextClientId
      );
      state = nextState;
      sessionId = closed.sessionId as string;
      identity = nextIdentity;
      const returnedUpdates = Object.freeze(updates.slice(0, targetIndex + 1));
      const update = returnedUpdates.at(-1)!;
      return Object.freeze({ status: 'reseeded', update, updates: returnedUpdates });
    } catch (error) {
      return Object.freeze({
        status: 'failed',
        code: 'reseed-failed',
        reason: error instanceof Error ? error.message : 'reseed failed',
      });
    }
  }

  function snapshotResyncRequirement(): YjsSnapshotResyncRequirement {
    return Object.freeze({
      status: 'fullSnapshotResyncRequired',
      snapshot: backend.encodeSnapshot(),
      precondition: Object.freeze({
        documentId: identity.documentId,
        canonicalFingerprint: state.reseedCheckpoint.canonicalFingerprint,
        stateVector: state.reseedCheckpoint.stateVector.slice(),
      }),
    });
  }

  function applySnapshotResync(requirement: YjsSnapshotResyncRequirement): YjsSnapshotResyncResult {
    try {
      if (
        requirement.status !== 'fullSnapshotResyncRequired' ||
        requirement.precondition.documentId !== identity.documentId
      ) {
        return Object.freeze({
          status: 'failed',
          code: 'invalid-resync-requirement',
          reason: 'snapshot resync requirement does not match document',
        });
      }
      if (
        fingerprintAuthoredModel(state.model) !== requirement.precondition.canonicalFingerprint ||
        !stateVectorsEqual(
          Y.encodeStateVector(state.yjsState.doc),
          requirement.precondition.stateVector
        )
      ) {
        return Object.freeze({
          status: 'conflict',
          code: 'receiver-diverged',
          manualResolutionRequired: true,
        });
      }
      const beforeModel = state.model;
      const beforeYjs = decodeYjsDocState(state.yjsState);
      const restored = decodeYjsBackendSnapshot(requirement.snapshot, {
        replicaId,
        sessionId,
        clientId: identity.clientId,
      });
      const clientOwners = new Map(
        restored.clientOwners.map((owner) => [
          owner.clientId,
          clientOwnerRecord({
            replicaId: owner.replicaId,
            sessionId: owner.sessionId,
          }),
        ])
      );
      clientOwners.set(
        identity.clientId,
        clientOwnerRecord({
          replicaId,
          sessionId,
        })
      );
      const nextState: RuntimeState = Object.freeze({
        model: restored.model,
        env: restored.env,
        coverage: createBackendCoverage(restored.appliedConstituentIds, restored.appliedCommitIds),
        yjsState: restored.yjsState,
        appliedUpdateIds: new Set(restored.appliedUpdateIds),
        appliedSemanticUpdateIds: new Set(restored.appliedSemanticUpdateIds),
        appliedUpdateDigests: new Map(
          restored.appliedUpdateDigests.map((entry) => [entry.updateId, entry.digest])
        ),
        appliedRepairCanonicalDigests: new Map(
          restored.appliedRepairCanonicalDigests.map((entry) => [entry.updateId, entry.digest])
        ),
        nextRepairSeq: restored.nextRepairSeq,
        bufferedUpdates: new Map(
          restored.bufferedUpdates.map((update) => [update.updateId, update])
        ),
        clientOwners,
        publicationJournal: restored.publicationJournal.map(snapshotJournalEntry),
        remoteEventsSinceLastLocal: Object.freeze([...restored.remoteEventsSinceLastLocal]),
        reseedCheckpoint: Object.freeze({
          ...restored.reseedCheckpoint,
          stateVector: restored.reseedCheckpoint.stateVector.slice(),
          fullState: restored.reseedCheckpoint.fullState.slice(),
        }),
      });
      state = nextState;
      if (
        beforeModel.revision === restored.model.revision &&
        fingerprintAuthoredModel(beforeModel) === fingerprintAuthoredModel(restored.model)
      ) {
        return Object.freeze({ status: 'applied' });
      }
      const resyncConstituentId = compactDerivedId(
        `snapshot-resync-${replicaId}-${restored.model.revision}`,
        `snapshot-resync\u0000${replicaId}\u0000${restored.model.revision}`
      );
      const change = createRemoteCommitResult({
        commitId: compactDerivedId(
          `snapshot-resync-commit-${replicaId}-${restored.model.revision}`,
          `snapshot-resync-commit\u0000${replicaId}\u0000${restored.model.revision}`
        ),
        beforeModel,
        afterModel: restored.model,
        beforeYjs,
        afterYjs: decodeYjsDocState(restored.yjsState),
        appliedRepair: true,
      });
      return Object.freeze({
        status: 'applied',
        change,
        resyncConstituentId,
      });
    } catch (error) {
      return Object.freeze({
        status: 'failed',
        code: 'snapshot-resync-failed',
        reason: error instanceof Error ? error.message : 'snapshot resync failed',
      });
    }
  }
}

function hasPendingYjsState(doc: Y.Doc): boolean {
  return doc.store.pendingStructs !== null || doc.store.pendingDs !== null;
}

function clientOwnerRecord(input: { replicaId: string; sessionId: string }): ClientOwner {
  return Object.freeze(input);
}

function withClientOwner(
  owners: ReadonlyMap<number, ClientOwner>,
  update: ReplicationUpdateEnvelope
): ReadonlyMap<number, ClientOwner> {
  const next = new Map(owners);
  next.set(
    update.sourceClientId,
    clientOwnerRecord({
      replicaId: update.sourceReplicaId,
      sessionId: update.sourceSessionId,
    })
  );
  return next;
}

function validateRemoteAuthoredEditBindings(
  before: DecodedYjsModel,
  after: DecodedYjsModel,
  update: ReplicationUpdateEnvelope,
  clientOwners: ReadonlyMap<number, ClientOwner>
): readonly string[] {
  const errors: string[] = [];
  const structCreators = new Map<string, number>();
  for (const struct of Y.decodeUpdate(update.bytes).structs) {
    // Incremental updates may carry already-covered dependency structs from
    // other clients. Only source-owned structs can introduce authored events.
    if (struct.id.client !== update.sourceClientId) continue;
    if (!('parentSub' in struct)) continue;
    const mapKey = struct.parentSub;
    if (typeof mapKey !== 'string' || mapKey.length === 0) continue;
    const derivedCreator = struct.id.client;
    const existingCreator = structCreators.get(mapKey);
    if (existingCreator !== undefined && existingCreator !== derivedCreator) {
      errors.push('authored edit event struct creator ambiguous for map key');
      continue;
    }
    structCreators.set(mapKey, derivedCreator);
  }

  const beforeContributionIds = new Set(
    before.texts.flatMap(
      (text) => text.authoredContributions?.map((event) => event.creationId) ?? []
    )
  );
  const beforeJournalKeys = new Set(before.splitTailEditJournal.map((entry) => entry.key));
  const semanticCreators = new Map<string, number>();

  const validateNewEvent = (event: AuthoredTextEditEvent, mapKey: string): void => {
    const derivedCreator = structCreators.get(mapKey);
    if (derivedCreator === undefined) {
      errors.push('authored edit event struct creator missing from update');
      return;
    }
    if (derivedCreator !== update.sourceClientId) {
      errors.push('authored edit event struct creator does not match update source client');
    }
    const boundOwner = clientOwners.get(derivedCreator);
    if (
      boundOwner &&
      (boundOwner.replicaId !== update.sourceReplicaId ||
        boundOwner.sessionId !== update.sourceSessionId)
    ) {
      errors.push('authored edit event struct creator does not map to update replica session');
    }
    if (event.sourceClientId !== derivedCreator) {
      errors.push(
        clientOwners.has(event.sourceClientId)
          ? 'authored edit event names a different registered client'
          : 'authored edit event source client does not corroborate struct creator'
      );
    }
    if (event.actorId !== update.sourceActorId) {
      errors.push('authored edit event actor does not match update source actor');
    }
    const semanticFingerprint = authoredEditSemanticFingerprint(event);
    const priorCreator = semanticCreators.get(semanticFingerprint);
    if (priorCreator !== undefined && priorCreator !== derivedCreator) {
      errors.push('authored edit event semantic identity ambiguous across struct creators');
      return;
    }
    semanticCreators.set(semanticFingerprint, derivedCreator);
  };

  for (const text of after.texts) {
    for (const event of text.authoredContributions ?? []) {
      if (beforeContributionIds.has(event.creationId)) continue;
      validateNewEvent(event as AuthoredTextEditEvent, event.creationId);
    }
  }
  for (const entry of after.splitTailEditJournal) {
    if (beforeJournalKeys.has(entry.key)) continue;
    validateNewEvent(entry.event as AuthoredTextEditEvent, entry.key);
  }
  return errors;
}

function authoredEditSemanticFingerprint(event: AuthoredTextEditEvent): string {
  if (event.kind === 'insert') {
    return canonicalJson({
      kind: 'insert',
      leftAnchor: event.leftAnchor,
      rightAnchor: event.rightAnchor,
      affinity: event.affinity,
      anchorSplitOffset: event.anchorSplitOffset,
      text: event.text,
    });
  }
  return canonicalJson({
    kind: 'delete',
    tombstonedTokenIds: [...event.tombstonedTokenIds],
    observedInsertCreationIds: [...event.observedInsertCreationIds],
    anchorSplitOffset: event.anchorSplitOffset,
  });
}

function initialClientOwners(
  doc: Y.Doc,
  replicaId: string,
  sessionId: string
): readonly { clientId: number; replicaId: string; sessionId: string }[] {
  const owners = [...Y.decodeStateVector(Y.encodeStateVector(doc)).keys()].map((clientId) => ({
    clientId,
    replicaId: 'replica-seed',
    sessionId: 'session-seed',
  }));
  const ownIndex = owners.findIndex((owner) => owner.clientId === doc.clientID);
  const own = { clientId: doc.clientID, replicaId, sessionId };
  if (ownIndex >= 0) owners[ownIndex] = own;
  else owners.push(own);
  return owners.sort((left, right) => left.clientId - right.clientId);
}

function updatePayloadDigest(update: ReplicationUpdateEnvelope): string {
  return new Bun.CryptoHasher('sha256').update(update.bytes).digest('hex');
}

function recordAppliedUpdate(
  appliedUpdateIds: Set<string>,
  appliedUpdateDigests: Map<string, string>,
  update: ReplicationUpdateEnvelope
): void {
  appliedUpdateIds.add(update.updateId);
  appliedUpdateDigests.set(update.updateId, updatePayloadDigest(update));
}

function repairCanonicalDigest(
  basisVector: Uint8Array,
  repairSteps: readonly string[],
  afterRepairDecoded: DecodedYjsModel
): string {
  return new Bun.CryptoHasher('sha256')
    .update(
      canonicalJson({
        basisDigest: new Bun.CryptoHasher('sha256').update(basisVector).digest('hex'),
        repairSteps: [...repairSteps],
        repairIdentity: repairIdentityFor(afterRepairDecoded),
      })
    )
    .digest('hex');
}

function createRepairUpdateIdentity(
  canonicalDigest: string,
  basisVector: Uint8Array
): {
  readonly updateId: string;
  readonly semanticUpdateId: string;
  readonly constituentId: string;
} {
  const basisDigest = new Bun.CryptoHasher('sha256').update(basisVector).digest('hex');
  const identitySeed = `repair\u0000${canonicalDigest}\u0000${basisDigest}`;
  return Object.freeze({
    updateId: repairStableId(`${identitySeed}\u0000update`),
    semanticUpdateId: repairStableId(`${identitySeed}\u0000semantic`),
    constituentId: repairStableId(`${identitySeed}\u0000constituent`),
  });
}

function repairStableId(provenance: string): string {
  return compactDerivedId('\u0000', provenance);
}

function authoredContentSignature(model: DocumentModel): string {
  const body = model.authored.body;
  return canonicalJson(
    body.paragraphOrder.map((paragraphId) => {
      const paragraph = body.paragraphs.get(paragraphId)!;
      return {
        text: paragraph.text,
        styleId: paragraph.styleId,
        authoredProperties: paragraph.authoredProperties,
        marks: paragraph.marks.map((mark) => ({
          kind: mark.kind,
          start: mark.start,
          end: mark.end,
        })),
      };
    })
  );
}

function snapshotJournalEntry(entry: LocalPublicationJournalEntry): LocalPublicationJournalEntry {
  return Object.freeze({
    sequence: entry.sequence,
    baseRevision: entry.baseRevision,
    semanticUpdateId: entry.semanticUpdateId,
    attemptUpdateIds: Object.freeze([...entry.attemptUpdateIds]),
    constituentIds: Object.freeze([...entry.constituentIds]),
    actorId: entry.actorId,
    originSessionId: entry.originSessionId,
    ops: Object.freeze(entry.ops.map((op) => Object.freeze({ ...op }))),
    baseFullState: entry.baseFullState.slice(),
    latestAttempt: entry.latestAttempt,
    remoteEventsBefore: Object.freeze([...entry.remoteEventsBefore]),
  });
}

function journalEntryBytes(entry: LocalPublicationJournalEntry): number {
  return (
    entry.baseFullState.length +
    entry.latestAttempt.bytes.length +
    entry.remoteEventsBefore.reduce((total, event) => total + event.bytes.length, 0) +
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
    ).length
  );
}

function appendJournalEntry(
  journal: readonly LocalPublicationJournalEntry[],
  entry: LocalPublicationJournalEntry
): readonly LocalPublicationJournalEntry[] {
  const next = [...journal, snapshotJournalEntry(entry)];
  while (
    next.length > YJS_MAX_RESEED_JOURNAL_ENTRIES ||
    next.reduce((total, item) => total + journalEntryBytes(item), 0) > YJS_MAX_RESEED_JOURNAL_BYTES
  ) {
    next.shift();
  }
  return Object.freeze(next);
}

function checkpointFromState(
  yjsState: YjsDocState,
  model: DocumentModel,
  nextJournalSequence: number
): RestoredYjsBackendState['reseedCheckpoint'] {
  const stateVector = Y.encodeStateVector(yjsState.doc);
  return Object.freeze({
    canonicalFingerprint: fingerprintAuthoredModel(model),
    stateVector: stateVector.slice(),
    fullState: Y.encodeStateAsUpdate(yjsState.doc),
    revision: model.revision,
    nextJournalSequence,
  });
}

function pendingQuotaError(
  updates: ReadonlyMap<string, ReplicationUpdateEnvelope>,
  doc: Y.Doc
): string | undefined {
  const pendingUpdates = [...updates.values()].filter((update) =>
    updateHasUnintegratedStructs(update, doc)
  );
  if (pendingUpdates.length > YJS_MAX_PENDING_UPDATES) {
    return 'pending update count exceeds frozen limit';
  }
  let aggregateBytes = 0;
  const bySource = new Map<number, { count: number; bytes: number }>();
  for (const update of pendingUpdates) {
    aggregateBytes += update.bytes.length;
    const source = bySource.get(update.sourceClientId) ?? { count: 0, bytes: 0 };
    source.count += 1;
    source.bytes += update.bytes.length;
    bySource.set(update.sourceClientId, source);
  }
  if (aggregateBytes > YJS_MAX_PENDING_UPDATE_BYTES) {
    return 'pending update bytes exceed frozen aggregate limit';
  }
  for (const source of bySource.values()) {
    if (source.count > YJS_MAX_PENDING_UPDATES_PER_SOURCE) {
      return 'pending update count exceeds frozen per-source limit';
    }
    if (source.bytes > YJS_MAX_PENDING_BYTES_PER_SOURCE) {
      return 'pending update bytes exceed frozen per-source limit';
    }
  }
  return undefined;
}

function updateHasUnintegratedStructs(update: ReplicationUpdateEnvelope, doc: Y.Doc): boolean {
  const current = Y.decodeStateVector(Y.encodeStateVector(doc));
  const decoded = Y.decodeUpdate(update.bytes);
  if (
    decoded.structs.some(
      (struct) => (current.get(struct.id.client) ?? 0) < struct.id.clock + struct.length
    )
  ) {
    return true;
  }
  for (const [clientId, ranges] of decoded.ds.clients) {
    const structs = doc.store.clients.get(clientId) ?? [];
    for (const range of ranges) {
      const end = range.clock + range.len;
      if ((current.get(clientId) ?? 0) < end) return true;
      let clock = range.clock;
      while (clock < end) {
        const struct = structs.find(
          (candidate) =>
            candidate.id.clock <= clock && candidate.id.clock + candidate.length > clock
        );
        if (!struct || !struct.deleted) return true;
        clock = Math.min(end, struct.id.clock + struct.length);
      }
    }
  }
  return false;
}

function repairIdentityFor(decoded: DecodedYjsModel): string {
  const records = [
    ...decoded.stories.map((record) => ({ kind: 'story', ...repairProvenance(record) })),
    ...decoded.blocks.map((record) => ({
      kind: 'block',
      ...repairProvenance(record),
      proposedParagraphId: record.proposedParagraphId,
    })),
    ...decoded.texts.map((record) => ({ kind: 'text', ...repairProvenance(record) })),
    ...decoded.marks.map((record) => ({
      kind: 'mark',
      ...repairProvenance(record),
      markKind: record.markKind,
    })),
    ...decoded.capsules.map((record) => ({
      kind: 'capsule',
      ...repairProvenance(record),
    })),
    ...decoded.tombstones.map((record) => ({
      kind: `tombstone-${record.recordKind}`,
      ...repairProvenance(record),
    })),
  ].sort((left, right) => codeUnitCompare(left.creationId, right.creationId));
  return new Bun.CryptoHasher('sha256')
    .update(canonicalJson({ documentId: decoded.documentId, records }))
    .digest('hex');
}

function repairProvenance(record: {
  readonly creationId: string;
  readonly proposedSemanticId: string;
  readonly actorId: string;
  readonly commitId: string;
}) {
  return {
    creationId: record.creationId,
    proposedSemanticId: record.proposedSemanticId,
    actorId: record.actorId,
    commitId: record.commitId,
  };
}

function validateStagedParity(state: YjsDocState, model: DocumentModel): void {
  const decoded = decodeYjsDocState(state);
  const schemaErrors = validateDecodedYjsModel(decoded);
  if (schemaErrors.length > 0) {
    throw new TypeError(`staged Yjs schema invalid: ${schemaErrors.join('; ')}`);
  }
  const derived = createDocumentModel(deriveAuthoredPackageFromYjs(state), model.revision);
  if (fingerprintAuthoredModel(derived) !== fingerprintAuthoredModel(model)) {
    throw new TypeError('staged canonical/Yjs fingerprint mismatch');
  }
}

function assertBufferedCanonicalParity(state: YjsDocState, model: DocumentModel): void {
  const derived = createDocumentModel(deriveAuthoredPackageFromYjs(state), model.revision);
  if (fingerprintAuthoredModel(derived) !== fingerprintAuthoredModel(model)) {
    throw new TypeError('buffered Yjs state changed integrated canonical model');
  }
}

function operationEnvironmentForActor(
  state: YjsDocState,
  actorId: string,
  model: DocumentModel
): OperationEnvironment {
  const allocator = readAllocatorRecords(state.doc).get(actorId);
  if (!allocator) {
    return createOperationEnvironment(actorId, collectSemanticIds(model));
  }
  return Object.freeze({
    actorId,
    nextCommitSeq: allocator.nextCommitSeq,
    nextLocalSeq: allocator.nextLocalSeq,
    reservedSemanticIds: new Set(allocator.observedSemanticIds),
  });
}

function createCommitResult(
  data: InternalStagedMutation,
  commitId: string,
  forwardOps: readonly DocOpSingle[]
): BackendCommitResult {
  return Object.freeze({
    commitId,
    revisionBefore: data.baseRevision,
    revisionAfter: data.revisionAfter,
    identityMappings: Object.freeze(
      dedupeIdentityMappings([...data.trace.identityMappings]).map((item) =>
        Object.freeze({ ...item })
      )
    ),
    structuralRangesBefore: Object.freeze(
      structuralRangesForAffectedDraft(data.beforeDraft, data.trace).map((item) =>
        Object.freeze({ ...item })
      )
    ),
    structuralRangesAfter: Object.freeze(
      structuralRangesForAffectedDraft(data.normalizedDraft, data.trace).map((item) =>
        Object.freeze({ ...item })
      )
    ),
    dirtyDependencies: Object.freeze(
      dirtyDependenciesFor(data.trace, data.beforeDraft, data.normalizedDraft).map((item) =>
        Object.freeze({ ...item })
      )
    ),
    normalized: true,
    appliedRepair: data.appliedRepair,
    historyCommit: Object.freeze({
      forwardOps: Object.freeze([...forwardOps]),
      beforeDraftSnapshot: serializeDraftSnapshot(data.beforeDraft),
      tombstones: extractIdentityTombstones(
        data.beforeDraft,
        data.stagedDraft,
        forwardOps,
        data.trace
      ),
      appliedRepair: data.appliedRepair,
    }) satisfies BackendHistoryCommitRecord,
  });
}

function createBackendIdentity(
  documentId: string,
  replicaId: string,
  sessionId: string,
  clientId: number
): YjsBackendIdentity {
  return Object.freeze({
    documentId,
    backendVersion: YJS_BACKEND_VERSION,
    schemaVersion: YJS_SCHEMA_VERSION,
    normalizationVersion: YJS_NORMALIZATION_VERSION,
    replicaId,
    sessionId,
    clientId,
  });
}

function snapshotCommitInput(input: BackendCommitInput): BackendCommitInput {
  const closed = readClosedDataObject(
    input,
    ['actorId', 'constituentIds'],
    'Yjs backend commit input'
  );
  const constituentIds = snapshotConstituentIds(
    closed.constituentIds,
    'Yjs backend commit constituent IDs'
  );
  if (!isSpikeId(closed.actorId)) throw new TypeError('invalid commit actorId');
  return Object.freeze({
    actorId: closed.actorId,
    constituentIds: Object.freeze(constituentIds),
  });
}

function snapshotConstituentIds(value: unknown, label: string): string[] {
  const ids = snapshotDenseArray(value, label);
  if (ids.length === 0 || ids.some((id) => !isSpikeId(id)) || !hasUniqueStrings(ids as string[])) {
    throw new TypeError(`invalid ${label}`);
  }
  return ids as string[];
}

function snapshotOperationEnvironment(env: OperationEnvironment): OperationEnvironmentSnapshot {
  return Object.freeze({
    actorId: env.actorId,
    nextCommitSeq: env.nextCommitSeq,
    nextLocalSeq: env.nextLocalSeq,
    reservedSemanticIds: immutableStringSet(env.reservedSemanticIds),
  });
}

function assertCurrentBase(data: InternalStagedMutation, state: RuntimeState): void {
  if (
    data.baseRevision !== state.model.revision ||
    data.baseFingerprint !== fingerprintAuthoredModel(state.model)
  ) {
    throw new TypeError('stale stage');
  }
}

function stableUpdateId(
  kind: 'update' | 'repair',
  replicaId: string,
  owner: string,
  constituentIds: readonly string[]
): string {
  return compactDerivedId(
    `${kind}-${replicaId}-${owner}-${constituentIds[0] ?? 'none'}`,
    `${kind}\u0000${replicaId}\u0000${owner}\u0000${constituentIds.join('\u0000')}`
  );
}

function assertTrustedUpdate(update: ReplicationUpdateEnvelope): void {
  const validation = snapshotAndValidateReplicationUpdate(update);
  if (!validation.snapshot || validation.errors.length > 0) {
    throw new TypeError(`invalid prepared replication update: ${validation.errors.join('; ')}`);
  }
}

function failedRemote(code: string, reason: string): YjsRemoteStageResult {
  return Object.freeze({ status: 'failed', code, reason });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stateVectorsEqual(left: Uint8Array, right: Uint8Array): boolean {
  const leftMap = Y.decodeStateVector(left);
  const rightMap = Y.decodeStateVector(right);
  return (
    leftMap.size === rightMap.size &&
    [...leftMap].every(([clientId, clock]) => rightMap.get(clientId) === clock)
  );
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function collectSemanticIds(model: DocumentModel): string[] {
  const ids = [model.authored.body.storyId];
  for (const paragraphId of model.authored.body.paragraphOrder) {
    const paragraph = model.authored.body.paragraphs.get(paragraphId);
    if (!paragraph) continue;
    ids.push(paragraph.blockId, paragraph.paragraphId, `text-${paragraph.blockId}`);
    for (const mark of paragraph.marks) ids.push(mark.markId);
  }
  for (const capsule of model.authored.capsules) ids.push(capsule.capsuleId);
  return ids;
}
