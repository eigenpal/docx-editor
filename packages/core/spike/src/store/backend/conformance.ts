/** @spike-features insert-delete-split-join-operations, local-backend, origin-metadata */
import type { DocOp } from '../../contracts/doc-op';
import type { MutationOrigin } from '../../contracts/origins';
import { fingerprintAuthoredModel } from '../../model/fingerprint';
import type { DocumentModel } from '../../model/types';
import type {
  BackendCommitInput,
  BackendCommitResult,
  BackendStageResult,
  SemanticStoreBackend,
} from './types';
import type { SnapshotEnvelope } from '../../contracts/snapshot';
import { isSpikeId } from '../../contracts/ids';
import {
  isReplicationUpdate,
  snapshotAndValidateReplicationUpdate,
} from '../../contracts/replication-update';

export interface BackendConformanceBatchStep {
  readonly batch: DocOp;
}

export interface BackendConformanceScenario {
  readonly name: string;
  readonly batches: readonly BackendConformanceBatchStep[];
  readonly expectFailure?: boolean;
  readonly expectNoOp?: boolean;
  readonly expectRepair?: boolean;
}

export interface BackendConformanceDriver {
  createBackend(initialModel?: DocumentModel): SemanticStoreBackend;
  restoreBackend(snapshot: SnapshotEnvelope): SemanticStoreBackend;
  readonly expectsWireUpdates?: boolean;
  validateWireDelta?(input: {
    readonly before: ReplicationStateProbe;
    readonly after: ReplicationStateProbe;
    readonly updateBytes: Uint8Array;
  }): boolean;
  validateCausalReverseDelivery?(): boolean;
  validateSameActorConvergence?(): boolean;
  validateClientCollisionReseed?(): boolean;
  validateCommitIdUniqueness?(): boolean;
  validateBufferedAttribution?(): boolean;
  validatePendingQuotas?(): boolean;
  validateLosslessReseedJournal?(): boolean;
  validateIndependentPendingChains?(): boolean;
  validateSnapshotResyncRecovery?(): boolean;
  validateStructuralTextConservation?(): boolean;
  validatePendingDeleteReverseDelivery?(): boolean;
  applyBatch(
    backend: SemanticStoreBackend,
    batch: DocOp,
    origin?: MutationOrigin
  ): BackendConformanceApplyResult;
}

export type BackendConformanceApplyResult =
  | {
      readonly status: 'applied';
      readonly revisionBefore: number;
      readonly revisionAfter: number;
      readonly commitId: string;
      readonly constituentIds: readonly string[];
      readonly identityMappings: BackendCommitResult['identityMappings'];
      readonly normalized: boolean;
      readonly appliedRepair: boolean;
      readonly origin: MutationOrigin;
    }
  | { readonly status: 'failed'; readonly code: string; readonly reason: string }
  | { readonly status: 'noOp'; readonly reason: string };

export interface BackendConformanceScenarioResult {
  readonly name: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly fingerprints: readonly string[];
  readonly revisions: readonly number[];
  readonly steps: readonly BackendConformanceStepResult[];
}

export interface BackendConformanceStepResult {
  readonly status: BackendConformanceApplyResult['status'];
  readonly canonicalFingerprint: string;
  readonly revision: number;
  readonly revisionBefore?: number;
  readonly revisionAfter?: number;
  readonly commitId?: string;
  readonly constituentIds?: readonly string[];
  readonly identityMappings?: BackendCommitResult['identityMappings'];
  readonly normalized?: boolean;
  readonly appliedRepair?: boolean;
  readonly coverage: Readonly<{
    constituentIds: readonly string[];
    commitIds: readonly string[];
  }>;
}

export interface BackendConformanceInvariants {
  readonly rollback: boolean;
  readonly staleStageRejection: boolean;
  readonly failedCommitAtomicity: boolean;
  readonly coverage: boolean;
  readonly snapshotRestoreParity: boolean;
  readonly aliasSafety: boolean;
  readonly wireUpdatePolicy: boolean;
  readonly trueStateVectorDelta: boolean;
  readonly causalReverseDelivery: boolean;
  readonly sameActorConvergence: boolean;
  readonly clientCollisionReseed: boolean;
  readonly commitIdUniqueness: boolean;
  readonly bufferedAttribution: boolean;
  readonly pendingQuotas: boolean;
  readonly losslessReseedJournal: boolean;
  readonly independentPendingChains: boolean;
  readonly snapshotResyncRecovery: boolean;
  readonly structuralTextConservation: boolean;
  readonly pendingDeleteReverseDelivery: boolean;
  readonly publicationOwnership: boolean;
}

