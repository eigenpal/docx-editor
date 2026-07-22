/** @spike-features origin-metadata, insert-delete-split-join-operations, yjs-backend */
import { describe, expect, test } from 'bun:test';
import {
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createYjsUndoManagerExperiment,
  decodeReconstructionJournal,
  fingerprintAuthoredModel,
  type DocOpSingle,
} from '../src';
import { UNDO_EXPERIMENT_MAX_JOURNAL_EVENTS } from '../src/experiment/yjs-undo-manager/quotas';

const STORY = 'story-body-0';
const ALICE = { actorId: 'actor-alice', sessionId: 'session-alice-1' };
const BOB = { actorId: 'actor-bob', sessionId: 'session-bob-1' };

function apply(
  experiment: ReturnType<typeof createYjsUndoManagerExperiment>,
  actor: typeof ALICE,
  groupId: string,
  constituentId: string,
  op: DocOpSingle,
  kind: 'human' | 'remote' = 'human'
) {
  const batch = createDocOpBatch({
    ops: [op],
    transaction: {
      ...actor,
      groupId,
      constituentIds: [constituentId],
    },
  });
  return kind === 'human'
    ? experiment.applyLocal(batch, createMutationOrigin('human', actor))
    : experiment.applyRemote(
        batch,
        createMutationOrigin('remote', {
          ...actor,
          replicaId: `replica-${actor.actorId}`,
          updateId: `update-${constituentId}`,
        })
      );
}

function reopen(experiment: ReturnType<typeof createYjsUndoManagerExperiment>) {
  return experiment.reopenFromJournal(experiment.encodeReconstructionJournal());
}

describe('task 2.4 replacement scenarios — same-target interleaving', () => {
  test('insert undo preserves same-offset remote insertion through reopen', () => {
    let experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    expect(
      apply(experiment, ALICE, 'insert-a', 'insert-a', {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 1,
        text: 'A',
      }).status
    ).toBe('applied');
    expect(
      apply(
        experiment,
        BOB,
        'insert-b',
        'insert-b',
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 1,
          text: 'B',
        },
        'remote'
      ).status
    ).toBe('applied');
    expect(experiment.undo(ALICE).status).toBe('applied');
    experiment = reopen(experiment);
    expect(experiment.model.authored.body.paragraphs.get('para-010')?.text).toBe('pB010');
    expect(experiment.redo(ALICE).status).toBe('applied');
    expect(experiment.model.authored.body.paragraphs.get('para-010')?.text).toContain('B');
  });

  test('delete undo restores local deletion without removing remote insertion', () => {
    let experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    expect(
      apply(experiment, ALICE, 'delete-a', 'delete-a', {
        kind: 'deleteRange',
        storyId: STORY,
        blockId: 'block-para-010',
        start: 1,
        end: 2,
      }).status
    ).toBe('applied');
    expect(
      apply(
        experiment,
        BOB,
        'insert-b',
        'insert-b',
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 1,
          text: 'B',
        },
        'remote'
      ).status
    ).toBe('applied');
    expect(experiment.undo(ALICE).status).toBe('applied');
    experiment = reopen(experiment);
    const text = experiment.model.authored.body.paragraphs.get('para-010')?.text;
    expect(text).toContain('B');
    expect(text).toContain('0');
    expect(experiment.redo(ALICE).status).toBe('applied');
  });

  test('falsifies same-tail split undo because remote nested text is deleted with the local parent', () => {
    let experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    expect(
      apply(experiment, ALICE, 'split-a', 'split-a', {
        kind: 'splitParagraph',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 2,
      }).status
    ).toBe('applied');
    expect(
      apply(
        experiment,
        BOB,
        'tail-b',
        'tail-b',
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010-tail',
          offset: 0,
          text: 'B',
        },
        'remote'
      ).status
    ).toBe('applied');
    expect(experiment.undo(ALICE).status).toBe('applied');
    experiment = reopen(experiment);
    expect(experiment.model.authored.body.paragraphs.has('para-010-tail')).toBe(false);
    expect(experiment.model.authored.body.paragraphs.get('para-010')?.text).toBe('p010');
    expect(experiment.redo(ALICE).status).toBe('applied');
    expect(experiment.model.authored.body.paragraphs.get('para-010-tail')?.blockId).toBe(
      'block-para-010-tail'
    );
  });

  test('join undo restores removed semantic IDs and preserves remote survivor edit', () => {
    let experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    expect(
      apply(experiment, ALICE, 'join-a', 'join-a', {
        kind: 'joinParagraphs',
        storyId: STORY,
        firstBlockId: 'block-para-010',
        secondBlockId: 'block-para-011',
      }).status
    ).toBe('applied');
    expect(
      apply(
        experiment,
        BOB,
        'join-b',
        'join-b',
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 4,
          text: 'B',
        },
        'remote'
      ).status
    ).toBe('applied');
    expect(experiment.undo(ALICE).status).toBe('applied');
    experiment = reopen(experiment);
    expect(experiment.model.authored.body.paragraphs.get('para-011')?.blockId).toBe(
      'block-para-011'
    );
    const text = [...experiment.model.authored.body.paragraphs.values()]
      .map((paragraph) => paragraph.text)
      .join('');
    expect(text).toContain('B');
    expect(experiment.redo(ALICE).status).toBe('applied');
  });

  for (const mark of ['bold', 'italic'] as const) {
    test(`falsifies overlapping ${mark} undo because remote map replacement consumes the stack item`, () => {
      const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
      expect(
        apply(experiment, ALICE, `${mark}-a`, `${mark}-a`, {
          kind: 'setMark',
          storyId: STORY,
          blockId: 'block-para-010',
          mark,
          start: 0,
          end: 2,
          enabled: true,
        }).status
      ).toBe('applied');
      expect(
        apply(
          experiment,
          BOB,
          `${mark}-b`,
          `${mark}-b`,
          {
            kind: 'setMark',
            storyId: STORY,
            blockId: 'block-para-010',
            mark,
            start: 1,
            end: 4,
            enabled: true,
          },
          'remote'
        ).status
      ).toBe('applied');
      expect(experiment.undo(ALICE)).toMatchObject({ status: 'failed', code: 'empty-undo' });
      expect(experiment.model.authored.body.paragraphs.get('para-010')?.marks).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: mark, start: 0, end: 4 })])
      );
    });
  }
});

