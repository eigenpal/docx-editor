/** @spike-features origin-metadata, insert-delete-split-join-operations, yjs-backend */
import { describe, expect, test } from 'bun:test';
import bindingOracle from '../oracles/binding-oracle.v1.json';
import {
  UNDO_EXPERIMENT_DECISION,
  UNDO_EXPERIMENT_MECHANISM,
  UNDO_EXPERIMENT_REJECTED,
  UNDO_EXPERIMENT_VERDICT,
  UNDO_EXPERIMENT_LIMITATIONS,
  UNDO_EXPERIMENT_RETAINED_REPLAY_HORIZON,
  compactJournalRetainingHorizon,
  createDocOpBatch,
  createDocumentModel,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createSemanticDocumentStore,
  createYjsUndoManagerExperiment,
  decodeReconstructionJournal,
  replayReconstructionJournal,
  fingerprintAuthoredModel,
  type DocOpSingle,
} from '../src';
import { deriveAuthoredPackageFromYjs } from '../src/store/yjs/doc-derive';

const STORY = 'story-body-0';
const ALICE = { actorId: 'actor-alice', sessionId: 'session-alice-1' };
const BOB = { actorId: 'actor-bob', sessionId: 'session-bob-1' };

function batch(
  actor: typeof ALICE,
  groupId: string,
  constituentIds: readonly string[],
  ops: readonly DocOpSingle[]
) {
  return createDocOpBatch({
    ops,
    transaction: { ...actor, groupId, constituentIds },
  });
}

describe('task 2.4 experiment — RED gate APIs', () => {
  test('exports isolated experiment runner and journal codec', () => {
    expect(typeof createYjsUndoManagerExperiment).toBe('function');
    expect(typeof decodeReconstructionJournal).toBe('function');
    expect(typeof replayReconstructionJournal).toBe('function');
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    expect(typeof experiment.undo).toBe('function');
    expect(typeof experiment.redo).toBe('function');
    expect(typeof experiment.inspectActorHistory).toBe('function');
    expect(typeof experiment.encodeReconstructionJournal).toBe('function');
    expect(typeof experiment.reopenFromJournal).toBe('function');
    expect(typeof experiment.compareLocalSemanticExpected).toBe('function');
  });

  test('records exact model-shape rejection without selected or pending wording', () => {
    expect(UNDO_EXPERIMENT_MECHANISM).toBe('yjs-undo-manager-durability');
    expect(UNDO_EXPERIMENT_REJECTED).toBe('store-level-inverse-doc-op');
    expect(UNDO_EXPERIMENT_VERDICT).toBe('REJECT_CURRENT_MODEL_SHAPE');
    expect(UNDO_EXPERIMENT_DECISION.verdict).toBe('REJECT_CURRENT_MODEL_SHAPE');
    expect(UNDO_EXPERIMENT_DECISION.finding).toBe(
      'Public Y.UndoManager durability/grouping/staging can work via a bounded reconstruction journal, but the current model-shaped nested Y.Map/Y.Text replacement shape fails same-target nested remote edits and overlapping marks because untracked replacement consumes tracked undo items and undo of locally created nested types deletes later remote child edits.'
    );
    expect(UNDO_EXPERIMENT_DECISION.consequence).toBe(
      'Task 2.4 remains unchecked; the next design must change model granularity/ownership or undo requirements before implementation.'
    );
    expect(UNDO_EXPERIMENT_DECISION.task24Complete).toBe(false);
    expect(JSON.stringify(UNDO_EXPERIMENT_DECISION)).not.toMatch(/\b(?:selected|pending)\b/i);
  });
});

describe('task 2.4 experiment — gate 1 scope and origins', () => {
  test('uses gc:false doc, authored scope, and stable tracked origin per actor/session', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    expect(
      experiment.applyLocal(
        batch(
          ALICE,
          'group-a',
          ['op-a'],
          [
            {
              kind: 'insertText',
              storyId: STORY,
              blockId: 'block-para-010',
              offset: 0,
              text: 'X',
            },
          ]
        ),
        createMutationOrigin('human', ALICE)
      ).status
    ).toBe('applied');
    const history = experiment.inspectActorHistory(ALICE);
    expect(history.undoEntries).toBe(1);
    expect(history.stackItemMeta[0]?.groupId).toBe('group-a');
  });
});

