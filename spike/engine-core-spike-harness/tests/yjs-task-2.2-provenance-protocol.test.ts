/** @spike-features yjs-backend */
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  baseAnchor,
  baseTokenId,
  compareAuthoredEditEvents,
  materializeTokenSequence,
  type AuthoredTextEditEvent,
} from '../src/store/yjs/token-sequence';
import {
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createReplicationCoordinator,
  createReplicationUpdateEnvelope,
  createYjsStoreBackend,
  fingerprintAuthoredModel,
  restoreYjsStoreBackend,
  validateDecodedYjsModel,
  type DocOpSingle,
  type ReplicationCoordinator,
  type ReplicationUpdateEnvelope,
} from '../src';
import { getRecordField, getRootMap } from '../src/store/yjs/doc-access';

const STORY = 'story-body-0';
const TAIL = 'block-para-010-tail';

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
        paragraph.blockId === 'block-para-010' || paragraph.paragraphId.startsWith('para-010')
    )
    .map((paragraph) => paragraph.text)
    .join('');
}

function splitTail(coordinator: ReplicationCoordinator, actorId: string, id: string) {
  return local(coordinator, actorId, id, {
    kind: 'splitParagraph',
    storyId: STORY,
    blockId: 'block-para-010',
    offset: 1,
  });
}

describe('task 2.2 token merge protocol RED', () => {
  test('insert X then delete exactly X stays deleted after merge/repair/reopen', () => {
    for (const applyRemoteFirst of [false, true]) {
      const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-token-ixd-sender-${applyRemoteFirst ? 'rf' : 'lf'}`,
      });
      const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-token-ixd-receiver-${applyRemoteFirst ? 'rf' : 'lf'}`,
      });

      const splitUpdate = splitTail(sender, 'actor-a', 'op-token-ixd-split');
      const insertUpdate = local(sender, 'actor-a', 'op-token-ixd-insert', {
        kind: 'insertText',
        storyId: STORY,
        blockId: TAIL,
        offset: 1,
        text: 'X',
      });
      const deleteUpdate = local(sender, 'actor-a', 'op-token-ixd-delete', {
        kind: 'deleteRange',
        storyId: STORY,
        blockId: TAIL,
        start: 1,
        end: 2,
      });
      expect(para010JoinedText(sender)).toBe('p010');

      const receiverSplit = local(receiver, 'actor-b', 'op-token-ixd-r-split', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
      });

      if (applyRemoteFirst) {
        for (const update of [splitUpdate, insertUpdate, deleteUpdate]) {
          expect(remote(receiver, update).status).toBe('applied');
        }
        expect(remote(sender, receiverSplit).status).toBe('applied');
      } else {
        expect(remote(sender, receiverSplit).status).toBe('applied');
        for (const update of [splitUpdate, insertUpdate, deleteUpdate]) {
          expect(remote(receiver, update).status).toBe('applied');
        }
      }

      for (const replica of [sender, receiver]) {
        expect(para010JoinedText(replica)).toBe('p010');
        const decoded = replica.inspectYjsModel();
        expect(validateDecodedYjsModel(decoded)).toEqual([]);
        const tail = decoded.texts.find((text) => text.structuralSplitOffset !== undefined);
        const deleteEvent = tail?.authoredContributions?.find((event) => event.kind === 'delete');
        expect(deleteEvent?.kind).toBe('delete');
        if (deleteEvent?.kind === 'delete' && deleteEvent.tombstonedTokenIds) {
          expect(deleteEvent.tombstonedTokenIds.length).toBeGreaterThan(0);
        }
      }
      expect(fingerprintAuthoredModel(sender.model)).toBe(fingerprintAuthoredModel(receiver.model));
    }
  });

  test('partial deletion spans original and inserted tokens', () => {
    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-token-partial',
    });
    splitTail(coordinator, 'actor-a', 'op-token-partial-split');
    local(coordinator, 'actor-a', 'op-token-partial-insert', {
      kind: 'insertText',
      storyId: STORY,
      blockId: TAIL,
      offset: 1,
      text: 'X',
    });
    local(coordinator, 'actor-a', 'op-token-partial-delete', {
      kind: 'deleteRange',
      storyId: STORY,
      blockId: TAIL,
      start: 1,
      end: 3,
    });
    expect(para010JoinedText(coordinator)).toBe('p00');
  });

  test('concurrent insert at delete boundary honors explicit before/after affinity in both orders', () => {
    const tail = '010';
    const makeBoundaryInsert = (
      creationId: string,
      actorId: string,
      text: string,
      affinity: 'before' | 'after'
    ): AuthoredTextEditEvent =>
      Object.freeze({
        kind: 'insert',
        tokenId: creationId,
        leftAnchor: baseAnchor(TAIL, 0),
        rightAnchor: baseAnchor(TAIL, 1),
        affinity,
        anchorSplitOffset: 1,
        text,
        actorId,
        commitId: `commit-${creationId.split(':')[1]}`,
        creationId,
        sourceClientId: actorId === 'actor-a' ? 11 : 12,
      });

    const leftBefore = makeBoundaryInsert('actor-a:1:1', 'actor-a', 'L', 'before');
    const rightAfter = makeBoundaryInsert('actor-b:1:1', 'actor-b', 'R', 'after');
    expect(materializeTokenSequence(TAIL, tail, [leftBefore, rightAfter])).toBe('0LR10');
    expect(materializeTokenSequence(TAIL, tail, [rightAfter, leftBefore])).toBe('0LR10');

    const rightBefore = makeBoundaryInsert('actor-a:1:2', 'actor-a', 'R', 'before');
    const leftAfter = makeBoundaryInsert('actor-b:1:1', 'actor-b', 'L', 'after');
    expect(materializeTokenSequence(TAIL, tail, [rightBefore, leftAfter])).toBe('0RL10');
    expect(materializeTokenSequence(TAIL, tail, [leftAfter, rightBefore])).toBe('0RL10');
  });

  test('repeated text and surrogate-safe UTF-16 boundaries', () => {
    const tail = '010';
    const emoji = '🇺🇸';
    const insert = Object.freeze({
      kind: 'insert' as const,
      tokenId: 'actor-a:1:1',
      leftAnchor: baseAnchor(TAIL, 0),
      rightAnchor: baseAnchor(TAIL, 1),
      affinity: 'after' as const,
      anchorSplitOffset: 1,
      text: emoji,
      actorId: 'actor-a',
      commitId: 'commit-1',
      creationId: 'actor-a:1:1',
      sourceClientId: 11,
    });
    const inserted = materializeTokenSequence(TAIL, tail, [insert]);
    expect(inserted.length).toBe(tail.length + emoji.length);
    const deleteEvent = Object.freeze({
      kind: 'delete' as const,
      tombstonedTokenIds: Object.freeze(['actor-a:1:1']),
      observedInsertCreationIds: Object.freeze(['actor-a:1:1']),
      anchorSplitOffset: 1,
      actorId: 'actor-a',
      commitId: 'commit-2',
      creationId: 'actor-a:1:2',
      sourceClientId: 11,
    });
    expect(materializeTokenSequence(TAIL, tail, [insert, deleteEvent])).toBe(tail);

    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-token-utf16',
    });
    splitTail(coordinator, 'actor-a', 'op-token-utf16-split');
    local(coordinator, 'actor-a', 'op-token-utf16-insert', {
      kind: 'insertText',
      storyId: STORY,
      blockId: TAIL,
      offset: 1,
      text: 'XX',
    });
    local(coordinator, 'actor-a', 'op-token-utf16-delete', {
      kind: 'deleteRange',
      storyId: STORY,
      blockId: TAIL,
      start: 1,
      end: 2,
    });
    expect(para010JoinedText(coordinator)).toBe('p0X10');
    expect(validateDecodedYjsModel(coordinator.inspectYjsModel())).toEqual([]);
  });

  test('multi-step insert/delete chain validates and repair redelivery is a fixed point', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-token-chain-sender',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-token-chain-receiver',
    });

    const splitUpdate = splitTail(sender, 'actor-a', 'op-token-chain-split');
    const insertA = local(sender, 'actor-a', 'op-token-chain-i1', {
      kind: 'insertText',
      storyId: STORY,
      blockId: TAIL,
      offset: 1,
      text: 'A',
    });
    const insertB = local(sender, 'actor-a', 'op-token-chain-i2', {
      kind: 'insertText',
      storyId: STORY,
      blockId: TAIL,
      offset: 2,
      text: 'B',
    });
    const deleteUpdate = local(sender, 'actor-a', 'op-token-chain-d1', {
      kind: 'deleteRange',
      storyId: STORY,
      blockId: TAIL,
      start: 2,
      end: 3,
    });
    expect(para010JoinedText(sender)).toBe('p0A10');
    expect(validateDecodedYjsModel(sender.inspectYjsModel())).toEqual([]);

    for (const update of [splitUpdate, insertA, insertB, deleteUpdate]) {
      expect(remote(receiver, update).status).toBe('applied');
    }
    expect(para010JoinedText(receiver)).toBe('p0A10');
    const revisionAfterFirst = receiver.model.revision;
    const second = receiver.applyRemote(
      deleteUpdate,
      createMutationOrigin('remote', {
        actorId: deleteUpdate.sourceActorId,
        replicaId: deleteUpdate.sourceReplicaId,
        updateId: deleteUpdate.updateId,
      })
    );
    expect(second.status).toBe('duplicate');
    expect(receiver.model.revision).toBe(revisionAfterFirst);
  });
});