export interface BackendConformanceReport {
  readonly passed: boolean;
  readonly scenarios: readonly BackendConformanceScenarioResult[];
  readonly invariants: BackendConformanceInvariants;
}

export function runBackendConformanceSuite(
  driver: BackendConformanceDriver,
  scenarios: readonly BackendConformanceScenario[]
): BackendConformanceReport {
  const results = scenarios.map((scenario) => runBackendConformanceScenario(driver, scenario));
  const invariants = runBackendInvariants(driver, scenarios);
  return Object.freeze({
    passed:
      results.every((result) => result.passed) &&
      Object.values(invariants).every((value) => value),
    scenarios: Object.freeze(results),
    invariants,
  });
}

function runBackendConformanceScenario(
  driver: BackendConformanceDriver,
  scenario: BackendConformanceScenario
): BackendConformanceScenarioResult {
  const backend = driver.createBackend();
  const failures: string[] = [];
  const fingerprints: string[] = [fingerprintAuthoredModel(backend.model)];
  const revisions: number[] = [backend.model.revision];
  const steps: BackendConformanceStepResult[] = [];

  for (const step of scenario.batches) {
    const beforeInspection = backend.inspectState();
    const beforeModelFingerprint = fingerprintAuthoredModel(backend.model);
    const result = driver.applyBatch(backend, step.batch);
    const afterModelFingerprint = fingerprintAuthoredModel(backend.model);
    const afterInspection = backend.inspectState();
    fingerprints.push(afterModelFingerprint);
    revisions.push(backend.model.revision);
    steps.push(snapshotStepResult(backend, result));
    failures.push(
      ...validateStepConsistency({
        scenario,
        batch: step.batch,
        result,
        backend,
        beforeInspection,
        afterInspection,
        beforeModelFingerprint,
        afterModelFingerprint,
      })
    );

    if (scenario.expectFailure) {
      if (result.status !== 'failed') {
        failures.push(`${scenario.name}: expected failure but got ${result.status}`);
      }
      continue;
    }
    if (scenario.expectNoOp) {
      if (result.status !== 'noOp') {
        failures.push(`${scenario.name}: expected noOp but got ${result.status}`);
      }
      continue;
    }
    if (result.status !== 'applied') {
      failures.push(`${scenario.name}: expected applied but got ${result.status}`);
    }
  }

  if (!scenario.expectFailure && !scenario.expectNoOp) {
    const lastRevision = revisions.at(-1) ?? 0;
    if (lastRevision !== scenario.batches.length) {
      failures.push(
        `${scenario.name}: expected revision ${scenario.batches.length} but got ${lastRevision}`
      );
    }
  }

  return Object.freeze({
    name: scenario.name,
    passed: failures.length === 0,
    failures: Object.freeze(failures),
    fingerprints: Object.freeze(fingerprints),
    revisions: Object.freeze(revisions),
    steps: Object.freeze(steps),
  });
}

function snapshotStepResult(
  backend: SemanticStoreBackend,
  result: BackendConformanceApplyResult
): BackendConformanceStepResult {
  const inspection = backend.inspectState();
  const base = {
    status: result.status,
    canonicalFingerprint: inspection.canonicalFingerprint,
    revision: inspection.revision,
    coverage: inspection.coverage,
  };
  if (result.status !== 'applied') return Object.freeze(base);
  return Object.freeze({
    ...base,
    revisionBefore: result.revisionBefore,
    revisionAfter: result.revisionAfter,
    commitId: result.commitId,
    constituentIds: Object.freeze([...result.constituentIds]),
    identityMappings: result.identityMappings,
    normalized: result.normalized,
    appliedRepair: result.appliedRepair,
  });
}

