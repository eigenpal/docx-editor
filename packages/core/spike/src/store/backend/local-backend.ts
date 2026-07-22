/** @spike-features insert-delete-split-join-operations, local-backend, origin-metadata */
import {
  hasUniqueStrings,
  readClosedDataObject,
  snapshotDenseArray,
} from '../../contracts/closed-input';
import { isSpikeId } from '../../contracts/ids';
import type { SnapshotEnvelope } from '../../contracts/snapshot';
import { createDocumentModel } from '../../model/fixture';
import type { DocumentModel } from '../../model/types';
import { validateDocumentModel } from '../../model/validators';
import { fingerprintAuthoredModel } from '../../model/fingerprint';
import {
  commitIdFor,
  createOperationEnvironment,
  type OperationEnvironment,
} from '../operation-environment';
import type { DocOpSingle } from '../../contracts/doc-op';
import {
  dedupeIdentityMappings,
  dirtyDependenciesFor,
  structuralRangesForAffectedDraft,
} from '../publish-metadata';
import { extractIdentityTombstones, serializeDraftSnapshot } from '../history';
import type { BackendHistoryCommitRecord } from './types';
import {
  createBackendCoverage,
  immutableStringSet,
  nextBackendCoverage,
  snapshotBackendCoverage,
  type BackendCoverageState,
} from './coverage';
import { stageSemanticMutation, type InternalStagedMutation } from './staging';
import {
  decodeLocalBackendSnapshot,
  encodeLocalBackendSnapshot,
  LOCAL_BACKEND_SCHEMA_VERSION,
  LOCAL_BACKEND_VERSION,
  LOCAL_NORMALIZATION_VERSION,
  type RestoredLocalBackendState,
} from './local-snapshot';
import {
  createEmptyActorSessionGroupHistoryState,
  createSafeAuditCursor,
  type ActorSessionGroupHistoryState,
} from '../history';
import type {
  BackendIdentity,
  BackendCommitInput,
  BackendCommitResult,
  BackendCoverageBookkeeping,
  BackendStateInspection,
  BackendStageInput,
  BackendStagePreview,
  BackendStageResult,
  BackendStagedMutation,
  LocalStoreBackend,
  OperationEnvironmentSnapshot,
} from './types';

const TRUSTED_STAGES = new WeakSet<object>();
let nextStageToken = 1;

export interface LocalStoreBackendOptions {
  readonly documentId?: string;
  readonly actorId?: string;
}

export function createLocalStoreBackend(
  initialModel: DocumentModel | unknown,
  options: LocalStoreBackendOptions = {}
): LocalStoreBackend {
  const errors = validateDocumentModel(initialModel);
  if (errors.length > 0) throw new TypeError(errors.join('; '));
  const initial = initialModel as DocumentModel;
  const identity = createBackendIdentity(options.documentId ?? 'doc-spike-0');
  const model = createDocumentModel(initial.authored, initial.revision);
  const restored: RestoredLocalBackendState = {
    identity,
    model,
    env: createOperationEnvironment(options.actorId ?? 'actor-local', collectSemanticIds(model)),
    coverage: createBackendCoverage(),
    actorSessionGroupHistory: createEmptyActorSessionGroupHistoryState(LOCAL_NORMALIZATION_VERSION),
  };
  return createLocalStoreBackendFromState(restored);
}

export function restoreLocalStoreBackend(snapshot: unknown): LocalStoreBackend {
  return createLocalStoreBackendFromState(decodeLocalBackendSnapshot(snapshot));
}

export function isBackendStagedMutation(value: unknown): value is BackendStagedMutation {
  return typeof value === 'object' && value !== null && TRUSTED_STAGES.has(value);
}

