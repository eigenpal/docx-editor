/** @spike-features yjs-backend */
import { describe, expect, test } from 'bun:test';
import {
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createReplicationCoordinator,
  createReplicationUpdateEnvelope,
  createSnapshotEnvelope,
  createYjsStoreBackend,
  fingerprintAuthoredModel,
  restoreYjsStoreBackend,
  type DocOpSingle,
  type ReplicationCoordinator,
  type ReplicationUpdateEnvelope,
} from '../src';

const STORY = 'story-body-0';
const COLLIDING_CLIENT_ID = 1_679_832_501;

function local(
  coordinator: ReplicationCoordinator,
  actorId: string,
  sessionId: string,
  constituentId: string,
  op: DocOpSingle
): ReplicationUpdateEnvelope {
  const result = coordinator.applyLocal(
    createDocOpBatch({
      ops: [op],
      transaction: {
        actorId,
        sessionId,
        groupId: `${sessionId}-group`,
        constituentIds: [constituentId],
      },
    }),
    createMutationOrigin('human', { actorId, sessionId })
  );
  expect(result.status, JSON.stringify(result)).toBe('applied');
  if (result.status !== 'applied' || !result.replicationUpdate) {
    throw new TypeError('expected local replication update');
  }
  return result.replicationUpdate;
}

function remoteOrigin(update: ReplicationUpdateEnvelope) {
  const source = update as ReplicationUpdateEnvelope & {
    sourceSessionId?: string;
  };
  return createMutationOrigin(
    'remote',
    {
      actorId: update.sourceActorId,
      replicaId: update.sourceReplicaId,
      sessionId: source.sourceSessionId ?? `${update.sourceReplicaId}-session`,
      updateId: update.updateId,
    } as never
  );
}

function contentFingerprint(coordinator: ReplicationCoordinator): string {
  return fingerprintAuthoredModel({
    authored: coordinator.model.authored,
    revision: 0,
  });
}

