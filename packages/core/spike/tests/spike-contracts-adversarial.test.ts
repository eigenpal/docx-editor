import { describe, expect, test } from 'bun:test';
import {
  assertAwarenessExcludedFromAuthoredPayload,
  createAwarenessOrigin,
  createAwarenessState,
  createDocOpBatch,
  createEncryptedReplayJournalEnvelope,
  createInternalAnchorEnvelope,
  createModelChange,
  createMutationOrigin,
  createReplicationUpdateEnvelope,
  createSnapshotEnvelope,
  isDocOp,
  snapshotAndValidateAwarenessOrigin,
  snapshotAndValidateDocOp,
  snapshotAndValidateModelChange,
  snapshotAndValidateMutationOrigin,
  snapshotAndValidateReplicationUpdate,
  snapshotAndValidateSnapshot,
  snapshotAndValidateSynchronousTransactionContext,
  type DocOpSingle,
} from '../src/contracts';
import * as brands from '../src/contracts/brands';

const insert: DocOpSingle = {
  kind: 'insertText',
  storyId: 'story-body-0',
  blockId: 'block-para-010',
  offset: 2,
  text: 'X',
};

function batchInput() {
  return {
    version: 'doc-op/1',
    kind: 'batch',
    ops: [insert],
    transaction: {
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
      groupId: 'group-alice-1',
      constituentIds: ['op-1'],
    },
  };
}

function changeInput() {
  return {
    version: 'model-change/2',
    commitId: 'commit-1',
    constituentIds: ['op-1'],
    causalUpdateIds: [],
    revisionBefore: 1,
    revisionAfter: 2,
    structuralRangesBefore: [
      { storyId: 'story-body-0', blockId: 'block-para-010', start: 0, end: 4 },
    ],
    structuralRangesAfter: [
      { storyId: 'story-body-0', blockId: 'block-para-010', start: 0, end: 4 },
    ],
    identityMappings: [
      { kind: 'block', beforeId: 'block-para-010', afterId: 'block-para-010' },
    ],
    dirtyDependencies: [{ dependencyKind: 'block', targetId: 'block-para-010' }],
    origin: {
      domain: 'mutation',
      kind: 'human',
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
    },
    normalized: false,
    repairEvidence: null,
  };
}

describe('adversarial contract trust', () => {
  test('does not export mutable trust registries or registration hooks', () => {
    expect(Object.keys(brands).some((key) => /TRUSTED|register/i.test(key))).toBe(false);
  });

  test('accepts closed structural snapshots but rejects forged hidden fields', () => {
    const structural = batchInput();
    expect(isDocOp(structural)).toBe(false);
    const validated = snapshotAndValidateDocOp(structural);
    expect(validated.errors).toEqual([]);
    expect(validated.snapshot).not.toBe(structural);
    expect(isDocOp(validated.snapshot)).toBe(true);
    const forged = batchInput();
    Object.defineProperty(forged, 'hidden', { value: true, enumerable: false });
    expect(snapshotAndValidateDocOp(forged).errors).not.toEqual([]);
  });

  test('rejects single operations at the DocOp apply boundary', () => {
    expect(snapshotAndValidateDocOp(insert).errors).not.toEqual([]);
  });
});

