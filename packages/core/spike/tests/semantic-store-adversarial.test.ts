import { describe, expect, test } from 'bun:test';
import {
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createSemanticDocumentStore,
  fingerprintAuthoredModel,
  type DocOpSingle,
  type SemanticDocumentStore,
} from '../src';

const STORY = 'story-body-0';
const VALID_ID = /^[A-Za-z][A-Za-z0-9-]{0,127}$/;
let nextBatchId = 1;

function batch(
  ops: DocOpSingle[],
  ids: string[] = ops.map((_, index) => `op-auto-${nextBatchId++}-${index + 1}`)
) {
  return createDocOpBatch({
    ops,
    transaction: {
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
      groupId: 'group-alice-1',
      constituentIds: ids,
    },
  });
}

function apply(store: SemanticDocumentStore, ops: DocOpSingle[], ids?: string[]) {
  return store.apply(
    batch(ops, ids),
    createMutationOrigin('human', {
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
    })
  );
}

function bold(blockId: string, start: number, end: number, enabled: boolean): DocOpSingle {
  return { kind: 'setMark', storyId: STORY, blockId, mark: 'bold', start, end, enabled };
}

describe('semantic store adversarial mark regressions', () => {
  test('middle subtraction creates two stable valid IDs and preserves the gap', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    expect(apply(store, [bold('block-para-000', 0, 4, true)], ['op-enable']).status).toBe(
      'applied'
    );
    const originalId = store.model.authored.body.paragraphs.get('para-000')!.marks[0]!.markId;

    const result = apply(store, [bold('block-para-000', 1, 3, false)], ['op-subtract']);
    expect(result.status).toBe('applied');
    const marks = store.model.authored.body.paragraphs
      .get('para-000')!
      .marks.filter((mark) => mark.kind === 'bold')
      .sort((a, b) => a.start - b.start);
    expect(marks.map(({ start, end }) => [start, end])).toEqual([
      [0, 1],
      [3, 4],
    ]);
    expect(marks[0]!.markId).toBe(originalId);
    expect(marks[1]!.markId).not.toBe(originalId);
    expect(marks.every((mark) => VALID_ID.test(mark.markId))).toBe(true);
    expect(new Set(marks.map((mark) => mark.markId)).size).toBe(2);
  });

  test('enabling an already-covered mark is a no-op without ID churn', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    expect(apply(store, [bold('block-para-000', 0, 4, true)], ['op-enable']).status).toBe(
      'applied'
    );
    const before = store.model.authored.body.paragraphs.get('para-000')!.marks;
    const revision = store.model.revision;

    const repeat = apply(store, [bold('block-para-000', 1, 3, true)], ['op-repeat']);
    expect(repeat.status).toBe('noOp');
    expect(store.model.revision).toBe(revision);
    expect(store.model.authored.body.paragraphs.get('para-000')!.marks).toEqual(before);
  });
});