describe('third Yjs protocol review regressions', () => {
  test('known deterministic hash-collision replica names receive independent random clients', () => {
    const first = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-hash-12470',
    });
    const second = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-hash-87223',
    });
    const firstClient = (first as ReplicationCoordinator & {
      inspectReplicationState(): { clientId: number };
    }).inspectReplicationState().clientId;
    const secondClient = (second as ReplicationCoordinator & {
      inspectReplicationState(): { clientId: number };
    }).inspectReplicationState().clientId;
    expect(firstClient).not.toBe(secondClient);
    expect(firstClient).toBeGreaterThan(0);
    expect(secondClient).toBeGreaterThan(0);
  });

  test('detects explicit client ownership collision and reseeds without semantic loss', () => {
    const first = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-hash-12470',
      sessionId: 'session-collision-first',
      clientId: COLLIDING_CLIENT_ID,
    } as never);
    const second = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-hash-87223',
      sessionId: 'session-collision-second',
      clientId: COLLIDING_CLIENT_ID,
    } as never);
    const firstUpdate = local(
      first,
      'actor-shared',
      'session-collision-first',
      'op-collision-first',
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 0,
        text: 'A',
      }
    );
    const secondUpdate = local(
      second,
      'actor-shared',
      'session-collision-second',
      'op-collision-second',
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
        text: 'B',
      }
    );
    expect(
      (firstUpdate as ReplicationUpdateEnvelope & { sourceClientId?: number })
        .sourceClientId
    ).toBe(COLLIDING_CLIENT_ID);

    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-collision-receiver',
    });
    expect(receiver.applyRemote(firstUpdate, remoteOrigin(firstUpdate)).status).toBe(
      'applied'
    );
    const beforeCollision = receiver.inspectState();
    const collision = receiver.applyRemote(secondUpdate, remoteOrigin(secondUpdate));
    expect(collision.status).toBe('clientCollision');
    expect(receiver.inspectState()).toEqual(beforeCollision);

    const reseeded = second.reseedLocalUpdate(secondUpdate.updateId, {
      clientId: COLLIDING_CLIENT_ID + 1,
      sessionId: 'session-collision-second-reseed',
    });
    expect(reseeded.status).toBe('reseeded');
    if (reseeded.status !== 'reseeded') return;
    expect(reseeded.update.constituentIds).toEqual(secondUpdate.constituentIds);
    expect(reseeded.update.updateId).not.toBe(secondUpdate.updateId);
    expect(
      (reseeded.update as ReplicationUpdateEnvelope & { semanticUpdateId?: string })
        .semanticUpdateId
    ).toBe(secondUpdate.updateId);
    expect(receiver.applyRemote(reseeded.update, remoteOrigin(reseeded.update)).status).toBe(
      'applied'
    );
    const text =
      receiver.model.authored.body.paragraphs.get('para-010')?.text ?? '';
    expect(text).toContain('A');
    expect(text).toContain('B');
    expect(text.match(/A/g)?.length).toBe(1);
    expect(text.match(/B/g)?.length).toBe(1);
    expect(receiver.applyRemote(reseeded.update, remoteOrigin(reseeded.update)).status).toBe(
      'duplicate'
    );
  });

  test('same actor concurrent sessions produce distinct stable commit provenance', () => {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-commit-left',
      sessionId: 'session-commit-left',
      clientId: 2_000_000_001,
    } as never);
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-commit-right',
      sessionId: 'session-commit-right',
      clientId: 2_000_000_002,
    } as never);
    const leftUpdate = local(
      left,
      'actor-shared',
      'session-commit-left',
      'op-commit-left',
      {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 2,
      }
    );
    const rightUpdate = local(
      right,
      'actor-shared',
      'session-commit-right',
      'op-commit-right',
      {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 2,
      }
    );
    expect(leftUpdate.sourceActorId).toBe(rightUpdate.sourceActorId);
    expect(leftUpdate.sourceReplicaId).not.toBe(rightUpdate.sourceReplicaId);
    const leftCommit = left.inspectState().coverage.commitIds.at(-1);
    const rightCommit = right.inspectState().coverage.commitIds.at(-1);
    expect(leftCommit).toBeDefined();
    expect(rightCommit).toBeDefined();
    expect(leftCommit).not.toBe(rightCommit);
    expect(leftUpdate.updateId).not.toBe(rightUpdate.updateId);
  });

  test('causal resolution attributes every newly visible buffered update', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-attribution-sender',
      sessionId: 'session-attribution',
      clientId: 2_100_000_001,
    } as never);
    const update1 = local(
      sender,
      'actor-attribution',
      'session-attribution',
      'op-attribution-1',
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 0,
        text: 'A',
      }
    );
    const update2 = local(
      sender,
      'actor-attribution',
      'session-attribution',
      'op-attribution-2',
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
        text: 'B',
      }
    );
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-attribution-receiver',
    });
    const buffered = receiver.applyRemote(update2, remoteOrigin(update2));
    expect(buffered.status, JSON.stringify(buffered)).toBe('buffered');
    const resolved = receiver.applyRemote(update1, remoteOrigin(update1));
    expect(resolved.status).toBe('applied');
    if (resolved.status !== 'applied') return;
    expect(resolved.change.constituentIds).toEqual([
      'op-attribution-1',
      'op-attribution-2',
    ]);
    expect(
      (
        resolved.change as typeof resolved.change & {
          causalUpdateIds?: readonly string[];
        }
      ).causalUpdateIds
    ).toEqual([update1.updateId, update2.updateId].sort());
    expect(receiver.inspectState().coverage.constituentIds).toEqual(
      expect.arrayContaining(['op-attribution-1', 'op-attribution-2'])
    );
  });

  test('bounded per-source pending quota rejects floods without mutation', () => {
    const maxPerSource = 8;
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-flood-sender',
      sessionId: 'session-flood',
      clientId: 2_200_000_001,
    } as never);
    const updates: ReplicationUpdateEnvelope[] = [];
    for (let index = 0; index <= maxPerSource; index += 1) {
      updates.push(
        local(
          sender,
          'actor-flood',
          'session-flood',
          `op-flood-${index}`,
          {
            kind: 'insertText',
            storyId: STORY,
            blockId: 'block-para-010',
            offset: index,
            text: String(index % 10),
          }
        )
      );
    }
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-flood-receiver',
    });
    for (const update of updates.slice(1, maxPerSource + 1).reverse()) {
      const buffered = receiver.applyRemote(update, remoteOrigin(update));
      expect(buffered.status, JSON.stringify(buffered)).toBe('buffered');
    }
    const before = receiver.inspectState();
    const rejected = receiver.applyRemote(
      updates[maxPerSource + 0]!,
      remoteOrigin(updates[maxPerSource + 0]!)
    );
    expect(rejected.status).toBe('duplicate');

    const source = updates[maxPerSource]! as ReplicationUpdateEnvelope & {
      sourceClientId?: number;
      sourceSessionId?: string;
      semanticUpdateId?: string;
    };
    const forged = createReplicationUpdateEnvelope({
      documentId: source.documentId,
      backendVersion: source.backendVersion,
      schemaVersion: source.schemaVersion,
      checkpoint: source.checkpoint,
      updateId: 'update-flood-extra-attempt',
      semanticUpdateId: 'update-flood-extra-semantic',
      sourceActorId: source.sourceActorId,
      sourceReplicaId: source.sourceReplicaId,
      sourceSessionId: source.sourceSessionId,
      sourceClientId: source.sourceClientId,
      constituentIds: ['op-flood-extra'],
      coverage: 'incremental',
      bytes: source.bytes,
    } as never);
    const flooded = receiver.applyRemote(forged, remoteOrigin(forged));
    expect(flooded.status).toBe('failed');
    if (flooded.status === 'failed') expect(flooded.code).toBe('pending-quota');
    expect(receiver.inspectState()).toEqual(before);
  });

  test('persists client ownership and rejects tampered pending limits', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-snapshot-owner',
      sessionId: 'session-snapshot-owner',
      clientId: 2_300_000_001,
    });
    const first = local(
      sender,
      'actor-snapshot-owner',
      'session-snapshot-owner',
      'op-snapshot-owner-1',
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 0,
        text: 'A',
      }
    );
    const second = local(
      sender,
      'actor-snapshot-owner',
      'session-snapshot-owner',
      'op-snapshot-owner-2',
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
        text: 'B',
      }
    );
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-snapshot-owner-receiver',
      sessionId: 'session-snapshot-owner-receiver',
      clientId: 2_300_000_002,
    });
    const buffered = backend.stageRemoteReplicationUpdate(second);
    expect(buffered.status).toBe('buffered');
    if (buffered.status !== 'buffered') return;
    backend.publishBufferedRemote(buffered.prepared);
    const snapshot = backend.encodeSnapshot();
    const restored = restoreYjsStoreBackend(snapshot);
    expect(restored.identity.clientId).toBe(backend.identity.clientId);

    const collider = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-snapshot-owner-collider',
      sessionId: 'session-snapshot-owner-collider',
      clientId: first.sourceClientId,
    });
    const collisionUpdate = local(
      collider,
      'actor-snapshot-owner',
      'session-snapshot-owner-collider',
      'op-snapshot-owner-collider',
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 0,
        text: 'C',
      }
    );
    expect(restored.stageRemoteReplicationUpdate(collisionUpdate).status).toBe(
      'clientCollision'
    );

    const payload = JSON.parse(new TextDecoder().decode(snapshot.bytes)) as {
      pendingLimits: { maxCount: number };
    };
    payload.pendingLimits.maxCount += 1;
    const tampered = createSnapshotEnvelope({
      documentId: snapshot.documentId,
      backendVersion: snapshot.backendVersion,
      schemaVersion: snapshot.schemaVersion,
      normalizationVersion: snapshot.normalizationVersion,
      checkpoint: snapshot.checkpoint,
      bytes: new TextEncoder().encode(JSON.stringify(payload)),
    });
    expect(() => restoreYjsStoreBackend(tampered)).toThrow(
      'snapshot pending limits mismatch'
    );
  });

  test('enforces aggregate pending bytes independently across sources', () => {
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-byte-quota-receiver',
    });
    const large = 'X'.repeat(70_000);
    let rejected:
      | ReturnType<ReplicationCoordinator['applyRemote']>
      | undefined;
    for (let index = 0; index < 8; index += 1) {
      const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-byte-quota-${index}`,
        sessionId: `session-byte-quota-${index}`,
        clientId: 2_400_000_000 + index,
      });
      local(
        sender,
        'actor-byte-quota',
        `session-byte-quota-${index}`,
        `op-byte-quota-base-${index}`,
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 0,
          text: 'A',
        }
      );
      const pending = local(
        sender,
        'actor-byte-quota',
        `session-byte-quota-${index}`,
        `op-byte-quota-pending-${index}`,
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 1,
          text: large,
        }
      );
      rejected = receiver.applyRemote(pending, remoteOrigin(pending));
      if (rejected.status === 'failed') break;
      expect(rejected.status).toBe('buffered');
    }
    expect(rejected?.status).toBe('failed');
    if (rejected?.status === 'failed') {
      expect(rejected.code).toBe('pending-quota');
      expect(rejected.reason).toContain('aggregate');
    }
  });

  test('enforces global pending count across independent sources', () => {
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-global-quota-receiver',
    });
    for (let index = 0; index < 33; index += 1) {
      const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-global-quota-${index}`,
        sessionId: `session-global-quota-${index}`,
        clientId: 2_500_000_000 + index,
      });
      local(
        sender,
        'actor-global-quota',
        `session-global-quota-${index}`,
        `op-global-quota-base-${index}`,
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 0,
          text: 'A',
        }
      );
      const pending = local(
        sender,
        'actor-global-quota',
        `session-global-quota-${index}`,
        `op-global-quota-pending-${index}`,
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 1,
          text: 'B',
        }
      );
      const result = receiver.applyRemote(pending, remoteOrigin(pending));
      if (index < 32) {
        expect(result.status).toBe('buffered');
      } else {
        expect(result.status).toBe('failed');
        if (result.status === 'failed') {
          expect(result.code).toBe('pending-quota');
          expect(result.reason).toContain('count');
        }
      }
    }
  });
});