describe('task 2.4 replacement scenarios — ownership and isolation', () => {
  test('actor-local undo never consumes another actor stack', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    apply(experiment, ALICE, 'a', 'a', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'A',
    });
    apply(experiment, BOB, 'b', 'b', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'B',
    });
    expect(experiment.undo(ALICE).status).toBe('applied');
    expect(experiment.inspectActorHistory(BOB).undoEntries).toBe(1);
    expect(experiment.model.authored.body.paragraphs.get('para-010')?.text).toContain('B');
  });

  test('new tracked edit invalidates only that actor/session redo', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    apply(experiment, ALICE, 'a', 'a', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'A',
    });
    expect(experiment.undo(ALICE).status).toBe('applied');
    expect(experiment.inspectActorHistory(ALICE).redoEligible).toBe(true);
    apply(experiment, ALICE, 'b', 'b', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'B',
    });
    expect(experiment.inspectActorHistory(ALICE).redoEligible).toBe(false);
  });

  test('repair evidence is owned by the initiating actor and constituent', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    const result = apply(experiment, ALICE, 'a', 'owned-a', {
      kind: 'splitParagraph',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 2,
    });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.change.repairEvidence?.normalizationOwner).toContain('actor-alice');
    expect(result.change.repairEvidence?.repairConstituentId).toContain('owned-a');
  });
});

describe('task 2.4 replacement scenarios — journal trust boundary', () => {
  test('unknown nested journal fields reject', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    apply(experiment, ALICE, 'a', 'a', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'A',
    });
    const journal = structuredClone(experiment.encodeReconstructionJournal());
    Object.assign(journal.events[0]!, { unexpected: true });
    expect(() => decodeReconstructionJournal(journal)).toThrow();
  });

  test('journal event quota rejects atomically', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    const journal = structuredClone(experiment.encodeReconstructionJournal());
    (journal as unknown as { events: unknown[] }).events = Array.from(
      { length: UNDO_EXPERIMENT_MAX_JOURNAL_EVENTS + 1 },
      (_, sequence) => ({
        kind: 'group-boundary' as const,
        sequence,
        ...ALICE,
        groupId: `group-${sequence}`,
      })
    );
    expect(() => decodeReconstructionJournal(journal)).toThrow();
  });

  test('out-of-order journal controls reject before materialization', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    apply(experiment, ALICE, 'a', 'a', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'A',
    });
    const journal = structuredClone(experiment.encodeReconstructionJournal());
    (journal.events[0] as { sequence: number }).sequence = 2;
    expect(() => experiment.reopenFromJournal(journal)).toThrow();
  });

  test('failed origin validation emits no notification and changes no state', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    const notifications: unknown[] = [];
    experiment.subscribeModel((change) => notifications.push(change));
    const before = fingerprintAuthoredModel(experiment.model);
    const result = experiment.applyLocal(
      createDocOpBatch({
        ops: [
          { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'A' },
        ],
        transaction: { ...ALICE, groupId: 'a', constituentIds: ['a'] },
      }),
      { kind: 'human' } as never
    );
    expect(result.status).toBe('failed');
    expect(notifications).toEqual([]);
    expect(fingerprintAuthoredModel(experiment.model)).toBe(before);
  });

  test('reopened server-style execution preserves terminal state and stack metadata', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    apply(experiment, ALICE, 'a', 'a', {
      kind: 'insertText',
      storyId: STORY,
      blockId: 'block-para-010',
      offset: 0,
      text: 'A',
    });
    apply(
      experiment,
      BOB,
      'b',
      'b',
      { kind: 'insertText', storyId: STORY, blockId: 'block-para-020', offset: 0, text: 'B' },
      'remote'
    );
    const reopened = reopen(experiment);
    expect(fingerprintAuthoredModel(reopened.model)).toBe(
      fingerprintAuthoredModel(experiment.model)
    );
    expect(reopened.inspectActorHistory(ALICE)).toEqual(experiment.inspectActorHistory(ALICE));
  });
});
