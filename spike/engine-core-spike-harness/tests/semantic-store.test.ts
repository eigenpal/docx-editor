import { describe, expect, test } from 'bun:test';
import {
  createDocOpBatch,
  createMutationOrigin,
  createSemanticDocumentStore,
  createFrozenAuthoredFixture,
  fingerprintAuthoredModel,
  loadOracleManifest,
  NORMALIZATION_PRECEDENCE,
  type AuthoredMark,
  type DocOpSingle,
  type SemanticDocumentStore,
} from '../src';

const STORY = 'story-body-0';
const manifest = loadOracleManifest();

function humanBatch(ops: DocOpSingle[], constituentIds: string[]) {
  return createDocOpBatch({
    ops,
    transaction: {
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
      groupId: 'group-alice-1',
      constituentIds,
    },
  });
}

function applyHuman(store: SemanticDocumentStore, ops: DocOpSingle[], ids: string[]) {
  return store.apply(
    humanBatch(ops, ids),
    createMutationOrigin('human', { actorId: 'actor-alice', sessionId: 'session-alice-1' })
  );
}

describe('semantic store — red gate (task 2.1)', () => {
  test('module exists and exposes one apply path', () => {
    expect(typeof createSemanticDocumentStore).toBe('function');
  });
});

describe('semantic store — insert and delete', () => {
  test('inserts text at UTF-16 offset and preserves paragraph identity', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const before = store.model.authored.body.paragraphs.get('para-010')!;
    const result = applyHuman(
      store,
      [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 2, text: 'X' }],
      ['op-insert-1']
    );
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const after = store.model.authored.body.paragraphs.get('para-010')!;
    expect(after.text).toBe('p0X10');
    expect(after.blockId).toBe(before.blockId);
    expect(after.paragraphId).toBe(before.paragraphId);
    expect(result.change.revisionAfter).toBe(1);
    expect(result.change.constituentIds).toEqual(['op-insert-1']);
  });

  test('deletes a UTF-16 range and shifts marks', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const result = applyHuman(
      store,
      [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-001', start: 1, end: 4 }],
      ['op-delete-1']
    );
    expect(result.status).toBe('applied');
    const paragraph = store.model.authored.body.paragraphs.get('para-001')!;
    expect(paragraph.text).toBe('p');
    expect(paragraph.marks.some((mark: AuthoredMark) => mark.kind === 'italic')).toBe(false);
    expect(paragraph.marks.some((mark: AuthoredMark) => mark.kind === 'bold')).toBe(true);
  });

  test('rejects surrogate-splitting insert offset', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    applyHuman(
      store,
      [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-000', offset: 1, text: '🇺🇸' }],
      ['op-seed-emoji']
    );
    const bad = applyHuman(
      store,
      [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-000', offset: 2, text: '!' }],
      ['op-surrogate']
    );
    expect(bad.status).toBe('failed');
    if (bad.status === 'failed') expect(bad.code).toBe('invalid-offset');
  });
});

describe('semantic store — split and join identity', () => {
  test('split keeps original ID on first fragment and mints deterministic tail', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const result = applyHuman(
      store,
      [{ kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 2 }],
      ['op-split-1']
    );
    expect(result.status).toBe('applied');
    const head = store.model.authored.body.paragraphs.get('para-010')!;
    const tail = store.model.authored.body.paragraphs.get('para-010-tail');
    expect(head.text).toBe('p0');
    expect(head.blockId).toBe('block-para-010');
    expect(tail?.text).toBe('10');
    expect(tail?.blockId).toBe('block-para-010-tail');
    const order = store.model.authored.body.paragraphOrder;
    expect(order.indexOf('para-010-tail')).toBe(order.indexOf('para-010') + 1);
  });

  test('join keeps first paragraph identity and removes second', () => {
    let store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    applyHuman(
      store,
      [{ kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 2 }],
      ['op-split-1']
    );
    const result = applyHuman(
      store,
      [
        {
          kind: 'joinParagraphs',
          storyId: STORY,
          firstBlockId: 'block-para-010',
          secondBlockId: 'block-para-010-tail',
        },
      ],
      ['op-join-1']
    );
    expect(result.status).toBe('applied');
    expect(store.model.authored.body.paragraphs.get('para-010')?.text).toBe('p010');
    expect(store.model.authored.body.paragraphs.has('para-010-tail')).toBe(false);
    if (result.status === 'applied') {
      expect(
        result.change.identityMappings.some(
          (mapping) =>
            mapping.kind === 'block' &&
            mapping.beforeId === 'block-para-010-tail' &&
            mapping.afterId === 'block-para-010'
        )
      ).toBe(true);
    }
  });

  test('rejects non-adjacent join', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const result = applyHuman(
      store,
      [
        {
          kind: 'joinParagraphs',
          storyId: STORY,
          firstBlockId: 'block-para-000',
          secondBlockId: 'block-para-002',
        },
      ],
      ['op-join-bad']
    );
    expect(result.status).toBe('failed');
  });
});

