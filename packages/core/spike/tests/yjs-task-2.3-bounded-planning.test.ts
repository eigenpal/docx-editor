/** @spike-features one-schema-backed-docx-editor-command, bold-mark */
import { describe, expect, test } from 'bun:test';
import {
  createFrozenAuthoredFixture,
  createSemanticDocumentStore,
  docRange,
  draftFromAuthoredInvocationCountForTests,
  planSemanticCommand,
  resetDraftFromAuthoredInvocationCountForTests,
} from '../src';
import {
  authoredBlockIdLookupWorkForTests,
  resetAuthoredBlockIdLookupWorkForTests,
} from '../src/model/internal/block-id-index-instrumentation';

const STORY = 'story-body-0';

describe('task 2.3 bounded planning — reject before draft clone', () => {
  test('rejects invalid story, block, or range before draftFromAuthored', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    const transaction = {
      actorId: 'actor-server',
      sessionId: 'session-server-1',
      groupId: 'group-server-1',
      constituentId: 'op-task23-bounded-plan',
    };
    const command = { type: 'toggleMark' as const, mark: 'bold' as const };

    const invalidCases = [
      {
        label: 'nonexistent block',
        selection: docRange({
          storyId: STORY,
          blockId: 'block-para-missing',
          start: 0,
          end: 1,
        }),
      },
      {
        label: 'wrong story',
        selection: docRange({
          storyId: 'story-header-99',
          blockId: 'block-para-010',
          start: 0,
          end: 1,
        }),
      },
      {
        label: 'out-of-bounds utf-16 range',
        selection: docRange({
          storyId: STORY,
          blockId: 'block-para-010',
          start: 0,
          end: 999,
        }),
      },
    ];

    for (const { label, selection } of invalidCases) {
      resetDraftFromAuthoredInvocationCountForTests();
      resetAuthoredBlockIdLookupWorkForTests();
      const plan = planSemanticCommand(
        command,
        { storyId: STORY, selection, model: store.model },
        transaction
      );
      expect(plan.result.status, label).toBe('failed');
      if (plan.result.status === 'failed') {
        expect(plan.result.code, label).toBe('invalid-selection');
      }
      expect(plan.docOp, label).toBeNull();
      expect(draftFromAuthoredInvocationCountForTests(), `${label} must not clone authored model`).toBe(
        0
      );
    }
  });

  test('missing selected block ID does not scan every paragraph', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());
    expect(store.model.authored.body.paragraphOrder).toHaveLength(128);

    resetAuthoredBlockIdLookupWorkForTests();
    const plan = planSemanticCommand(
      { type: 'toggleMark', mark: 'bold' },
      {
        storyId: STORY,
        selection: docRange({
          storyId: STORY,
          blockId: 'block-para-missing',
          start: 0,
          end: 1,
        }),
        model: store.model,
      },
      {
        actorId: 'actor-server',
        sessionId: 'session-server-1',
        groupId: 'group-server-1',
        constituentId: 'op-task23-bounded-lookup',
      }
    );

    expect(plan.result.status).toBe('failed');
    if (plan.result.status === 'failed') {
      expect(plan.result.code).toBe('invalid-selection');
    }
    expect(authoredBlockIdLookupWorkForTests()).toBe(0);
  });

  test('existing block ID resolves with one direct lookup', () => {
    const store = createSemanticDocumentStore(createFrozenAuthoredFixture());

    resetAuthoredBlockIdLookupWorkForTests();
    const plan = planSemanticCommand(
      { type: 'toggleMark', mark: 'bold' },
      {
        storyId: STORY,
        selection: docRange({
          storyId: STORY,
          blockId: 'block-para-010',
          start: 0,
          end: 1,
        }),
        model: store.model,
      },
      {
        actorId: 'actor-server',
        sessionId: 'session-server-1',
        groupId: 'group-server-1',
        constituentId: 'op-task23-bounded-lookup-hit',
      }
    );

    expect(plan.result.status).toBe('applied');
    expect(authoredBlockIdLookupWorkForTests()).toBe(1);
  });
});