describe('task 2.2 provenance protocol blockers', () => {
  test('blocker 1: later-commit insert on split-tail converges without lost insert', () => {
    for (const applyRightFirst of [false, true]) {
      const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-prov-later-left-${applyRightFirst ? 'rf' : 'lf'}`,
      });
      const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-prov-later-right-${applyRightFirst ? 'rf' : 'lf'}`,
      });

      const leftSplit = local(left, 'actor-a', 'op-prov-later-left-split', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
      });
      const rightSplit = local(right, 'actor-b', 'op-prov-later-right-split', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 3,
      });
      const leftInsert = local(left, 'actor-a', 'op-prov-later-left-insert', {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010-tail',
        offset: 1,
        text: 'L',
      });
      const rightInsert = local(right, 'actor-b', 'op-prov-later-right-insert', {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010-tail',
        offset: 1,
        text: 'R',
      });

      if (applyRightFirst) {
        expect(remote(left, rightSplit).status).toBe('applied');
        expect(remote(left, rightInsert).status).toBe('applied');
        expect(remote(right, leftSplit).status).toBe('applied');
        expect(remote(right, leftInsert).status).toBe('applied');
      } else {
        expect(remote(right, leftSplit).status).toBe('applied');
        expect(remote(right, leftInsert).status).toBe('applied');
        expect(remote(left, rightSplit).status).toBe('applied');
        expect(remote(left, rightInsert).status).toBe('applied');
      }

      for (const replica of [left, right]) {
        const joined = para010JoinedText(replica);
        expect(joined).toContain('L');
        expect(joined).toContain('R');
        expect(joined.replace(/[^p010LR]/g, '')).toBe('p0L10R');
      }
      expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
    }
  });

  test('blocker 1b: concurrent insert/delete preserves both intents in both delivery orders', () => {
    for (const applyRightFirst of [false, true]) {
      const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-prov-id-left-${applyRightFirst ? 'rf' : 'lf'}`,
      });
      const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-prov-id-right-${applyRightFirst ? 'rf' : 'lf'}`,
      });

      const leftSplit = local(left, 'actor-a', 'op-prov-id-left-split', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
      });
      const leftInsert = local(left, 'actor-a', 'op-prov-id-left-insert', {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010-tail',
        offset: 1,
        text: 'L',
      });
      const rightSplit = local(right, 'actor-b', 'op-prov-id-right-split', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
      });
      const rightDelete = local(right, 'actor-b', 'op-prov-id-right-delete', {
        kind: 'deleteRange',
        storyId: STORY,
        blockId: 'block-para-010-tail',
        start: 1,
        end: 3,
      });

      if (applyRightFirst) {
        expect(remote(left, rightSplit).status).toBe('applied');
        expect(remote(left, rightDelete).status).toBe('applied');
        expect(remote(right, leftSplit).status).toBe('applied');
        expect(remote(right, leftInsert).status).toBe('applied');
      } else {
        expect(remote(right, leftSplit).status).toBe('applied');
        expect(remote(right, leftInsert).status).toBe('applied');
        expect(remote(left, rightSplit).status).toBe('applied');
        expect(remote(left, rightDelete).status).toBe('applied');
      }

      for (const replica of [left, right]) {
        expect(para010JoinedText(replica)).toBe('p0L');
      }
      expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
    }
  });

  test('blocker 2: tail deletion is replayed and never resurrected by repair', () => {
    for (const applyRightFirst of [false, true]) {
      const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-prov-del-left-${applyRightFirst ? 'rf' : 'lf'}`,
      });
      const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-prov-del-right-${applyRightFirst ? 'rf' : 'lf'}`,
      });

      const leftSplit = local(left, 'actor-a', 'op-prov-del-left-split', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
      });
      const leftDelete = local(left, 'actor-a', 'op-prov-del-left-delete', {
        kind: 'deleteRange',
        storyId: STORY,
        blockId: 'block-para-010-tail',
        start: 1,
        end: 3,
      });
      const rightSplit = local(right, 'actor-b', 'op-prov-del-right-split', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
      });

      if (applyRightFirst) {
        expect(remote(left, rightSplit).status).toBe('applied');
        expect(remote(right, leftSplit).status).toBe('applied');
        expect(remote(right, leftDelete).status).toBe('applied');
      } else {
        expect(remote(right, leftSplit).status).toBe('applied');
        expect(remote(right, leftDelete).status).toBe('applied');
        expect(remote(left, rightSplit).status).toBe('applied');
      }

      for (const replica of [left, right]) {
        expect(para010JoinedText(replica)).toBe('p0');
      }
      expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
    }
  });

  test('blocker 2b: repair redelivery is a fixed point with zero revision churn', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-fixed-sender',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-fixed-receiver',
    });
    const update = local(sender, 'actor-a', 'op-prov-fixed-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    const insertUpdate = local(sender, 'actor-a', 'op-prov-fixed-insert', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010-tail',
      offset: 1,
      text: 'X',
    });
    expect(remote(receiver, update).status).toBe('applied');
    const first = remote(receiver, insertUpdate);
    expect(first.status).toBe('applied');
    if (first.status !== 'applied' || !first.replicationUpdate) {
      throw new Error('expected repair-bearing remote apply');
    }
    const revisionAfterFirst = receiver.model.revision;
    const repair = first.replicationUpdate;
    const second = receiver.applyRemote(repair, createMutationOrigin('remote', {
      actorId: repair.sourceActorId,
      replicaId: repair.sourceReplicaId,
      updateId: repair.updateId,
    }));
    expect(second.status).toBe('duplicate');
    expect(receiver.model.revision).toBe(revisionAfterFirst);
  });

  test('blocker 3: eight same-batch inserts validate and order by numeric localSeq', () => {
    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-eight-batch',
    });
    const inserts: DocOpSingle[] = [
      {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        kind: 'insertText' as const,
        storyId: STORY,
        blockId: 'block-para-010-tail',
        offset: 1 + index,
        text: String(index),
      })),
    ];
    const result = coordinator.applyLocal(
      createDocOpBatch({
        ops: inserts,
        transaction: {
          actorId: 'actor-eight',
          sessionId: 'session-eight',
          groupId: 'group-eight',
          constituentIds: inserts.map((_, index) => `op-prov-eight-${index}`),
        },
      }),
      createMutationOrigin('human', {
        actorId: 'actor-eight',
        sessionId: 'session-eight',
      })
    );
    expect(result.status, JSON.stringify(result)).toBe('applied');

    const decoded = coordinator.inspectYjsModel();
    expect(validateDecodedYjsModel(decoded), validateDecodedYjsModel(decoded).join('; ')).toEqual([]);

    const tailText = decoded.texts.find((text) => text.content.includes('01234567'));
    expect(tailText?.authoredContributions?.length).toBe(8);
    const localSeqs = tailText!.authoredContributions!.map(
      (event) => Number.parseInt(event.creationId.split(':')[2]!, 10)
    );
    expect(localSeqs).toEqual([...localSeqs].sort((left, right) => left - right));
    const ordered = [...(tailText!.authoredContributions! as AuthoredTextEditEvent[])].sort(
      compareAuthoredEditEvents
    );
    expect(ordered.map((event) => (event.kind === 'insert' ? event.text : ''))).toEqual(
      (tailText!.authoredContributions! as AuthoredTextEditEvent[]).map((event) =>
        event.kind === 'insert' ? event.text : ''
      )
    );
  });

  test('blocker 3b: malformed journal entry rejects staging atomically', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-journal-sender',
    });
    const receiverBackend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-journal-receiver',
    });
    const honest = local(sender, 'actor-honest', 'op-prov-journal-honest-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    const stagedHonest = receiverBackend.stageRemoteReplicationUpdate(honest);
    expect(stagedHonest.status).toBe('staged');
    if (stagedHonest.status === 'staged') {
      receiverBackend.publishRemotePublication(stagedHonest.prepared);
    }

    const cloneDoc = new Y.Doc({ gc: false });
    cloneDoc.getMap('root');
    Y.applyUpdate(cloneDoc, sender.inspectReplicationState().fullState);
    cloneDoc.transact(() => {
      const meta = getRootMap(cloneDoc, 'meta');
      const journal = meta.get('splitTailEditJournal') as Y.Map<unknown>;
      journal.set('block-para-010-tail\u0000bad-entry', {
        kind: 'insert',
        tokenId: 'actor-honest:1:99',
        leftAnchor: baseAnchor('block-para-010-tail', 0),
        rightAnchor: baseAnchor('block-para-010-tail', 1),
        affinity: 'before',
        anchorSplitOffset: 1,
        text: 'BAD',
        actorId: 'actor-honest',
        commitId: 'commit-1',
        creationId: 'actor-honest:1:99',
        sourceClientId: honest.sourceClientId,
      });
    });

    const before = receiverBackend.inspectState();
    const receiverDoc = new Y.Doc({ gc: false });
    receiverDoc.getMap('root');
    Y.applyUpdate(receiverDoc, receiverBackend.inspectReplicationState().fullState);
    const forgedUpdate = createReplicationUpdateEnvelope({
      documentId: honest.documentId,
      backendVersion: honest.backendVersion,
      schemaVersion: honest.schemaVersion,
      checkpoint: honest.checkpoint,
      updateId: 'update-prov-journal-forged',
      semanticUpdateId: 'update-prov-journal-forged',
      sourceActorId: honest.sourceActorId,
      sourceReplicaId: honest.sourceReplicaId,
      sourceSessionId: honest.sourceSessionId,
      sourceClientId: honest.sourceClientId,
      constituentIds: ['op-prov-journal-forged'],
      coverage: 'incremental',
      bytes: Y.encodeStateAsUpdate(cloneDoc, Y.encodeStateVector(receiverDoc)),
    });

    expect(receiverBackend.stageRemoteReplicationUpdate(forgedUpdate).status).toBe('failed');
    expect(receiverBackend.inspectState()).toEqual(before);
  });

  test('blocker 4: forged remote contribution provenance rejects atomically', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-forge-sender',
    });
    const receiverBackend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-forge-receiver',
    });

    const honest = local(sender, 'actor-honest', 'op-prov-forge-honest-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    const stagedHonest = receiverBackend.stageRemoteReplicationUpdate(honest);
    expect(stagedHonest.status).toBe('staged');
    if (stagedHonest.status === 'staged') {
      receiverBackend.publishRemotePublication(stagedHonest.prepared);
    }

    const cloneDoc = new Y.Doc({ gc: false });
    cloneDoc.getMap('root');
    Y.applyUpdate(cloneDoc, sender.inspectReplicationState().fullState);
    cloneDoc.transact(() => {
      for (const [, textRecord] of getRootMap(cloneDoc, 'texts')) {
        if (!(textRecord instanceof Y.Map)) continue;
        if (typeof textRecord.get('structuralSplitOffset') !== 'number') continue;
        let contributions = textRecord.get('authoredContributions');
        if (!(contributions instanceof Y.Map)) {
          contributions = new Y.Map<unknown>();
          textRecord.set('authoredContributions', contributions);
        }
        (contributions as Y.Map<unknown>).set('actor-victim:99:1', {
          kind: 'insert',
          tokenId: 'actor-victim:99:1',
          leftAnchor: baseAnchor('block-para-010-tail', 0),
          rightAnchor: baseAnchor('block-para-010-tail', 1),
          affinity: 'before',
          anchorSplitOffset: 1,
          text: 'FORGED',
          actorId: 'actor-victim',
          commitId: 'commit-99',
          creationId: 'actor-victim:99:1',
          sourceClientId: honest.sourceClientId,
        });
        getRecordField<Y.Text>(textRecord, 'content').insert(0, 'FORGED');
      }
    });

    const before = receiverBackend.inspectState();
    const receiverDoc = new Y.Doc({ gc: false });
    receiverDoc.getMap('root');
    Y.applyUpdate(receiverDoc, receiverBackend.inspectReplicationState().fullState);
    const forgedUpdate = createReplicationUpdateEnvelope({
      documentId: honest.documentId,
      backendVersion: honest.backendVersion,
      schemaVersion: honest.schemaVersion,
      checkpoint: honest.checkpoint,
      updateId: 'update-prov-forged-contribution',
      semanticUpdateId: 'update-prov-forged-contribution',
      sourceActorId: honest.sourceActorId,
      sourceReplicaId: honest.sourceReplicaId,
      sourceSessionId: honest.sourceSessionId,
      sourceClientId: honest.sourceClientId,
      constituentIds: ['op-prov-forged-contribution'],
      coverage: 'incremental',
      bytes: Y.encodeStateAsUpdate(cloneDoc, Y.encodeStateVector(receiverDoc)),
    });

    expect(receiverBackend.stageRemoteReplicationUpdate(forgedUpdate).status).toBe('failed');
    expect(receiverBackend.inspectState()).toEqual(before);
  });

  test('base token IDs are stable across branches for shared original tail offsets', () => {
    expect(baseTokenId(TAIL, 0)).toBe('base:block-para-010-tail:0');
    expect(baseTokenId(TAIL, 1)).toBe('base:block-para-010-tail:1');
  });
});

