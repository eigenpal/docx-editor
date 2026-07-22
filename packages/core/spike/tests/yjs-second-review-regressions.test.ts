/** @spike-features yjs-backend */
import { describe, expect, test } from 'bun:test';
import {
  compareYjsSchema,
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createReplicationCoordinator,
  createYjsStoreBackend,
  fingerprintAuthoredModel,
  restoreYjsStoreBackend,
  type DocOpSingle,
  type ReplicationCoordinator,
  type ReplicationUpdateEnvelope,
} from '../src';

const STORY = 'story-body-0';

function applyLocal(
  coordinator: ReplicationCoordinator,
  replicaId: string,
  actorId: string,
  constituentId: string,
  op: DocOpSingle
): ReplicationUpdateEnvelope {
  const sessionId = `${replicaId}-session`;
  const result = coordinator.applyLocal(
    createDocOpBatch({
      ops: [op],
      transaction: {
        actorId,
        sessionId,
        groupId: `${replicaId}-group`,
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

function remoteOrigin(update: ReplicationUpdateEnvelope, overrides: {
  actorId?: string;
  replicaId?: string;
  updateId?: string;
} = {}) {
  const metadata = update as ReplicationUpdateEnvelope & {
    sourceActorId?: string;
    sourceReplicaId?: string;
  };
  return createMutationOrigin(
    'remote',
    {
      actorId: overrides.actorId ?? metadata.sourceActorId ?? 'actor-alice',
      replicaId:
        overrides.replicaId ?? metadata.sourceReplicaId ?? 'replica-causal-sender',
      updateId: overrides.updateId ?? update.updateId,
    } as never
  );
}

function contentFingerprint(coordinator: ReplicationCoordinator): string {
  return fingerprintAuthoredModel({
    authored: coordinator.model.authored,
    revision: 0,
  });
}

describe('second Yjs review regressions', () => {
  test('buffers update2 pending structs then resolves exactly once when update1 arrives', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-causal-sender',
    });
    const update1 = applyLocal(
      sender,
      'replica-causal-sender',
      'actor-alice',
      'op-causal-1',
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 0,
        text: 'A',
      }
    );
    const update2 = applyLocal(
      sender,
      'replica-causal-sender',
      'actor-alice',
      'op-causal-2',
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
        text: 'B',
      }
    );
    const reverse = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-causal-reverse',
    });
    const notifications: number[] = [];
    reverse.subscribeModel((change) => notifications.push(change.revisionAfter));
    const buffered = reverse.applyRemote(update2, remoteOrigin(update2));
    expect(buffered.status).toBe('buffered');
    expect(reverse.model.revision).toBe(0);
    expect(notifications).toEqual([]);
    expect(reverse.inspectState().coverage.constituentIds).toContain('op-causal-2');
    const afterBuffered = reverse.inspectState();
    expect(reverse.applyRemote(update2, remoteOrigin(update2)).status).toBe('duplicate');
    expect(reverse.inspectState()).toEqual(afterBuffered);

    const resolved = reverse.applyRemote(update1, remoteOrigin(update1));
    expect(resolved.status).toBe('applied');
    expect(notifications).toEqual([1]);
    expect(reverse.inspectState().coverage.constituentIds).toEqual(
      expect.arrayContaining(['op-causal-1', 'op-causal-2'])
    );
    expect(contentFingerprint(reverse)).toBe(contentFingerprint(sender));

    const forward = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-causal-forward',
    });
    expect(forward.applyRemote(update1, remoteOrigin(update1)).status).toBe('applied');
    expect(forward.applyRemote(update2, remoteOrigin(update2)).status).toBe('applied');
    expect(contentFingerprint(forward)).toBe(contentFingerprint(reverse));
    expect(compareYjsSchema(forward.inspectYjsModel(), reverse.inspectYjsModel()).equal).toBe(
      true
    );
  });

  test('snapshot restore retains buffered pending structs and coverage', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-buffer-sender',
    });
    const update1 = applyLocal(sender, 'replica-buffer-sender', 'actor-alice', 'op-buffer-1', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'A',
    });
    const update2 = applyLocal(sender, 'replica-buffer-sender', 'actor-alice', 'op-buffer-2', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
      text: 'B',
    });
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-buffer-backend',
    });
    const staged = backend.stageRemoteReplicationUpdate(update2);
    expect(staged.status).toBe('buffered');
    if (staged.status !== 'buffered') return;
    backend.publishBufferedRemote(staged.prepared);
    const restored = restoreYjsStoreBackend(backend.encodeSnapshot(), {
      replicaId: 'replica-buffer-restored',
    });
    expect(restored.inspectReplicationState().bufferedUpdateIds).toEqual([
      update2.updateId,
    ]);
    const prerequisite = restored.stageRemoteReplicationUpdate(update1);
    expect(prerequisite.status).toBe('staged');
    if (prerequisite.status !== 'staged') return;
    restored.publishRemotePublication(prerequisite.prepared);
    expect(
      fingerprintAuthoredModel({ authored: restored.model.authored, revision: 0 })
    ).toBe(contentFingerprint(sender));
  });

  test('local envelopes carry sender metadata and remote origin must match exactly', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-origin-sender',
    });
    const update = applyLocal(
      sender,
      'replica-origin-sender',
      'actor-alice',
      'op-origin',
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 0,
        text: 'O',
      }
    ) as ReplicationUpdateEnvelope & {
      sourceActorId?: string;
      sourceReplicaId?: string;
    };
    expect(update.sourceActorId).toBe('actor-alice');
    expect(update.sourceReplicaId).toBe('replica-origin-sender');

    for (const origin of [
      remoteOrigin(update, { updateId: 'update-wrong' }),
      remoteOrigin(update, { actorId: 'actor-bob' }),
      remoteOrigin(update, { replicaId: 'replica-wrong' }),
    ]) {
      const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: 'replica-origin-receiver',
      });
      const before = receiver.inspectState();
      expect(receiver.applyRemote(update, origin).status).toBe('failed');
      expect(receiver.inspectState()).toEqual(before);
    }
  });

  test('same actor on concurrent replicas creates disjoint structural and mark IDs', () => {
    const actorId = 'actor-shared';
    const creationIds = new Set<string>();
    for (let index = 0; index < 1024; index += 1) {
      const backend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
        actorId,
        replicaId: `replica-id-${index}`,
        sessionId: `session-id-${index}`,
        clientId: index + 1,
      });
      const structural = index % 2 === 0;
      const staged = backend.stageLocalMutation({
        actorId,
        ops: structural
          ? [
              {
                kind: 'splitParagraph',
                storyId: STORY,
                blockId: 'block-para-010',
                offset: 2,
              },
            ]
          : [
              {
                kind: 'setMark',
                storyId: STORY,
                blockId: 'block-para-010',
                mark: 'bold',
                start: 0,
                end: 2,
                enabled: true,
              },
            ],
        constituentIds: [`op-replica-${index}`],
      });
      expect(staged.status).toBe('staged');
      if (staged.status !== 'staged') continue;
      backend.commitStagedMutation(staged.staged, {
        actorId,
        constituentIds: [`op-replica-${index}`],
      });
      const decoded = backend.inspectYjsModel();
      const created = [...decoded.blocks, ...decoded.marks].filter(
        (record) => record.actorId === actorId
      );
      expect(created).not.toHaveLength(0);
      for (const record of created) {
        expect(creationIds.has(record.creationId)).toBe(false);
        creationIds.add(record.creationId);
      }
    }
    expect(creationIds.size).toBeGreaterThanOrEqual(1024);
  }, 30_000);

  test('three same-actor structural and mark edits converge in opposite orders', () => {
    const actorId = 'actor-shared';
    const replicas = ['a', 'b', 'c'].map((suffix) =>
      createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-shared-${suffix}`,
      })
    );
    const originals = [
      applyLocal(replicas[0]!, 'replica-shared-a', actorId, 'op-shared-split-a', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 2,
      }),
      applyLocal(replicas[1]!, 'replica-shared-b', actorId, 'op-shared-split-b', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 3,
      }),
      applyLocal(replicas[2]!, 'replica-shared-c', actorId, 'op-shared-mark', {
        kind: 'setMark',
        storyId: STORY,
        blockId: 'block-para-010',
        mark: 'italic',
        start: 1,
        end: 4,
        enabled: true,
      }),
    ];
    const repairs = new Map<string, ReplicationUpdateEnvelope>();
    const orders = [
      [2, 1],
      [0, 2],
      [1, 0],
    ];
    replicas.forEach((replica, replicaIndex) => {
      for (const updateIndex of orders[replicaIndex]!) {
        const update = originals[updateIndex]!;
        const result = replica.applyRemote(update, remoteOrigin(update));
        expect(
          ['applied', 'buffered', 'duplicate'],
          JSON.stringify(result)
        ).toContain(result.status);
        if (result.status === 'applied' && result.replicationUpdate) {
          repairs.set(result.replicationUpdate.updateId, result.replicationUpdate);
        }
        expect(replica.applyRemote(update, remoteOrigin(update)).status).toBe(
          'duplicate'
        );
      }
    });
    for (const repair of repairs.values()) {
      for (const replica of replicas) {
        const result = replica.applyRemote(repair, remoteOrigin(repair));
        expect(['applied', 'duplicate', 'noOp', 'buffered']).toContain(result.status);
      }
    }
    for (const replica of replicas.slice(1)) {
      expect(contentFingerprint(replica)).toBe(contentFingerprint(replicas[0]!));
      expect(
        compareYjsSchema(replica.inspectYjsModel(), replicas[0]!.inspectYjsModel()).equal
      ).toBe(true);
      expect(replica.inspectState().coverage.constituentIds).toEqual(
        replicas[0]!.inspectState().coverage.constituentIds
      );
    }
  });

  test('remote changes contain binding-usable exact diff metadata', () => {
    const cases: Array<{
      name: string;
      op: DocOpSingle;
      assertChange: (change: Extract<
        ReturnType<ReplicationCoordinator['applyRemote']>,
        { status: 'applied' }
      >['change']) => void;
    }> = [
      {
        name: 'insert',
        op: {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 1,
          text: 'I',
        },
        assertChange(change) {
          expect(change.structuralRangesBefore.map((range) => range.blockId)).toEqual([
            'block-para-010',
          ]);
          expect(change.structuralRangesAfter.map((range) => range.blockId)).toEqual([
            'block-para-010',
          ]);
          expect(change.dirtyDependencies).toContainEqual({
            dependencyKind: 'block',
            targetId: 'block-para-010',
          });
        },
      },
      {
        name: 'delete',
        op: {
          kind: 'deleteRange',
          storyId: STORY,
          blockId: 'block-para-010',
          start: 1,
          end: 3,
        },
        assertChange(change) {
          expect(change.structuralRangesBefore).not.toHaveLength(0);
          expect(change.structuralRangesAfter).not.toHaveLength(0);
        },
      },
      {
        name: 'split',
        op: {
          kind: 'splitParagraph',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 2,
        },
        assertChange(change) {
          expect(change.identityMappings.some((mapping) => mapping.kind === 'block')).toBe(
            true
          );
          expect(
            change.identityMappings.some((mapping) => mapping.kind === 'paragraph')
          ).toBe(true);
          expect(change.structuralRangesAfter.length).toBeGreaterThan(1);
        },
      },
      {
        name: 'join',
        op: {
          kind: 'joinParagraphs',
          storyId: STORY,
          firstBlockId: 'block-para-010',
          secondBlockId: 'block-para-011',
        },
        assertChange(change) {
          expect(
            change.identityMappings.some(
              (mapping) =>
                mapping.kind === 'block' &&
                mapping.beforeId === 'block-para-011' &&
                mapping.afterId === 'block-para-010'
            )
          ).toBe(true);
        },
      },
      {
        name: 'mark',
        op: {
          kind: 'setMark',
          storyId: STORY,
          blockId: 'block-para-010',
          mark: 'bold',
          start: 0,
          end: 2,
          enabled: true,
        },
        assertChange(change) {
          expect(change.dirtyDependencies.some((item) => item.dependencyKind === 'mark')).toBe(
            true
          );
          expect(change.identityMappings.some((mapping) => mapping.kind === 'mark')).toBe(
            true
          );
        },
      },
    ];

    for (const item of cases) {
      const senderReplica = `replica-diff-${item.name}-sender`;
      const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: senderReplica,
      });
      const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-diff-${item.name}-receiver`,
      });
      const update = applyLocal(
        sender,
        senderReplica,
        'actor-alice',
        `op-diff-${item.name}`,
        item.op
      );
      const result = receiver.applyRemote(update, remoteOrigin(update));
      expect(result.status).toBe('applied');
      if (result.status === 'applied') item.assertChange(result.change);
    }
  });

  test('collision repair reports remapped identities and normalization evidence', () => {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-diff-collision-left',
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-diff-collision-right',
    });
    const leftUpdate = applyLocal(
      left,
      'replica-diff-collision-left',
      'actor-alice',
      'op-diff-collision-left',
      {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 2,
      }
    );
    const rightUpdate = applyLocal(
      right,
      'replica-diff-collision-right',
      'actor-bob',
      'op-diff-collision-right',
      {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 3,
      }
    );
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-diff-collision-receiver',
    });
    expect(receiver.applyRemote(leftUpdate, remoteOrigin(leftUpdate)).status).toBe(
      'applied'
    );
    const repaired = receiver.applyRemote(rightUpdate, remoteOrigin(rightUpdate));
    expect(repaired.status).toBe('applied');
    if (repaired.status !== 'applied') return;
    expect(repaired.change.normalized).toBe(true);
    expect(repaired.change.repairEvidence?.appliedRepair).toBe(true);
    expect(
      repaired.change.identityMappings.some(
        (mapping) =>
          mapping.beforeId !== null &&
          mapping.afterId !== null &&
          mapping.beforeId !== mapping.afterId
      ),
      JSON.stringify(repaired.change.identityMappings)
    ).toBe(true);
    expect(repaired.replicationUpdate?.sourceActorId).toBe('actor-repair');
  });
});