function createLocalStoreBackendFromState(initial: RestoredLocalBackendState): LocalStoreBackend {
  let state = Object.freeze({
    model: initial.model,
    env: initial.env,
    coverage: initial.coverage,
  });
  const identity = Object.freeze({ ...initial.identity });
  const restoredHistory = initial.actorSessionGroupHistory;
  const stages = new WeakMap<BackendStagedMutation, StageRecord>();

  const backend: LocalStoreBackend = {
    identity,
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
      const closed = readClosedDataObject(
        input,
        input.actorId === undefined
          ? input.identityRestoration === undefined
            ? ['ops', 'constituentIds']
            : ['ops', 'constituentIds', 'identityRestoration']
          : input.identityRestoration === undefined
            ? ['ops', 'constituentIds', 'actorId']
            : ['ops', 'constituentIds', 'actorId', 'identityRestoration'],
        'backend stage input'
      );
      const ops = snapshotDenseArray(closed.ops, 'backend stage operations');
      const constituentIds = snapshotConstituentIds(
        closed.constituentIds,
        'backend stage constituent IDs'
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
      const actorId =
        typeof closed.actorId === 'string' ? (closed.actorId as string) : state.env.actorId;
      if (!isSpikeId(actorId)) throw new TypeError('invalid local stage actorId');
      const stagingEnv =
        actorId === state.env.actorId
          ? state.env
          : createOperationEnvironment(actorId, collectSemanticIds(state.model));
      const result = stageSemanticMutation(
        state.model,
        stagingEnv,
        ops as BackendStageInput['ops'],
        (closed.identityRestoration as BackendStageInput['identityRestoration'] | undefined) ?? []
      );
      if (result.status !== 'staged') return result;
      const preview = Object.freeze({
        stageToken: `local-stage-${nextStageToken++}`,
        baseRevision: result.data.baseRevision,
        baseFingerprint: result.data.baseFingerprint,
        revisionAfter: result.data.revisionAfter,
        stagedFingerprint: result.data.stagedFingerprint,
      });
      const staged = Object.freeze({ preview });
      TRUSTED_STAGES.add(staged);
      stages.set(staged, {
        status: 'pending',
        data: result.data,
        actorId,
        constituentIds: Object.freeze([...constituentIds]),
        ops: Object.freeze([...(ops as DocOpSingle[])]),
      });
      return Object.freeze({ status: 'staged', staged });
    },
    previewStagedMutation(
      staged: BackendStagedMutation,
      input: BackendCommitInput
    ): BackendCommitResult {
      return prepareCommit(staged, input).result;
    },
    commitStagedMutation(
      staged: BackendStagedMutation,
      input: BackendCommitInput
    ): BackendCommitResult {
      const prepared = prepareCommit(staged, input);
      // All validation, copying, metadata creation, and next-state construction
      // completed above. This publication section performs only non-throwing
      // assignments.
      state = prepared.nextState;
      prepared.record.status = 'committed';
      return prepared.result;
    },
    rollbackStagedMutation(staged: BackendStagedMutation): void {
      const record = getStageRecord(staged);
      if (record.status === 'committed') {
        throw new TypeError('cannot roll back committed stage');
      }
      if (record.status === 'rolledBack') return;
      record.status = 'rolledBack';
    },
    encodeSnapshot(history?: ActorSessionGroupHistoryState): SnapshotEnvelope {
      const emptyHistory = createEmptyActorSessionGroupHistoryState(
        LOCAL_NORMALIZATION_VERSION
      );
      const fallbackHistory =
        restoredHistory.safeAuditCursor.sequence === state.model.revision
          ? restoredHistory
          : Object.freeze({
              ...emptyHistory,
              safeAuditCursor: createSafeAuditCursor(state.model.revision),
            });
      return encodeLocalBackendSnapshot({
        identity,
        model: state.model,
        env: state.env,
        coverage: state.coverage,
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
          constituentIds: Object.freeze(
            [...state.coverage.constituentIds].sort(codeUnitCompare)
          ),
          commitIds: Object.freeze([...state.coverage.commitIds].sort(codeUnitCompare)),
        }),
      });
    },
    hasConstituentCoverage(constituentId: string): boolean {
      return state.coverage.constituentIds.has(constituentId);
    },
    hasCommitCoverage(commitId: string): boolean {
      return state.coverage.commitIds.has(commitId);
    },
    encodeReplicationUpdate(): never {
      throw new Error('local backend does not emit replication updates');
    },
  };

  return backend;

  function getStageRecord(staged: BackendStagedMutation): StageRecord {
    if (!isBackendStagedMutation(staged)) throw new TypeError('untrusted stage');
    const record = stages.get(staged);
    if (!record) throw new TypeError('stage belongs to another backend');
    return record;
  }

  function prepareCommit(
    staged: BackendStagedMutation,
    input: BackendCommitInput
  ): PreparedCommit {
    const record = getStageRecord(staged);
    if (record.status === 'rolledBack') throw new TypeError('rolled back stage');
    if (record.status === 'committed') throw new TypeError('stage already committed');
    const data = record.data;
    const currentFingerprint = fingerprintAuthoredModel(state.model);
    if (
      data.baseRevision !== state.model.revision ||
      data.baseFingerprint !== currentFingerprint
    ) {
      throw new TypeError('stale stage');
    }

    const commitInput = snapshotCommitInput(input);
    if (!sameStrings(commitInput.constituentIds, record.constituentIds)) {
      throw new TypeError('commit constituent IDs do not match stage');
    }
    if (commitInput.actorId !== record.actorId) {
      throw new TypeError('commit metadata does not match local stage');
    }
    if (commitInput.constituentIds.some((id) => state.coverage.constituentIds.has(id))) {
      throw new TypeError('constituent coverage overlap');
    }
    const commitId = commitIdFor(
      record.actorId,
      data.baseRevision >= 10
        ? data.revisionAfter
        : state.env.nextCommitSeq
    );
    if (state.coverage.commitIds.has(commitId)) throw new TypeError('commit ID already covered');

    const result = createCommitResult(data, commitId, record.ops);
    const nextEnv: OperationEnvironment = Object.freeze({
      actorId: record.actorId,
      nextCommitSeq: state.env.nextCommitSeq + 1,
      nextLocalSeq: data.stagingEnv.nextLocalSeq,
      reservedSemanticIds: new Set(data.stagingEnv.reservedSemanticIds),
    });
    const nextCoverage = nextBackendCoverage(
      state.coverage,
      commitInput.constituentIds,
      commitId
    );
    const nextState = Object.freeze({
      model: data.stagedModel,
      env: nextEnv,
      coverage: nextCoverage,
    });
    return { record, result, nextState };
  }
}

