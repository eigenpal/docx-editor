/** @spike-features yjs-backend */
import { describe, expect, test } from 'bun:test';
import {
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createReplicationCoordinator,
  createSnapshotEnvelope,
  createYjsStoreBackend,
  restoreYjsStoreBackend,
  type DocOpSingle,
  type ReplicationCoordinator,
  type ReplicationUpdateEnvelope,
  type YjsStoreBackend,
} from '../src';

const STORY = 'story-body-0';
const COLLIDING_CLIENT = 1_679_832_501;

function local(
  coordinator: ReplicationCoordinator,
  actorId: string,
  constituentId: string,
  op: DocOpSingle
): ReplicationUpdateEnvelope {
  const result = coordinator.applyLocal(
    createDocOpBatch({
      ops: [op],
      transaction: {
        actorId,
        sessionId: `session-${actorId}`,
        groupId: `group-${actorId}`,
        constituentIds: [constituentId],
      },
    }),
    createMutationOrigin('human', {
      actorId,
      sessionId: `session-${actorId}`,
    })
  );
  expect(result.status, JSON.stringify(result)).toBe('applied');
  if (result.status !== 'applied' || !result.replicationUpdate) throw new Error();
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

function backendLocal(
  backend: YjsStoreBackend,
  index: number
): ReplicationUpdateEnvelope {
  const constituentId = `op-fifth-retained-${index}`;
  const staged = backend.stageLocalMutation({
    actorId: 'actor-retained',
    ops: [{
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: index,
      text: 'T',
    }],
    constituentIds: [constituentId],
  });
  expect(staged.status).toBe('staged');
  if (staged.status !== 'staged') throw new Error();
  const prepared = backend.prepareLocalPublication(staged.staged, {
    actorId: 'actor-retained',
    constituentIds: [constituentId],
  });
  backend.publishLocalPublication(prepared);
  return prepared.update;
}

describe('fifth Yjs protocol review regressions', () => {
  test('reseed replays local remote local event history without content loss', () => {
    const accepted = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-accepted',
      clientId: COLLIDING_CLIENT,
    });
    const retrying = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-retrying',
      clientId: COLLIDING_CLIENT,
    });
    const remoteSource = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-remote',
      clientId: COLLIDING_CLIENT + 100,
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-receiver',
    });
    const acceptedUpdate = local(accepted, 'actor-accepted', 'op-fifth-x', {
      kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'X',
    });
    const a = local(retrying, 'actor-retrying', 'op-fifth-a', {
      kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'A',
    });
    const r = local(remoteSource, 'actor-remote', 'op-fifth-r', {
      kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'R',
    });
    expect(remote(retrying, r).status).toBe('applied');
    const b = local(retrying, 'actor-retrying', 'op-fifth-b', {
      kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 1, text: 'B',
    });
    expect(remote(receiver, acceptedUpdate).status).toBe('applied');
    expect(remote(receiver, r).status).toBe('applied');
    expect(remote(receiver, b).status).toBe('clientCollision');
    const replay = retrying.reseedLocalUpdate(b.updateId, {
      clientId: COLLIDING_CLIENT + 1,
      sessionId: 'session-fifth-reseed',
    });
    expect(replay.status).toBe('reseeded');
    if (replay.status !== 'reseeded') return;
    expect(replay.updates.map((update) => update.semanticUpdateId)).toEqual([
      a.semanticUpdateId,
      b.semanticUpdateId,
    ]);
    for (const update of replay.updates) {
      const result = remote(receiver, update);
      expect(result.status, JSON.stringify(result)).toBe('applied');
    }
    const text = receiver.model.authored.body.paragraphs.get('para-010')?.text ?? '';
    for (const value of ['X', 'A', 'R', 'B']) expect(text).toContain(value);
  });

  test('pending delete update buffers before insert and resolves after prerequisite', () => {
    const inserter = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-inserter',
    });
    const deleter = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-deleter',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-delete-receiver',
    });
    const insert = local(inserter, 'actor-insert', 'op-fifth-insert', {
      kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'Z',
    });
    const insertedAtDeleter = remote(deleter, insert);
    expect(insertedAtDeleter.status).toBe('applied');
    const prerequisiteRepair =
      insertedAtDeleter.status === 'applied'
        ? insertedAtDeleter.replicationUpdate
        : undefined;
    const deletion = local(deleter, 'actor-delete', 'op-fifth-delete', {
      kind: 'deleteRange', storyId: STORY, blockId: 'block-para-010', start: 0, end: 1,
    });
    const bufferedDelete = remote(receiver, deletion);
    expect(bufferedDelete.status, JSON.stringify(bufferedDelete)).toBe('buffered');
    const resolved = remote(receiver, insert);
    expect(['applied', 'buffered']).toContain(resolved.status);
    if (prerequisiteRepair) {
      const repaired = remote(receiver, prerequisiteRepair);
      expect(['applied', 'duplicate']).toContain(repaired.status);
    }
    expect(receiver.model.authored.body.paragraphs.get('para-010')?.text).toBe('p010');

    const ordered = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-delete-ordered',
    });
    expect(remote(ordered, insert).status).toBe('applied');
    if (prerequisiteRepair) {
      expect(['applied', 'duplicate']).toContain(
        remote(ordered, prerequisiteRepair).status
      );
    }
    const orderedDelete = remote(ordered, deletion);
    expect(orderedDelete.status, JSON.stringify(orderedDelete)).toBe('applied');
    expect(ordered.model.authored.body.paragraphs.get('para-010')?.text).toBe('p010');
  });

  test('concurrent structural split repair conserves source text exactly once', () => {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-split-left',
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-split-right',
    });
    const leftSplit = local(left, 'actor-split', 'op-fifth-split-left', {
      kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 1,
    });
    const rightSplit = local(right, 'actor-split', 'op-fifth-split-right', {
      kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 3,
    });
    const mergedLeft = remote(left, rightSplit);
    expect(mergedLeft.status, JSON.stringify(mergedLeft)).toBe('applied');
    expect(remote(right, leftSplit).status).toBe('applied');
    for (const replica of [left, right]) {
      const activeText = replica.model.authored.body.paragraphOrder
        .map((id) => replica.model.authored.body.paragraphs.get(id)!)
        .filter((paragraph) =>
          paragraph.blockId === 'block-para-010' ||
          paragraph.paragraphId.startsWith('para-010')
        )
        .map((paragraph) => paragraph.text)
        .join('');
      expect(
        activeText,
        JSON.stringify(
          replica.model.authored.body.paragraphOrder
            .map((id) => replica.model.authored.body.paragraphs.get(id)!)
            .filter((paragraph) => paragraph.paragraphId.startsWith('para-010'))
        )
      ).toBe('p010');
      expect(activeText.match(/p010/g)?.length ?? 0).toBe(1);
      expect(replica.inspectYjsModel().collisionCandidates.length).toBeGreaterThan(0);
    }
  });

  test('expired collision history requires a trusted snapshot and safe receiver resync', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-resync-sender',
      clientId: 2_910_000_001,
    });
    const updates: ReplicationUpdateEnvelope[] = [];
    for (let index = 0; index < 10; index += 1) {
      updates.push(local(sender, 'actor-resync', `op-fifth-resync-${index}`, {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: index,
        text: 'S',
      }));
    }
    const recovery = sender.reseedLocalUpdate(updates[0]!.semanticUpdateId, {
      clientId: 2_910_000_002,
      sessionId: 'session-fifth-resync',
    });
    expect(recovery.status).toBe('fullSnapshotResyncRequired');
    if (recovery.status !== 'fullSnapshotResyncRequired') return;
    expect(recovery.snapshot.coverage).toBe('full');
    expect(recovery.precondition.stateVector.length).toBeGreaterThan(0);

    const unauthorized = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-resync-unauthorized',
    });
    const unauthorizedBefore = unauthorized.inspectState();
    expect(unauthorized.applySnapshotResync(recovery).status).toBe('unauthorized');
    expect(unauthorized.inspectState()).toEqual(unauthorizedBefore);

    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-resync-receiver',
      authorizeSnapshotResync: () => true,
    });
    for (const update of updates) {
      if (
        receiver.inspectState().canonicalFingerprint ===
          recovery.precondition.canonicalFingerprint &&
        Buffer.from(receiver.inspectReplicationState().stateVector).equals(
          Buffer.from(recovery.precondition.stateVector)
        )
      ) {
        break;
      }
      expect(remote(receiver, update).status).toBe('applied');
    }
    const applied = receiver.applySnapshotResync(recovery);
    expect(applied.status, JSON.stringify(applied)).toBe('applied');
    expect(receiver.model.authored.body.paragraphs.get('para-010')?.text).toBe(
      sender.model.authored.body.paragraphs.get('para-010')?.text
    );
  });

  test('retained session entries replay after old-session eviction', () => {
    const oldSession = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-retained',
      sessionId: 'session-fifth-retained-old',
      clientId: 2_930_000_001,
    });
    backendLocal(oldSession, 0);
    backendLocal(oldSession, 1);
    const currentSession = restoreYjsStoreBackend(oldSession.encodeSnapshot(), {
      replicaId: 'replica-fifth-retained',
      sessionId: 'session-fifth-retained-current',
      clientId: 2_930_000_002,
    });
    const retained = Array.from({ length: 8 }, (_, index) =>
      backendLocal(currentSession, index + 2)
    );
    const replay = currentSession.reseedLocalUpdate(
      retained.at(-1)!.semanticUpdateId,
      {
        clientId: 2_930_000_003,
        sessionId: 'session-fifth-retained-reseed',
      }
    );
    expect(replay.status, JSON.stringify(replay)).toBe('reseeded');
    if (replay.status !== 'reseeded') return;
    expect(replay.updates.map((update) => update.semanticUpdateId)).toEqual(
      retained.map((update) => update.semanticUpdateId)
    );
  });

  test('snapshot persists and validates compacted recovery metadata', () => {
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-checkpoint-snapshot',
      clientId: 2_940_000_001,
    });
    const updates = Array.from({ length: 10 }, (_, index) =>
      backendLocal(backend, index)
    );
    const snapshot = backend.encodeSnapshot();
    const restored = restoreYjsStoreBackend(snapshot);
    const recovery = restored.reseedLocalUpdate(updates[0]!.semanticUpdateId, {
      clientId: 2_940_000_002,
      sessionId: 'session-fifth-checkpoint-restored',
    });
    expect(recovery.status).toBe('fullSnapshotResyncRequired');

    const payload = JSON.parse(new TextDecoder().decode(snapshot.bytes));
    payload.reseedCheckpoint.stateVectorHex = '00';
    const tampered = createSnapshotEnvelope({
      documentId: snapshot.documentId,
      backendVersion: snapshot.backendVersion,
      schemaVersion: snapshot.schemaVersion,
      normalizationVersion: snapshot.normalizationVersion,
      checkpoint: snapshot.checkpoint,
      bytes: new TextEncoder().encode(JSON.stringify(payload)),
    });
    expect(() => restoreYjsStoreBackend(tampered)).toThrow(
      'snapshot reseed checkpoint state vector mismatch'
    );
  });

  test('snapshot resync refuses receiver-only divergence atomically', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-conflict-sender',
      clientId: 2_920_000_001,
    });
    const updates = Array.from({ length: 10 }, (_, index) =>
      local(sender, 'actor-conflict', `op-fifth-conflict-${index}`, {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: index,
        text: 'C',
      })
    );
    const recovery = sender.reseedLocalUpdate(updates[0]!.semanticUpdateId, {
      clientId: 2_920_000_002,
      sessionId: 'session-fifth-conflict',
    });
    expect(recovery.status).toBe('fullSnapshotResyncRequired');
    if (recovery.status !== 'fullSnapshotResyncRequired') return;
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-fifth-conflict-receiver',
      authorizeSnapshotResync: () => true,
    });
    local(receiver, 'actor-receiver-only', 'op-fifth-receiver-only', {
      kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'D',
    });
    const before = receiver.inspectState();
    expect(receiver.applySnapshotResync(recovery)).toEqual({
      status: 'conflict',
      code: 'receiver-diverged',
      manualResolutionRequired: true,
    });
    expect(receiver.inspectState()).toEqual(before);
  });
});