describe('semantic store — marks', () => {
  test('sets and unsets bold/italic over ranges', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const bold = applyHuman(
      store,
      [
        {
          kind: 'setMark',
          storyId: STORY,
          blockId: 'block-para-000',
          mark: 'bold',
          start: 0,
          end: 2,
          enabled: true,
        },
      ],
      ['op-bold']
    );
    expect(bold.status).toBe('applied');
    let paragraph = store.model.authored.body.paragraphs.get('para-000')!;
    expect(paragraph.marks.some((mark: AuthoredMark) => mark.kind === 'bold' && mark.start === 0 && mark.end === 2)).toBe(
      true
    );
    const unset = applyHuman(
      store,
      [
        {
          kind: 'setMark',
          storyId: STORY,
          blockId: 'block-para-000',
          mark: 'bold',
          start: 0,
          end: 1,
          enabled: false,
        },
      ],
      ['op-unbold']
    );
    expect(unset.status).toBe('applied');
    paragraph = store.model.authored.body.paragraphs.get('para-000')!;
    const boldMark = paragraph.marks.find((mark: AuthoredMark) => mark.kind === 'bold');
    expect(boldMark?.start).toBe(1);
    expect(boldMark?.end).toBe(2);
  });

  test('mark IDs stay unique after split', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    applyHuman(
      store,
      [{ kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-001', offset: 2 }],
      ['op-split-marks']
    );
    const head = store.model.authored.body.paragraphs.get('para-001')!;
    const tail = store.model.authored.body.paragraphs.get('para-001-tail')!;
    const ids = [...head.marks, ...tail.marks].map((mark) => mark.markId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('semantic store — batch atomicity and evolving positions', () => {
  test('applies multi-op batch with evolving offsets atomically', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const result = applyHuman(
      store,
      [
        { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'A' },
        { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 5, text: 'B' },
      ],
      ['op-a', 'op-b']
    );
    expect(result.status).toBe('applied');
    expect(store.model.authored.body.paragraphs.get('para-010')?.text).toBe('Ap010B');
  });

  test('rolls back entire batch on mid-batch validation failure', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const fingerprintBefore = fingerprintAuthoredModel(store.model);
    const notifications: number[] = [];
    store.subscribeModel((change) => notifications.push(change.revisionAfter));
    const result = applyHuman(
      store,
      [
        { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'Z' },
        { kind: 'deleteRange', storyId: STORY, blockId: 'block-para-999', start: 0, end: 1 },
      ],
      ['op-good', 'op-bad']
    );
    expect(result.status).toBe('failed');
    expect(fingerprintAuthoredModel(store.model)).toBe(fingerprintBefore);
    expect(store.model.revision).toBe(0);
    expect(notifications).toEqual([]);
  });
});

describe('semantic store — no-op policy', () => {
  test('returns typed no-op without revision for empty-effect batch', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    let notified = false;
    store.subscribeModel(() => {
      notified = true;
    });
    const result = applyHuman(
      store,
      [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-010', start: 2, end: 2 }],
      ['op-noop']
    );
    expect(result.status).toBe('noOp');
    expect(store.model.revision).toBe(0);
    expect(notified).toBe(false);
  });
});

describe('semantic store — authored and capsule preservation', () => {
  test('preserves authored omission/raw values and frozen capsule evidence', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    applyHuman(
      store,
      [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-064', offset: 4, text: '!' }],
      ['op-style']
    );
    const paragraph = store.model.authored.body.paragraphs.get('para-064')!;
    expect(paragraph.authoredProperties.lineHeightTwips).toEqual({
      state: 'raw',
      rawLexical: '288',
    });
    const capsule = store.model.authored.capsules[0]!;
    expect(Buffer.from(capsule.bytes).toString('hex')).toBe(manifest.unsupportedCapsule.bytesHex);
    expect(capsule.ownerBlockId).toBe(manifest.unsupportedCapsule.ownerSlot.blockId);
    expect(capsule.childIndex).toBe(manifest.unsupportedCapsule.ownerSlot.childIndex);
  });
});

describe('semantic store — ModelChange and notifications', () => {
  test('emits accurate ModelChange with revision +1 and ordered notification', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const seen: number[] = [];
    store.subscribeModel((change) => seen.push(change.revisionAfter));
    const result = applyHuman(
      store,
      [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 4, text: '!' }],
      ['op-notify']
    );
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.change.revisionBefore).toBe(0);
    expect(result.change.revisionAfter).toBe(1);
    expect(result.change.normalized).toBe(true);
    expect(result.change.origin.kind).toBe('human');
    expect(seen).toEqual([1]);
  });

  test('keeps committed state when subscriber throws and reports error once', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    let notificationCount = 0;
    store.subscribeModel(() => {
      notificationCount += 1;
      throw new Error('subscriber blew up');
    });
    store.subscribeModel(() => {
      notificationCount += 1;
    });
    const result = applyHuman(
      store,
      [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: '!' }],
      ['op-subscriber']
    );
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(store.model.revision).toBe(1);
    expect(notificationCount).toBe(2);
    expect(result.subscriberErrors).toHaveLength(1);
    expect(result.subscriberErrors[0]?.message).toBe('subscriber blew up');
  });
});