describe('semantic store adversarial trust boundary', () => {
  test('snapshots mutable initial model and rejects caller alias mutation', () => {
    const fixture = createFrozenAuthoredFixture();
    const mutableParagraph = {
      ...fixture.authored.body.paragraphs.get('para-010')!,
      marks: [],
      authoredProperties: { lineHeightTwips: { state: 'omitted' as const } },
    };
    const paragraphs = new Map(fixture.authored.body.paragraphs);
    paragraphs.set('para-010', mutableParagraph);
    const input = {
      revision: 0,
      authored: {
        body: {
          storyId: STORY,
          paragraphOrder: [...fixture.authored.body.paragraphOrder],
          paragraphs,
        },
        capsules: fixture.authored.capsules,
      },
    };
    const store = createSemanticDocumentStore(input);
    mutableParagraph.text = 'attacker';
    paragraphs.delete('para-010');
    input.authored.body.paragraphOrder.splice(10, 1);
    expect(store.model.authored.body.paragraphs.get('para-010')!.text).toBe('p010');
    expect(store.model.authored.body.paragraphOrder).toContain('para-010');
  });

  test('rejects malformed initial UTF-16', () => {
    const fixture = createFrozenAuthoredFixture();
    const paragraphs = new Map(fixture.authored.body.paragraphs);
    paragraphs.set('para-010', {
      ...paragraphs.get('para-010')!,
      text: '\ud800',
      marks: [],
    });
    expect(() =>
      createSemanticDocumentStore({
        revision: 0,
        authored: {
          body: { ...fixture.authored.body, paragraphs },
          capsules: fixture.authored.capsules,
        },
      })
    ).toThrow(/UTF-16/);
  });

  test('rejects unpaired surrogate operation text without mutation', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const before = fingerprintAuthoredModel(store.model);
    const result = apply(store, [
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 0,
        text: '\udc00',
      },
    ]);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.code).toBe('invalid-text');
    expect(fingerprintAuthoredModel(store.model)).toBe(before);
  });

  test('closed origin accessor and extra fields fail without invocation or mutation', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const before = fingerprintAuthoredModel(store.model);
    let invoked = false;
    const accessor = Object.defineProperty(
      { domain: 'mutation', kind: 'human', actorId: 'actor-alice' },
      'sessionId',
      {
        enumerable: true,
        get() {
          invoked = true;
          return 'session-alice-1';
        },
      }
    );
    const result = store.apply(
      batch([{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'X' }]),
      accessor as never
    );
    expect(result.status).toBe('failed');
    expect(invoked).toBe(false);
    expect(fingerprintAuthoredModel(store.model)).toBe(before);

    const extra = store.apply(
      batch([{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'X' }]),
      {
        domain: 'mutation',
        kind: 'human',
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
        extra: true,
      } as never
    );
    expect(extra.status).toBe('failed');
    expect(fingerprintAuthoredModel(store.model)).toBe(before);
  });

  test('max-length constituent ID cannot fail post-stage ModelChange creation', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const tooLongForRepairId = `o${'x'.repeat(127)}`;
    const result = apply(
      store,
      [
        {
          kind: 'setMark',
          storyId: STORY,
          blockId: 'block-para-001',
          mark: 'bold',
          start: 0,
          end: 4,
          enabled: true,
        },
      ],
      [tooLongForRepairId]
    );
    expect(result.status).toBe('applied');
    if (result.status === 'applied' && result.change.repairEvidence) {
      expect(VALID_ID.test(result.change.repairEvidence.repairConstituentId)).toBe(true);
    }
  });

  test('join rejects deleting the frozen capsule owner without mutation', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const before = fingerprintAuthoredModel(store.model);
    const result = apply(store, [
      {
        kind: 'joinParagraphs',
        storyId: STORY,
        firstBlockId: 'block-para-002',
        secondBlockId: 'block-para-003',
      },
    ]);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.code).toBe('capsule-owner');
    expect(fingerprintAuthoredModel(store.model)).toBe(before);
  });
});

