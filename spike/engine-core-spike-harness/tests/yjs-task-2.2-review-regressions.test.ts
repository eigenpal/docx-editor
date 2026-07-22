/** @spike-features yjs-backend */
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  commitIdFor,
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createLocalStoreBackend,
  createModelChange,
  createMutationOrigin,
  createReplicationCoordinator,
  createYjsStoreBackend,
  fingerprintAuthoredModel,
  snapshotAndValidateModelChange,
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
  if (result.status !== 'applied' || !result.replicationUpdate) {
    throw new Error('expected applied replication update');
  }
  return result.replicationUpdate;
}

function remote(coordinator: ReplicationCoordinator, update: ReplicationUpdateEnvelope) {
  return coordinator.applyRemote(
    update,
    createMutationOrigin('remote', {
      actorId: update.sourceActorId,
      replicaId: update.sourceReplicaId,
      updateId: update.updateId,
    })
  );
}

function para010JoinedText(coordinator: ReplicationCoordinator): string {
  return coordinator.model.authored.body.paragraphOrder
    .map((id) => coordinator.model.authored.body.paragraphs.get(id)!)
    .filter(
      (paragraph) =>
        paragraph.blockId === 'block-para-010' ||
        paragraph.paragraphId.startsWith('para-010')
    )
    .map((paragraph) => paragraph.text)
    .join('');
}

