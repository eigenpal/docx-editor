/** @spike-features yjs-backend */
import { describe, expect, test } from 'bun:test';
import {
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createReplicationCoordinator,
  createYjsStoreBackend,
  restoreYjsStoreBackend,
  type DocOpSingle,
  type ReplicationCoordinator,
  type ReplicationUpdateEnvelope,
} from '../src';

const STORY = 'story-body-0';
const COLLIDING_CLIENT = 1_679_832_501;

function local(
  coordinator: ReplicationCoordinator,
  constituentId: string,
  op: DocOpSingle
): ReplicationUpdateEnvelope {
  const result = coordinator.applyLocal(
    createDocOpBatch({
      ops: [op],
      transaction: {
        actorId: 'actor-fourth',
        sessionId: 'session-fourth-operation',
        groupId: 'group-fourth',
        constituentIds: [constituentId],
      },
    }),
    createMutationOrigin('human', {
      actorId: 'actor-fourth',
      sessionId: 'session-fourth-operation',
    })
  );
  expect(result.status, JSON.stringify(result)).toBe('applied');
  if (result.status !== 'applied' || !result.replicationUpdate) {
    throw new TypeError('expected local update');
  }
  return result.replicationUpdate;
}

function remote(coordinator: ReplicationCoordinator, update: ReplicationUpdateEnvelope) {
  return coordinator.applyRemote(
    update,
    createMutationOrigin('remote', {
      actorId: update.sourceActorId,
      replicaId: update.sourceReplicaId,
      sessionId: update.sourceSessionId,
      updateId: update.updateId,
    })
  );
}

