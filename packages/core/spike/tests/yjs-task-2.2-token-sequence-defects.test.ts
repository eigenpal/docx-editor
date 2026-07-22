/** @spike-features yjs-backend */
import { describe, expect, test } from 'bun:test';
import {
  YJS_MAX_CONTRIBUTIONS_PER_TEXT,
  YJS_MAX_SPLIT_TAIL_JOURNAL_ENTRIES,
} from '../src/store/yjs/constants';
import {
  baseAnchor,
  materializeTokenSequence,
  remapEventToSharedTail,
  validateAuthoredEditEvents,
  validateSplitTailEditJournal,
  validateTokenEventGraph,
  type AuthoredTextEditEvent,
} from '../src/store/yjs/token-sequence';
import {
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createReplicationCoordinator,
  createYjsStoreBackend,
  fingerprintAuthoredModel,
  restoreYjsStoreBackend,
  validateDecodedYjsModel,
  type DocOpSingle,
  type ReplicationCoordinator,
  type ReplicationUpdateEnvelope,
} from '../src';
import { getRootMap } from '../src/store/yjs/doc-access';
import * as Y from 'yjs';
import { mergeAuthoredEditEventsIntoText, readAuthoredEditEvents } from '../src/store/yjs/structural-provenance';

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

function makeDelete(
  creationId: string,
  tombstonedTokenIds: readonly string[],
  anchorSplitOffset = 1,
  observedInsertCreationIds?: readonly string[]
): AuthoredTextEditEvent {
  const actorId = creationId.split(':')[0]!;
  const observed =
    observedInsertCreationIds ??
    Object.freeze(tombstonedTokenIds.filter((tokenId) => !tokenId.startsWith('base:')));
  return Object.freeze({
    kind: 'delete',
    tombstonedTokenIds: Object.freeze([...tombstonedTokenIds]),
    observedInsertCreationIds: Object.freeze([...observed]),
    anchorSplitOffset,
    actorId,
    commitId: `commit-${creationId.split(':')[1]}`,
    creationId,
    sourceClientId: actorId === 'actor-a' ? 11 : 12,
  });
}

function makeInsert(
  creationId: string,
  text: string,
  affinity: 'before' | 'after',
  anchorSplitOffset: number,
  leftOffset: number,
  rightOffset: number | 'end'
): AuthoredTextEditEvent {
  return Object.freeze({
    kind: 'insert',
    tokenId: creationId,
    leftAnchor:
      rightOffset === 'end' && leftOffset === 0
        ? baseAnchor(TAIL, leftOffset)
        : baseAnchor(TAIL, leftOffset),
    rightAnchor:
      rightOffset === 'end'
        ? Object.freeze({ kind: 'end' as const })
        : baseAnchor(TAIL, rightOffset),
    affinity,
    anchorSplitOffset,
    text,
    actorId: creationId.split(':')[0]!,
    commitId: `commit-${creationId.split(':')[1]}`,
    creationId,
    sourceClientId: 11,
  });
}

function makeInsertAfterToken(
  creationId: string,
  text: string,
  afterTokenId: string,
  anchorSplitOffset = 1
): AuthoredTextEditEvent {
  const actorId = creationId.split(':')[0]!;
  return Object.freeze({
    kind: 'insert',
    tokenId: creationId,
    leftAnchor: Object.freeze({ kind: 'token' as const, tokenId: afterTokenId }),
    rightAnchor: baseAnchor(TAIL, 1),
    affinity: 'after' as const,
    anchorSplitOffset,
    text,
    actorId,
    commitId: `commit-${creationId.split(':')[1]}`,
    creationId,
    sourceClientId: actorId === 'actor-a' ? 11 : 12,
  });
}


function tailContributions(decoded: ReturnType<ReplicationCoordinator['inspectYjsModel']>) {
  return decoded.texts.find((text) => text.structuralSplitOffset !== undefined)?.authoredContributions;
}

