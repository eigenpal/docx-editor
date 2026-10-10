import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor } from '../../../packages/core/src/editor/docx-editor';
import { createDocumentRefresh } from '../../../packages/core/src/editor/document-refresh';
import { sampleDocx, sampleUpdate } from '../sample-document';
import { runRefreshJob, type ServerUpdate } from './refresh-job';
import type { RefreshResult } from '@docx-editor.dev/react';

const close: (() => void)[] = [];
afterEach(() => close.splice(0).forEach((dispose) => dispose()));
function open() {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: sampleDocx() });
  const refresh = createDocumentRefresh(editor);
  close.push(() => {
    editor.destroy();
    container.remove();
  });
  return { editor, refresh };
}

test('successive jobs apply cumulative files, summaries, and partial failures; late results cannot overwrite', async () => {
  const { editor, refresh } = open();
  const results: RefreshResult[] = [];
  for (const round of [1, 2]) {
    await runRefreshJob(
      refresh,
      new AbortController().signal,
      async function* (submission) {
        yield sampleUpdate(submission.id, round, 1);
        yield sampleUpdate(submission.id, round, 2);
        yield sampleUpdate(submission.id, round, 1);
      },
      (result) => results.push(result)
    );
    expect(refresh.snapshot().phase).toBe('complete');
    expect(editor.surface!.session.bodyText()).toContain(`Delivery date: October ${10 + round}.`);
    expect(editor.surface!.session.bodyText()).toContain(`Review date: October ${11 + round}.`);
    expect(editor.surface!.session.bodyText()).not.toContain('Section 31');
    expect(results.at(-1)).toMatchObject({ ok: false, code: 'out-of-order' });
    const accepted = results.at(-2)!;
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) continue;
    expect(accepted.failures).toEqual(['risk-summary']);
    expect(accepted.changes.map((change) => change.status)).toEqual([
      'available',
      'available',
      'unavailable',
      'deleted',
    ]);
    expect(refresh.highlightChanges({ includePrevious: true, timeoutMs: 5000 })).toBe(2);
    const saved = await editor.save();
    editor.load(saved);
    expect(editor.surface!.session.bodyText()).toContain(`Review date: October ${11 + round}.`);
  }
});

test('local edits stop a job and survive the refused replacement', async () => {
  const { editor, refresh } = open();
  const results: RefreshResult[] = [];
  await runRefreshJob(
    refresh,
    new AbortController().signal,
    async function* (submission) {
      editor.surface!.type('Keep my edit');
      yield sampleUpdate(submission.id, 1, 1);
      throw new Error('The client must stop receiving after refusal');
    },
    (result) => results.push(result)
  );
  expect(results).toMatchObject([{ ok: false, code: 'local-edits' }]);
  expect(editor.surface!.session.bodyText()).toContain('Keep my edit');
});

test('cancellation keeps accepted output and prevents later updates', async () => {
  const { editor, refresh } = open();
  const controller = new AbortController();
  const results: RefreshResult[] = [];
  await runRefreshJob(
    refresh,
    controller.signal,
    async function* (submission) {
      yield sampleUpdate(submission.id, 1, 1);
      controller.abort();
      refresh.cancel();
      yield sampleUpdate(submission.id, 1, 2);
    },
    (result) => results.push(result)
  );
  expect(results).toHaveLength(1);
  expect(editor.surface!.session.bodyText()).toContain('Delivery date: October 11.');
  expect(editor.surface!.session.bodyText()).not.toContain('Review date: October 12.');
});

for (const field of ['documentId', 'submissionId'] as const) {
  test(`rejects a foreign ${field} and closes the submission`, async () => {
    const { editor, refresh } = open();
    const original = editor.surface!.session.bodyText();
    await expect(
      runRefreshJob(
        refresh,
        new AbortController().signal,
        async function* (submission) {
          yield { ...sampleUpdate(submission.id, 1, 1), [field]: 'foreign' };
        },
        () => {
          throw new Error('Foreign output must not reach the editor');
        }
      )
    ).rejects.toThrow('identity-mismatch');
    expect(editor.surface!.session.bodyText()).toBe(original);
    expect(refresh.snapshot().phase).toBe('idle');
  });
}

test('transport failure closes the submission and permits a fresh request', async () => {
  const { refresh } = open();
  await expect(
    runRefreshJob(
      refresh,
      new AbortController().signal,
      async function* (): AsyncGenerator<ServerUpdate> {
        throw new Error('transport-failed');
      },
      () => {}
    )
  ).rejects.toThrow('transport-failed');
  expect(refresh.snapshot().phase).toBe('idle');
  const submission = await refresh.capture();
  refresh.finish(submission);
});
