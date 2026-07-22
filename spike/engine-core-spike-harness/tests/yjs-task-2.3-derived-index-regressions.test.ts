/** @spike-features one-body-story, paragraphs, stable-paragraph-ids, one-schema-backed-docx-editor-command, bold-mark */
import { describe, expect, test } from 'bun:test';
import {
  authoredFingerprintPayload,
  createFrozenAuthoredFixture,
  createLocalStoreBackend,
  createMutationOrigin,
  createSemanticDocumentStore,
  docRange,
  executeCommandOnServer,
  fingerprintAuthoredModel,
  planSemanticCommand,
  restoreLocalStoreBackend,
  validateAuthoredPackage,
  type AuthoredPackageModelInput,
  type DocxEditor,
} from '../src';
import {
  authoredBlockIdLookupWorkForTests,
  resetAuthoredBlockIdLookupWorkForTests,
} from '../src/model/internal/block-id-index-instrumentation';
import { resolveAuthoredParagraphByBlockId } from '../src/model/block-id-index';

const STORY = 'story-body-0';
const STRUCTURAL_ERROR = 'unknown or derived authored field';

function mutableFixtureInput(): AuthoredPackageModelInput {
  const source = createFrozenAuthoredFixture().authored;
  return {
    body: {
      storyId: source.body.storyId,
      paragraphOrder: [...source.body.paragraphOrder],
      paragraphs: new Map(source.body.paragraphs),
    },
    capsules: [...source.capsules],
  };
}

