/** @spike-features yjs-backend */
import { describe, expect, test } from 'bun:test';
import {
  compareYjsSchema,
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createYjsStoreBackend,
  fingerprintAuthoredModel,
  fingerprintYjsSchema,
  restoreYjsStoreBackend,
  runBackendConformanceSuite,
  validateDecodedYjsModel,
  validateYjsCausalReverseDelivery,
  validateYjsClientCollisionReseed,
  validateYjsCommitIdUniqueness,
  validateYjsBufferedAttribution,
  validateYjsPendingQuotas,
  validateYjsLosslessReseedJournal,
  validateYjsIndependentPendingChains,
  validateYjsSnapshotResyncRecovery,
  validateYjsStructuralTextConservation,
  validateYjsPendingDeleteReverseDelivery,
  validateYjsSameActorConvergence,
  validateYjsStateVectorDelta,
  type BackendConformanceScenario,
} from '../src';
import { scenarios as conformanceScenarios } from './yjs-conformance-scenarios';

const STORY = 'story-body-0';

describe('yjs backend — red gate (task 2.2)', () => {
  test('exports model-shaped Yjs backend with gc disabled', () => {
    expect(typeof createYjsStoreBackend).toBe('function');
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture());
    expect(backend.identity.backendVersion).toBe('yjs-backend/1.0.0');
    expect(backend.model.revision).toBe(0);
    const decoded = backend.inspectYjsModel();
    expect(decoded.gcEnabled).toBe(false);
    expect(validateDecodedYjsModel(decoded)).toEqual([]);
  });

  test('frozen root keys and nested container types match oracle', () => {
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture());
    const decoded = backend.inspectYjsModel();
    expect(Object.keys(decoded.rootContainers).sort()).toEqual(
      ['allocator', 'blocks', 'capsules', 'marks', 'meta', 'stories', 'storyOrder', 'texts'].sort()
    );
    expect(decoded.rootContainers.storyOrder).toBe('Y.Array');
    expect(decoded.texts[0]?.contentContainerType).toBe('Y.Text');
    expect(decoded.allocatorContainerType).toBe('Y.Map');
  });

  test('passes shared backend conformance harness with wire updates', () => {
    const driver = createYjsConformanceDriver();
    const report = runBackendConformanceSuite(driver, conformanceScenarios);
    expect(report.passed, JSON.stringify(report)).toBe(true);
    expect(report.invariants.wireUpdatePolicy).toBe(true);
    expect(report.invariants.trueStateVectorDelta).toBe(true);
    expect(report.invariants.snapshotRestoreParity).toBe(true);
  });

  test('local canonical fingerprint matches decoded Yjs after representative ops', () => {
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture());
    const batch = createDocOpBatch({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'X' }],
      transaction: {
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
        groupId: 'group-alice-1',
        constituentIds: ['op-insert'],
      },
    });
    applyBatchToYjsBackend(backend, batch);
    const canonical = fingerprintAuthoredModel(backend.model);
    const decoded = backend.inspectYjsModel();
    expect(decoded.backendVersion).toBe('yjs-backend/1.0.0');
    expect(validateDecodedYjsModel(decoded)).toEqual([]);
    expect(canonical).toHaveLength(64);
    expect(backend.inspectState().canonicalFingerprint).toBe(canonical);
  });

  test('staged mutation is isolated until atomic commit', () => {
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture());
    const before = backend.inspectState();
    const staged = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'Z' }],
      constituentIds: ['op-isolated'],
      actorId: 'actor-alice',
    });
    expect(staged.status).toBe('staged');
    if (staged.status !== 'staged') return;
    expect(backend.inspectState()).toEqual(before);
    backend.commitStagedMutation(staged.staged, {
      actorId: 'actor-alice',
      constituentIds: ['op-isolated'],
    });
    expect(backend.model.revision).toBe(1);
  });

  test('snapshot restore preserves canonical Yjs allocator coverage and checkpoint', () => {
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      documentId: 'doc-spike-0',
    });
    applyBatchToYjsBackend(
      backend,
      createDocOpBatch({
        ops: [{ kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 2 }],
        transaction: {
          actorId: 'actor-alice',
          sessionId: 'session-alice-1',
          groupId: 'group-alice-1',
          constituentIds: ['op-split'],
        },
      })
    );
    const snapshot = backend.encodeSnapshot();
    expect(snapshot.backendVersion).toBe('yjs-backend/1.0.0');
    const restored = restoreYjsStoreBackend(snapshot);
    expect(restored.inspectState()).toEqual(backend.inspectState());
    expect(fingerprintYjsSchema(restored.inspectYjsModel())).toBe(
      fingerprintYjsSchema(backend.inspectYjsModel())
    );
    expect(fingerprintAuthoredModel(restored.model)).toBe(fingerprintAuthoredModel(backend.model));
  });

  test('encodeReplicationUpdate returns trusted incremental envelope with covered constituents', () => {
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture());
    applyBatchToYjsBackend(
      backend,
      createDocOpBatch({
        ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: '!' }],
        transaction: {
          actorId: 'actor-alice',
          sessionId: 'session-alice-1',
          groupId: 'group-alice-1',
          constituentIds: ['op-wire'],
        },
      })
    );
    const update = backend.encodeReplicationUpdate();
    expect(update.coverage).toBe('incremental');
    expect(update.constituentIds).toEqual(['op-wire']);
    expect(update.bytes.length).toBeGreaterThan(0);
    expect(update.bytes).not.toBe(update.bytes);
  });
});