function tailContributionActors(coordinator: ReplicationCoordinator): Set<string> {
  const decoded = coordinator.inspectYjsModel();
  const actors = new Set<string>();
  for (const text of decoded.texts) {
    if (typeof text.structuralSplitOffset !== 'number') continue;
    for (const event of text.authoredContributions ?? []) {
      actors.add(event.actorId);
    }
  }
  return actors;
}

function splitTailBatch(
  coordinator: ReplicationCoordinator,
  actorId: string,
  splitConstituentId: string,
  insertConstituentId: string,
  text: string
): ReplicationUpdateEnvelope {
  const result = coordinator.applyLocal(
    createDocOpBatch({
      ops: [
        {
          kind: 'splitParagraph',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 1,
        },
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: TAIL,
          offset: 1,
          text,
        },
      ],
      transaction: {
        actorId,
        sessionId: `session-${actorId}`,
        groupId: `group-${actorId}`,
        constituentIds: [splitConstituentId, insertConstituentId],
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

function stageRepairFromCollision(
  receiver: ReturnType<typeof createYjsStoreBackend>,
  left: ReplicationUpdateEnvelope,
  right: ReplicationUpdateEnvelope
): ReplicationUpdateEnvelope {
  const first = receiver.stageRemoteReplicationUpdate(left);
  expect(first.status).toBe('staged');
  if (first.status !== 'staged') {
    throw new Error('expected staged left update');
  }
  receiver.publishRemotePublication(first.prepared);
  const second = receiver.stageRemoteReplicationUpdate(right);
  expect(second.status, JSON.stringify(second)).toBe('staged');
  if (second.status !== 'staged') {
    throw new Error('expected staged right update');
  }
  expect(second.prepared.appliedRepair).toBe(true);
  expect(second.prepared.repairUpdate).toBeDefined();
  receiver.publishRemotePublication(second.prepared);
  return second.prepared.repairUpdate!;
}

function insertOnTail(
  coordinator: ReplicationCoordinator,
  actorId: string,
  constituentId: string,
  text: string
): ReplicationUpdateEnvelope {
  return local(coordinator, actorId, constituentId, {
    kind: 'insertText',
    storyId: STORY,
    blockId: TAIL,
    offset: 1,
    text,
  });
}

describe('task 2.2 provenance identity acceptance blockers', () => {
  test('actor A then actor B through same replica both replicate', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-prov-sender',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-prov-receiver',
    });

    const updateA = splitTailBatch(
      sender,
      'actor-a',
      'op-accept-prov-a-split',
      'op-accept-prov-a-insert',
      'A'
    );
    const updateB = insertOnTail(sender, 'actor-b', 'op-accept-prov-b-insert', 'B');
    expect(updateA.sourceClientId).toBe(updateB.sourceClientId);
    expect(updateA.sourceReplicaId).toBe(updateB.sourceReplicaId);
    expect(updateA.sourceActorId).toBe('actor-a');
    expect(updateB.sourceActorId).toBe('actor-b');

    expect(remote(receiver, updateA).status).toBe('applied');
    expect(remote(receiver, updateB).status).toBe('applied');
    expect(tailContributionActors(receiver)).toEqual(new Set(['actor-a', 'actor-b']));
    expect(para010JoinedText(receiver)).toContain('A');
    expect(para010JoinedText(receiver)).toContain('B');
  });

  test('actor claim differing from update origin rejects atomically', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-origin-sender',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-origin-receiver',
    });
    const update = splitTailBatch(
      sender,
      'actor-a',
      'op-accept-origin-split',
      'op-accept-origin-insert',
      'X'
    );
    const before = receiver.inspectState();
    const result = receiver.applyRemote(
      update,
      createMutationOrigin('remote', {
        actorId: 'actor-forged',
        replicaId: update.sourceReplicaId,
        sessionId: update.sourceSessionId,
        updateId: update.updateId,
      })
    );
    expect(result.status).toBe('failed');
    expect(receiver.inspectState()).toEqual(before);
  });

  test('forwarded prior actor events remain valid through same replica', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-forward-sender',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-forward-receiver',
    });

    const updateA = splitTailBatch(
      sender,
      'actor-a',
      'op-accept-forward-a-split',
      'op-accept-forward-a-insert',
      'A'
    );
    const updateB = insertOnTail(sender, 'actor-b', 'op-accept-forward-b-insert', 'B');
    expect(remote(receiver, updateA).status).toBe('applied');
    const before = receiver.inspectState();
    expect(remote(receiver, updateB).status).toBe('applied');
    expect(receiver.inspectState().revision).toBeGreaterThan(before.revision);
    expect(tailContributionActors(receiver)).toEqual(new Set(['actor-a', 'actor-b']));
    const decoded = receiver.inspectYjsModel();
    expect(validateDecodedYjsModel(decoded)).toEqual([]);
    const actorAEvents = decoded.texts.flatMap(
      (text) => text.authoredContributions?.filter((event) => event.actorId === 'actor-a') ?? []
    );
    expect(actorAEvents.length).toBeGreaterThan(0);
  });
});