function allocatorFor(...events: AuthoredTextEditEvent[]) {
  const byActor = new Map<string, { nextLocalSeq: number; nextCommitSeq: number }>();
  for (const event of events) {
    const parts = event.creationId.split(':');
    const actorId = parts[0]!;
    const commitSeq = Number.parseInt(parts[1]!, 10);
    const localSeq = Number.parseInt(parts[2]!, 10);
    const current = byActor.get(actorId) ?? { nextLocalSeq: 0, nextCommitSeq: 0 };
    byActor.set(actorId, {
      nextLocalSeq: Math.max(current.nextLocalSeq, localSeq + 1),
      nextCommitSeq: Math.max(current.nextCommitSeq, commitSeq + 1),
    });
  }
  return byActor;
}

describe('task 2.2 token-sequence defect 1: split-offset remapping', () => {
  test('materializes delete from later split offset against shared original tail', () => {
    const sharedTail = '010';
    const deleteLaterSplit = Object.freeze({
      kind: 'delete' as const,
      tombstonedTokenIds: Object.freeze(['base:block-para-010-tail:0']),
      observedInsertCreationIds: Object.freeze([] as const),
      anchorSplitOffset: 3,
      actorId: 'actor-b',
      commitId: 'commit-1',
      creationId: 'actor-b:1:1',
      sourceClientId: 12,
    });
    const remappedDelete = remapEventToSharedTail(deleteLaterSplit, 1, TAIL);
    expect(remappedDelete.kind).toBe('delete');
    if (remappedDelete.kind === 'delete') {
      expect(remappedDelete.tombstonedTokenIds).toEqual(['base:block-para-010-tail:2']);
    }
    expect(materializeTokenSequence(TAIL, sharedTail, [deleteLaterSplit], 1)).toBe('01');
    expect(materializeTokenSequence(TAIL, sharedTail, [deleteLaterSplit])).toBe('10');
  });

  test('materializes insert from later split offset without relocating addressed text', () => {
    const sharedTail = '010';
    const insertLaterSplit = makeInsert('actor-b:1:1', 'Y', 'after', 3, 0, 'end');
    expect(materializeTokenSequence(TAIL, sharedTail, [insertLaterSplit], 1)).toBe('010Y');
  });

  test('concurrent earlier/later split insert+delete converges in both delivery orders', () => {
    for (const applyRightFirst of [false, true]) {
      const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-remap-id-left-${applyRightFirst ? 'rf' : 'lf'}`,
      });
      const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
        replicaId: `replica-remap-id-right-${applyRightFirst ? 'rf' : 'lf'}`,
      });

      const leftSplit = local(left, 'actor-a', 'op-remap-id-left-split', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
      });
      const leftInsert = local(left, 'actor-a', 'op-remap-id-left-insert', {
        kind: 'insertText',
        storyId: STORY,
        blockId: TAIL,
        offset: 1,
        text: 'L',
      });
      const rightSplit = local(right, 'actor-b', 'op-remap-id-right-split', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 3,
      });
      const rightDelete = local(right, 'actor-b', 'op-remap-id-right-delete', {
        kind: 'deleteRange',
        storyId: STORY,
        blockId: TAIL,
        start: 0,
        end: 1,
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
        expect(para010JoinedText(replica)).toBe('p0L1');
      }
      expect(fingerprintAuthoredModel(left.model)).toBe(fingerprintAuthoredModel(right.model));
    }
  });
});

describe('task 2.2 token-sequence defect 2: quota deduplication by stable identity', () => {
  function contributionAtQuota(creationId: string): AuthoredTextEditEvent {
    return makeInsert(creationId, 'q', 'before', 1, 0, 1);
  }

  test('validateAuthoredEditEvents ignores duplicate creation IDs before quota enforcement', () => {
    const events = Array.from({ length: YJS_MAX_CONTRIBUTIONS_PER_TEXT }, (_, index) =>
      contributionAtQuota(`actor-q:1:${index + 1}`)
    );
    const duplicate = events[0]!;
    const errors: string[] = [];
    validateAuthoredEditEvents(
      [...events, duplicate],
      {
        actorId: 'actor-q',
        commitId: 'commit-1',
        creationId: 'actor-q:1:0',
      },
      TAIL,
      '010',
      new Map([['actor-q', { nextLocalSeq: YJS_MAX_CONTRIBUTIONS_PER_TEXT + 1, nextCommitSeq: 2 }]]),
      errors
    );
    expect(errors).toEqual([]);
  });

  test('validateSplitTailEditJournal ignores duplicate keys before quota enforcement', () => {
    const entries = Array.from({ length: YJS_MAX_SPLIT_TAIL_JOURNAL_ENTRIES }, (_, index) => {
      const event = contributionAtQuota(`actor-j:1:${index + 1}`);
      return Object.freeze({
        key: `${TAIL}\u0000${event.creationId}`,
        event,
      });
    });
    const duplicate = entries[0]!;
    const errors: string[] = [];
    validateSplitTailEditJournal(
      [...entries, duplicate],
      new Map([[TAIL, entries.map((entry) => entry.event)]]),
      errors
    );
    expect(errors).toEqual([]);
  });

  test('mergeAuthoredEditEventsIntoText replays duplicate map identity at quota idempotently', () => {
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      replicaId: 'replica-quota-map-merge',
    });
    const doc = new Y.Doc({ gc: false });
    doc.getMap('root');
    Y.applyUpdate(doc, backend.inspectReplicationState().fullState);
    const texts = getRootMap(doc, 'texts');
    const textRecord = new Y.Map<unknown>();
    textRecord.set('proposedSemanticId', `text-${TAIL}`);
    textRecord.set('parentBlockId', 'block-para-010-tail');
    textRecord.set('structuralSplitOffset', 1);
    textRecord.set('structuralOriginalTail', '010');
    texts.set('text-quota-map', textRecord);

    const existing = Array.from({ length: YJS_MAX_CONTRIBUTIONS_PER_TEXT }, (_, index) =>
      contributionAtQuota(`actor-map:1:${index + 1}`)
    );
    mergeAuthoredEditEventsIntoText(textRecord, existing);
    expect(readAuthoredEditEvents(textRecord).length).toBe(YJS_MAX_CONTRIBUTIONS_PER_TEXT);

    expect(() => mergeAuthoredEditEventsIntoText(textRecord, [existing[0]!])).not.toThrow();
    expect(readAuthoredEditEvents(textRecord).length).toBe(YJS_MAX_CONTRIBUTIONS_PER_TEXT);
  });

  test('remote update redelivery at contribution quota is duplicate without quota failure', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-quota-redelivery-sender',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-quota-redelivery-receiver',
    });

    local(sender, 'actor-a', 'op-quota-redelivery-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });

    const inserts: DocOpSingle[] = Array.from({ length: YJS_MAX_CONTRIBUTIONS_PER_TEXT }, (_, index) => ({
      kind: 'insertText' as const,
      storyId: STORY,
      blockId: TAIL,
      offset: 1,
      text: String(index % 10),
    }));
    const batch = sender.applyLocal(
      createDocOpBatch({
        ops: inserts,
        transaction: {
          actorId: 'actor-quota',
          sessionId: 'session-quota',
          groupId: 'group-quota',
          constituentIds: inserts.map((_, index) => `op-quota-${index}`),
        },
      }),
      createMutationOrigin('human', {
        actorId: 'actor-quota',
        sessionId: 'session-quota',
      })
    );
    expect(batch.status, JSON.stringify(batch)).toBe('applied');
    if (batch.status !== 'applied' || !batch.replicationUpdate) {
      throw new Error('expected applied batch');
    }

    const update = batch.replicationUpdate;
    expect(remote(receiver, update).status).toBe('applied');
    const revisionAfterFirst = receiver.model.revision;
    const second = remote(receiver, update);
    expect(second.status).toBe('duplicate');
    expect(receiver.model.revision).toBe(revisionAfterFirst);
  });

  test('snapshot restore duplicate map and journal identities at quota validate cleanly', () => {
    const events = Array.from({ length: YJS_MAX_CONTRIBUTIONS_PER_TEXT }, (_, index) =>
      contributionAtQuota(`actor-snap:1:${index + 1}`)
    );
    const entries = events.map((event) =>
      Object.freeze({
        key: `${TAIL}\u0000${event.creationId}`,
        event,
      })
    );
    const duplicateEntry = entries[0]!;
    const errors: string[] = [];
    validateSplitTailEditJournal(
      [...entries, duplicateEntry],
      new Map([[TAIL, [...events, events[0]!]]]),
      errors
    );
    expect(errors).toEqual([]);
  });
});

describe('task 2.2 token-sequence defect 3: affinity load-bearing placement', () => {
  test('before affinity precedes after affinity regardless of creation precedence', () => {
    const tail = '010';
    const beforeLater = makeInsert('actor-a:1:2', 'A', 'before', 1, 0, 1);
    const afterEarlier = makeInsert('actor-a:1:1', 'B', 'after', 1, 0, 1);
    expect(materializeTokenSequence(TAIL, tail, [beforeLater, afterEarlier])).toBe('0AB10');
    expect(materializeTokenSequence(TAIL, tail, [afterEarlier, beforeLater])).toBe('0AB10');
  });

  test('equal affinity resolves by deterministic creation precedence in both orders', () => {
    const tail = '010';
    const first = makeInsert('actor-a:1:1', 'A', 'before', 1, 0, 1);
    const second = makeInsert('actor-a:1:2', 'B', 'before', 1, 0, 1);
    expect(materializeTokenSequence(TAIL, tail, [first, second])).toBe('0AB10');
    expect(materializeTokenSequence(TAIL, tail, [second, first])).toBe('0AB10');
  });

  test('left/right boundary before-then-after affinity is stable across event delivery order', () => {
    const tail = '010';
    const leftBefore = makeInsert('actor-a:1:1', 'L', 'before', 1, 0, 1);
    const rightAfter = makeInsert('actor-b:1:1', 'R', 'after', 1, 0, 1);
    expect(materializeTokenSequence(TAIL, tail, [leftBefore, rightAfter])).toBe('0LR10');
    expect(materializeTokenSequence(TAIL, tail, [rightAfter, leftBefore])).toBe('0LR10');
  });
});

describe('task 2.2 token-sequence defect 4: cross-actor causal delete validation', () => {
  test('validates actor-a first-commit delete of actor-b insert with explicit observation', () => {
    const tail = '010';
    const insert = makeInsert('actor-b:1:1', 'X', 'after', 1, 0, 1);
    const del = makeDelete('actor-a:1:1', ['actor-b:1:1'], 1, ['actor-b:1:1']);
    for (const events of [
      [insert, del],
      [del, insert],
    ] as const) {
      const errors: string[] = [];
      validateTokenEventGraph(TAIL, tail, events, errors);
      expect(errors).toEqual([]);
      expect(materializeTokenSequence(TAIL, tail, events)).toBe('010');
    }
  });

  test('validates delete of inserted token regardless of actor sort order', () => {
    const tail = '010';
    const insert = makeInsert('actor-b:1:1', 'X', 'after', 1, 0, 1);
    const del = makeDelete('actor-a:2:1', ['actor-b:1:1'], 1, ['actor-b:1:1']);
    for (const events of [
      [insert, del],
      [del, insert],
    ] as const) {
      const errors: string[] = [];
      validateTokenEventGraph(TAIL, tail, events, errors);
      expect(errors).toEqual([]);
      validateAuthoredEditEvents(
        events,
        { actorId: 'actor-a', commitId: 'commit-2', creationId: 'actor-a:2:1' },
        TAIL,
        tail,
        allocatorFor(...events),
        errors
      );
      expect(errors).toEqual([]);
      expect(materializeTokenSequence(TAIL, tail, events)).toBe('010');
    }
  });

  test('rejects delete of inserted token without explicit observation even when commit counters imply visibility', () => {
    const tail = '010';
    const insert = makeInsert('actor-b:1:1', 'X', 'after', 1, 0, 1);
    const unobservedDelete = makeDelete('actor-a:2:1', ['actor-b:1:1'], 1, []);
    const errors: string[] = [];
    validateTokenEventGraph(TAIL, tail, [insert, unobservedDelete], errors);
    expect(errors.length).toBeGreaterThan(0);
  });

  test('rejects unknown and causally unauthenticated tombstone references', () => {
    const tail = '010';
    const insert = makeInsert('actor-b:1:1', 'X', 'after', 1, 0, 1);
    const unknownDelete = makeDelete('actor-a:2:1', ['missing-token:9:9'], 1, []);
    const unobservedDelete = makeDelete('actor-a:1:1', ['actor-b:1:1'], 1, []);
    const surplusBasisDelete = makeDelete('actor-a:2:1', ['actor-b:1:1'], 1, [
      'actor-b:1:1',
      'missing-token:9:9',
    ]);

    for (const [label, events] of [
      ['unknown', [insert, unknownDelete]],
      ['unobserved', [insert, unobservedDelete]],
      ['surplus-basis', [insert, surplusBasisDelete]],
    ] as const) {
      const errors: string[] = [];
      validateTokenEventGraph(TAIL, tail, events, errors);
      expect(errors.length, label).toBeGreaterThan(0);
    }
  });

  test('cross-actor insert then delete validates through coordinator path', () => {
    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-token-xdel-coordinator',
    });
    local(coordinator, 'actor-a', 'op-token-xdel-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    local(coordinator, 'actor-b', 'op-token-xdel-insert', {
      kind: 'insertText',
      storyId: STORY,
      blockId: TAIL,
      offset: 1,
      text: 'X',
    });
    local(coordinator, 'actor-a', 'op-token-xdel-delete', {
      kind: 'deleteRange',
      storyId: STORY,
      blockId: TAIL,
      start: 1,
      end: 2,
    });
    expect(para010JoinedText(coordinator)).toBe('p010');
    expect(validateDecodedYjsModel(coordinator.inspectYjsModel())).toEqual([]);
  });

  test('snapshot reopen validates cross-actor delete graph and decode stays clean', () => {
    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-token-xdel-snap',
    });
    local(coordinator, 'actor-a', 'op-token-xdel-snap-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    local(coordinator, 'actor-b', 'op-token-xdel-snap-insert', {
      kind: 'insertText',
      storyId: STORY,
      blockId: TAIL,
      offset: 1,
      text: 'Z',
    });
    local(coordinator, 'actor-a', 'op-token-xdel-snap-delete', {
      kind: 'deleteRange',
      storyId: STORY,
      blockId: TAIL,
      start: 1,
      end: 2,
    });
    expect(para010JoinedText(coordinator)).toBe('p010');

    const edited = coordinator.inspectYjsModel();
    const insertEvent = tailContributions(edited)?.find((event) => event.kind === 'insert');
    expect(insertEvent?.kind).toBe('insert');

    const snapshot = coordinator.encodeSnapshot();
    const reopened = restoreYjsStoreBackend(snapshot, {
      replicaId: 'replica-token-xdel-snap-reopen',
    });
    const decoded = reopened.inspectYjsModel();
    expect(validateDecodedYjsModel(decoded)).toEqual([]);
    const deleteEvent = tailContributions(decoded)?.find((event) => event.kind === 'delete');
    expect(deleteEvent?.kind).toBe('delete');
    if (deleteEvent?.kind === 'delete' && insertEvent?.kind === 'insert') {
      expect(deleteEvent.observedInsertCreationIds).toEqual([insertEvent.creationId]);
      expect(deleteEvent.tombstonedTokenIds).toEqual([insertEvent.creationId]);
    }
    expect(
      decoded.texts.find((text) => text.structuralSplitOffset !== undefined)?.content
    ).toBe('010');
  });
});

describe('task 2.2 token-sequence defect 5: tombstoned structural anchor topology', () => {
  test('insert B after A survives correct location when A is tombstoned', () => {
    const tail = '010';
    const insertA = makeInsert('actor-a:1:1', 'A', 'after', 1, 0, 1);
    const insertB = makeInsertAfterToken('actor-b:1:1', 'B', 'actor-a:1:1');
    const deleteA = makeDelete('actor-a:2:1', ['actor-a:1:1']);
    for (const events of [
      [insertA, insertB, deleteA],
      [deleteA, insertB, insertA],
    ] as const) {
      const errors: string[] = [];
      validateTokenEventGraph(TAIL, tail, events, errors);
      expect(errors).toEqual([]);
      expect(materializeTokenSequence(TAIL, tail, events)).toBe('0B10');
    }
  });

  test('transitive token anchor chains resolve through tombstoned nodes in inverse actor order', () => {
    const tail = '010';
    const insertA = makeInsert('actor-b:1:1', 'A', 'after', 1, 0, 1);
    const insertB = makeInsertAfterToken('actor-a:1:1', 'B', 'actor-b:1:1');
    const insertC = makeInsertAfterToken('actor-c:1:1', 'C', 'actor-a:1:1');
    const deleteA = makeDelete('actor-a:2:1', ['actor-b:1:1']);
    const events = [insertC, deleteA, insertB, insertA];
    const errors: string[] = [];
    validateTokenEventGraph(TAIL, tail, events, errors);
    expect(errors).toEqual([]);
    expect(materializeTokenSequence(TAIL, tail, events)).toBe('0BC10');
  });

  test('rejects dangling and cyclic token anchors', () => {
    const tail = '010';
    const dangling = makeInsertAfterToken('actor-a:1:1', 'X', 'missing:1:1');
    const cycleA = Object.freeze({
      ...makeInsert('actor-a:1:1', 'A', 'after', 1, 0, 1),
      rightAnchor: Object.freeze({ kind: 'token' as const, tokenId: 'actor-b:1:1' }),
    });
    const cycleB = makeInsertAfterToken('actor-b:1:1', 'B', 'actor-a:1:1');

    for (const events of [[dangling], [cycleA, cycleB]] as const) {
      const errors: string[] = [];
      validateTokenEventGraph(TAIL, tail, events, errors);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  test('anchored survivor validates through coordinator and snapshot reopen', () => {
    const coordinator = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-token-anchor-coordinator',
    });
    local(coordinator, 'actor-a', 'op-token-anchor-split', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 1,
    });
    local(coordinator, 'actor-a', 'op-token-anchor-i-a', {
      kind: 'insertText',
      storyId: STORY,
      blockId: TAIL,
      offset: 1,
      text: 'A',
    });
    local(coordinator, 'actor-b', 'op-token-anchor-i-b', {
      kind: 'insertText',
      storyId: STORY,
      blockId: TAIL,
      offset: 2,
      text: 'B',
    });
    local(coordinator, 'actor-a', 'op-token-anchor-d-a', {
      kind: 'deleteRange',
      storyId: STORY,
      blockId: TAIL,
      start: 1,
      end: 2,
    });
    expect(para010JoinedText(coordinator)).toBe('p0B10');
    expect(validateDecodedYjsModel(coordinator.inspectYjsModel())).toEqual([]);

    const snapshot = coordinator.encodeSnapshot();
    const restored = restoreYjsStoreBackend(snapshot, {
      replicaId: 'replica-token-anchor-reopen',
    });
    const decoded = restored.inspectYjsModel();
    expect(validateDecodedYjsModel(decoded)).toEqual([]);
    const contributions = tailContributions(decoded) ?? [];
    expect(contributions.some((event) => event.kind === 'delete')).toBe(true);
    expect(contributions.some((event) => event.kind === 'insert' && event.text === 'B')).toBe(
      true
    );
    expect(
      decoded.texts.find((text) => text.structuralSplitOffset !== undefined)?.content
    ).toBe('0B10');
  });
});