describe('adversarial immutable opaque bytes', () => {
  test('returns fresh bytes for every external read', () => {
    const update = createReplicationUpdateEnvelope({
      documentId: 'doc-1',
      backendVersion: 'backend/1',
      schemaVersion: 'schema/1',
      checkpoint: 'checkpoint-1',
      updateId: 'update-1',
      semanticUpdateId: 'update-1',
      sourceActorId: 'actor-1',
      sourceReplicaId: 'replica-1',
      sourceSessionId: 'session-1',
      sourceClientId: 1,
      constituentIds: ['op-1'],
      coverage: 'incremental',
      bytes: new Uint8Array([1, 2]),
    });
    const snapshot = createSnapshotEnvelope({
      documentId: 'doc-1',
      backendVersion: 'backend/1',
      schemaVersion: 'schema/1',
      normalizationVersion: 'normalize/1',
      checkpoint: 'checkpoint-1',
      bytes: new Uint8Array([3, 4]),
    });
    const anchor = createInternalAnchorEnvelope({
      documentId: 'doc-1',
      backendVersion: 'backend/1',
      schemaVersion: 'schema/1',
      checkpoint: 'checkpoint-1',
      affinity: 'before',
      relativeBytes: new Uint8Array([5, 6]),
    });
    const replay = createEncryptedReplayJournalEnvelope({
      sequence: 1,
      commitId: 'commit-1',
      payloadSchemaVersion: 'payload/1',
      retentionPolicyId: 'retention-1',
      authorizationPolicyId: 'authorization-1',
      encryptedPayload: new Uint8Array([7, 8]),
    });

    update.bytes[0] = 99;
    snapshot.bytes[0] = 99;
    anchor.relativeBytes[0] = 99;
    replay.encryptedPayload[0] = 99;

    expect([...update.bytes]).toEqual([1, 2]);
    expect([...snapshot.bytes]).toEqual([3, 4]);
    expect([...anchor.relativeBytes]).toEqual([5, 6]);
    expect([...replay.encryptedPayload]).toEqual([7, 8]);
  });

  test('reserves full coverage exclusively for Snapshot', () => {
    const fullUpdate = {
      version: 'replication-update/2',
      documentId: 'doc-1',
      backendVersion: 'backend/1',
      schemaVersion: 'schema/1',
      checkpoint: 'checkpoint-1',
      updateId: 'update-1',
      semanticUpdateId: 'update-1',
      sourceActorId: 'actor-1',
      sourceReplicaId: 'replica-1',
      sourceSessionId: 'session-1',
      sourceClientId: 1,
      constituentIds: ['op-1'],
      coverage: 'full',
      bytes: new Uint8Array([1]),
    };
    expect(snapshotAndValidateReplicationUpdate(fullUpdate).errors).not.toEqual([]);
    expect(() =>
      createReplicationUpdateEnvelope({
        ...fullUpdate,
        coverage: 'full' as never,
      })
    ).toThrow();

    const snapshot = createSnapshotEnvelope({
      documentId: 'doc-1',
      backendVersion: 'backend/1',
      schemaVersion: 'schema/1',
      normalizationVersion: 'normalize/1',
      checkpoint: 'checkpoint-1',
      bytes: new Uint8Array([1]),
    });
    expect(snapshot.coverage).toBe('full');
    expect(snapshotAndValidateSnapshot(snapshot).errors).toEqual([]);
    expect(snapshotAndValidateReplicationUpdate(snapshot).errors).not.toEqual([]);
  });
});

describe('adversarial closed snapshots', () => {
  test('never invokes origin accessors and rejects hidden/symbol fields', () => {
    let invoked = false;
    const accessor = Object.defineProperty(
      { domain: 'mutation', kind: 'human', sessionId: 'session-1' },
      'actorId',
      {
        enumerable: true,
        get() {
          invoked = true;
          return 'actor-1';
        },
      }
    );
    expect(snapshotAndValidateMutationOrigin(accessor).errors).not.toEqual([]);
    expect(invoked).toBe(false);

    const hidden = { ...createAwarenessOrigin('presence', { actorId: 'actor-1' }) };
    Object.defineProperty(hidden, Symbol('hidden'), { value: true });
    expect(snapshotAndValidateAwarenessOrigin(hidden).errors).not.toEqual([]);
  });
});

describe('adversarial DocOp invariants', () => {
  test('rejects duplicate constituent IDs and unsafe integers', () => {
    const duplicate = batchInput();
    duplicate.transaction.constituentIds = ['op-1', 'op-1'];
    expect(snapshotAndValidateDocOp(duplicate).errors).not.toEqual([]);

    const unsafe = batchInput();
    unsafe.ops = [{ ...insert, offset: Number.MAX_SAFE_INTEGER + 1 }];
    expect(snapshotAndValidateDocOp(unsafe).errors).not.toEqual([]);
  });

  test('factory snapshots closed input instead of spreading extras', () => {
    expect(() =>
      createDocOpBatch({
        ops: [{ ...insert, extra: true } as DocOpSingle],
        transaction: batchInput().transaction,
      })
    ).toThrow();
  });
});