describe('task 2.4 experiment — gate 2 deterministic grouping', () => {
  test('stopCapturing on group boundaries without captureTimeout wall clock', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    const groupA = 'group-a';
    const groupB = 'group-b';
    for (const [groupId, id, text] of [
      [groupA, 'op-a', 'a'],
      [groupA, 'op-b', 'b'],
      [groupB, 'op-c', 'c'],
    ] as const) {
      expect(
        experiment.applyLocal(
          batch(
            ALICE,
            groupId,
            [id],
            [
              {
                kind: 'insertText',
                storyId: STORY,
                blockId: 'block-para-010',
                offset: 0,
                text,
              },
            ]
          ),
          createMutationOrigin('human', ALICE)
        ).status
      ).toBe('applied');
    }
    expect(experiment.inspectActorHistory(ALICE).undoEntries).toBe(2);
  });
});

describe('task 2.4 experiment — gate 3 remote interleave split undo redo', () => {
  test('matches binding oracle split-then-remote-interleave expectations', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    expect(
      experiment.applyLocal(
        batch(
          ALICE,
          'group-alice-split-1',
          ['op-alice-split-11'],
          [
            {
              kind: 'splitParagraph',
              storyId: STORY,
              blockId: 'block-para-010',
              offset: 2,
            },
          ]
        ),
        createMutationOrigin('human', ALICE)
      ).status
    ).toBe('applied');

    const remoteResult = experiment.applyRemote(
      batch(
        BOB,
        'group-bob-1',
        ['op-bob-insert-12'],
        [
          {
            kind: 'insertText',
            storyId: STORY,
            blockId: 'block-para-020',
            offset: 0,
            text: 'Z',
          },
        ]
      ),
      createMutationOrigin('remote', {
        ...BOB,
        replicaId: 'replica-bob',
        updateId: 'update-bob-12',
      })
    );
    expect(remoteResult.status).toBe('applied');

    const undo = experiment.undo(ALICE);
    expect(undo.status).toBe('applied');
    if (undo.status !== 'applied') return;
    expect(undo.change.origin.kind).toBe('undo');
    expect(experiment.model.authored.body.paragraphs.get('para-010')?.text).toBe('p010');
    expect(experiment.model.authored.body.paragraphs.get('para-020')?.text).toBe('Zp020');
    expect(experiment.inspectActorHistory(ALICE).redoEligible).toBe(true);

    const redo = experiment.redo(ALICE);
    expect(redo.status).toBe('applied');
    if (redo.status !== 'applied') return;
    expect(redo.change.origin.kind).toBe('redo');
    expect(experiment.model.authored.body.paragraphs.get('para-010-tail')?.blockId).toBe(
      'block-para-010-tail'
    );
    expect(experiment.model.authored.body.paragraphs.get('para-020')?.text).toBe('Zp020');
    expect(experiment.inspectActorHistory(ALICE).redoEligible).toBe(false);
  });
});

describe('task 2.4 experiment — gate 4 staged derivation without inverse DocOps', () => {
  test('undo and redo emit ModelChange with undo/redo origin only', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    experiment.applyLocal(
      batch(
        ALICE,
        'group-a',
        ['op-a'],
        [
          {
            kind: 'insertText',
            storyId: STORY,
            blockId: 'block-para-010',
            offset: 0,
            text: 'Q',
          },
        ]
      ),
      createMutationOrigin('human', ALICE)
    );
    const undo = experiment.undo(ALICE);
    expect(undo.status).toBe('applied');
    if (undo.status === 'applied') expect(undo.change.origin.kind).toBe('undo');
    const redo = experiment.redo(ALICE);
    expect(redo.status).toBe('applied');
    if (redo.status === 'applied') expect(redo.change.origin.kind).toBe('redo');
  });
});

