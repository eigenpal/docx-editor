import { describe, expect, test } from 'bun:test';
import {
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createLocalStoreBackend,
  createMutationOrigin,
  createReplicationUpdateEnvelope,
  createSemanticDocumentStore,
  fingerprintAuthoredModel,
  restoreLocalStoreBackend,
  runBackendConformanceSuite,
  type BackendConformanceScenario,
  type SemanticStoreBackend,
} from '../src';

const STORY = 'story-body-0';

function createLocalDriver() {
  return {
    createBackend(initialModel = createFrozenAuthoredFixture()) {
      return createLocalStoreBackend(initialModel);
    },
    restoreBackend(snapshot: unknown) {
      return restoreLocalStoreBackend(snapshot);
    },
    expectsWireUpdates: false,
    applyBatch(
      backend: SemanticStoreBackend,
      batch: ReturnType<typeof createDocOpBatch>,
      origin = createMutationOrigin('human', {
        actorId: batch.transaction.actorId,
        sessionId: batch.transaction.sessionId,
      })
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
        origin,
      };
    },
  };
}

const scenarios: BackendConformanceScenario[] = [
  {
    name: 'insert-delete',
    expectRepair: false,
    batches: [
      {
        batch: createDocOpBatch({
          ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'X' }],
          transaction: {
            actorId: 'actor-alice',
            sessionId: 'session-alice-1',
            groupId: 'group-alice-1',
            constituentIds: ['op-insert'],
          },
        }),
      },
      {
        batch: createDocOpBatch({
          ops: [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-001', start: 1, end: 4 }],
          transaction: {
            actorId: 'actor-alice',
            sessionId: 'session-alice-1',
            groupId: 'group-alice-1',
            constituentIds: ['op-delete'],
          },
        }),
      },
    ],
  },
  {
    name: 'split-join-identity',
    batches: [
      {
        batch: createDocOpBatch({
          ops: [{ kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 2 }],
          transaction: {
            actorId: 'actor-alice',
            sessionId: 'session-alice-1',
            groupId: 'group-alice-1',
            constituentIds: ['op-split'],
          },
        }),
      },
      {
        batch: createDocOpBatch({
          ops: [
            {
              kind: 'joinParagraphs',
              storyId: STORY,
              firstBlockId: 'block-para-010',
              secondBlockId: 'block-para-010-tail',
            },
          ],
          transaction: {
            actorId: 'actor-alice',
            sessionId: 'session-alice-1',
            groupId: 'group-alice-1',
            constituentIds: ['op-join'],
          },
        }),
      },
    ],
  },
  {
    name: 'validation-failure',
    expectFailure: true,
    batches: [
      {
        batch: createDocOpBatch({
          ops: [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-999', start: 0, end: 1 }],
          transaction: {
            actorId: 'actor-alice',
            sessionId: 'session-alice-1',
            groupId: 'group-alice-1',
            constituentIds: ['op-bad'],
          },
        }),
      },
    ],
  },
  {
    name: 'no-op',
    expectNoOp: true,
    batches: [
      {
        batch: createDocOpBatch({
          ops: [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-010', start: 2, end: 2 }],
          transaction: {
            actorId: 'actor-alice',
            sessionId: 'session-alice-1',
            groupId: 'group-alice-1',
            constituentIds: ['op-noop'],
          },
        }),
      },
    ],
  },
];

describe('backend conformance harness — red gate (task 2.2 local slice)', () => {
  test('runs reusable scenarios against a backend driver', () => {
    const report = runBackendConformanceSuite(createLocalDriver(), scenarios);
    expect(report.passed).toBe(true);
    expect(report.scenarios.length).toBe(scenarios.length);
    expect(report.invariants).toEqual({
      rollback: true,
      staleStageRejection: true,
      failedCommitAtomicity: true,
      coverage: true,
      snapshotRestoreParity: true,
      aliasSafety: true,
      wireUpdatePolicy: true,
      trueStateVectorDelta: true,
      causalReverseDelivery: true,
      sameActorConvergence: true,
      clientCollisionReseed: true,
      commitIdUniqueness: true,
      bufferedAttribution: true,
      pendingQuotas: true,
      losslessReseedJournal: true,
      independentPendingChains: true,
      snapshotResyncRecovery: true,
      structuralTextConservation: true,
      pendingDeleteReverseDelivery: true,
      publicationOwnership: true,
    });
    expect(report.scenarios[0]?.steps[0]).toMatchObject({
      status: 'applied',
      revisionBefore: 0,
      revisionAfter: 1,
      constituentIds: ['op-insert'],
      normalized: true,
    });
    expect(report.scenarios[0]?.steps[0]?.canonicalFingerprint).toHaveLength(64);
    expect(report.scenarios[0]?.steps[0]?.coverage.constituentIds).toContain('op-insert');
  });

  test('matches semantic store fingerprints revision deltas and observable ModelChange fields', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture());
    const driver = createLocalDriver();
    const origin = createMutationOrigin('human', {
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
    });
    for (const scenario of scenarios) {
      for (const step of scenario.batches) {
        const storeResult = store.apply(step.batch, origin);
        const backendResult = driver.applyBatch(backend, step.batch, origin);
        expect(storeResult.status).toBe(backendResult.status);
        if (storeResult.status === 'applied' && backendResult.status === 'applied') {
          expect(storeResult.change.revisionBefore).toBe(backendResult.revisionBefore);
          expect(storeResult.change.revisionAfter).toBe(backendResult.revisionAfter);
          expect(storeResult.change.commitId).toBe(backendResult.commitId);
          expect(storeResult.change.constituentIds).toEqual(backendResult.constituentIds);
          expect(storeResult.change.identityMappings).toEqual(backendResult.identityMappings);
          expect(storeResult.change.normalized).toBe(backendResult.normalized);
        }
        expect(fingerprintAuthoredModel(store.model)).toBe(fingerprintAuthoredModel(backend.model));
        expect(store.model.revision).toBe(backend.model.revision);
      }
    }
  });

  test('rejects drivers that lie about committed result metadata', () => {
    const honest = createLocalDriver();
    const lies = [
      (result: Record<string, unknown>) => ({ ...result, revisionBefore: 99 }),
      (result: Record<string, unknown>) => ({ ...result, revisionAfter: 99 }),
      (result: Record<string, unknown>) => ({ ...result, commitId: 'not valid!' }),
      (result: Record<string, unknown>) => ({ ...result, commitId: 'commit-lie-999' }),
      (result: Record<string, unknown>) => ({ ...result, constituentIds: ['op-lie'] }),
      (result: Record<string, unknown>) => ({ ...result, normalized: false }),
      (result: Record<string, unknown>) => ({ ...result, appliedRepair: true }),
    ];
    for (const lie of lies) {
      const report = runBackendConformanceSuite(
        {
          ...honest,
          applyBatch(backend, batch, origin) {
            void origin;
            const result = honest.applyBatch(backend, batch);
            return result.status === 'applied'
              ? (lie(result as unknown as Record<string, unknown>) as never)
              : result;
          },
        },
        [scenarios[0]!]
      );
      expect(report.passed).toBe(false);
      expect(report.scenarios[0]?.failures.length).toBeGreaterThan(0);
    }
  });

  test('rejects no-op or failure reports that mutated backend state', () => {
    const honest = createLocalDriver();
    for (const status of ['noOp', 'failed'] as const) {
      const report = runBackendConformanceSuite(
        {
          ...honest,
          applyBatch(backend, batch) {
            const applied = honest.applyBatch(backend, batch);
            expect(applied.status).toBe('applied');
            return status === 'noOp'
              ? { status: 'noOp' as const, reason: 'lie' }
              : { status: 'failed' as const, code: 'lie', reason: 'lie' };
          },
        },
        [scenarios[0]!]
      );
      expect(report.passed).toBe(false);
      expect(report.scenarios[0]?.failures).toContain(
        `insert-delete: ${status} mutated backend state`
      );
    }
  });

  test('fails conformance when restoreBackend is missing', () => {
    const { restoreBackend: _missing, ...driver } = createLocalDriver();
    const report = runBackendConformanceSuite(driver as never, [scenarios[0]!]);
    expect(report.passed).toBe(false);
    expect(report.invariants.snapshotRestoreParity).toBe(false);
  });

  test('rejects envelope-only replicated backends without actual Yjs delta evidence', () => {
    const report = runBackendConformanceSuite(createWireDriver('valid'), [scenarios[0]!]);
    expect(report.passed).toBe(false);
    expect(report.invariants.wireUpdatePolicy).toBe(true);
    expect(report.invariants.trueStateVectorDelta).toBe(false);
  });

  test('fails replicated conformance for missing throwing or malformed wire methods', () => {
    for (const mode of ['missing', 'throwing', 'malformed'] as const) {
      const report = runBackendConformanceSuite(createWireDriver(mode), [scenarios[0]!]);
      expect(report.passed).toBe(false);
      expect(report.invariants.wireUpdatePolicy).toBe(false);
    }
  });
});