function createYjsConformanceDriver() {
  return {
    createBackend(initialModel = createFrozenAuthoredFixture()) {
      return createYjsStoreBackend(initialModel);
    },
    restoreBackend(snapshot: unknown) {
      return restoreYjsStoreBackend(snapshot);
    },
    expectsWireUpdates: true,
    validateWireDelta: validateYjsStateVectorDelta,
    validateCausalReverseDelivery: validateYjsCausalReverseDelivery,
    validateSameActorConvergence: validateYjsSameActorConvergence,
    validateClientCollisionReseed: validateYjsClientCollisionReseed,
    validateCommitIdUniqueness: validateYjsCommitIdUniqueness,
    validateBufferedAttribution: validateYjsBufferedAttribution,
    validatePendingQuotas: validateYjsPendingQuotas,
    validateLosslessReseedJournal: validateYjsLosslessReseedJournal,
    validateIndependentPendingChains: validateYjsIndependentPendingChains,
    validateSnapshotResyncRecovery: validateYjsSnapshotResyncRecovery,
    validateStructuralTextConservation: validateYjsStructuralTextConservation,
    validatePendingDeleteReverseDelivery: validateYjsPendingDeleteReverseDelivery,
    applyBatch(
      backend: ReturnType<typeof createYjsStoreBackend>,
      batch: ReturnType<typeof createDocOpBatch>,
      origin = createMutationOrigin('human', {
        actorId: batch.transaction.actorId,
        sessionId: batch.transaction.sessionId,
      })
    ) {
      void origin;
      return applyBatchToYjsBackend(backend, batch);
    },
  };
}

function applyBatchToYjsBackend(
  backend: ReturnType<typeof createYjsStoreBackend>,
  batch: ReturnType<typeof createDocOpBatch>
) {
  const staged = backend.stageLocalMutation({
    ops: batch.ops,
    constituentIds: batch.transaction.constituentIds,
    actorId: batch.transaction.actorId,
  });
  if (staged.status === 'failed') {
    return { status: 'failed' as const, code: staged.code, reason: staged.message };
  }
  if (staged.status === 'noOp') {
    return { status: 'noOp' as const, reason: staged.reason };
  }
  const committed = backend.commitStagedMutation(staged.staged, {
    actorId: batch.transaction.actorId,
    constituentIds: batch.transaction.constituentIds,
  });
  return {
    status: 'applied' as const,
    revisionBefore: committed.revisionBefore,
    revisionAfter: committed.revisionAfter,
    commitId: committed.commitId,
    constituentIds: [...batch.transaction.constituentIds],
    identityMappings: committed.identityMappings,
    normalized: committed.normalized,
    appliedRepair: committed.appliedRepair,
    origin: createMutationOrigin('human', {
      actorId: batch.transaction.actorId,
      sessionId: batch.transaction.sessionId,
    }),
  };
}

export { conformanceScenarios as yjsConformanceScenarios };