describe('fourth Yjs protocol review regressions', () => {
  test('delayed reseed replays causal predecessors without losing later edits', () => {
    const accepted = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-hash-12470',
      sessionId: 'session-fourth-accepted',
      clientId: COLLIDING_CLIENT,
    });
    const retrying = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-hash-87223',
      sessionId: 'session-fourth-retrying',
      clientId: COLLIDING_CLIENT,
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fourth-receiver',
    });
    const acceptedUpdate = local(accepted, 'op-fourth-accepted', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'A',
    });
    const first = local(retrying, 'op-fourth-first', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'B',
    });
    const second = local(retrying, 'op-fourth-second', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
      text: 'C',
    });
    const later = local(retrying, 'op-fourth-later', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 2,
      text: 'D',
    });
    const senderBefore = retrying.model.authored.body.paragraphs.get('para-010')?.text;

    expect(remote(receiver, acceptedUpdate).status).toBe('applied');
    expect(remote(receiver, second).status).toBe('clientCollision');
    const reseeded = retrying.reseedLocalUpdate(second.updateId, {
      clientId: COLLIDING_CLIENT + 1,
      sessionId: 'session-fourth-reseeded',
    });
    expect(reseeded.status).toBe('reseeded');
    if (reseeded.status !== 'reseeded') return;
    const retryUpdates = (
      reseeded as typeof reseeded & {
        updates: readonly ReplicationUpdateEnvelope[];
      }
    ).updates;
    expect(retryUpdates?.map((update) => update.semanticUpdateId)).toEqual([
      first.semanticUpdateId,
      second.semanticUpdateId,
    ]);
    expect(retrying.model.authored.body.paragraphs.get('para-010')?.text).toBe(
      senderBefore
    );
    const firstRetryResult = remote(receiver, retryUpdates[0]!);
    expect(firstRetryResult.status, JSON.stringify(firstRetryResult)).toBe('applied');
    expect(remote(receiver, retryUpdates[1]!).status).toBe('applied');
    expect(remote(receiver, retryUpdates[0]!).status).toBe('duplicate');
    expect(remote(receiver, first).status).toBe('duplicate');
    expect(remote(receiver, second).status).toBe('duplicate');

    const laterRetry = retrying.reseedLocalUpdate(later.semanticUpdateId, {
      clientId: COLLIDING_CLIENT + 2,
      sessionId: 'session-fourth-reseeded-again',
    });
    expect(laterRetry.status).toBe('reseeded');
    if (laterRetry.status !== 'reseeded') return;
    const laterUpdates = (
      laterRetry as typeof laterRetry & {
        updates: readonly ReplicationUpdateEnvelope[];
      }
    ).updates;
    for (const update of laterUpdates) remote(receiver, update);
    const text = receiver.model.authored.body.paragraphs.get('para-010')?.text ?? '';
    expect(text).toContain('A');
    expect(text).toContain('B');
    expect(text).toContain('C');
    expect(text).toContain('D');
  });

  test('structural replay remints creation IDs and preserves collision candidates', () => {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fourth-split-left',
      sessionId: 'session-fourth-split-left',
      clientId: COLLIDING_CLIENT,
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fourth-split-right',
      sessionId: 'session-fourth-split-right',
      clientId: COLLIDING_CLIENT,
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fourth-split-receiver',
    });
    const leftSplit = local(left, 'op-fourth-split-left', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 2,
    });
    const rightSplit = local(right, 'op-fourth-split-right', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 3,
    });
    const beforeCreationIds = new Set(
      right
        .inspectYjsModel()
        .blocks.filter((block) => block.actorId === 'actor-fourth')
        .map((block) => block.creationId)
    );
    expect(remote(receiver, leftSplit).status).toBe('applied');
    expect(remote(receiver, rightSplit).status).toBe('clientCollision');
    const replay = right.reseedLocalUpdate(rightSplit.updateId, {
      clientId: COLLIDING_CLIENT + 10,
      sessionId: 'session-fourth-split-reseed',
    });
    expect(replay.status).toBe('reseeded');
    if (replay.status !== 'reseeded') return;
    const afterCreationIds = right
      .inspectYjsModel()
      .blocks.filter((block) => block.actorId === 'actor-fourth')
      .map((block) => block.creationId);
    expect(afterCreationIds.some((id) => !beforeCreationIds.has(id))).toBe(true);
    expect(remote(receiver, replay.update).status).toBe('applied');
    const repaired = receiver.inspectYjsModel();
    expect(
      repaired.collisionCandidates.length + repaired.tombstones.length
    ).toBeGreaterThan(1);
  });

  test('expired journal retry is typed and leaves state unchanged', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fourth-expiry',
      sessionId: 'session-fourth-expiry',
      clientId: 2_600_000_001,
    });
    const updates: ReplicationUpdateEnvelope[] = [];
    for (let index = 0; index < 10; index += 1) {
      updates.push(
        local(sender, `op-fourth-expiry-${index}`, {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: index,
          text: 'E',
        })
      );
    }
    const before = sender.inspectState();
    const expired = sender.reseedLocalUpdate(updates[0]!.semanticUpdateId, {
      clientId: 2_600_000_002,
      sessionId: 'session-fourth-expiry-reseed',
    });
    expect(expired.status).toBe('fullSnapshotResyncRequired');
    expect(sender.inspectState()).toEqual(before);
  });

  test('snapshot restores retained semantic publication journal', () => {
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      actorId: 'actor-fourth',
      replicaId: 'replica-fourth-journal-snapshot',
      sessionId: 'session-fourth-journal-snapshot',
      clientId: 2_650_000_001,
    });
    const updates: ReplicationUpdateEnvelope[] = [];
    for (let index = 0; index < 2; index += 1) {
      const staged = backend.stageLocalMutation({
        actorId: 'actor-fourth',
        ops: [
          {
            kind: 'insertText',
            storyId: STORY,
            blockId: 'block-para-010',
            offset: index,
            text: String(index),
          },
        ],
        constituentIds: [`op-fourth-journal-snapshot-${index}`],
      });
      expect(staged.status).toBe('staged');
      if (staged.status !== 'staged') return;
      const prepared = backend.prepareLocalPublication(staged.staged, {
        actorId: 'actor-fourth',
        constituentIds: [`op-fourth-journal-snapshot-${index}`],
      });
      backend.publishLocalPublication(prepared);
      updates.push(prepared.update);
    }
    const restored = restoreYjsStoreBackend(backend.encodeSnapshot());
    const replay = restored.reseedLocalUpdate(updates[1]!.semanticUpdateId, {
      clientId: 2_650_000_002,
      sessionId: 'session-fourth-journal-snapshot-reseed',
    });
    expect(replay.status).toBe('reseeded');
    if (replay.status !== 'reseeded') return;
    expect(replay.updates.map((update) => update.semanticUpdateId)).toEqual(
      updates.map((update) => update.semanticUpdateId)
    );
  });

  test('resolves one causal chain while unrelated pending chain remains snapshotable', () => {
    const sourceA = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fourth-chain-a',
      clientId: 2_700_000_001,
    });
    const sourceB = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fourth-chain-b',
      clientId: 2_700_000_002,
    });
    const a1 = local(sourceA, 'op-fourth-a1', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'A',
    });
    const a2 = local(sourceA, 'op-fourth-a2', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
      text: 'a',
    });
    const b1 = local(sourceB, 'op-fourth-b1', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'B',
    });
    const b2 = local(sourceB, 'op-fourth-b2', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
      text: 'b',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fourth-chain-receiver',
    });
    expect(remote(receiver, a2).status).toBe('buffered');
    expect(remote(receiver, b2).status).toBe('buffered');
    const resolvedA = remote(receiver, a1);
    expect(resolvedA.status, JSON.stringify(resolvedA)).toBe('applied');
    if (resolvedA.status !== 'applied') return;
    expect(resolvedA.change.causalUpdateIds).toEqual(
      [a1.updateId, a2.updateId].sort()
    );
    expect(receiver.inspectReplicationState().bufferedUpdateIds).toEqual([
      b2.updateId,
    ]);

    const backend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fourth-chain-backend',
    });
    for (const update of [a2, b2, a1]) {
      const staged = backend.stageRemoteReplicationUpdate(update);
      if (staged.status === 'buffered') backend.publishBufferedRemote(staged.prepared);
      else if (staged.status === 'staged') backend.publishRemotePublication(staged.prepared);
      else throw new TypeError(`unexpected stage ${staged.status}`);
    }
    const restored = restoreYjsStoreBackend(backend.encodeSnapshot());
    expect(restored.inspectReplicationState().bufferedUpdateIds).toEqual([
      b2.updateId,
    ]);
    const resolveB = restored.stageRemoteReplicationUpdate(b1);
    expect(resolveB.status).toBe('staged');
    if (resolveB.status !== 'staged') return;
    expect(resolveB.prepared.causalUpdateIds).toEqual(
      [b1.updateId, b2.updateId].sort()
    );
    restored.publishRemotePublication(resolveB.prepared);
    expect(restored.inspectReplicationState().bufferedUpdateIds).toEqual([]);
  });
});