function validateStepConsistency(input: {
  scenario: BackendConformanceScenario;
  batch: DocOp;
  result: BackendConformanceApplyResult;
  backend: SemanticStoreBackend;
  beforeInspection: ReturnType<SemanticStoreBackend['inspectState']>;
  afterInspection: ReturnType<SemanticStoreBackend['inspectState']>;
  beforeModelFingerprint: string;
  afterModelFingerprint: string;
}): string[] {
  const failures: string[] = [];
  const label = input.scenario.name;
  if (
    !sameIdentity(input.beforeInspection.identity, input.afterInspection.identity) ||
    !isSpikeId(input.afterInspection.identity.documentId)
  ) {
    failures.push(`${label}: backend identity changed or is invalid`);
  }
  if (
    input.afterInspection.revision !== input.backend.model.revision ||
    input.afterInspection.canonicalFingerprint !== input.afterModelFingerprint
  ) {
    failures.push(`${label}: backend inspection disagrees with canonical state`);
  }

  if (input.result.status !== 'applied') {
    if (
      !sameInspection(input.beforeInspection, input.afterInspection) ||
      input.beforeModelFingerprint !== input.afterModelFingerprint
    ) {
      failures.push(`${label}: ${input.result.status} mutated backend state`);
    }
    return failures;
  }

  const expectedBefore = input.beforeInspection.revision;
  const expectedAfter = expectedBefore + 1;
  if (
    input.result.revisionBefore !== expectedBefore ||
    input.result.revisionAfter !== expectedAfter ||
    input.afterInspection.revision !== expectedAfter
  ) {
    failures.push(`${label}: applied revision metadata disagrees with backend state`);
  }
  if (!isSpikeId(input.result.commitId)) {
    failures.push(`${label}: invalid commit ID grammar`);
  }
  if (
    !input.backend.hasCommitCoverage(input.result.commitId) ||
    !input.afterInspection.coverage.commitIds.includes(input.result.commitId)
  ) {
    failures.push(`${label}: applied commit ID lacks backend coverage`);
  }
  if (!sameStrings(input.result.constituentIds, input.batch.transaction.constituentIds)) {
    failures.push(`${label}: applied constituent IDs disagree with batch`);
  }
  if (
    input.result.constituentIds.some(
      (id) =>
        !input.backend.hasConstituentCoverage(id) ||
        !input.afterInspection.coverage.constituentIds.includes(id)
    )
  ) {
    failures.push(`${label}: applied constituent ID lacks backend coverage`);
  }
  if (input.result.normalized !== true) {
    failures.push(`${label}: applied result is not normalized`);
  }
  if (
    typeof input.result.appliedRepair !== 'boolean' ||
    (input.scenario.expectRepair !== undefined &&
      input.result.appliedRepair !== input.scenario.expectRepair)
  ) {
    failures.push(`${label}: repair evidence disagrees with scenario`);
  }
  return failures;
}

