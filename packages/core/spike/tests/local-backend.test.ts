import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createLocalStoreBackend,
  createMutationOrigin,
  createSemanticDocumentStore,
  createSnapshotEnvelope,
  fingerprintAuthoredModel,
  isBackendStagedMutation,
  restoreLocalStoreBackend,
  type DocOpSingle,
  type LocalStoreBackend,
  type SemanticStoreBackend,
} from '../src';

const STORY = 'story-body-0';

function humanBatch(ops: DocOpSingle[], constituentIds: string[]) {
  return createDocOpBatch({
    ops,
    transaction: {
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
      groupId: 'group-alice-1',
      constituentIds,
    },
  });
}

describe('local backend — red gate (task 2.2 local slice)', () => {
  test('exports PM-free backend seam and local implementation', () => {
    expect(typeof createLocalStoreBackend).toBe('function');
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    expect(backend.model.revision).toBe(0);
    expect(typeof backend.stageLocalMutation).toBe('function');
    expect(typeof backend.commitStagedMutation).toBe('function');
    expect(typeof backend.rollbackStagedMutation).toBe('function');
    expect(typeof backend.encodeSnapshot).toBe('function');
  });

  test('local backend modules contain no prosemirror dom or yjs imports', () => {
    const backendRoot = join(import.meta.dir, '../src/store/backend');
    const localOnly = ['local-backend.ts', 'local-snapshot.ts', 'staging.ts', 'coverage.ts', 'conformance.ts', 'types.ts', 'index.ts'];
    const sources: string[] = [];
    for (const file of localOnly) {
      sources.push(readFileSync(join(backendRoot, file), 'utf8'));
    }
    const joined = sources.join('\n');
    expect(joined).not.toMatch(/from\s+['"][^'"]*(?:prosemirror|dom)[^'"]*['"]/i);
    expect(joined).not.toMatch(/from\s+['"]yjs['"]/i);
    expect(joined).not.toMatch(/\bsubscribeModel\b/);
  });
});

describe('local backend — stage validate commit rollback lifecycle', () => {
  test('only the first of two stages from the same base may commit', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const first = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'A' }],
      constituentIds: ['op-first'],
      actorId: 'actor-alice',
    });
    const second = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'B' }],
      constituentIds: ['op-second'],
      actorId: 'actor-alice',
    });
    expect(first.status).toBe('staged');
    expect(second.status).toBe('staged');
    if (first.status !== 'staged' || second.status !== 'staged') return;
    expect(first.staged.preview.stageToken).not.toBe(second.staged.preview.stageToken);
    expect(first.staged.preview.baseRevision).toBe(0);
    expect(first.staged.preview.baseFingerprint).toBe(fingerprintAuthoredModel(backend.model));

    const committed = backend.commitStagedMutation(first.staged, {
      actorId: 'actor-alice',
      constituentIds: ['op-first'],
    });
    expect(() =>
      backend.commitStagedMutation(second.staged, {
        actorId: 'actor-alice',
        constituentIds: ['op-second'],
      })
    ).toThrow(/stale stage/);
    expect(backend.model.revision).toBe(1);
    expect(backend.hasCommitCoverage(committed.commitId)).toBe(true);
    expect(backend.hasConstituentCoverage('op-second')).toBe(false);
  });

  test('stage handle exposes only immutable preview data', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const result = backend.stageLocalMutation({
      ops: [{ kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 2 }],
      constituentIds: ['op-forged'],
    });
    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    expect(Object.keys(result.staged)).toEqual(['preview']);
    expect(Object.isFrozen(result.staged)).toBe(true);
    expect(Object.isFrozen(result.staged.preview)).toBe(true);
    expect('beforeDraft' in result.staged).toBe(false);
    expect('trace' in result.staged).toBe(false);
    expect('stagingEnv' in result.staged).toBe(false);
    expect('stagedModel' in result.staged).toBe(false);
    expect(() =>
      backend.commitStagedMutation({ preview: result.staged.preview } as never, {
        actorId: 'actor-alice',
        constituentIds: ['op-forged'],
      })
    ).toThrow(/untrusted stage/);
  });

  test('failed commit validation leaves all state and stage pending', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const result = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: '!' }],
      constituentIds: ['op-valid'],
    });
    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    const before = backend.inspectState();
    const constituentIds = ['op-valid'];
    Object.defineProperty(constituentIds, '0', {
      enumerable: true,
      get() {
        throw new Error('constituent getter invoked');
      },
    });
    expect(() =>
      backend.commitStagedMutation(result.staged, {
        actorId: 'actor-alice',
        constituentIds,
      })
    ).toThrow(/accessor elements are forbidden/);
    expect(backend.inspectState()).toEqual(before);

    const committed = backend.commitStagedMutation(result.staged, {
      actorId: 'actor-alice',
      constituentIds: ['op-valid'],
    });
    expect(committed.revisionAfter).toBe(1);
  });

  test('rollback is idempotent and a rolled-back stage cannot commit', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const result = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: '!' }],
      constituentIds: ['op-rolled-back'],
    });
    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    backend.rollbackStagedMutation(result.staged);
    backend.rollbackStagedMutation(result.staged);
    expect(() =>
      backend.commitStagedMutation(result.staged, {
        actorId: 'actor-alice',
        constituentIds: ['op-rolled-back'],
      })
    ).toThrow(/rolled back stage/);
  });

  test('staged mutation is isolated until commit', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const beforeFingerprint = fingerprintAuthoredModel(backend.model);
    const staged = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'Z' }],
      constituentIds: ['op-isolated'],
    });
    expect(staged.status).toBe('staged');
    if (staged.status !== 'staged') return;
    expect(isBackendStagedMutation(staged.staged)).toBe(true);
    expect(fingerprintAuthoredModel(backend.model)).toBe(beforeFingerprint);
    expect(backend.model.revision).toBe(0);
    backend.rollbackStagedMutation(staged.staged);
    expect(fingerprintAuthoredModel(backend.model)).toBe(beforeFingerprint);
  });

  test('commit promotes canonical model and operation environment', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const staged = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'Z' }],
      constituentIds: ['op-insert-1'],
    });
    expect(staged.status).toBe('staged');
    if (staged.status !== 'staged') return;
    const committed = backend.commitStagedMutation(staged.staged, {
      actorId: 'actor-alice',
      constituentIds: ['op-insert-1'],
    });
    expect(committed.revisionAfter).toBe(1);
    expect(backend.model.revision).toBe(1);
    expect(backend.model.authored.body.paragraphs.get('para-010')?.text).toBe('Zp010');
    expect(backend.operationEnvironment.nextCommitSeq).toBeGreaterThan(1);
  });

  test('validation failure rolls back without revision or env allocation drift', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const envBefore = backend.inspectState().operationEnvironment;
    const staged = backend.stageLocalMutation({
      ops: [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-999', start: 0, end: 1 }],
      constituentIds: ['op-bad'],
    });
    expect(staged.status).toBe('failed');
    if (staged.status === 'failed') expect(staged.code).toBe('missing-block');
    expect(backend.model.revision).toBe(0);
    expect(backend.inspectState().operationEnvironment).toEqual(envBefore);
  });

  test('no-op batch returns typed no-op without commit bookkeeping', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const staged = backend.stageLocalMutation({
      ops: [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-010', start: 2, end: 2 }],
      constituentIds: ['op-noop'],
    });
    expect(staged.status).toBe('noOp');
    expect(backend.coverage.constituentIds.size).toBe(0);
    expect(backend.coverage.commitIds.size).toBe(0);
  });
});

