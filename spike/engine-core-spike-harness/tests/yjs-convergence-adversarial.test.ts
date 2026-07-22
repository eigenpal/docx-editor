/** @spike-features yjs-backend */
import { describe, expect, test } from 'bun:test';
import {
  compareYjsSchema,
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createReplicationCoordinator,
  createReplicationUpdateEnvelope,
  createYjsStoreBackend,
  fingerprintAuthoredModel,
  fingerprintYjsSchema,
  restoreYjsStoreBackend,
  type DocOpSingle,
  type ReplicationCoordinator,
  type ReplicationUpdateEnvelope,
} from '../src';

const STORY = 'story-body-0';

function local(
  coordinator: ReplicationCoordinator,
  actorId: string,
  constituentId: string,
  op: DocOpSingle
): ReplicationUpdateEnvelope {
  const sessionId = `${actorId}-session`;
  const result = coordinator.applyLocal(
    createDocOpBatch({
      ops: [op],
      transaction: {
        actorId,
        sessionId,
        groupId: `${actorId}-group`,
        constituentIds: [constituentId],
      },
    }),
    createMutationOrigin('human', { actorId, sessionId })
  );
  expect(result.status).toBe('applied');
  if (result.status !== 'applied' || !result.replicationUpdate) {
    throw new Error('expected local replication update');
  }
  return result.replicationUpdate;
}

function remote(
  coordinator: ReplicationCoordinator,
  update: ReplicationUpdateEnvelope,
  actorId: string
) {
  return coordinator.applyRemote(
    update,
    createMutationOrigin('remote', {
      actorId,
      replicaId: update.sourceReplicaId,
      updateId: update.updateId,
    })
  );
}

function assertReplicaParity(replicas: readonly ReplicationCoordinator[]): void {
  const first = replicas[0]!;
  for (const replica of replicas.slice(1)) {
    expect(
      fingerprintAuthoredModel({ authored: replica.model.authored, revision: 0 }),
      JSON.stringify({
        first: first.model.authored.body.paragraphs.get('para-010')?.marks,
        replica: replica.model.authored.body.paragraphs.get('para-010')?.marks,
      })
    ).toBe(
      fingerprintAuthoredModel({ authored: first.model.authored, revision: 0 })
    );
    expect(compareYjsSchema(replica.inspectYjsModel(), first.inspectYjsModel())).toEqual({
      equal: true,
      errors: [],
    });
    expect(fingerprintYjsSchema(replica.inspectYjsModel())).toBe(
      fingerprintYjsSchema(first.inspectYjsModel())
    );
    expect(replica.inspectState().coverage.constituentIds).toEqual(
      first.inspectState().coverage.constituentIds
    );
  }
}

function convergeScenario(ops: readonly DocOpSingle[]): void {
  const replicas = ['a', 'b', 'c'].map((suffix) =>
    createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: `replica-${suffix}`,
    })
  );
  const actors = ['actor-alice', 'actor-bob', 'actor-carol'];
  const originals = ops.map((op, index) =>
    local(replicas[index]!, actors[index]!, `op-${index + 1}`, op)
  );
  const repairs: ReplicationUpdateEnvelope[] = [];
  const deliveryOrders = [
    [1, 2],
    [2, 0],
    [0, 1],
  ];
  replicas.forEach((replica, replicaIndex) => {
    for (const updateIndex of deliveryOrders[replicaIndex]!) {
      const result = remote(replica, originals[updateIndex]!, actors[updateIndex]!);
      expect(['applied', 'duplicate'], JSON.stringify(result)).toContain(result.status);
      if (result.status === 'applied' && result.replicationUpdate) {
        repairs.push(result.replicationUpdate);
      }
      const duplicate = remote(replica, originals[updateIndex]!, actors[updateIndex]!);
      expect(duplicate.status).toBe('duplicate');
    }
  });
  const uniqueRepairs = new Map(repairs.map((update) => [update.updateId, update]));
  for (const repair of uniqueRepairs.values()) {
    for (const replica of replicas) {
      const result = remote(replica, repair, 'actor-repair');
      expect(
        ['applied', 'duplicate', 'noOp'],
        JSON.stringify(result)
      ).toContain(result.status);
    }
  }
  assertReplicaParity(replicas);
}