function runBackendInvariants(
  driver: BackendConformanceDriver,
  scenarios: readonly BackendConformanceScenario[]
): BackendConformanceInvariants {
  const applicable = scenarios
    .flatMap((scenario) => scenario.batches)
    .find((step) => !scenarios.find((scenario) => scenario.batches.includes(step))?.expectFailure);
  if (!applicable) throw new TypeError('backend conformance requires an applicable batch');
  const input = {
    actorId: applicable.batch.transaction.actorId,
    constituentIds: applicable.batch.transaction.constituentIds,
  };

  const rollbackBackend = driver.createBackend();
  const rollbackBefore = rollbackBackend.inspectState();
  const rollbackStage = rollbackBackend.stageLocalMutation({
    ops: applicable.batch.ops,
    constituentIds: applicable.batch.transaction.constituentIds,
    actorId: input.actorId,
  });
  let rollback = false;
  if (rollbackStage.status === 'staged') {
    rollbackBackend.rollbackStagedMutation(rollbackStage.staged);
    rollbackBackend.rollbackStagedMutation(rollbackStage.staged);
    rollback = sameInspection(rollbackBackend.inspectState(), rollbackBefore);
  }

  const staleBackend = driver.createBackend();
  const replicationBefore = inspectReplicationState(staleBackend);
  const staleFirst = staleBackend.stageLocalMutation({
    ops: applicable.batch.ops,
    constituentIds: applicable.batch.transaction.constituentIds,
    actorId: input.actorId,
  });
  const staleSecond = staleBackend.stageLocalMutation({
    ops: applicable.batch.ops,
    constituentIds: applicable.batch.transaction.constituentIds,
    actorId: input.actorId,
  });
  let staleStageRejection = false;
  let coverage = false;
  if (staleFirst.status === 'staged' && staleSecond.status === 'staged') {
    const committed = staleBackend.commitStagedMutation(staleFirst.staged, input);
    try {
      staleBackend.commitStagedMutation(staleSecond.staged, {
        actorId: input.actorId,
        constituentIds: ['conformance-stale'],
      });
    } catch {
      staleStageRejection = true;
    }
    coverage =
      staleBackend.hasCommitCoverage(committed.commitId) &&
      input.constituentIds.every((id) => staleBackend.hasConstituentCoverage(id)) &&
      !staleBackend.hasConstituentCoverage('conformance-stale');
  }

  const atomicBackend = driver.createBackend();
  const atomicStage = atomicBackend.stageLocalMutation({
    ops: applicable.batch.ops,
    constituentIds: applicable.batch.transaction.constituentIds,
    actorId: input.actorId,
  });
  const atomicBefore = atomicBackend.inspectState();
  let failedCommitAtomicity = false;
  if (atomicStage.status === 'staged') {
    const badIds = ['conformance-bad'];
    Object.defineProperty(badIds, '0', {
      enumerable: true,
      get() {
        throw new Error('forbidden accessor');
      },
    });
    try {
      atomicBackend.commitStagedMutation(atomicStage.staged, {
        actorId: input.actorId,
        constituentIds: badIds,
      });
    } catch {
      failedCommitAtomicity = sameInspection(atomicBackend.inspectState(), atomicBefore);
    }
  }

  let snapshotRestoreParity = false;
  if (typeof driver.restoreBackend === 'function') {
    const snapshot = staleBackend.encodeSnapshot();
    try {
      const restored = driver.restoreBackend(snapshot);
      snapshotRestoreParity =
        sameInspection(restored.inspectState(), staleBackend.inspectState()) &&
        fingerprintAuthoredModel(restored.model) === fingerprintAuthoredModel(staleBackend.model);
    } catch {
      snapshotRestoreParity = false;
    }
  }

  const envA = staleBackend.operationEnvironment;
  const envB = staleBackend.operationEnvironment;
  const coverageA = staleBackend.coverage;
  const aliasSafety =
    envA !== envB &&
    coverageA !== staleBackend.coverage &&
    Object.isFrozen(envA) &&
    Object.isFrozen(envA.reservedSemanticIds) &&
    (envA.reservedSemanticIds as unknown as { add?: unknown }).add === undefined &&
    (coverageA.commitIds as unknown as { add?: unknown }).add === undefined;

  const wireUpdatePolicy = validateWireUpdatePolicy(
    staleBackend,
    driver.expectsWireUpdates === true,
    input.constituentIds
  );
  const trueStateVectorDelta = validateTrueStateVectorDelta(
    staleBackend,
    driver.expectsWireUpdates === true,
    replicationBefore,
    driver.validateWireDelta
  );
  const causalReverseDelivery =
    driver.expectsWireUpdates !== true ||
    driver.validateCausalReverseDelivery?.() === true;
  const sameActorConvergence =
    driver.expectsWireUpdates !== true ||
    driver.validateSameActorConvergence?.() === true;
  const clientCollisionReseed =
    driver.expectsWireUpdates !== true ||
    driver.validateClientCollisionReseed?.() === true;
  const commitIdUniqueness =
    driver.expectsWireUpdates !== true ||
    driver.validateCommitIdUniqueness?.() === true;
  const bufferedAttribution =
    driver.expectsWireUpdates !== true ||
    driver.validateBufferedAttribution?.() === true;
  const pendingQuotas =
    driver.expectsWireUpdates !== true ||
    driver.validatePendingQuotas?.() === true;
  const losslessReseedJournal =
    driver.expectsWireUpdates !== true ||
    driver.validateLosslessReseedJournal?.() === true;
  const independentPendingChains =
    driver.expectsWireUpdates !== true ||
    driver.validateIndependentPendingChains?.() === true;
  const snapshotResyncRecovery =
    driver.expectsWireUpdates !== true ||
    driver.validateSnapshotResyncRecovery?.() === true;
  const structuralTextConservation =
    driver.expectsWireUpdates !== true ||
    driver.validateStructuralTextConservation?.() === true;
  const pendingDeleteReverseDelivery =
    driver.expectsWireUpdates !== true ||
    driver.validatePendingDeleteReverseDelivery?.() === true;

  const publicationOwnership =
    !(`${'subscribe'}${'Model'}` in staleBackend) &&
    !(`${'notification'}${'Diagnostics'}` in staleBackend);

  return Object.freeze({
    rollback,
    staleStageRejection,
    failedCommitAtomicity,
    coverage,
    snapshotRestoreParity,
    aliasSafety,
    wireUpdatePolicy,
    trueStateVectorDelta,
    causalReverseDelivery,
    sameActorConvergence,
    clientCollisionReseed,
    commitIdUniqueness,
    bufferedAttribution,
    pendingQuotas,
    losslessReseedJournal,
    independentPendingChains,
    snapshotResyncRecovery,
    structuralTextConservation,
    pendingDeleteReverseDelivery,
    publicationOwnership,
  });
}