describe('semantic store adversarial allocator regressions', () => {
  test('failed and no-op operations do not consume identities', () => {
    const clean = createSemanticDocumentStore(createFrozenAuthoredFixture());
    apply(clean, [bold('block-para-000', 0, 2, true)]);
    const cleanId = clean.model.authored.body.paragraphs.get('para-000')!.marks[0]!.markId;

    const challenged = createSemanticDocumentStore(createFrozenAuthoredFixture());
    apply(challenged, [bold('block-para-999', 0, 1, true)]);
    apply(challenged, [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-000', start: 1, end: 1 }]);
    apply(challenged, [bold('block-para-000', 0, 2, true)]);
    expect(challenged.model.authored.body.paragraphs.get('para-000')!.marks[0]!.markId).toBe(
      cleanId
    );
  });

  test('split join split never reuses deleted tail identities', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    expect(
      apply(store, [
        { kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 2 },
      ]).status
    ).toBe('applied');
    const firstTailId = store.model.authored.body.paragraphOrder.find((id) => id.startsWith('para-010-'))!;
    const firstTailBlock = store.model.authored.body.paragraphs.get(firstTailId)!.blockId;
    expect(
      apply(store, [
        {
          kind: 'joinParagraphs',
          storyId: STORY,
          firstBlockId: 'block-para-010',
          secondBlockId: firstTailBlock,
        },
      ]).status
    ).toBe('applied');
    expect(
      apply(store, [
        { kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 2 },
      ]).status
    ).toBe('applied');
    const secondTailId = store.model.authored.body.paragraphOrder.find(
      (id) => id.startsWith('para-010-') && id !== firstTailId
    )!;
    expect(secondTailId).toBeDefined();
    expect(secondTailId).not.toBe(firstTailId);
    expect(VALID_ID.test(secondTailId)).toBe(true);
    expect(VALID_ID.test(store.model.authored.body.paragraphs.get(secondTailId)!.blockId)).toBe(true);
  });
});

describe('semantic store adversarial ModelChange regressions', () => {
  test('insert reports only the affected block ranges and dependencies', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const result = apply(store, [
      { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 2, text: 'X' },
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.change.structuralRangesBefore).toEqual([
      { storyId: STORY, blockId: 'block-para-010', start: 0, end: 4 },
    ]);
    expect(result.change.structuralRangesAfter).toEqual([
      { storyId: STORY, blockId: 'block-para-010', start: 0, end: 5 },
    ]);
    expect(result.change.dirtyDependencies).toContainEqual({
      dependencyKind: 'block',
      targetId: 'block-para-010',
    });
    expect(result.change.dirtyDependencies).toContainEqual({
      dependencyKind: 'style',
      targetId: 'style-default',
    });
  });

  test('split and join include exact created and deleted structural ranges', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const split = apply(store, [
      { kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 2 },
    ]);
    expect(split.status).toBe('applied');
    if (split.status !== 'applied') return;
    expect(split.change.structuralRangesBefore).toEqual([
      { storyId: STORY, blockId: 'block-para-010', start: 0, end: 4 },
    ]);
    expect(split.change.structuralRangesAfter).toHaveLength(2);
    const tail = split.change.structuralRangesAfter.find(
      (range) => range.blockId !== 'block-para-010'
    )!;

    const join = apply(store, [
      {
        kind: 'joinParagraphs',
        storyId: STORY,
        firstBlockId: 'block-para-010',
        secondBlockId: tail.blockId,
      },
    ]);
    expect(join.status).toBe('applied');
    if (join.status !== 'applied') return;
    expect(join.change.structuralRangesBefore.map((range) => range.blockId).sort()).toEqual(
      ['block-para-010', tail.blockId].sort()
    );
    expect(join.change.structuralRangesAfter).toEqual([
      { storyId: STORY, blockId: 'block-para-010', start: 0, end: 4 },
    ]);
  });

  test('insert reports every shifted mark as dirty with stable identity mappings', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const beforeMarks = store.model.authored.body.paragraphs.get('para-001')!.marks;
    const result = apply(store, [
      { kind: 'insertText', storyId: STORY, blockId: 'block-para-001', offset: 0, text: 'X' },
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    for (const mark of beforeMarks) {
      expect(result.change.dirtyDependencies).toContainEqual({
        dependencyKind: 'mark',
        targetId: mark.markId,
      });
      expect(result.change.identityMappings).toContainEqual({
        kind: 'mark',
        beforeId: mark.markId,
        afterId: mark.markId,
      });
    }
  });

  test('split maps moved and divided marks and dirties all resulting identities', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const beforeMarks = store.model.authored.body.paragraphs.get('para-001')!.marks;
    const result = apply(store, [
      { kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-001', offset: 2 },
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const afterMarks = [
      ...store.model.authored.body.paragraphs.get('para-001')!.marks,
      ...store.model.authored.body.paragraphs.get('para-001-tail')!.marks,
    ];
    const transformedIds = new Set([
      ...beforeMarks.filter((mark) => mark.end > 2).map((mark) => mark.markId),
      ...afterMarks
        .filter((mark) => mark.kind === 'italic')
        .map((mark) => mark.markId),
    ]);
    for (const markId of transformedIds) {
      expect(result.change.dirtyDependencies).toContainEqual({
        dependencyKind: 'mark',
        targetId: markId,
      });
    }
    for (const before of beforeMarks.filter((mark) => mark.end > 2)) {
      expect(
        result.change.identityMappings.some(
          (mapping) => mapping.kind === 'mark' && mapping.beforeId === before.markId
        )
      ).toBe(true);
    }
  });

  test('normalization is constrained to touched paragraphs', () => {
    const fixture = createFrozenAuthoredFixture();
    const paragraphs = new Map(fixture.authored.body.paragraphs);
    paragraphs.set('para-005', {
      ...paragraphs.get('para-005')!,
      marks: [
        { markId: 'mark-adjacent-a', kind: 'bold', start: 0, end: 2 },
        { markId: 'mark-adjacent-b', kind: 'bold', start: 2, end: 4 },
      ],
    });
    const store = createSemanticDocumentStore({
      revision: 0,
      authored: {
        body: { ...fixture.authored.body, paragraphs },
        capsules: fixture.authored.capsules,
      },
    });
    const result = apply(store, [
      { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'X' },
    ]);
    expect(result.status).toBe('applied');
    expect(store.model.authored.body.paragraphs.get('para-005')!.marks).toHaveLength(2);
    if (result.status === 'applied') {
      expect(
        result.change.dirtyDependencies.some(
          (dependency) => dependency.targetId === 'block-para-005'
        )
      ).toBe(false);
    }
  });

  test('delete and join report every transformed or deleted mark identity', () => {
    const deleteStore = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const deleted = apply(deleteStore, [
      { kind: 'deleteRange', storyId: STORY, blockId: 'block-para-001', start: 1, end: 4 },
    ]);
    expect(deleted.status).toBe('applied');
    if (deleted.status === 'applied') {
      expect(deleted.change.dirtyDependencies).toContainEqual({
        dependencyKind: 'mark',
        targetId: 'mark-para-001-italic',
      });
    }

    const joinStore = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const joined = apply(joinStore, [
      {
        kind: 'joinParagraphs',
        storyId: STORY,
        firstBlockId: 'block-para-000',
        secondBlockId: 'block-para-001',
      },
    ]);
    expect(joined.status).toBe('applied');
    if (joined.status === 'applied') {
      for (const markId of ['mark-para-001-bold', 'mark-para-001-italic']) {
        expect(joined.change.dirtyDependencies).toContainEqual({
          dependencyKind: 'mark',
          targetId: markId,
        });
        expect(joined.change.identityMappings).toContainEqual({
          kind: 'mark',
          beforeId: markId,
          afterId: markId,
        });
      }
    }
  });

  test('setMark merge maps every consumed mark to the created identity', () => {
    const fixture = createFrozenAuthoredFixture();
    const paragraphs = new Map(fixture.authored.body.paragraphs);
    paragraphs.set('para-005', {
      ...paragraphs.get('para-005')!,
      marks: [
        { markId: 'mark-adjacent-a', kind: 'bold', start: 0, end: 2 },
        { markId: 'mark-adjacent-b', kind: 'bold', start: 2, end: 4 },
      ],
    });
    const store = createSemanticDocumentStore({
      revision: 0,
      authored: {
        body: { ...fixture.authored.body, paragraphs },
        capsules: fixture.authored.capsules,
      },
    });
    const result = apply(store, [bold('block-para-005', 1, 3, true)]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const created = store.model.authored.body.paragraphs.get('para-005')!.marks[0]!.markId;
    for (const beforeId of ['mark-adjacent-a', 'mark-adjacent-b']) {
      expect(result.change.identityMappings).toContainEqual({
        kind: 'mark',
        beforeId,
        afterId: created,
      });
      expect(result.change.dirtyDependencies).toContainEqual({
        dependencyKind: 'mark',
        targetId: beforeId,
      });
    }
    expect(result.change.dirtyDependencies).toContainEqual({
      dependencyKind: 'mark',
      targetId: created,
    });
  });

  test('normalization merge reports repair, dirty marks, and many-to-one mapping', () => {
    const fixture = createFrozenAuthoredFixture();
    const paragraphs = new Map(fixture.authored.body.paragraphs);
    paragraphs.set('para-005', {
      ...paragraphs.get('para-005')!,
      marks: [
        { markId: 'mark-normalize-a', kind: 'bold', start: 0, end: 2 },
        { markId: 'mark-normalize-b', kind: 'bold', start: 2, end: 4 },
      ],
    });
    const store = createSemanticDocumentStore({
      revision: 0,
      authored: {
        body: { ...fixture.authored.body, paragraphs },
        capsules: fixture.authored.capsules,
      },
    });
    const result = apply(store, [
      { kind: 'insertText', storyId: STORY, blockId: 'block-para-005', offset: 4, text: 'X' },
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.change.repairEvidence?.appliedRepair).toBe(true);
    expect(result.change.identityMappings).toContainEqual({
      kind: 'mark',
      beforeId: 'mark-normalize-b',
      afterId: 'mark-normalize-a',
    });
    for (const markId of ['mark-normalize-a', 'mark-normalize-b']) {
      expect(result.change.dirtyDependencies).toContainEqual({
        dependencyKind: 'mark',
        targetId: markId,
      });
    }
  });
});

describe('semantic store adversarial derived IDs', () => {
  test('max-length valid actor and constituent IDs always produce valid internal IDs', () => {
    const actorId = `A${'a'.repeat(127)}`;
    const constituentId = `O${'o'.repeat(127)}`;
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const operation = createDocOpBatch({
      ops: [
        {
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 0,
          text: 'X',
        },
      ],
      transaction: {
        actorId,
        sessionId: 'session-max',
        groupId: 'group-max',
        constituentIds: [constituentId],
      },
    });
    const result = store.apply(
      operation,
      createMutationOrigin('human', { actorId, sessionId: 'session-max' })
    );
    expect(result.status).toBe('applied');
    if (result.status === 'applied') expect(VALID_ID.test(result.change.commitId)).toBe(true);
  });

  test('max-length paragraph and block IDs split to compact valid unique IDs', () => {
    const fixture = createFrozenAuthoredFixture();
    const paragraphId = `P${'p'.repeat(127)}`;
    const blockId = `B${'b'.repeat(127)}`;
    const paragraphs = new Map(fixture.authored.body.paragraphs);
    const original = paragraphs.get('para-010')!;
    paragraphs.delete('para-010');
    paragraphs.set(paragraphId, { ...original, paragraphId, blockId });
    const order = fixture.authored.body.paragraphOrder.map((id) =>
      id === 'para-010' ? paragraphId : id
    );
    const store = createSemanticDocumentStore({
      revision: 0,
      authored: {
        body: { storyId: STORY, paragraphOrder: order, paragraphs },
        capsules: fixture.authored.capsules,
      },
    });
    const result = apply(store, [
      { kind: 'splitParagraph', storyId: STORY, blockId, offset: 2 },
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const created = result.change.structuralRangesAfter.find((range) => range.blockId !== blockId)!;
    expect(VALID_ID.test(created.blockId)).toBe(true);
    const createdParagraphId = store.model.authored.body.paragraphOrder.find(
      (id) => id !== paragraphId && store.model.authored.body.paragraphs.get(id)?.blockId === created.blockId
    )!;
    expect(VALID_ID.test(createdParagraphId)).toBe(true);
  });
});

describe('semantic store adversarial notification serialization', () => {
  test('reentrant apply queues revision N+1 until every subscriber finishes N', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const events: string[] = [];
    let nested = false;
    store.subscribeModel((change) => {
      events.push(`a${change.revisionAfter}-start`);
      if (!nested) {
        nested = true;
        const result = apply(store, [
          { kind: 'insertText', storyId: STORY, blockId: 'block-para-011', offset: 0, text: 'Y' },
        ]);
        expect(result.status).toBe('applied');
      }
      events.push(`a${change.revisionAfter}-end`);
    });
    store.subscribeModel((change) => events.push(`b${change.revisionAfter}`));

    const result = apply(store, [
      { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'X' },
    ]);
    expect(result.status).toBe('applied');
    expect(events).toEqual([
      'a1-start',
      'a1-end',
      'b1',
      'a2-start',
      'a2-end',
      'b2',
    ]);
  });

  test('queued reentrant ApplyResult is frozen and never mutates after return', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    let nestedResult: ReturnType<typeof apply> | undefined;
    let snapshotAtReturn = '';
    store.subscribeModel((change) => {
      if (change.revisionAfter !== 1) throw new Error('nested subscriber failure');
      nestedResult = apply(store, [
        { kind: 'insertText', storyId: STORY, blockId: 'block-para-011', offset: 0, text: 'Y' },
      ]);
      snapshotAtReturn = JSON.stringify(nestedResult);
    });

    apply(store, [
      { kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'X' },
    ]);
    expect(nestedResult).toBeDefined();
    expect(Object.isFrozen(nestedResult)).toBe(true);
    expect(JSON.stringify(nestedResult)).toBe(snapshotAtReturn);
    expect(store.notificationDiagnostics()).toEqual([
      {
        revision: 2,
        subscriberIndex: 0,
        message: 'nested subscriber failure',
      },
    ]);
  });
});