describe('task 2.2 review regressions', () => {
  test('full snapshot resync emits exactly one coherent ModelChange when revision advances', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-task22-resync-sender',
      clientId: 3_010_000_001,
    });
    const updates = Array.from({ length: 10 }, (_, index) =>
      local(sender, 'actor-resync', `op-task22-resync-${index}`, {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: index,
        text: 'S',
      })
    );
    const recovery = sender.reseedLocalUpdate(updates[0]!.semanticUpdateId, {
      clientId: 3_010_000_002,
      sessionId: 'session-task22-resync',
    });
    expect(recovery.status).toBe('fullSnapshotResyncRequired');
    if (recovery.status !== 'fullSnapshotResyncRequired') return;

    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-task22-resync-receiver',
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

    const changes: Array<{ before: number; after: number }> = [];
    receiver.subscribeModel((change) => {
      changes.push({
        before: change.revisionBefore,
        after: change.revisionAfter,
      });
    });
    expect(receiver.model.revision).toBe(0);
    const result = receiver.applySnapshotResync(recovery);
    expect(result.status, JSON.stringify(result)).toBe('applied');
    expect(receiver.model.revision).toBe(10);
    expect(changes).toEqual([{ before: 0, after: 10 }]);
  });

  test('structural collision repair conserves independently authored tail text', () => {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-task22-tail-left',
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-task22-tail-right',
    });

    function localBatch(
      coordinator: ReplicationCoordinator,
      actorId: string,
      constituentIds: string[],
      ops: DocOpSingle[]
    ): ReplicationUpdateEnvelope {
      const result = coordinator.applyLocal(
        createDocOpBatch({
          ops,
          transaction: {
            actorId,
            sessionId: `session-${actorId}`,
            groupId: `group-${actorId}`,
            constituentIds,
          },
        }),
        createMutationOrigin('human', {
          actorId,
          sessionId: `session-${actorId}`,
        })
      );
      expect(result.status, JSON.stringify(result)).toBe('applied');
      if (result.status !== 'applied' || !result.replicationUpdate) {
        throw new Error('expected applied replication update');
      }
      return result.replicationUpdate;
    }

    const leftUpdate = localBatch(
      left,
      'actor-a',
      ['op-task22-left-split', 'op-task22-left-insert'],
      [
        {
          kind: 'splitParagraph',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 1,
        },
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010-tail',
          offset: 1,
          text: 'X',
        },
      ]
    );
    const rightUpdate = localBatch(
      right,
      'actor-b',
      ['op-task22-right-split', 'op-task22-right-insert'],
      [
        {
          kind: 'splitParagraph',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 3,
        },
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010-tail',
          offset: 1,
          text: 'Y',
        },
      ]
    );

    expect(remote(left, rightUpdate).status).toBe('applied');
    expect(remote(right, leftUpdate).status).toBe('applied');

    for (const replica of [left, right]) {
      const joined = para010JoinedText(replica);
      expect(joined, JSON.stringify(replica.model.authored.body.paragraphOrder)).toContain('X');
      expect(joined).toContain('Y');
      expect(joined.replace(/[^p010XY]/g, '')).toBe('p0X10Y');
    }
    expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
  });

  test('local backend commit actor matches staged actor provenance and allocator ownership', () => {
    const backend = createLocalStoreBackend(createFrozenAuthoredFixture(), {
      actorId: 'actor-stage-owner',
    });
    const staged = backend.stageLocalMutation({
      ops: [{ kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 1 }],
      constituentIds: ['op-task22-stage-actor'],
      actorId: 'actor-stage-owner',
    });
    expect(staged.status).toBe('staged');
    if (staged.status !== 'staged') return;

    expect(() =>
      backend.commitStagedMutation(staged.staged, {
        actorId: 'actor-commit-mismatch',
        constituentIds: ['op-task22-stage-actor'],
      })
    ).toThrow(/commit metadata does not match local stage|actor/i);

    const committed = backend.commitStagedMutation(staged.staged, {
      actorId: 'actor-stage-owner',
      constituentIds: ['op-task22-stage-actor'],
    });
    const env = backend.inspectState().operationEnvironment;
    expect(env.actorId).toBe('actor-stage-owner');
    expect(committed.commitId).toBe(commitIdFor('actor-stage-owner', 1));
    expect(env.nextCommitSeq).toBe(2);
  });

  test('same-tail X/X multiplicity survives identical edited tails in both delivery orders', () => {
    function runSameTailCollision(applyRightFirst: boolean) {
      const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-task22-x-left-${applyRightFirst ? 'right-first' : 'left-first'}`,
      });
      const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-task22-x-right-${applyRightFirst ? 'right-first' : 'left-first'}`,
      });

      function localBatch(
        coordinator: ReplicationCoordinator,
        actorId: string,
        constituentIds: string[],
        ops: DocOpSingle[]
      ): ReplicationUpdateEnvelope {
        const result = coordinator.applyLocal(
          createDocOpBatch({
            ops,
            transaction: {
              actorId,
              sessionId: `session-${actorId}`,
              groupId: `group-${actorId}`,
              constituentIds,
            },
          }),
          createMutationOrigin('human', {
            actorId,
            sessionId: `session-${actorId}`,
          })
        );
        expect(result.status, JSON.stringify(result)).toBe('applied');
        if (result.status !== 'applied' || !result.replicationUpdate) {
          throw new Error('expected applied replication update');
        }
        return result.replicationUpdate;
      }

      const splitAndInsert = (offset: number): DocOpSingle[] => [
        {
          kind: 'splitParagraph',
          storyId: STORY,
          blockId: 'block-para-010',
          offset,
        },
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010-tail',
          offset: 1,
          text: 'X',
        },
      ];

      const leftUpdate = localBatch(
        left,
        'actor-a',
        ['op-task22-x-left-split', 'op-task22-x-left-insert'],
        splitAndInsert(1)
      );
      const rightUpdate = localBatch(
        right,
        'actor-b',
        ['op-task22-x-right-split', 'op-task22-x-right-insert'],
        splitAndInsert(1)
      );

      if (applyRightFirst) {
        expect(remote(left, rightUpdate).status).toBe('applied');
        expect(remote(right, leftUpdate).status).toBe('applied');
      } else {
        expect(remote(right, leftUpdate).status).toBe('applied');
        expect(remote(left, rightUpdate).status).toBe('applied');
      }

      return { left, right };
    }

    const expectedJoined = 'p0XX10';
    for (const applyRightFirst of [false, true]) {
      const { left, right } = runSameTailCollision(applyRightFirst);
      for (const replica of [left, right]) {
        const joined = para010JoinedText(replica);
        expect(joined, JSON.stringify(replica.model.authored.body.paragraphOrder)).toBe(
          expectedJoined
        );
        expect(joined.match(/X/g)?.length).toBe(2);
      }
      expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
    }
  });

  test('same-tail XX/XX multiplicity survives identical edited tails in both delivery orders', () => {
    function runSameTailCollision(applyRightFirst: boolean) {
      const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-task22-xx-left-${applyRightFirst ? 'right-first' : 'left-first'}`,
      });
      const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-task22-xx-right-${applyRightFirst ? 'right-first' : 'left-first'}`,
      });

      function localBatch(
        coordinator: ReplicationCoordinator,
        actorId: string,
        constituentIds: string[],
        ops: DocOpSingle[]
      ): ReplicationUpdateEnvelope {
        const result = coordinator.applyLocal(
          createDocOpBatch({
            ops,
            transaction: {
              actorId,
              sessionId: `session-${actorId}`,
              groupId: `group-${actorId}`,
              constituentIds,
            },
          }),
          createMutationOrigin('human', {
            actorId,
            sessionId: `session-${actorId}`,
          })
        );
        expect(result.status, JSON.stringify(result)).toBe('applied');
        if (result.status !== 'applied' || !result.replicationUpdate) {
          throw new Error('expected applied replication update');
        }
        return result.replicationUpdate;
      }

      const splitAndInsert = (offset: number): DocOpSingle[] => [
        {
          kind: 'splitParagraph',
          storyId: STORY,
          blockId: 'block-para-010',
          offset,
        },
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010-tail',
          offset: 1,
          text: 'XX',
        },
      ];

      const leftUpdate = localBatch(
        left,
        'actor-a',
        ['op-task22-xx-left-split', 'op-task22-xx-left-insert'],
        splitAndInsert(1)
      );
      const rightUpdate = localBatch(
        right,
        'actor-b',
        ['op-task22-xx-right-split', 'op-task22-xx-right-insert'],
        splitAndInsert(1)
      );

      if (applyRightFirst) {
        expect(remote(left, rightUpdate).status).toBe('applied');
        expect(remote(right, leftUpdate).status).toBe('applied');
      } else {
        expect(remote(right, leftUpdate).status).toBe('applied');
        expect(remote(left, rightUpdate).status).toBe('applied');
      }

      return { left, right };
    }

    const expectedJoined = 'p0XXXX10';
    for (const applyRightFirst of [false, true]) {
      const { left, right } = runSameTailCollision(applyRightFirst);
      for (const replica of [left, right]) {
        const joined = para010JoinedText(replica);
        expect(joined, JSON.stringify(replica.model.authored.body.paragraphOrder)).toBe(
          expectedJoined
        );
        expect(joined.match(/X/g)?.length).toBe(4);
      }
      expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
    }
  });

  test('same-tail XYXY/XYXY multiplicity survives identical edited tails in both delivery orders', () => {
    function runSameTailCollision(applyRightFirst: boolean) {
      const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-task22-xyxy-left-${applyRightFirst ? 'right-first' : 'left-first'}`,
      });
      const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-task22-xyxy-right-${applyRightFirst ? 'right-first' : 'left-first'}`,
      });

      function localBatch(
        coordinator: ReplicationCoordinator,
        actorId: string,
        constituentIds: string[],
        ops: DocOpSingle[]
      ): ReplicationUpdateEnvelope {
        const result = coordinator.applyLocal(
          createDocOpBatch({
            ops,
            transaction: {
              actorId,
              sessionId: `session-${actorId}`,
              groupId: `group-${actorId}`,
              constituentIds,
            },
          }),
          createMutationOrigin('human', {
            actorId,
            sessionId: `session-${actorId}`,
          })
        );
        expect(result.status, JSON.stringify(result)).toBe('applied');
        if (result.status !== 'applied' || !result.replicationUpdate) {
          throw new Error('expected applied replication update');
        }
        return result.replicationUpdate;
      }

      const splitAndInsert = (offset: number): DocOpSingle[] => [
        {
          kind: 'splitParagraph',
          storyId: STORY,
          blockId: 'block-para-010',
          offset,
        },
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010-tail',
          offset: 1,
          text: 'XYXY',
        },
      ];

      const leftUpdate = localBatch(
        left,
        'actor-a',
        ['op-task22-xyxy-left-split', 'op-task22-xyxy-left-insert'],
        splitAndInsert(1)
      );
      const rightUpdate = localBatch(
        right,
        'actor-b',
        ['op-task22-xyxy-right-split', 'op-task22-xyxy-right-insert'],
        splitAndInsert(1)
      );

      if (applyRightFirst) {
        expect(remote(left, rightUpdate).status).toBe('applied');
        expect(remote(right, leftUpdate).status).toBe('applied');
      } else {
        expect(remote(right, leftUpdate).status).toBe('applied');
        expect(remote(left, rightUpdate).status).toBe('applied');
      }

      return { left, right };
    }

    const expectedJoined = 'p0XYXYXYXY10';
    for (const applyRightFirst of [false, true]) {
      const { left, right } = runSameTailCollision(applyRightFirst);
      for (const replica of [left, right]) {
        const joined = para010JoinedText(replica);
        expect(joined, JSON.stringify(replica.model.authored.body.paragraphOrder)).toBe(
          expectedJoined
        );
        expect(joined.match(/XYXY/g)?.length).toBe(2);
      }
      expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
    }
  });

  test('unedited duplicate split does not duplicate shared original tail text in both delivery orders', () => {
    function runUneditedSplitCollision(applyRightFirst: boolean) {
      const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-task22-unedited-left-${applyRightFirst ? 'right-first' : 'left-first'}`,
      });
      const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-task22-unedited-right-${applyRightFirst ? 'right-first' : 'left-first'}`,
      });

      const leftUpdate = local(left, 'actor-a', 'op-task22-unedited-left-split', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
      });
      const rightUpdate = local(right, 'actor-b', 'op-task22-unedited-right-split', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
      });

      if (applyRightFirst) {
        expect(remote(left, rightUpdate).status).toBe('applied');
        expect(remote(right, leftUpdate).status).toBe('applied');
      } else {
        expect(remote(right, leftUpdate).status).toBe('applied');
        expect(remote(left, rightUpdate).status).toBe('applied');
      }

      return { left, right };
    }

    for (const applyRightFirst of [false, true]) {
      const { left, right } = runUneditedSplitCollision(applyRightFirst);
      for (const replica of [left, right]) {
        expect(para010JoinedText(replica)).toBe('p010');
      }
      expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
    }
  });

  test('identical independent tail insertions preserve multiplicity and converge deterministically', () => {
    function runCollisionScenario(applyRightFirst: boolean) {
      const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-task22-identical-left-${applyRightFirst ? 'right-first' : 'left-first'}`,
      });
      const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-task22-identical-right-${applyRightFirst ? 'right-first' : 'left-first'}`,
      });

      function localBatch(
        coordinator: ReplicationCoordinator,
        actorId: string,
        constituentIds: string[],
        ops: DocOpSingle[]
      ): ReplicationUpdateEnvelope {
        const result = coordinator.applyLocal(
          createDocOpBatch({
            ops,
            transaction: {
              actorId,
              sessionId: `session-${actorId}`,
              groupId: `group-${actorId}`,
              constituentIds,
            },
          }),
          createMutationOrigin('human', {
            actorId,
            sessionId: `session-${actorId}`,
          })
        );
        expect(result.status, JSON.stringify(result)).toBe('applied');
        if (result.status !== 'applied' || !result.replicationUpdate) {
          throw new Error('expected applied replication update');
        }
        return result.replicationUpdate;
      }

      const leftUpdate = localBatch(
        left,
        'actor-a',
        ['op-task22-identical-left-split', 'op-task22-identical-left-insert'],
        [
          {
            kind: 'splitParagraph',
            storyId: STORY,
            blockId: 'block-para-010',
            offset: 1,
          },
          {
            kind: 'insertText',
            storyId: STORY,
            blockId: 'block-para-010-tail',
            offset: 1,
            text: 'Z',
          },
        ]
      );
      const rightUpdate = localBatch(
        right,
        'actor-b',
        ['op-task22-identical-right-split', 'op-task22-identical-right-insert'],
        [
          {
            kind: 'splitParagraph',
            storyId: STORY,
            blockId: 'block-para-010',
            offset: 3,
          },
          {
            kind: 'insertText',
            storyId: STORY,
            blockId: 'block-para-010-tail',
            offset: 1,
            text: 'Z',
          },
        ]
      );

      if (applyRightFirst) {
        expect(remote(left, rightUpdate).status).toBe('applied');
        expect(remote(right, leftUpdate).status).toBe('applied');
      } else {
        expect(remote(right, leftUpdate).status).toBe('applied');
        expect(remote(left, rightUpdate).status).toBe('applied');
      }

      return { left, right };
    }

    const leftFirst = runCollisionScenario(false);
    const rightFirst = runCollisionScenario(true);
    const expectedJoined = 'p0Z10Z';

    for (const { left, right } of [leftFirst, rightFirst]) {
      for (const replica of [left, right]) {
        const joined = para010JoinedText(replica);
        expect(joined, JSON.stringify(replica.model.authored.body.paragraphOrder)).toBe(
          expectedJoined
        );
        expect(joined.match(/Z/g)?.length).toBe(2);
      }
      expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
    }
  });

  test('repeated substring tail insertions preserve independent authored multiplicity', () => {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-task22-repeat-left',
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-task22-repeat-right',
    });

    function localBatch(
      coordinator: ReplicationCoordinator,
      actorId: string,
      constituentIds: string[],
      ops: DocOpSingle[]
    ): ReplicationUpdateEnvelope {
      const result = coordinator.applyLocal(
        createDocOpBatch({
          ops,
          transaction: {
            actorId,
            sessionId: `session-${actorId}`,
            groupId: `group-${actorId}`,
            constituentIds,
          },
        }),
        createMutationOrigin('human', {
          actorId,
          sessionId: `session-${actorId}`,
        })
      );
      expect(result.status, JSON.stringify(result)).toBe('applied');
      if (result.status !== 'applied' || !result.replicationUpdate) {
        throw new Error('expected applied replication update');
      }
      return result.replicationUpdate;
    }

    const leftUpdate = localBatch(
      left,
      'actor-a',
      ['op-task22-repeat-left-split', 'op-task22-repeat-left-insert'],
      [
        {
          kind: 'splitParagraph',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 1,
        },
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010-tail',
          offset: 1,
          text: 'ZZ',
        },
      ]
    );
    const rightUpdate = localBatch(
      right,
      'actor-b',
      ['op-task22-repeat-right-split', 'op-task22-repeat-right-insert'],
      [
        {
          kind: 'splitParagraph',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 3,
        },
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010-tail',
          offset: 1,
          text: 'Z',
        },
      ]
    );

    expect(remote(left, rightUpdate).status).toBe('applied');
    expect(remote(right, leftUpdate).status).toBe('applied');

    for (const replica of [left, right]) {
      const joined = para010JoinedText(replica);
      expect(joined.match(/Z/g)?.length).toBe(3);
      expect(joined).toBe('p0ZZ10Z');
    }
    expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
  });

  test('identical numeric tail insertions preserve multiplicity via provenance not string inference', () => {
    function runNumericCollision(applyRightFirst: boolean) {
      const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-task22-zero-left-${applyRightFirst ? 'right-first' : 'left-first'}`,
      });
      const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-task22-zero-right-${applyRightFirst ? 'right-first' : 'left-first'}`,
      });

      function localBatch(
        coordinator: ReplicationCoordinator,
        actorId: string,
        constituentIds: string[],
        ops: DocOpSingle[]
      ): ReplicationUpdateEnvelope {
        const result = coordinator.applyLocal(
          createDocOpBatch({
            ops,
            transaction: {
              actorId,
              sessionId: `session-${actorId}`,
              groupId: `group-${actorId}`,
              constituentIds,
            },
          }),
          createMutationOrigin('human', {
            actorId,
            sessionId: `session-${actorId}`,
          })
        );
        expect(result.status, JSON.stringify(result)).toBe('applied');
        if (result.status !== 'applied' || !result.replicationUpdate) {
          throw new Error('expected applied replication update');
        }
        return result.replicationUpdate;
      }

      const splitAndInsert = (offset: number): DocOpSingle[] => [
        {
          kind: 'splitParagraph',
          storyId: STORY,
          blockId: 'block-para-010',
          offset,
        },
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010-tail',
          offset: 1,
          text: '0',
        },
      ];

      const leftUpdate = localBatch(
        left,
        'actor-a',
        ['op-task22-zero-left-split', 'op-task22-zero-left-insert'],
        splitAndInsert(1)
      );
      const rightUpdate = localBatch(
        right,
        'actor-b',
        ['op-task22-zero-right-split', 'op-task22-zero-right-insert'],
        splitAndInsert(1)
      );

      if (applyRightFirst) {
        expect(remote(left, rightUpdate).status).toBe('applied');
        expect(remote(right, leftUpdate).status).toBe('applied');
      } else {
        expect(remote(right, leftUpdate).status).toBe('applied');
        expect(remote(left, rightUpdate).status).toBe('applied');
      }

      return { left, right };
    }

    const expectedJoined = 'p00010';
    for (const applyRightFirst of [false, true]) {
      const { left, right } = runNumericCollision(applyRightFirst);
      for (const replica of [left, right]) {
        const joined = para010JoinedText(replica);
        expect(joined, JSON.stringify(replica.model.authored.body.paragraphOrder)).toBe(
          expectedJoined
        );
        expect(joined.match(/0/g)?.length).toBe(4);
      }
      expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
    }
  });

  test('remote merge and repair publish as one atomic prepared transition', () => {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-task22-atomic-left',
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-task22-atomic-right',
    });
    const leftSplit = local(left, 'actor-a', 'op-task22-atomic-left', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    const rightSplit = local(right, 'actor-b', 'op-task22-atomic-right', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 3,
    });

    const backend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-task22-atomic-receiver',
    });
    expect(backend.stageRemoteReplicationUpdate(leftSplit).status).toBe('staged');
    const before = backend.inspectState();
    const staged = backend.stageRemoteReplicationUpdate(rightSplit);
    expect(staged.status, JSON.stringify(staged)).toBe('staged');
    if (staged.status !== 'staged') return;
    expect(staged.prepared.appliedRepair).toBe(true);
    expect(backend.inspectState()).toEqual(before);
    expect(staged.prepared.repairUpdate).toBeDefined();
    const repair = staged.prepared.repairUpdate!;
    const structClients = [
      ...new Set(Y.decodeUpdate(repair.bytes).structs.map((item) => item.id.client)),
    ];
    expect(structClients).toEqual([backend.identity.clientId]);
    backend.publishRemotePublication(staged.prepared);
    expect(backend.inspectState().revision).toBe(before.revision + 1);
  });

  test('ModelChange revision jumps reject ordinary origins even with repairEvidence', () => {
    const base = {
      commitId: 'commit-task22-revision-jump',
      constituentIds: ['op-task22-revision-jump'],
      causalUpdateIds: ['update-task22-revision-jump'],
      revisionBefore: 0,
      revisionAfter: 10,
      structuralRangesBefore: [],
      structuralRangesAfter: [],
      identityMappings: [],
      dirtyDependencies: [],
      normalized: true,
      repairEvidence: {
        repairConstituentId: 'repair-task22-revision-jump',
        normalizationOwner: 'commit-task22-revision-jump',
        appliedRepair: true,
      },
    } as const;

    for (const kind of ['human', 'agent', 'undo', 'redo', 'remote'] as const) {
      const origin =
        kind === 'remote'
          ? createMutationOrigin('remote', {
              actorId: 'actor-remote',
              replicaId: 'replica-remote',
              updateId: 'update-task22-revision-jump',
            })
          : createMutationOrigin(kind, {
              actorId: 'actor-task22',
              sessionId: 'session-task22',
            });
      expect(
        snapshotAndValidateModelChange({ ...base, origin }).errors,
        kind
      ).not.toEqual([]);
      expect(() =>
        createModelChange({
          ...base,
          origin,
        })
      ).toThrow();
    }
  });

  test('ModelChange permits non-unit revision jumps only for repair origin snapshot resync', () => {
    const resyncChange = createModelChange({
      commitId: 'commit-task22-resync',
      constituentIds: ['snapshot-resync-replica-task22-resync-10'],
      causalUpdateIds: ['snapshot-resync-replica-task22-resync-10'],
      revisionBefore: 0,
      revisionAfter: 10,
      structuralRangesBefore: [],
      structuralRangesAfter: [],
      identityMappings: [],
      dirtyDependencies: [],
      origin: createMutationOrigin('repair', {
        actorId: 'actor-repair',
        sessionId: 'session-task22-resync',
        repairConstituentId: 'snapshot-resync-replica-task22-resync-10',
      }),
      normalized: true,
      repairEvidence: {
        repairConstituentId: 'snapshot-resync-replica-task22-resync-10',
        normalizationOwner: 'commit-task22-resync',
        appliedRepair: true,
      },
    });
    expect(snapshotAndValidateModelChange(resyncChange).errors).toEqual([]);
    expect(resyncChange.revisionAfter).toBe(10);
  });
});