interface StageRecord {
  status: 'pending' | 'committed' | 'rolledBack';
  readonly data: InternalStagedMutation;
  readonly actorId: string;
  readonly constituentIds: readonly string[];
  readonly ops: readonly DocOpSingle[];
}

interface PreparedCommit {
  readonly record: StageRecord;
  readonly result: BackendCommitResult;
  readonly nextState: Readonly<{
    model: DocumentModel;
    env: OperationEnvironment;
    coverage: BackendCoverageState;
  }>;
}

function snapshotCommitInput(input: BackendCommitInput): BackendCommitInput {
  const closed = readClosedDataObject(
    input,
    ['actorId', 'constituentIds'],
    'backend commit input'
  );
  const constituentIds = snapshotConstituentIds(
    closed.constituentIds,
    'backend commit constituent IDs'
  );
  if (
    !isSpikeId(closed.actorId) ||
    constituentIds.length === 0
  ) {
    throw new TypeError('invalid backend commit input');
  }
  return Object.freeze({
    actorId: closed.actorId as string,
    constituentIds: Object.freeze([...constituentIds]),
  });
}

function snapshotConstituentIds(value: unknown, label: string): string[] {
  const ids = snapshotDenseArray(value, label);
  if (
    ids.length === 0 ||
    ids.some((id) => !isSpikeId(id)) ||
    !hasUniqueStrings(ids as string[])
  ) {
    throw new TypeError(`invalid ${label}`);
  }
  return ids as string[];
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function createCommitResult(
  data: InternalStagedMutation,
  commitId: string,
  forwardOps: readonly DocOpSingle[]
): BackendCommitResult {
  const historyCommit = createHistoryCommitRecord(data, forwardOps);
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
    historyCommit,
  });
}

function createHistoryCommitRecord(
  data: InternalStagedMutation,
  forwardOps: readonly DocOpSingle[]
): BackendHistoryCommitRecord {
  return Object.freeze({
    forwardOps: Object.freeze([...forwardOps]),
    beforeDraftSnapshot: serializeDraftSnapshot(data.beforeDraft),
    tombstones: extractIdentityTombstones(data.beforeDraft, data.stagedDraft, forwardOps, data.trace),
    appliedRepair: data.appliedRepair,
  });
}

function createBackendIdentity(documentId: string): BackendIdentity {
  if (!isSpikeId(documentId)) throw new TypeError('invalid backend documentId');
  return Object.freeze({
    documentId,
    backendVersion: LOCAL_BACKEND_VERSION,
    schemaVersion: LOCAL_BACKEND_SCHEMA_VERSION,
    normalizationVersion: LOCAL_NORMALIZATION_VERSION,
  });
}

function snapshotOperationEnvironment(
  env: OperationEnvironment
): OperationEnvironmentSnapshot {
  return Object.freeze({
    actorId: env.actorId,
    nextCommitSeq: env.nextCommitSeq,
    nextLocalSeq: env.nextLocalSeq,
    reservedSemanticIds: immutableStringSet(env.reservedSemanticIds),
  });
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function collectSemanticIds(model: DocumentModel): string[] {
  const ids: string[] = [];
  for (const paragraphId of model.authored.body.paragraphOrder) {
    const paragraph = model.authored.body.paragraphs.get(paragraphId);
    if (!paragraph) continue;
    ids.push(paragraph.blockId, paragraph.paragraphId);
    for (const mark of paragraph.marks) ids.push(mark.markId);
  }
  for (const capsule of model.authored.capsules) ids.push(capsule.capsuleId);
  return ids;
}
