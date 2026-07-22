/** @spike-features origin-metadata, insert-delete-split-join-operations */
import { describe, expect, test } from 'bun:test';
import {
  UNDO_MECHANISM,
  UNDO_MECHANISM_REJECTED,
  UNDO_MECHANISM_EXPERIMENT_VERDICT,
  computeInverseOps,
  createActorSessionGroupHistoryManager,
  createFrozenAuthoredFixture,
  draftFromAuthored,
  extractIdentityTombstones,
  createMutationTrace,
} from '../src';

describe('task 2.4 falsification — positional inverse DocOp rejection', () => {
  test('records quarantined inverse and final experiment rejection', () => {
    expect(UNDO_MECHANISM).toBe('store-level-inverse-doc-op-quarantined');
    expect(UNDO_MECHANISM_REJECTED).toBe('store-level-inverse-doc-op');
    expect(UNDO_MECHANISM_EXPERIMENT_VERDICT).toBe('REJECT_CURRENT_MODEL_SHAPE');
  });

  test('split inverse without tombstones uses unstable positional tail guess', () => {
    const beforeDraft = draftFromAuthored(createFrozenAuthoredFixture().authored);
    const splitOp = {
      kind: 'splitParagraph' as const,
      storyId: 'story-body-0',
      blockId: 'block-para-010',
      offset: 2,
    };
    const withoutTombstones = computeInverseOps(beforeDraft, [splitOp], []);
    const withTombstones = computeInverseOps(
      beforeDraft,
      [splitOp],
      [
        {
          version: 'identity-tombstone/1',
          kind: 'block',
          role: 'split-tail',
          headId: 'block-para-010',
          restoredId: 'block-para-010-tail',
        },
      ]
    );
    expect(withoutTombstones[0]).toMatchObject({
      kind: 'joinParagraphs',
      secondBlockId: 'block-para-010-tail',
    });
    expect(withTombstones[0]).toEqual(withoutTombstones[0]);
    expect(withoutTombstones[0]?.kind).toBe('joinParagraphs');
  });

  test('history manager remains testable in isolation after runtime quarantine', () => {
    const manager = createActorSessionGroupHistoryManager('1.0.0');
    expect(manager.inspectActor('actor-alice', 'session-alice-1').undoEntries).toBe(0);
  });

  test('identity tombstones require mutation trace not captured by positional inverse alone', () => {
    const beforeDraft = draftFromAuthored(createFrozenAuthoredFixture().authored);
    const trace = createMutationTrace();
    const tombstones = extractIdentityTombstones(beforeDraft, beforeDraft, [], trace);
    expect(tombstones.length).toBe(0);
  });
});
