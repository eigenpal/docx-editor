/** @spike-features origin-metadata, insert-delete-split-join-operations, yjs-backend */
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createYjsUndoManagerExperiment,
  fingerprintAuthoredModel,
  type DocOpSingle,
} from '../src';

const STORY = 'story-body-0';
const ALICE = { actorId: 'actor-alice', sessionId: 'session-alice-1' };
const BOB = { actorId: 'actor-bob', sessionId: 'session-bob-1' };

function batch(actor: typeof ALICE, groupId: string, constituentId: string, op: DocOpSingle) {
  return createDocOpBatch({
    ops: [op],
    transaction: { ...actor, groupId, constituentIds: [constituentId] },
  });
}

function insert(
  actor: typeof ALICE,
  groupId: string,
  constituentId: string,
  offset: number,
  text: string
) {
  return batch(actor, groupId, constituentId, {
    kind: 'insertText',
    storyId: STORY,
    blockId: 'block-para-010',
    offset,
    text,
  });
}

describe('task 2.4 review blockers — staged UndoManager experiment', () => {
  test('rejects actor/session/token and stack group metadata mismatches without invoking accessors', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    expect(
      experiment.applyLocal(
        insert(ALICE, 'group-a', 'op-a', 0, 'A'),
        createMutationOrigin('human', ALICE)
      ).status
    ).toBe('applied');
    const original = experiment.encodeReconstructionJournal();
    expect((original.events[0] as { trackedOrigin?: unknown }).trackedOrigin).toBe(
      'spike-tracked-origin/1\u0000actor-alice\u0000session-alice-1'
    );

    type MutableJournal = {
      events: Array<
        Record<string, unknown> & {
          actorHistories?: Array<{
            stackItemMeta: Array<Record<string, unknown>>;
          }>;
        }
      >;
    };
    const mutations: Array<(journal: MutableJournal) => void> = [
      (journal) => {
        journal.events[0].actorId = 'actor-mallory';
      },
      (journal) => {
        journal.events[0].sessionId = 'session-mallory';
      },
      (journal) => {
        journal.events[0].trackedOrigin =
          'spike-tracked-origin/1\u0000actor-mallory\u0000session-mallory';
      },
      (journal) => {
        journal.events.at(-1)!.actorHistories![0]!.stackItemMeta[0]!.groupId = 'group-mallory';
      },
    ];
    for (const mutate of mutations) {
      const malformed = structuredClone(original) as unknown as MutableJournal;
      mutate(malformed);
      expect(() => experiment.reopenFromJournal(malformed as never)).toThrow();
      expect(experiment.encodeReconstructionJournal()).toEqual(original);
    }

    let getterCalls = 0;
    const accessorEvent = Object.create(null);
    for (const [key, value] of Object.entries(original.events[0]!)) {
      if (key === 'actorId') continue;
      Object.defineProperty(accessorEvent, key, {
        enumerable: true,
        value,
      });
    }
    Object.defineProperty(accessorEvent, 'actorId', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return ALICE.actorId;
      },
    });
    const accessorJournal = {
      ...original,
      events: [accessorEvent, ...original.events.slice(1)],
    };
    expect(() => experiment.reopenFromJournal(accessorJournal)).toThrow();
    expect(getterCalls).toBe(0);
    expect(experiment.encodeReconstructionJournal()).toEqual(original);
  });

  test('rejects operation/origin actor-session mismatches atomically', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    const before = experiment.encodeReconstructionJournal();
    expect(
      experiment.applyLocal(
        insert(ALICE, 'group-a', 'op-a', 0, 'A'),
        createMutationOrigin('human', BOB)
      )
    ).toMatchObject({ status: 'failed', code: 'actor-session-mismatch' });
    expect(
      experiment.applyRemote(
        insert(BOB, 'group-b', 'op-b', 0, 'B'),
        createMutationOrigin('remote', {
          ...ALICE,
          replicaId: 'replica-alice',
          updateId: 'update-alice',
        })
      )
    ).toMatchObject({ status: 'failed', code: 'actor-session-mismatch' });
    expect(experiment.model.revision).toBe(0);
    expect(experiment.encodeReconstructionJournal()).toEqual(before);
  });

  test('group A captures both constituents, group B is separate, and reopen preserves undo order', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    expect(
      experiment.applyLocal(
        insert(ALICE, 'group-a', 'op-a1', 0, 'A'),
        createMutationOrigin('human', ALICE)
      ).status
    ).toBe('applied');
    expect(
      experiment.applyLocal(
        insert(ALICE, 'group-a', 'op-a2', 1, 'B'),
        createMutationOrigin('human', ALICE)
      ).status
    ).toBe('applied');
    expect(
      experiment.applyLocal(
        insert(ALICE, 'group-b', 'op-b1', 2, 'C'),
        createMutationOrigin('human', ALICE)
      ).status
    ).toBe('applied');

    const history = experiment.inspectActorHistory(ALICE);
    expect(history.undoEntries).toBe(2);
    expect(history.stackItemMeta).toEqual([
      expect.objectContaining({ groupId: 'group-a', constituentIds: ['op-a1', 'op-a2'] }),
      expect.objectContaining({ groupId: 'group-b', constituentIds: ['op-b1'] }),
    ]);

    const reopened = experiment.reopenFromJournal(experiment.encodeReconstructionJournal());
    expect(reopened.inspectActorHistory(ALICE)).toEqual(history);
    expect(reopened.undo(ALICE).status).toBe('applied');
    expect(reopened.model.authored.body.paragraphs.get('para-010')?.text).toBe('ABp010');
    expect(reopened.undo(ALICE).status).toBe('applied');
    expect(reopened.model.authored.body.paragraphs.get('para-010')?.text).toBe('p010');
    expect(reopened.redo(ALICE).status).toBe('applied');
    expect(reopened.model.authored.body.paragraphs.get('para-010')?.text).toBe('ABp010');
  });

  test('undo publishes exact nonempty ModelChange metadata once', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    const notifications: unknown[] = [];
    const subscribable = experiment as typeof experiment & {
      subscribeModel(listener: (change: unknown) => void): () => void;
    };
    subscribable.subscribeModel((change) => notifications.push(change));
    experiment.applyLocal(
      insert(ALICE, 'group-a', 'op-a', 0, 'A'),
      createMutationOrigin('human', ALICE)
    );
    const result = experiment.undo(ALICE);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.change.structuralRangesBefore.length).toBeGreaterThan(0);
    expect(result.change.structuralRangesAfter.length).toBeGreaterThan(0);
    expect(result.change.dirtyDependencies.length).toBeGreaterThan(0);
    expect(notifications).toHaveLength(2);
  });

  test('malformed remote update is typed failure and leaves all observable state unchanged', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    const before = {
      fingerprint: fingerprintAuthoredModel(experiment.model),
      revision: experiment.model.revision,
      history: experiment.inspectActorHistory(ALICE),
      journal: experiment.encodeReconstructionJournal(),
    };
    const result = experiment.applyRemoteUpdate(
      Uint8Array.of(255, 0, 255),
      createMutationOrigin('remote', {
        ...BOB,
        replicaId: 'replica-bob',
        updateId: 'update-malformed',
      })
    );
    expect(result).toMatchObject({ status: 'failed', code: 'malformed-yjs-update' });
    expect(fingerprintAuthoredModel(experiment.model)).toBe(before.fingerprint);
    expect(experiment.model.revision).toBe(before.revision);
    expect(experiment.inspectActorHistory(ALICE)).toEqual(before.history);
    expect(experiment.encodeReconstructionJournal()).toEqual(before.journal);
  });

  test('semantic no-op remote update adds no revision or journal event', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    const empty = new Y.Doc({ gc: false });
    const bytes = Y.encodeStateAsUpdate(empty);
    const beforeJournal = experiment.encodeReconstructionJournal();
    const result = experiment.applyRemoteUpdate(
      bytes,
      createMutationOrigin('remote', {
        ...BOB,
        replicaId: 'replica-bob',
        updateId: 'update-empty',
      })
    );
    expect(result.status).toBe('noOp');
    expect(experiment.model.revision).toBe(0);
    expect(experiment.encodeReconstructionJournal()).toEqual(beforeJournal);
  });

  test('undo, reopen, and eligible redo preserve exact authored and Yjs fingerprints without warnings', () => {
    const warnings: unknown[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
      experiment.applyLocal(
        insert(ALICE, 'group-a', 'op-a', 0, 'A'),
        createMutationOrigin('human', ALICE)
      );
      expect(experiment.undo(ALICE).status).toBe('applied');
      const expected = (
        experiment as typeof experiment & { inspectYjsFingerprint(): string }
      ).inspectYjsFingerprint();
      const reopened = experiment.reopenFromJournal(experiment.encodeReconstructionJournal());
      expect(fingerprintAuthoredModel(reopened.model)).toBe(
        fingerprintAuthoredModel(experiment.model)
      );
      expect(
        (reopened as typeof reopened & { inspectYjsFingerprint(): string }).inspectYjsFingerprint()
      ).toBe(expected);
      expect(reopened.inspectActorHistory(ALICE).redoEligible).toBe(true);
      expect(reopened.redo(ALICE).status).toBe('applied');
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings).toEqual([]);
  });

  test('compaction advances genesis and retained undo remains eligible with exact document state', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    experiment.applyLocal(
      insert(ALICE, 'group-old', 'op-old', 0, 'O'),
      createMutationOrigin('human', ALICE)
    );
    experiment.applyLocal(
      insert(ALICE, 'group-new', 'op-new', 1, 'N'),
      createMutationOrigin('human', ALICE)
    );
    const compactable = experiment as typeof experiment & {
      compact(retainLastGroups: number): void;
      inspectYjsFingerprint(): string;
    };
    const authoredBefore = fingerprintAuthoredModel(experiment.model);
    const yjsBefore = compactable.inspectYjsFingerprint();
    compactable.compact(1);
    const reopened = experiment.reopenFromJournal(experiment.encodeReconstructionJournal());
    expect(fingerprintAuthoredModel(reopened.model)).toBe(authoredBefore);
    expect(
      (reopened as typeof reopened & { inspectYjsFingerprint(): string }).inspectYjsFingerprint()
    ).toBe(yjsBefore);
    expect(reopened.inspectActorHistory(ALICE).undoEntries).toBe(1);
    expect(reopened.undo(ALICE).status).toBe('applied');
    expect(reopened.model.authored.body.paragraphs.get('para-010')?.text).toBe('Op010');
  });

  test('compacts actor A/B histories per session and preserves independent redo after reopen', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    const apply = (
      actor: typeof ALICE,
      groupId: string,
      constituentId: string,
      offset: number,
      text: string
    ) =>
      experiment.applyLocal(
        insert(actor, groupId, constituentId, offset, text),
        createMutationOrigin('human', actor)
      );
    expect(apply(ALICE, 'group-a1', 'op-a1', 0, 'A')).toMatchObject({
      status: 'applied',
    });
    expect(apply(ALICE, 'group-a2', 'op-a2', 1, 'C')).toMatchObject({
      status: 'applied',
    });
    expect(apply(BOB, 'group-b1', 'op-b1', 2, 'B')).toMatchObject({
      status: 'applied',
    });
    expect(experiment.undo(BOB).status).toBe('applied');
    expect(apply(BOB, 'group-b2', 'op-b2', 3, 'D')).toMatchObject({
      status: 'applied',
    });
    expect(experiment.undo(ALICE).status).toBe('applied');
    expect(experiment.undo(BOB).status).toBe('applied');

    const authoredBefore = fingerprintAuthoredModel(experiment.model);
    const yjsBefore = experiment.inspectYjsFingerprint();
    const revisionBefore = experiment.model.revision;
    experiment.compact(1);
    const compacted = experiment.encodeReconstructionJournal();
    expect(compacted.genesis.revision).toBe(1);
    expect(
      compacted.events
        .filter((event) => event.kind === 'tracked-update')
        .map((event) => [event.actorId, event.sessionId, event.groupId])
    ).toEqual([
      [ALICE.actorId, ALICE.sessionId, 'group-a2'],
      [BOB.actorId, BOB.sessionId, 'group-b2'],
    ]);
    expect(
      compacted.events
        .filter((event) => event.kind === 'group-boundary')
        .map((event) => event.groupId)
    ).toEqual(['group-a2', 'group-b2']);
    const reopened = experiment.reopenFromJournal(compacted);

    expect(fingerprintAuthoredModel(reopened.model)).toBe(authoredBefore);
    expect(reopened.inspectYjsFingerprint()).toBe(yjsBefore);
    expect(reopened.model.revision).toBe(revisionBefore);
    expect(reopened.inspectActorHistory(ALICE)).toMatchObject({
      undoEntries: 0,
      redoEntries: 1,
      redoEligible: true,
    });
    expect(reopened.inspectActorHistory(BOB)).toMatchObject({
      undoEntries: 0,
      redoEntries: 1,
      redoEligible: true,
    });
    expect(reopened.redo(ALICE).status).toBe('applied');
    expect(reopened.redo(BOB).status).toBe('applied');
  });

  test('zero retained groups checkpoints terminal state and drops every stack', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    expect(
      experiment.applyLocal(
        insert(ALICE, 'group-a', 'op-a', 0, 'A'),
        createMutationOrigin('human', ALICE)
      ).status
    ).toBe('applied');
    const authoredBefore = fingerprintAuthoredModel(experiment.model);
    const yjsBefore = experiment.inspectYjsFingerprint();
    experiment.compact(0);
    const reopened = experiment.reopenFromJournal(experiment.encodeReconstructionJournal());
    expect(fingerprintAuthoredModel(reopened.model)).toBe(authoredBefore);
    expect(reopened.inspectYjsFingerprint()).toBe(yjsBefore);
    expect(reopened.inspectActorHistory(ALICE)).toMatchObject({
      undoEntries: 0,
      redoEntries: 0,
      redoEligible: false,
    });
  });
});