describe('adversarial ModelChange invariants', () => {
  test('requires exactly one safe revision increment', () => {
    expect(
      snapshotAndValidateModelChange({ ...changeInput(), revisionAfter: 3 }).errors
    ).not.toEqual([]);
    expect(
      snapshotAndValidateModelChange({
        ...changeInput(),
        revisionBefore: Number.MAX_SAFE_INTEGER,
        revisionAfter: Number.MAX_SAFE_INTEGER + 1,
      }).errors
    ).not.toEqual([]);
  });

  test('rejects duplicate IDs, mappings, dirty dependencies, and incoherent references', () => {
    expect(
      snapshotAndValidateModelChange({
        ...changeInput(),
        constituentIds: ['op-1', 'op-1'],
      }).errors
    ).not.toEqual([]);
    expect(
      snapshotAndValidateModelChange({
        ...changeInput(),
        identityMappings: [
          ...changeInput().identityMappings,
          ...changeInput().identityMappings,
        ],
      }).errors
    ).not.toEqual([]);
    expect(
      snapshotAndValidateModelChange({
        ...changeInput(),
        dirtyDependencies: [
          ...changeInput().dirtyDependencies,
          ...changeInput().dirtyDependencies,
        ],
      }).errors
    ).not.toEqual([]);
    expect(
      snapshotAndValidateModelChange({
        ...changeInput(),
        identityMappings: [
          { kind: 'block', beforeId: 'missing-before', afterId: 'missing-after' },
        ],
      }).errors
    ).not.toEqual([]);
    expect(
      snapshotAndValidateModelChange({
        ...changeInput(),
        dirtyDependencies: [{ dependencyKind: 'block', targetId: 'missing-block' }],
      }).errors
    ).not.toEqual([]);
  });

  test('factory validates rather than trusting typed input', () => {
    const { version: _version, ...factoryInput } = changeInput();
    expect(() =>
      createModelChange({
        ...(factoryInput as Parameters<typeof createModelChange>[0]),
        origin: createMutationOrigin('human', {
          actorId: 'actor-alice',
          sessionId: 'session-alice-1',
        }),
        constituentIds: ['op-1', 'op-1'],
      })
    ).toThrow();
  });
});

describe('adversarial awareness exclusion', () => {
  test('awareness factory rejects invalid closed input', () => {
    expect(() =>
      createAwarenessState({
        actorId: 'actor-1',
        sessionId: 'session-1',
        presence: { status: 'invalid' as 'active' },
        selectionEphemeral: null,
      })
    ).toThrow();
  });

  test('finds awareness in arrays without invoking accessors and tolerates cycles', () => {
    expect(() =>
      assertAwarenessExcluded([{ nested: [{ awareness: true }] }])
    ).toThrow(/awareness/);

    let invoked = false;
    const accessor = Object.defineProperty({}, 'awareness', {
      enumerable: true,
      get() {
        invoked = true;
        return true;
      },
    });
    expect(() => assertAwarenessExcluded(accessor)).toThrow(/awareness/);
    expect(invoked).toBe(false);

    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() => assertAwarenessExcluded(cycle)).not.toThrow();
  });
});

describe('adversarial synchronous transaction context', () => {
  test('is versioned, closed, and requires actor/session coherence with mutation origin', () => {
    const valid = {
      version: 'transaction-context/1',
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
      groupId: 'group-alice-1',
      transactionId: 'txn-1',
      origin: {
        domain: 'mutation',
        kind: 'human',
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
      },
      rejectionReasons: [
        'async-callback',
        'mixed-origin',
        'nested-transaction',
        'preflight-failure',
        'reentrant-transaction',
      ],
    };
    expect(snapshotAndValidateSynchronousTransactionContext(valid).errors).toEqual([]);
    expect(
      snapshotAndValidateSynchronousTransactionContext({
        ...valid,
        actorId: 'actor-bob',
      }).errors
    ).not.toEqual([]);
    expect(
      snapshotAndValidateSynchronousTransactionContext({
        ...valid,
        extra: true,
      }).errors
    ).not.toEqual([]);
  });
});

function assertAwarenessExcluded(value: unknown): void {
  assertAwarenessExcludedFromAuthoredPayload(value);
}