describe('task 2.3 review regressions — private derived block index', () => {
  test('canonical body omits blockIdIndex from enumerable shape and JSON', () => {
    const model = createFrozenAuthoredFixture();
    const body = model.authored.body;
    expect(Object.keys(body).sort()).toEqual(['paragraphOrder', 'paragraphs', 'storyId']);
    expect('blockIdIndex' in body).toBe(false);
    expect(JSON.stringify(model.authored)).not.toContain('blockIdIndex');
    expect(JSON.stringify(authoredFingerprintPayload(model))).not.toContain('blockIdIndex');
    expect(fingerprintAuthoredModel(model)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('validation rejects caller-supplied blockIdIndex instead of discarding it', () => {
    const authored = mutableFixtureInput();
    const staleIndex = new Map([
      ['block-para-010', 'para-999'],
      ['block-para-000', 'para-000'],
    ]);
    const errors = validateAuthoredPackage({
      ...authored,
      body: {
        ...authored.body,
        blockIdIndex: staleIndex,
      } as never,
    });
    expect(errors).toContain(STRUCTURAL_ERROR);
  });

  test('validation rejects reconstructed frozen bodies that carry a stale blockIdIndex', () => {
    const frozen = createFrozenAuthoredFixture().authored;
    const reconstructed = {
      body: {
        ...frozen.body,
        blockIdIndex: new Map([['block-para-010', 'para-000']]),
      },
      capsules: frozen.capsules,
    };
    expect(validateAuthoredPackage(reconstructed as never)).toContain(STRUCTURAL_ERROR);
  });

  test('resolver accepts only canonical registered bodies and ignores stale caller data', () => {
    const model = createFrozenAuthoredFixture();
    const canonicalBody = model.authored.body;
    const paragraph = resolveAuthoredParagraphByBlockId(canonicalBody, 'block-para-010');
    expect(paragraph?.paragraphId).toBe('para-010');

    const reconstructed = {
      storyId: canonicalBody.storyId,
      paragraphOrder: [...canonicalBody.paragraphOrder],
      paragraphs: canonicalBody.paragraphs,
      blockIdIndex: new Map([['block-para-010', 'para-000']]),
    };
    expect(resolveAuthoredParagraphByBlockId(reconstructed as never, 'block-para-010')).toBeUndefined();
  });

  test('duplicate block IDs fail during canonical freeze instead of silently indexing', () => {
    const authored = mutableFixtureInput();
    const duplicate = authored.body.paragraphs.get('para-001')!;
    const paragraphs = new Map(authored.body.paragraphs);
    paragraphs.set('para-099', { ...duplicate, paragraphId: 'para-099' });
    expect(() =>
      validateAuthoredPackage({
        ...authored,
        body: { ...authored.body, paragraphs },
      })
    ).not.toThrow();
    expect(
      validateAuthoredPackage({
        ...authored,
        body: { ...authored.body, paragraphs },
      })
    ).toContain('duplicate paragraph ID');
  });

  test('commit and restore rebuild O(1) block lookup on the canonical body', () => {
    const initial = createFrozenAuthoredFixture();
    const backend = createLocalStoreBackend(initial, { actorId: 'actor-server' });
    const store = createSemanticDocumentStore(initial, { backend });

    resetAuthoredBlockIdLookupWorkForTests();
    const beforeCommit = planSemanticCommand(
      { type: 'toggleMark', mark: 'bold' },
      {
        storyId: STORY,
        selection: docRange({ storyId: STORY, blockId: 'block-para-010', start: 0, end: 1 }),
        model: store.model,
      },
      {
        actorId: 'actor-server',
        sessionId: 'session-server-1',
        groupId: 'group-server-1',
        constituentId: 'op-task23-reindex-commit',
      }
    );
    expect(beforeCommit.result.status).toBe('applied');
    expect(authoredBlockIdLookupWorkForTests()).toBe(1);

    const applyResult = store.apply(
      beforeCommit.docOp!,
      createMutationOrigin('agent', {
        actorId: 'actor-server',
        sessionId: 'session-server-1',
      })
    );
    expect(applyResult.status).toBe('applied');

    resetAuthoredBlockIdLookupWorkForTests();
    const afterCommitBody = store.model.authored.body;
    expect(Object.keys(afterCommitBody)).not.toContain('blockIdIndex');
    expect(
      resolveAuthoredParagraphByBlockId(afterCommitBody, 'block-para-010')?.paragraphId
    ).toBe('para-010');
    expect(authoredBlockIdLookupWorkForTests()).toBe(1);

    const restored = restoreLocalStoreBackend(backend.encodeSnapshot());
    resetAuthoredBlockIdLookupWorkForTests();
    const restoredBody = restored.model.authored.body;
    expect(Object.keys(restoredBody)).not.toContain('blockIdIndex');
    expect(
      resolveAuthoredParagraphByBlockId(restoredBody, 'block-para-010')?.paragraphId
    ).toBe('para-010');
    expect(authoredBlockIdLookupWorkForTests()).toBe(1);
  });
});

describe('task 2.3 review regressions — public command result shape', () => {
  function serverContext(
    store: ReturnType<typeof createSemanticDocumentStore>,
    selection: DocxEditor.DocRange | null = null
  ) {
    return {
      store,
      actorId: 'actor-server',
      sessionId: 'session-server-1',
      groupId: 'group-server-1',
      selection,
      originKind: 'agent' as const,
    };
  }

  test('executeCommandOnServer returns DocxEditor.CommandResult directly', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const selection = docRange({
      storyId: STORY,
      blockId: 'block-para-010',
      start: 0,
      end: 4,
    });
    const result = executeCommandOnServer(serverContext(store, selection), {
      type: 'toggleMark',
      mark: 'bold',
    });
    expect(result).toEqual({ status: 'applied', changed: true });
    expect(Object.keys(result).sort()).toEqual(['changed', 'status']);
  });

  test('failed invalid-command and empty-selection no-op match EditorDriver semantics', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const invalid = executeCommandOnServer(serverContext(store), {
      type: 'toggleMark',
      mark: 'italic',
    });
    expect(invalid).toEqual({
      status: 'failed',
      code: 'invalid-command',
      reason: 'command payload failed schema validation',
    });

    const fingerprintBefore = fingerprintAuthoredModel(store.model);
    let notifications = 0;
    store.subscribeModel(() => {
      notifications += 1;
    });
    const noOp = executeCommandOnServer(
      serverContext(store, docRange({ storyId: STORY, blockId: 'block-para-010', start: 2, end: 2 })),
      { type: 'toggleMark', mark: 'bold' }
    );
    expect(noOp).toEqual({ status: 'noOp', changed: false, reason: 'empty selection' });
    expect(notifications).toBe(0);
    expect(store.model.revision).toBe(0);
    expect(fingerprintAuthoredModel(store.model)).toBe(fingerprintBefore);
  });

  test('applied command commits one canonical revision through the store', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    let notifications = 0;
    store.subscribeModel((change) => {
      notifications += 1;
      expect(change.revisionAfter).toBe(1);
    });
    const result = executeCommandOnServer(
      serverContext(
        store,
        docRange({ storyId: STORY, blockId: 'block-para-010', start: 0, end: 4 })
      ),
      { type: 'toggleMark', mark: 'bold' }
    );
    expect(result).toEqual({ status: 'applied', changed: true });
    expect(notifications).toBe(1);
    expect(store.model.revision).toBe(1);
  });
});