function validateWireUpdatePolicy(
  backend: SemanticStoreBackend,
  expectsWireUpdates: boolean,
  expectedConstituentIds: readonly string[]
): boolean {
  const wireMethod = (backend as SemanticStoreBackend & {
    encodeReplicationUpdate?: () => unknown;
  }).encodeReplicationUpdate;
  if (!expectsWireUpdates) {
    if (typeof wireMethod !== 'function') return true;
    try {
      wireMethod.call(backend);
      return false;
    } catch {
      return true;
    }
  }
  if (typeof wireMethod !== 'function') return false;
  try {
    const update = wireMethod.call(backend);
    if (!isReplicationUpdate(update)) return false;
    const validation = snapshotAndValidateReplicationUpdate(update);
    if (!validation.snapshot || validation.errors.length > 0) return false;
    if (
      !Object.isFrozen(update) ||
      !Object.isFrozen(update.constituentIds) ||
      update.coverage !== 'incremental' ||
      update.documentId !== backend.identity.documentId ||
      update.backendVersion !== backend.identity.backendVersion ||
      update.schemaVersion !== backend.identity.schemaVersion ||
      !isSpikeId(update.updateId) ||
      !sameStrings(update.constituentIds, expectedConstituentIds) ||
      update.constituentIds.some((id) => !backend.hasConstituentCoverage(id))
    ) {
      return false;
    }
    const firstBytes = update.bytes;
    const secondBytes = update.bytes;
    return (
      firstBytes.length > 0 &&
      firstBytes !== secondBytes &&
      bytesEqual(firstBytes, secondBytes)
    );
  } catch {
    return false;
  }
}

export interface ReplicationStateProbe {
  readonly stateVector: Uint8Array;
  readonly fullState: Uint8Array;
}

function inspectReplicationState(
  backend: SemanticStoreBackend
): ReplicationStateProbe | undefined {
  const method = (
    backend as SemanticStoreBackend & {
      inspectReplicationState?: () => unknown;
    }
  ).inspectReplicationState;
  if (typeof method !== 'function') return undefined;
  const value = method.call(backend) as Partial<ReplicationStateProbe>;
  if (!(value.stateVector instanceof Uint8Array) || !(value.fullState instanceof Uint8Array)) {
    return undefined;
  }
  return {
    stateVector: value.stateVector.slice(),
    fullState: value.fullState.slice(),
  };
}

function validateTrueStateVectorDelta(
  backend: SemanticStoreBackend,
  expectsWireUpdates: boolean,
  before: ReplicationStateProbe | undefined,
  validator: BackendConformanceDriver['validateWireDelta']
): boolean {
  if (!expectsWireUpdates) return true;
  if (!before || typeof validator !== 'function') return false;
  const after = inspectReplicationState(backend);
  const wireMethod = (
    backend as SemanticStoreBackend & {
      encodeReplicationUpdate?: () => unknown;
    }
  ).encodeReplicationUpdate;
  if (!after || typeof wireMethod !== 'function') return false;
  try {
    const update = wireMethod.call(backend);
    if (!isReplicationUpdate(update) || update.bytes.length * 4 >= after.fullState.length) {
      return false;
    }
    return validator({ before, after, updateBytes: update.bytes });
  } catch {
    return false;
  }
}

function sameInspection(
  left: ReturnType<SemanticStoreBackend['inspectState']>,
  right: ReturnType<SemanticStoreBackend['inspectState']>
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameIdentity(
  left: ReturnType<SemanticStoreBackend['inspectState']>['identity'],
  right: ReturnType<SemanticStoreBackend['inspectState']>['identity']
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function applyBatchThroughBackend(
  backend: SemanticStoreBackend,
  batch: DocOp,
  commitInput: BackendCommitInput
): BackendConformanceApplyResult {
  const staged: BackendStageResult = backend.stageLocalMutation({
    ops: batch.ops,
    constituentIds: batch.transaction.constituentIds,
    actorId: commitInput.actorId,
  });
  if (staged.status === 'failed') {
    return Object.freeze({
      status: 'failed',
      code: staged.code,
      reason: staged.message,
    });
  }
  if (staged.status === 'noOp') {
    return Object.freeze({ status: 'noOp', reason: staged.reason });
  }
  try {
    const committed = backend.commitStagedMutation(staged.staged, commitInput);
    return Object.freeze({
      status: 'applied',
      revisionBefore: committed.revisionBefore,
      revisionAfter: committed.revisionAfter,
      commitId: committed.commitId,
      constituentIds: Object.freeze([...commitInput.constituentIds]),
      identityMappings: committed.identityMappings,
      normalized: committed.normalized,
      appliedRepair: committed.appliedRepair,
      origin: {
        kind: 'human',
        actorId: commitInput.actorId,
        sessionId: 'conformance-session',
      } as MutationOrigin,
    });
  } catch (error) {
    backend.rollbackStagedMutation(staged.staged);
    return Object.freeze({
      status: 'failed',
      code: 'commit-failed',
      reason: error instanceof Error ? error.message : 'backend commit failed',
    });
  }
}