function markCollisionRepair(
  receiver: ReturnType<typeof createYjsStoreBackend>,
  leftActor: string,
  rightActor: string,
  leftConstituentId: string,
  rightConstituentId: string
): ReplicationUpdateEnvelope {
  const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
    replicaId: `replica-mark-left-${leftConstituentId}`,
  });
  const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
    replicaId: `replica-mark-right-${rightConstituentId}`,
  });
  const leftUpdate = local(left, leftActor, leftConstituentId, {
    kind: 'setMark',
    storyId: STORY,
    blockId: 'block-para-010',
    mark: 'bold',
    start: 0,
    end: 2,
    enabled: true,
  });
  const rightUpdate = local(right, rightActor, rightConstituentId, {
    kind: 'setMark',
    storyId: STORY,
    blockId: 'block-para-010',
    mark: 'italic',
    start: 1,
    end: 4,
    enabled: true,
  });
  return stageRepairFromCollision(receiver, leftUpdate, rightUpdate);
}

describe('task 2.2 repair identity acceptance blockers', () => {
  test('two sequential distinct repairs receive distinct stable update IDs', () => {
    const left1 = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-repair-left-1',
    });
    const right1 = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-repair-right-1',
    });
    const receiver = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-repair-receiver',
    });

    const leftSplit1 = local(left1, 'actor-a', 'op-accept-repair-l1-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    const rightSplit1 = local(right1, 'actor-b', 'op-accept-repair-r1-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 3,
    });
    const repair1 = stageRepairFromCollision(receiver, leftSplit1, rightSplit1);
    const repair2 = markCollisionRepair(
      receiver,
      'actor-c',
      'actor-d',
      'op-accept-repair-l2-mark',
      'op-accept-repair-r2-mark'
    );

    expect(repair1.updateId).not.toBe(repair2.updateId);
    expect(repair1.constituentIds[0]).not.toBe(repair2.constituentIds[0]);
    expect(receiver.stageRemoteReplicationUpdate(repair1).status).toBe('duplicate');
    expect(receiver.stageRemoteReplicationUpdate(repair2).status).toBe('duplicate');
  });

  test('exact repair redelivery is a duplicate fixed point', () => {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-repair-redel-left',
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-repair-redel-right',
    });
    const receiver = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-repair-redel-receiver',
    });
    const leftSplit = local(left, 'actor-a', 'op-accept-repair-redel-left', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    const rightSplit = local(right, 'actor-b', 'op-accept-repair-redel-right', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 3,
    });
    const repair = stageRepairFromCollision(receiver, leftSplit, rightSplit);
    const revisionAfterFirst = receiver.inspectState().revision;
    expect(receiver.stageRemoteReplicationUpdate(repair).status).toBe('duplicate');
    expect(receiver.inspectState().revision).toBe(revisionAfterFirst);
  });

  test('snapshot reopen preserves repair identity and duplicate detection', () => {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-repair-snap-left',
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-repair-snap-right',
    });
    const receiver = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-repair-snap-receiver',
    });
    const leftSplit = local(left, 'actor-a', 'op-accept-repair-snap-left', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    const rightSplit = local(right, 'actor-b', 'op-accept-repair-snap-right', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 3,
    });
    const repair = stageRepairFromCollision(receiver, leftSplit, rightSplit);
    const snapshot = receiver.encodeSnapshot();
    const reopened = restoreYjsStoreBackend(snapshot, {
      replicaId: 'replica-accept-repair-snap-reopened',
    });
    expect(reopened.stageRemoteReplicationUpdate(repair).status).toBe('duplicate');

    const repair2 = markCollisionRepair(
      reopened,
      'actor-c',
      'actor-d',
      'op-accept-repair-snap-l2-mark',
      'op-accept-repair-snap-r2-mark'
    );
    expect(repair2.updateId).not.toBe(repair.updateId);
  });

  test('same update ID with different payload rejects rather than discards', () => {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-repair-collision-left',
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-repair-collision-right',
    });
    const receiver = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-accept-repair-collision-receiver',
    });
    const repair = stageRepairFromCollision(
      receiver,
      local(left, 'actor-a', 'op-accept-repair-collision-left', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
      }),
      local(right, 'actor-b', 'op-accept-repair-collision-right', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 3,
      })
    );

    const receiverDoc = new Y.Doc({ gc: false });
    receiverDoc.getMap('root');
    Y.applyUpdate(receiverDoc, receiver.inspectReplicationState().fullState);
    const cloneDoc = new Y.Doc({ gc: false });
    cloneDoc.getMap('root');
    Y.applyUpdate(cloneDoc, receiver.inspectReplicationState().fullState);
    cloneDoc.transact(() => {
      getRootMap(cloneDoc, 'meta').set('forgedRepairSequenceMarker', 999);
    });
    const forgedBytes = Y.encodeStateAsUpdate(cloneDoc, Y.encodeStateVector(receiverDoc));
    expect(Buffer.from(forgedBytes).equals(Buffer.from(repair.bytes))).toBe(false);

    const forged = createReplicationUpdateEnvelope({
      documentId: repair.documentId,
      backendVersion: repair.backendVersion,
      schemaVersion: repair.schemaVersion,
      checkpoint: repair.checkpoint,
      updateId: repair.updateId,
      semanticUpdateId: 'update-forged-collision-semantic',
      sourceActorId: repair.sourceActorId,
      sourceReplicaId: repair.sourceReplicaId,
      sourceSessionId: repair.sourceSessionId,
      sourceClientId: repair.sourceClientId,
      constituentIds: ['op-forged-collision-constituent'],
      coverage: repair.coverage,
      bytes: forgedBytes,
    });

    const before = receiver.inspectState();
    expect(receiver.stageRemoteReplicationUpdate(forged).status).toBe('failed');
    expect(receiver.inspectState()).toEqual(before);
    expect(receiver.stageRemoteReplicationUpdate(repair).status).toBe('duplicate');
  });
});