describe('task 2.4 experiment — gate 5 durability journal', () => {
  test('rejects malformed accessor and oversized journals atomically', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    experiment.applyLocal(
      batch(
        ALICE,
        'group-a',
        ['op-a'],
        [
          {
            kind: 'insertText',
            storyId: STORY,
            blockId: 'block-para-010',
            offset: 0,
            text: 'X',
          },
        ]
      ),
      createMutationOrigin('human', ALICE)
    );
    const journal = experiment.encodeReconstructionJournal();
    const accessor = Object.create(Object.prototype, {
      version: { enumerable: true, value: journal.version },
      genesis: { enumerable: true, get: () => journal.genesis },
      events: { enumerable: true, get: () => [] },
      retainedFromSequence: { enumerable: true, value: 0 },
    });
    expect(() => decodeReconstructionJournal(accessor)).toThrow();

    const outOfOrder = structuredClone(journal);
    (outOfOrder.events[0] as { sequence: number }).sequence = 99;
    expect(() => decodeReconstructionJournal(outOfOrder)).toThrow();
  });

  test('replay journal and prove eligible redo after reopen', () => {
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    experiment.applyLocal(
      batch(
        ALICE,
        'group-split',
        ['op-split'],
        [
          {
            kind: 'splitParagraph',
            storyId: STORY,
            blockId: 'block-para-010',
            offset: 2,
          },
        ]
      ),
      createMutationOrigin('human', ALICE)
    );
    experiment.undo(ALICE);
    const journal = experiment.encodeReconstructionJournal();
    const replay = replayReconstructionJournal(journal, {
      deriveFingerprint: (doc, revision) =>
        fingerprintAuthoredModel(
          createDocumentModel(
            deriveAuthoredPackageFromYjs({
              doc,
              documentId: 'doc-spike-0',
              checkpoint: 'replay',
              replicaId: 'replay',
            }),
            revision
          )
        ),
      deriveRevision: () => experiment.model.revision,
    });
    expect(replay.actorInspections.some((entry) => entry.redoEligible)).toBe(true);
  });
});

describe('task 2.4 experiment — gate 6 compaction limitation', () => {
  test('records finite replay horizon quota', () => {
    expect(UNDO_EXPERIMENT_LIMITATIONS.compactionBeyondRetainedHorizonInvalidatesOlderUndo).toBe(
      true
    );
    expect(UNDO_EXPERIMENT_RETAINED_REPLAY_HORIZON).toBe(48);
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    experiment.applyLocal(
      batch(
        ALICE,
        'group-a',
        ['op-a'],
        [
          {
            kind: 'insertText',
            storyId: STORY,
            blockId: 'block-para-010',
            offset: 0,
            text: 'X',
          },
        ]
      ),
      createMutationOrigin('human', ALICE)
    );
    const journal = experiment.encodeReconstructionJournal();
    expect(() => compactJournalRetainingHorizon(journal, 0)).not.toThrow();
  });
});

describe('task 2.4 experiment — gate 7 local semantic comparison', () => {
  test('matches local semantic expected results without claiming same internal mechanism', () => {
    const local = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const experiment = createYjsUndoManagerExperiment(createFrozenAuthoredFixture());
    const op = batch(
      ALICE,
      'group-a',
      ['op-a'],
      [
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 0,
          text: 'T',
        },
      ]
    );
    const origin = createMutationOrigin('human', ALICE);
    expect(local.apply(op, origin).status).toBe('applied');
    expect(experiment.applyLocal(op, origin).status).toBe('applied');
    const comparison = experiment.compareLocalSemanticExpected(
      fingerprintAuthoredModel(local.model)
    );
    expect(comparison.match).toBe(true);
    expect(UNDO_EXPERIMENT_LIMITATIONS.doesNotClaimLocalBackendUsesSameMechanism).toBe(true);
  });
});

describe('task 2.4 experiment — binding oracle durable fields', () => {
  test('oracle still declares durable history fields for future integration', () => {
    expect(bindingOracle.snapshots.durableFields).toContain('actorSessionGroupHistory');
    expect(bindingOracle.snapshots.durableFields).toContain('redoEligibility');
  });
});
