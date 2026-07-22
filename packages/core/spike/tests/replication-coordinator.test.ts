/** @spike-features yjs-backend */
import { describe, expect, test } from 'bun:test';
import {
  compareYjsSchema,
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createReplicationCoordinator,
  createReplicationUpdateEnvelope,
  fingerprintAuthoredModel,
  isReplicationUpdate,
  type DocOpSingle,
  type ReplicationCoordinator,
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

function remoteBatch(ops: DocOpSingle[], actorId: string, constituentIds: string[]) {
  return createDocOpBatch({
    ops,
    transaction: {
      actorId,
      sessionId: `${actorId}-session`,
      groupId: `${actorId}-group`,
      constituentIds,
    },
  });
}

function expectAppliedUpdate(
  result: ReturnType<ReplicationCoordinator['applyLocal']>
): NonNullable<Extract<typeof result, { status: 'applied' }>['replicationUpdate']> {
  expect(result.status).toBe('applied');
  if (result.status !== 'applied' || !result.replicationUpdate) {
    throw new Error('expected applied replication update');
  }
  return result.replicationUpdate;
}

describe('replication coordinator — red gate (task 2.2)', () => {
  test('exports sole coordinator that owns publish and notify', () => {
    expect(typeof createReplicationCoordinator).toBe('function');
    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture());
    expect(typeof coordinator.applyLocal).toBe('function');
    expect(typeof coordinator.applyRemote).toBe('function');
    expect(typeof coordinator.subscribeModel).toBe('function');
    expect(typeof coordinator.subscribeUpdates).toBe('function');
    expect('stageLocalMutation' in coordinator).toBe(false);
  });

  test('local commit emits exactly one ModelChange and one incremental update', () => {
    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture());
    const changes: number[] = [];
    const updates: string[] = [];
    coordinator.subscribeModel((change) => changes.push(change.revisionAfter));
    coordinator.subscribeUpdates((update) => updates.push(update.updateId));
    const result = coordinator.applyLocal(
      humanBatch(
        [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'A' }],
        ['op-local-1']
      ),
      createMutationOrigin('human', {
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
      })
    );
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(changes).toEqual([1]);
    expect(updates).toHaveLength(1);
    expect(result.replicationUpdate?.updateId).toBe(updates[0]);
    expect(isReplicationUpdate(result.replicationUpdate)).toBe(true);
  });

  test('two replicas converge under opposite delivery orders', () => {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-left',
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-right',
    });
    const leftBatch = humanBatch(
      [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'L' }],
      ['op-left']
    );
    const rightBatch = remoteBatch(
      [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-001', start: 1, end: 3 }],
      'actor-bob',
      ['op-right']
    );
    const leftUpdate = expectAppliedUpdate(
      left.applyLocal(
        leftBatch,
        createMutationOrigin('human', {
          actorId: 'actor-alice',
          sessionId: 'session-alice-1',
        })
      )
    );
    const rightUpdate = expectAppliedUpdate(
      right.applyLocal(
        rightBatch,
        createMutationOrigin('human', {
          actorId: 'actor-bob',
          sessionId: 'actor-bob-session',
        })
      )
    );

    right.applyRemote(leftUpdate, createMutationOrigin('remote', { actorId: 'actor-alice', replicaId: leftUpdate.sourceReplicaId, updateId: leftUpdate.updateId }));
    left.applyRemote(rightUpdate, createMutationOrigin('remote', { actorId: 'actor-bob', replicaId: rightUpdate.sourceReplicaId, updateId: rightUpdate.updateId }));

    expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
    expect(compareYjsSchema(left.inspectYjsModel(), right.inspectYjsModel()).equal).toBe(true);
    expect(left.model.revision).toBeGreaterThan(0);
    expect(right.model.revision).toBeGreaterThan(0);
  });

  test('duplicate and at-least-once delivery are idempotent by coverage', () => {
    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture());
    const update = expectAppliedUpdate(
      coordinator.applyLocal(
        humanBatch(
          [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'X' }],
          ['op-once']
        ),
        createMutationOrigin('human', {
          actorId: 'actor-alice',
          sessionId: 'session-alice-1',
        })
      )
    );
    const before = coordinator.inspectState();
    const notifications: number[] = [];
    coordinator.subscribeModel((change) => notifications.push(change.revisionAfter));
    coordinator.applyRemote(update, createMutationOrigin('remote', { actorId: 'actor-alice', replicaId: update.sourceReplicaId, updateId: update.updateId }));
    coordinator.applyRemote(update, createMutationOrigin('remote', { actorId: 'actor-alice', replicaId: update.sourceReplicaId, updateId: update.updateId }));
    expect(coordinator.inspectState()).toEqual(before);
    expect(notifications).toEqual([]);
  });

  test('echo suppression avoids rebroadcast loops', () => {
    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'echo-replica',
    });
    const echoed: string[] = [];
    coordinator.subscribeUpdates((update) => echoed.push(update.updateId));
    const update = expectAppliedUpdate(
      coordinator.applyLocal(
        humanBatch(
          [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'E' }],
          ['op-echo']
        ),
        createMutationOrigin('human', {
          actorId: 'actor-alice',
          sessionId: 'session-alice-1',
        })
      )
    );
    expect(echoed).toEqual([update.updateId]);
    coordinator.applyRemote(update, createMutationOrigin('remote', { actorId: 'actor-alice', replicaId: update.sourceReplicaId, updateId: update.updateId }));
    expect(echoed).toEqual([update.updateId]);
  });

  test('rejects unauthorized malformed and oversize remote updates', () => {
    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      authenticateRemote: () => false,
    });
    const update = createReplicationUpdateEnvelope({
      documentId: coordinator.identity.documentId,
      backendVersion: coordinator.identity.backendVersion,
      schemaVersion: coordinator.identity.schemaVersion,
      checkpoint: 'bad',
      updateId: 'update-bad-1',
      semanticUpdateId: 'update-bad-1',
      sourceActorId: 'actor-evil',
      sourceReplicaId: 'replica-evil',
      sourceSessionId: 'replica-evil',
      sourceClientId: 1,
      constituentIds: ['op-bad'],
      coverage: 'incremental',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const before = coordinator.inspectState();
    expect(
      coordinator.applyRemote(update, createMutationOrigin('remote', { actorId: 'actor-evil', replicaId: update.sourceReplicaId, updateId: update.updateId })).status
    ).toBe('failed');
    expect(coordinator.inspectState()).toEqual(before);
  });

  test('failed prepublication leaves model revision notifications and coverage unchanged', () => {
    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture());
    const before = coordinator.inspectState();
    const notifications: number[] = [];
    coordinator.subscribeModel((change) => notifications.push(change.revisionAfter));
    const result = coordinator.applyLocal(
      humanBatch(
        [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-999', start: 0, end: 1 }],
        ['op-fail']
      ),
      createMutationOrigin('human', {
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
      })
    );
    expect(result.status).toBe('failed');
    expect(coordinator.inspectState()).toEqual(before);
    expect(notifications).toEqual([]);
  });

  test('distinct local actors receive stable noncolliding publication commit IDs', () => {
    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-multi-actor',
    });
    const alice = coordinator.applyLocal(
      humanBatch(
        [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'A' }],
        ['op-alice-commit']
      ),
      createMutationOrigin('human', {
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
      })
    );
    const bob = coordinator.applyLocal(
      remoteBatch(
        [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 1, text: 'B' }],
        'actor-bob',
        ['op-bob-commit']
      ),
      createMutationOrigin('human', {
        actorId: 'actor-bob',
        sessionId: 'actor-bob-session',
      })
    );
    expect(alice.status).toBe('applied');
    expect(bob.status).toBe('applied');
    if (alice.status !== 'applied' || bob.status !== 'applied') return;
    expect(alice.change.commitId).not.toBe(bob.change.commitId);
  });
});