describe('task 2.2 struct-derived provenance RED', () => {
  function registerVictimClient(
    receiverBackend: ReturnType<typeof createYjsStoreBackend>
  ): ReplicationUpdateEnvelope {
    const victim = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-victim-register',
    });
    const victimUpdate = local(victim, 'actor-victim', 'op-prov-victim-register-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 2,
    });
    const staged = receiverBackend.stageRemoteReplicationUpdate(victimUpdate);
    expect(staged.status).toBe('staged');
    if (staged.status === 'staged') {
      receiverBackend.publishRemotePublication(staged.prepared);
    }
    return victimUpdate;
  }

  function forgeSourceClientIdOnHonestInsert(
    sender: ReplicationCoordinator,
    receiverBackend: ReturnType<typeof createYjsStoreBackend>,
    honestSplit: ReplicationUpdateEnvelope,
    forgedSourceClientId: number,
    updateId: string,
    constituentId: string
  ): ReplicationUpdateEnvelope {
    const insertUpdate = local(sender, honestSplit.sourceActorId, `${constituentId}-insert`, {
      kind: 'insertText',
      storyId: STORY,
      blockId: TAIL,
      offset: 1,
      text: 'FORGED',
    });
    const decoded = sender.inspectYjsModel();
    const event = decoded.texts
      .find((text) => text.structuralSplitOffset !== undefined)
      ?.authoredContributions?.find((item) => item.kind === 'insert');
    if (!event) throw new Error('expected insert contribution');
    const journalKey = decoded.splitTailEditJournal.find(
      (entry) => entry.event.creationId === event.creationId
    )?.key;
    if (!journalKey) throw new Error('expected split tail journal entry');

    const cloneDoc = new Y.Doc({ gc: false });
    cloneDoc.getMap('root');
    Y.applyUpdate(cloneDoc, sender.inspectReplicationState().fullState);
    cloneDoc.clientID = honestSplit.sourceClientId;
    cloneDoc.transact(() => {
      for (const [, textRecord] of getRootMap(cloneDoc, 'texts')) {
        if (!(textRecord instanceof Y.Map)) continue;
        if (typeof textRecord.get('structuralSplitOffset') !== 'number') continue;
        const contributions = textRecord.get('authoredContributions');
        if (!(contributions instanceof Y.Map)) continue;
        contributions.set(event.creationId, {
          ...contributions.get(event.creationId),
          sourceClientId: forgedSourceClientId,
        });
      }
      const journal = getRootMap(cloneDoc, 'meta').get('splitTailEditJournal');
      if (!(journal instanceof Y.Map)) throw new Error('splitTailEditJournal must be Y.Map');
      journal.set(journalKey, {
        ...(journal.get(journalKey) as Record<string, unknown>),
        sourceClientId: forgedSourceClientId,
      });
    });

    const receiverDoc = new Y.Doc({ gc: false });
    receiverDoc.getMap('root');
    Y.applyUpdate(receiverDoc, receiverBackend.inspectReplicationState().fullState);
    return createReplicationUpdateEnvelope({
      documentId: insertUpdate.documentId,
      backendVersion: insertUpdate.backendVersion,
      schemaVersion: insertUpdate.schemaVersion,
      checkpoint: insertUpdate.checkpoint,
      updateId,
      semanticUpdateId: updateId,
      sourceActorId: insertUpdate.sourceActorId,
      sourceReplicaId: insertUpdate.sourceReplicaId,
      sourceSessionId: insertUpdate.sourceSessionId,
      sourceClientId: insertUpdate.sourceClientId,
      constituentIds: [constituentId],
      coverage: 'incremental',
      bytes: Y.encodeStateAsUpdate(cloneDoc, Y.encodeStateVector(receiverDoc)),
    });
  }

  test('RED: forged event cannot choose a registered victim sourceClientId while matching envelope actor', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-bypass-sender',
    });
    const receiverBackend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-bypass-receiver',
    });
    const victimUpdate = registerVictimClient(receiverBackend);
    const honest = local(sender, 'actor-honest', 'op-prov-bypass-honest-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    const stagedHonest = receiverBackend.stageRemoteReplicationUpdate(honest);
    expect(stagedHonest.status).toBe('staged');
    if (stagedHonest.status === 'staged') {
      receiverBackend.publishRemotePublication(stagedHonest.prepared);
    }

    const before = receiverBackend.inspectState();
    const forgedUpdate = forgeSourceClientIdOnHonestInsert(
      sender,
      receiverBackend,
      honest,
      victimUpdate.sourceClientId,
      'update-prov-bypass-victim-client',
      'op-prov-bypass-victim-client'
    );

    expect(receiverBackend.stageRemoteReplicationUpdate(forgedUpdate).status).toBe('failed');
    expect(receiverBackend.inspectState()).toEqual(before);
  });

  test('legitimate same-replica multi-actor sequential updates still replicate', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-struct-sender',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-struct-receiver',
    });
    const updateA = splitTailBatch(
      sender,
      'actor-a',
      'op-prov-struct-a-split',
      'op-prov-struct-a-insert',
      'A'
    );
    const updateB = insertOnTail(sender, 'actor-b', 'op-prov-struct-b-insert', 'B');
    expect(remote(receiver, updateA).status).toBe('applied');
    expect(remote(receiver, updateB).status).toBe('applied');
    expect(tailContributionActors(receiver)).toEqual(new Set(['actor-a', 'actor-b']));
  });

  test('forwarded prior actor events remain valid through same replica', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-struct-forward-sender',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-struct-forward-receiver',
    });
    const updateA = splitTailBatch(
      sender,
      'actor-a',
      'op-prov-struct-forward-a-split',
      'op-prov-struct-forward-a-insert',
      'A'
    );
    const updateB = insertOnTail(sender, 'actor-b', 'op-prov-struct-forward-b-insert', 'B');
    expect(remote(receiver, updateA).status).toBe('applied');
    const before = receiver.inspectState();
    expect(remote(receiver, updateB).status).toBe('applied');
    expect(receiver.inspectState().revision).toBeGreaterThan(before.revision);
    expect(tailContributionActors(receiver)).toEqual(new Set(['actor-a', 'actor-b']));
  });

  test('snapshot reopen preserves struct-derived provenance rejection', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-struct-snap-sender',
    });
    const receiverBackend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-struct-snap-receiver',
    });
    const victimUpdate = registerVictimClient(receiverBackend);
    const honest = local(sender, 'actor-honest', 'op-prov-struct-snap-honest-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    const stagedHonest = receiverBackend.stageRemoteReplicationUpdate(honest);
    expect(stagedHonest.status).toBe('staged');
    if (stagedHonest.status === 'staged') {
      receiverBackend.publishRemotePublication(stagedHonest.prepared);
    }
    const snapshot = receiverBackend.encodeSnapshot();
    const reopened = restoreYjsStoreBackend(snapshot, {
      replicaId: 'replica-prov-struct-snap-reopened',
    });
    const forgedUpdate = forgeSourceClientIdOnHonestInsert(
      sender,
      reopened,
      honest,
      victimUpdate.sourceClientId,
      'update-prov-struct-snap-bypass',
      'op-prov-struct-snap-bypass'
    );
    const before = reopened.inspectState();
    expect(reopened.stageRemoteReplicationUpdate(forgedUpdate).status).toBe('failed');
    expect(reopened.inspectState()).toEqual(before);
  });

  test('exact duplicate remote update remains a duplicate fixed point', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-struct-dup-sender',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-struct-dup-receiver',
    });
    const update = splitTailBatch(
      sender,
      'actor-a',
      'op-prov-struct-dup-split',
      'op-prov-struct-dup-insert',
      'D'
    );
    expect(remote(receiver, update).status).toBe('applied');
    const revisionAfterFirst = receiver.model.revision;
    expect(remote(receiver, update).status).toBe('duplicate');
    expect(receiver.model.revision).toBe(revisionAfterFirst);
  });

  test('RED: ambiguous semantic event with mismatched struct creator rejects atomically', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-ambiguity-sender',
    });
    const receiverBackend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-prov-ambiguity-receiver',
    });
    const victimUpdate = registerVictimClient(receiverBackend);
    const honest = local(sender, 'actor-honest', 'op-prov-ambiguity-honest-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    const stagedHonest = receiverBackend.stageRemoteReplicationUpdate(honest);
    expect(stagedHonest.status).toBe('staged');
    if (stagedHonest.status === 'staged') {
      receiverBackend.publishRemotePublication(stagedHonest.prepared);
    }

    const insertUpdate = local(sender, 'actor-honest', 'op-prov-ambiguity-insert-a', {
      kind: 'insertText',
      storyId: STORY,
      blockId: TAIL,
      offset: 1,
      text: 'AMBIG',
    });
    const decoded = sender.inspectYjsModel();
    const honestEvent = decoded.texts
      .find((text) => text.structuralSplitOffset !== undefined)
      ?.authoredContributions?.find((item) => item.kind === 'insert');
    if (!honestEvent || honestEvent.kind !== 'insert') {
      throw new Error('expected honest insert contribution');
    }
    const honestJournalKey = decoded.splitTailEditJournal.find(
      (entry) => entry.event.creationId === honestEvent.creationId
    )?.key;
    if (!honestJournalKey) throw new Error('expected honest journal entry');

    const cloneDoc = new Y.Doc({ gc: false });
    cloneDoc.getMap('root');
    Y.applyUpdate(cloneDoc, sender.inspectReplicationState().fullState);
    cloneDoc.clientID = honest.sourceClientId;
    const duplicateCreationId = `${honestEvent.creationId}-duplicate`;
    const duplicateJournalKey = `${honestJournalKey}-duplicate`;
    const duplicateEvent = {
      ...honestEvent,
      tokenId: duplicateCreationId,
      creationId: duplicateCreationId,
      sourceClientId: victimUpdate.sourceClientId,
    };
    cloneDoc.transact(() => {
      for (const [, textRecord] of getRootMap(cloneDoc, 'texts')) {
        if (!(textRecord instanceof Y.Map)) continue;
        if (typeof textRecord.get('structuralSplitOffset') !== 'number') continue;
        const contributions = textRecord.get('authoredContributions');
        if (!(contributions instanceof Y.Map)) continue;
        contributions.set(duplicateCreationId, duplicateEvent);
      }
      const journal = getRootMap(cloneDoc, 'meta').get('splitTailEditJournal');
      if (!(journal instanceof Y.Map)) throw new Error('splitTailEditJournal must be Y.Map');
      journal.set(duplicateJournalKey, duplicateEvent);
    });

    const receiverDoc = new Y.Doc({ gc: false });
    receiverDoc.getMap('root');
    Y.applyUpdate(receiverDoc, receiverBackend.inspectReplicationState().fullState);
    const forgedUpdate = createReplicationUpdateEnvelope({
      documentId: insertUpdate.documentId,
      backendVersion: insertUpdate.backendVersion,
      schemaVersion: insertUpdate.schemaVersion,
      checkpoint: insertUpdate.checkpoint,
      updateId: 'update-prov-ambiguity',
      semanticUpdateId: 'update-prov-ambiguity',
      sourceActorId: insertUpdate.sourceActorId,
      sourceReplicaId: insertUpdate.sourceReplicaId,
      sourceSessionId: insertUpdate.sourceSessionId,
      sourceClientId: insertUpdate.sourceClientId,
      constituentIds: ['op-prov-ambiguity'],
      coverage: 'incremental',
      bytes: Y.encodeStateAsUpdate(cloneDoc, Y.encodeStateVector(receiverDoc)),
    });

    const before = receiverBackend.inspectState();
    expect(receiverBackend.stageRemoteReplicationUpdate(forgedUpdate).status).toBe('failed');
    expect(receiverBackend.inspectState()).toEqual(before);
  });
});