describe('Yjs convergence and repair adversarial matrix', () => {
  test('three replicas converge for concurrent same-position insertion', () => {
    convergeScenario([
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
        text: 'A',
      },
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
        text: 'B',
      },
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
        text: 'C',
      },
    ]);
  });

  test('three replicas converge for overlapping delete and insert', () => {
    convergeScenario([
      {
        kind: 'deleteRange',
        storyId: STORY,
        blockId: 'block-para-010',
        start: 1,
        end: 3,
      },
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 2,
        text: 'XY',
      },
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 3,
        text: 'Z',
      },
    ]);
  });

  test('three replicas converge for split collisions with observable candidates', () => {
    convergeScenario([
      {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
      },
      {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 2,
      },
      {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 3,
      },
    ]);
  });

  test('three replicas converge for join versus edit', () => {
    convergeScenario([
      {
        kind: 'joinParagraphs',
        storyId: STORY,
        firstBlockId: 'block-para-010',
        secondBlockId: 'block-para-011',
      },
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-011',
        offset: 1,
        text: 'B',
      },
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 2,
        text: 'C',
      },
    ]);
  });

  test('three replicas converge for overlapping marks', () => {
    convergeScenario([
      {
        kind: 'setMark',
        storyId: STORY,
        blockId: 'block-para-010',
        mark: 'bold',
        start: 0,
        end: 2,
        enabled: true,
      },
      {
        kind: 'setMark',
        storyId: STORY,
        blockId: 'block-para-010',
        mark: 'bold',
        start: 1,
        end: 4,
        enabled: true,
      },
      {
        kind: 'setMark',
        storyId: STORY,
        blockId: 'block-para-010',
        mark: 'italic',
        start: 0,
        end: 3,
        enabled: true,
      },
    ]);
  });

  test('repair and original redelivery are idempotent', () => {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-repair-left',
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-repair-right',
    });
    const leftUpdate = local(left, 'actor-alice', 'op-left-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    const rightUpdate = local(right, 'actor-bob', 'op-right-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 2,
    });
    const merged = remote(right, leftUpdate, 'actor-alice');
    expect(merged.status).toBe('applied');
    if (merged.status !== 'applied' || !merged.replicationUpdate) {
      throw new Error('expected repair update');
    }
    const repair = merged.replicationUpdate;
    const rightBeforeDuplicate = right.inspectState();
    expect(remote(right, leftUpdate, 'actor-alice').status).toBe('duplicate');
    expect(right.inspectState()).toEqual(rightBeforeDuplicate);
    expect(remote(left, rightUpdate, 'actor-bob').status).toBe('applied');
    expect(remote(left, repair, 'actor-repair').status).toBe('duplicate');
    const leftBeforeDuplicate = left.inspectState();
    expect(remote(left, repair, 'actor-repair').status).toBe('duplicate');
    expect(left.inspectState()).toEqual(leftBeforeDuplicate);
  });

  test('state-vector equality never grants constituent coverage', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-vector-sender',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-vector-receiver',
    });
    const update = local(sender, 'actor-alice', 'op-vector-original', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'V',
    });
    expect(remote(receiver, update, 'actor-alice').status).toBe('applied');
    const replay = createReplicationUpdateEnvelope({
      documentId: update.documentId,
      backendVersion: update.backendVersion,
      schemaVersion: update.schemaVersion,
      checkpoint: update.checkpoint,
      updateId: 'update-vector-replay-new-id',
      semanticUpdateId: 'update-vector-replay-new-id',
      sourceActorId: update.sourceActorId,
      sourceReplicaId: update.sourceReplicaId,
      sourceSessionId: update.sourceSessionId,
      sourceClientId: update.sourceClientId,
      constituentIds: ['op-vector-uncovered'],
      coverage: 'incremental',
      bytes: update.bytes,
    });
    const result = remote(receiver, replay, 'actor-alice');
    expect(result.status).toBe('noOp');
    expect(receiver.inspectState().coverage.constituentIds).not.toContain(
      'op-vector-uncovered'
    );
  });

  test('snapshot persists applied update IDs and rejects malformed remote bytes atomically', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-snapshot-sender',
    });
    const receiverBackend = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-snapshot-receiver',
    });
    const update = local(sender, 'actor-alice', 'op-snapshot-remote', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'S',
    });
    expect(remote(receiverBackend, update, 'actor-alice').status).toBe('applied');

    const backend = createYjsStoreBackendForSnapshot(update);
    const snapshot = backend.encodeSnapshot();
    const restored = restoreYjsStoreBackend(snapshot, {
      replicaId: 'replica-snapshot-restored',
    });
    expect(restored.inspectReplicationState().appliedUpdateIds).toContain(
      update.updateId
    );

    const malformed = createReplicationUpdateEnvelope({
      documentId: update.documentId,
      backendVersion: update.backendVersion,
      schemaVersion: update.schemaVersion,
      checkpoint: update.checkpoint,
      updateId: 'update-malformed-yjs',
      semanticUpdateId: 'update-malformed-yjs',
      sourceActorId: update.sourceActorId,
      sourceReplicaId: update.sourceReplicaId,
      sourceSessionId: update.sourceSessionId,
      sourceClientId: update.sourceClientId,
      constituentIds: ['op-malformed-yjs'],
      coverage: 'incremental',
      bytes: new Uint8Array([255, 255, 255]),
    });
    const before = backend.inspectState();
    expect(backend.stageRemoteReplicationUpdate(malformed).status).toBe('failed');
    expect(backend.inspectState()).toEqual(before);
  });

  test('remote Yjs merge remains isolated until nonthrowing publication', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-isolation-sender',
    });
    const update = local(sender, 'actor-alice', 'op-isolated-remote', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'I',
    });
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-isolation-receiver',
    });
    const beforeState = backend.inspectState();
    const beforeReplication = backend.inspectReplicationState();
    const staged = backend.stageRemoteReplicationUpdate(update);
    expect(staged.status).toBe('staged');
    expect(backend.inspectState()).toEqual(beforeState);
    expect(backend.inspectReplicationState()).toEqual(beforeReplication);
    if (staged.status !== 'staged') return;
    backend.publishRemotePublication(staged.prepared);
    expect(backend.model.revision).toBe(beforeState.revision + 1);
  });
});

function createYjsStoreBackendForSnapshot(update: ReplicationUpdateEnvelope) {
  const backend = requireYjsBackend();
  const staged = backend.stageRemoteReplicationUpdate(update);
  expect(staged.status).toBe('staged');
  if (staged.status !== 'staged') throw new Error('expected staged remote update');
  backend.publishRemotePublication(staged.prepared);
  return backend;
}

function requireYjsBackend() {
  return createYjsStoreBackend(createFrozenAuthoredFixture(), {
    replicaId: 'replica-snapshot-backend',
  });
}