describe('local backend — coverage and snapshot readiness', () => {
  test('covered constituent rejects the entire atomic batch before staging', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const first = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'A' }],
      constituentIds: ['op-covered'],
    });
    expect(first.status).toBe('staged');
    if (first.status !== 'staged') return;
    backend.commitStagedMutation(first.staged, {
      actorId: 'actor-alice',
      constituentIds: ['op-covered'],
    });
    const before = backend.inspectState();
    const duplicate = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'B' }],
      constituentIds: ['op-covered'],
    });
    expect(duplicate).toEqual({
      status: 'noOp',
      reason: 'constituent coverage overlap rejects atomic batch',
    });
    const partial = backend.stageLocalMutation({
      ops: [
        { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'C' },
        { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 1, text: 'D' },
      ],
      constituentIds: ['op-covered', 'op-new'],
    });
    expect(partial).toEqual({
      status: 'noOp',
      reason: 'constituent coverage overlap rejects atomic batch',
    });
    expect(backend.inspectState()).toEqual(before);
    expect(backend.hasConstituentCoverage('op-new')).toBe(false);
  });

  test('commit cannot substitute covered or mismatched constituent IDs', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const seed = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'A' }],
      constituentIds: ['op-covered'],
    });
    expect(seed.status).toBe('staged');
    if (seed.status !== 'staged') return;
    backend.commitStagedMutation(seed.staged, {
      actorId: 'actor-alice',
      constituentIds: ['op-covered'],
    });
    const candidate = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'B' }],
      constituentIds: ['op-candidate'],
    });
    expect(candidate.status).toBe('staged');
    if (candidate.status !== 'staged') return;
    const before = backend.inspectState();
    expect(() =>
      backend.commitStagedMutation(candidate.staged, {
        actorId: 'actor-alice',
        constituentIds: ['op-covered'],
      })
    ).toThrow(/constituent IDs do not match stage/);
    expect(backend.inspectState()).toEqual(before);
  });

  test('covered commit ID cannot reapply after snapshot restore', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), {
      documentId: 'doc-spike-0',
      actorId: 'actor-alice',
    });
    const first = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'A' }],
      constituentIds: ['op-first'],
    });
    expect(first.status).toBe('staged');
    if (first.status !== 'staged') return;
    const committed = backend.commitStagedMutation(first.staged, {
      actorId: 'actor-alice',
      constituentIds: ['op-first'],
    });
    const snapshot = backend.encodeSnapshot();
    const payload = JSON.parse(new TextDecoder().decode(snapshot.bytes));
    payload.allocator.nextCommitSeq = 1;
    const restored = restoreLocalStoreBackend(
      createSnapshotEnvelope({
        documentId: snapshot.documentId,
        backendVersion: snapshot.backendVersion,
        schemaVersion: snapshot.schemaVersion,
        normalizationVersion: snapshot.normalizationVersion,
        checkpoint: snapshot.checkpoint,
        bytes: new TextEncoder().encode(JSON.stringify(payload)),
      })
    );
    expect(restored.hasCommitCoverage(committed.commitId)).toBe(true);
    const candidate = restored.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'B' }],
      constituentIds: ['op-second'],
    });
    expect(candidate.status).toBe('staged');
    if (candidate.status !== 'staged') return;
    const before = restored.inspectState();
    expect(() =>
      restored.commitStagedMutation(candidate.staged, {
        actorId: 'actor-alice',
        constituentIds: ['op-second'],
      })
    ).toThrow(/commit ID already covered/);
    expect(restored.inspectState()).toEqual(before);
  });

  test('records stable constituent and commit coverage on commit', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const staged = backend.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: '!' }],
      constituentIds: ['op-coverage'],
    });
    expect(staged.status).toBe('staged');
    if (staged.status !== 'staged') return;
    const committed = backend.commitStagedMutation(staged.staged, {
      actorId: 'actor-alice',
      constituentIds: ['op-coverage'],
    });
    expect(backend.hasConstituentCoverage('op-coverage')).toBe(true);
    expect(backend.hasCommitCoverage(committed.commitId)).toBe(true);
    expect(backend.coverage.constituentIds.has('op-coverage')).toBe(true);
    expect(backend.coverage.commitIds.has(committed.commitId)).toBe(true);
  });

  test('encodeSnapshot returns closed immutable snapshot without replication bytes', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const snapshot = backend.encodeSnapshot();
    expect(snapshot.coverage).toBe('full');
    expect(snapshot.backendVersion).toBe('local/1');
    expect(snapshot.bytes.length).toBeGreaterThan(0);
    expect(snapshot.bytes).not.toBe(snapshot.bytes);
    expect(() => backend.encodeReplicationUpdate()).toThrow(/local backend does not emit replication updates/i);
  });

  test('snapshot restores complete authored state allocator and coverage exactly', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), {
      documentId: 'doc-spike-0',
      actorId: 'actor-alice',
    });
    const staged = backend.stageLocalMutation({
      ops: [
        { kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-001', offset: 2 },
        {
          kind: 'setMark',
          storyId: STORY,
          blockId: 'block-para-001-tail',
          mark: 'bold',
          start: 0,
          end: 2,
          enabled: true,
        },
      ],
      constituentIds: ['op-split', 'op-mark'],
    });
    expect(staged.status).toBe('staged');
    if (staged.status !== 'staged') return;
    backend.commitStagedMutation(staged.staged, {
      actorId: 'actor-alice',
      constituentIds: ['op-split', 'op-mark'],
    });
    const snapshot = backend.encodeSnapshot();
    const restored = restoreLocalStoreBackend(snapshot);

    expect(restored.identity).toEqual(backend.identity);
    expect(restored.inspectState()).toEqual(backend.inspectState());
    expect(fingerprintAuthoredModel(restored.model)).toBe(fingerprintAuthoredModel(backend.model));
    expect(restored.model.authored.body.paragraphOrder).toEqual(
      backend.model.authored.body.paragraphOrder
    );
    expect(restored.model.authored.body.paragraphs.get('para-001-tail')).toEqual(
      backend.model.authored.body.paragraphs.get('para-001-tail')
    );
    expect(restored.model.authored.capsules[0]?.bytes).toEqual(
      backend.model.authored.capsules[0]?.bytes
    );
  });

  test('restore rejects malformed tampered truncated and extra snapshot data', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), {
      documentId: 'doc-spike-0',
      actorId: 'actor-alice',
    });
    const snapshot = backend.encodeSnapshot();
    const payload = JSON.parse(new TextDecoder().decode(snapshot.bytes));
    const variants = [
      { ...payload, extra: true },
      { ...payload, documentId: 'doc-other' },
      { ...payload, authoredFingerprint: 'tampered' },
      { ...payload, localRevision: -1 },
    ];
    for (const variant of variants) {
      const envelope = createSnapshotEnvelope({
        documentId: 'doc-spike-0',
        backendVersion: snapshot.backendVersion,
        schemaVersion: snapshot.schemaVersion,
        normalizationVersion: snapshot.normalizationVersion,
        checkpoint: snapshot.checkpoint,
        bytes: new TextEncoder().encode(JSON.stringify(variant)),
      });
      expect(() => restoreLocalStoreBackend(envelope)).toThrow();
    }
    const truncated = createSnapshotEnvelope({
      documentId: 'doc-spike-0',
      backendVersion: snapshot.backendVersion,
      schemaVersion: snapshot.schemaVersion,
      normalizationVersion: snapshot.normalizationVersion,
      checkpoint: snapshot.checkpoint,
      bytes: snapshot.bytes.slice(0, 20),
    });
    expect(() => restoreLocalStoreBackend(truncated)).toThrow();
  });

  test('public state snapshots have no mutable aliases', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), { actorId: 'actor-alice' });
    const first = backend.operationEnvironment;
    const coverage = backend.coverage;
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.reservedSemanticIds)).toBe(true);
    expect(Object.isFrozen(coverage)).toBe(true);
    expect(Object.isFrozen(coverage.commitIds)).toBe(true);
    expect((first.reservedSemanticIds as unknown as { add?: unknown }).add).toBeUndefined();
    expect((coverage.commitIds as unknown as { add?: unknown }).add).toBeUndefined();
    expect(backend.operationEnvironment).not.toBe(first);
    expect(backend.coverage).not.toBe(coverage);
  });
});