function createWireDriver(mode: 'valid' | 'missing' | 'throwing' | 'malformed') {
  const local = createLocalDriver();
  const wrap = (backend: ReturnType<typeof createLocalStoreBackend>) =>
    new Proxy(backend, {
      get(target, property, receiver) {
        if (property !== 'encodeReplicationUpdate') {
          return Reflect.get(target, property, receiver);
        }
        if (mode === 'missing') return undefined;
        if (mode === 'throwing') return () => {
          throw new Error('wire encode failed');
        };
        if (mode === 'malformed') return () => ({ coverage: 'incremental' });
        return () => {
          const state = backend.inspectState();
          return createReplicationUpdateEnvelope({
            documentId: backend.identity.documentId,
            backendVersion: backend.identity.backendVersion,
            schemaVersion: backend.identity.schemaVersion,
            checkpoint: `wire-${state.revision}`,
            updateId: `update-wire-${state.revision}`,
            semanticUpdateId: `update-wire-${state.revision}`,
            sourceActorId: 'actor-conformance',
            sourceReplicaId: 'replica-conformance',
            sourceSessionId: 'session-conformance',
            sourceClientId: 1,
            constituentIds: state.coverage.constituentIds,
            coverage: 'incremental',
            bytes: new Uint8Array([state.revision + 1]),
          });
        };
      },
    });
  return {
    ...local,
    expectsWireUpdates: true,
    createBackend(initialModel = createFrozenAuthoredFixture()) {
      return wrap(createLocalStoreBackend(initialModel));
    },
    restoreBackend(snapshot: Parameters<typeof restoreLocalStoreBackend>[0]) {
      return wrap(restoreLocalStoreBackend(snapshot));
    },
  };
}