describe('semantic store — normalization precedence', () => {
  test('uses frozen binding-oracle normalization order', () => {
    expect(NORMALIZATION_PRECEDENCE).toEqual([
      'repair-orphaned-mark-endpoints',
      'collapse-duplicate-semantic-ids-by-collision-precedence',
      'enforce-story-block-order-consistency',
      'drop-repair-orphans-after-delete-before-split-join',
      'merge-adjacent-text-runs-with-identical-marks',
      'remove-zero-length-marks',
    ]);
  });
});

describe('semantic store — adversarial inputs', () => {
  test('rejects untrusted DocOp batches and origin mismatch', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const forged = {
      version: 'doc-op/1',
      kind: 'batch',
      ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'x' }],
      transaction: {
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
        groupId: 'group-alice-1',
        constituentIds: ['op-1'],
      },
    };
    const untrusted = store.apply(
      forged as never,
      createMutationOrigin('human', { actorId: 'actor-alice', sessionId: 'session-alice-1' })
    );
    expect(untrusted.status).toBe('failed');

    const mismatch = store.apply(
      humanBatch(
        [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'x' }],
        ['op-1']
      ),
      createMutationOrigin('human', { actorId: 'actor-bob', sessionId: 'session-bob-1' })
    );
    expect(mismatch.status).toBe('failed');
  });

  test('rejects duplicate constituent IDs at DocOp boundary before apply', () => {
    expect(() =>
      createDocOpBatch({
        ops: [
          { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'a' },
          { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 1, text: 'b' },
        ],
        transaction: {
          actorId: 'actor-alice',
          sessionId: 'session-alice-1',
          groupId: 'group-alice-1',
          constituentIds: ['dup', 'dup'],
        },
      })
    ).toThrow(/duplicate constituent/);
  });
});