describe('local backend — store integration without behavior drift', () => {
  test('store duplicate and partial constituent overlap are notification-free no-ops', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const notifications: number[] = [];
    store.subscribeModel((change) => notifications.push(change.revisionAfter));
    const first = store.apply(
      humanBatch(
        [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'A' }],
        ['op-covered']
      ),
      createMutationOrigin('human', {
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
      })
    );
    expect(first.status).toBe('applied');
    const beforeFingerprint = fingerprintAuthoredModel(store.model);
    const duplicate = store.apply(
      humanBatch(
        [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'B' }],
        ['op-covered']
      ),
      createMutationOrigin('human', {
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
      })
    );
    const partial = store.apply(
      humanBatch(
        [
          { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'C' },
          { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 1, text: 'D' },
        ],
        ['op-covered', 'op-new']
      ),
      createMutationOrigin('human', {
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
      })
    );
    expect(duplicate.status).toBe('noOp');
    expect(partial.status).toBe('noOp');
    expect(store.model.revision).toBe(1);
    expect(fingerprintAuthoredModel(store.model)).toBe(beforeFingerprint);
    expect(notifications).toEqual([1]);
  });

  test('injected backend must match initial document identity revision and fingerprint', () => {
    const initial = createFrozenAuthoredFixture();
    const matching = createLocalStoreBackend(initial, {
      documentId: 'doc-spike-0',
      actorId: 'actor-alice',
    });
    expect(
      createSemanticDocumentStore(initial, {
        documentId: 'doc-spike-0',
        backend: matching,
      }).model.revision
    ).toBe(0);
    expect(() =>
      createSemanticDocumentStore(initial, {
        documentId: 'doc-other',
        backend: matching,
      })
    ).toThrow(/document identity mismatch/);

    const advanced = createLocalStoreBackend(initial, {
      documentId: 'doc-spike-0',
      actorId: 'actor-alice',
    });
    const stage = advanced.stageLocalMutation({
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: '!' }],
      constituentIds: ['op-advance'],
    });
    expect(stage.status).toBe('staged');
    if (stage.status !== 'staged') return;
    advanced.commitStagedMutation(stage.staged, {
      actorId: 'actor-alice',
      constituentIds: ['op-advance'],
    });
    expect(() =>
      createSemanticDocumentStore(initial, {
        documentId: 'doc-spike-0',
        backend: advanced,
      })
    ).toThrow(/backend model mismatch/);
  });

  test('injected backend identity is snapshotted without invoking accessors', () => {
    const initial = createFrozenAuthoredFixture();
    const backend = createLocalStoreBackend(initial, {
      documentId: 'doc-spike-0',
      actorId: 'actor-alice',
    });
    let invoked = false;
    const forged = Object.create(backend) as typeof backend;
    Object.defineProperty(forged, 'identity', {
      enumerable: true,
      get() {
        invoked = true;
        return backend.identity;
      },
    });
    expect(() =>
      createSemanticDocumentStore(initial, {
        documentId: 'doc-spike-0',
        backend: forged,
      })
    ).toThrow(/backend identity/);
    expect(invoked).toBe(false);
  });
  test('store and backend produce identical fingerprints for representative batches', () => {
    const initial = createFrozenAuthoredFixture();
    const store = createSemanticDocumentStore(initial);
    const backend = createLocalStoreBackend(initial, { actorId: 'actor-alice' });
    const batches = [
      humanBatch(
        [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'A' }],
        ['op-a']
      ),
      humanBatch(
        [{ kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 2 }],
        ['op-split']
      ),
      humanBatch(
        [
          {
            kind: 'setMark',
            storyId: STORY,
            blockId: 'block-para-000',
            mark: 'bold',
            start: 0,
            end: 2,
            enabled: true,
          },
        ],
        ['op-bold']
      ),
    ];
    for (const batch of batches) {
      const origin = createMutationOrigin('human', {
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
      });
      const storeResult = store.apply(batch, origin);
      expect(storeResult.status).toBe('applied');
      const staged = backend.stageLocalMutation({
        ops: batch.ops,
        constituentIds: batch.transaction.constituentIds,
        actorId: batch.transaction.actorId,
      });
      expect(staged.status).toBe('staged');
      if (staged.status !== 'staged') return;
      backend.commitStagedMutation(staged.staged, {
        actorId: batch.transaction.actorId,
        constituentIds: batch.transaction.constituentIds,
      });
      expect(fingerprintAuthoredModel(store.model)).toBe(fingerprintAuthoredModel(backend.model));
      expect(store.model.revision).toBe(backend.model.revision);
    }
  });
});
