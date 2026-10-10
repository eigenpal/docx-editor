import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { createDocumentRefresh } from '../document-refresh.ts';
import { refreshFixture, refreshMetadata } from './document-refresh-fixture.ts';
import { formFieldDocx } from './form-field-docx.fixture.ts';
import { collectReviewItems } from '../../store/index.ts';
import { strFromU8, unzipSync } from 'fflate';

const dispose: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of dispose.splice(0)) cleanup();
});
function open(bytes = refreshFixture(), review = false) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: bytes,
    locale: 'en-GB',
    modules: review
      ? [
          {
            id: 'review',
            review: {
              displayModes: ['all-markup', 'proposed', 'original'],
              collectReviewItems,
              revisionItemsOfParagraph: () => [],
            },
          },
        ]
      : [],
  });
  const refresh = createDocumentRefresh(editor);
  dispose.push(() => {
    editor.destroy();
    container.remove();
  });
  return { container, editor, refresh };
}

test('capture waits for composition and exports the composed text', async () => {
  const { container, editor, refresh } = open();
  const pages = container.querySelector<HTMLElement>('.docx-pages')!;
  pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  let complete = false;
  const capturing = refresh.capture().then((value) => {
    complete = true;
    return value;
  });
  await Promise.resolve();
  expect(complete).toBe(false);
  const span = container.querySelector<HTMLElement>('[data-paragraph-id][data-start]')!;
  span.textContent = 'Composed ' + span.textContent;
  pages.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'Composed ' }));
  const submission = await capturing;
  expect(editor.surface!.session.bodyText()).toContain('Composed');
  expect(strFromU8(unzipSync(new Uint8Array(submission.bytes))['word/document.xml']!)).toContain(
    'Composed'
  );
});

test('cancel releases a capture waiting for composition', async () => {
  const { container, refresh } = open();
  container
    .querySelector('.docx-pages')!
    .dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  const pending = refresh.capture();
  refresh.cancel();
  await expect(pending).rejects.toMatchObject({ code: 'superseded' });
});

test('capture finalizes form values; pending form edits reject returned files', async () => {
  const { editor, refresh } = open(formFieldDocx(true));
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  const enter = (text: string) => {
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 10 },
    });
    editor.surface!.pasteRich(text, null);
  };
  enter('03/04/2030');
  const submission = await refresh.capture();
  expect(editor.surface!.session.bodyText()).toBe('04/03/2030 tail');
  enter('05/06/2030');
  expect(
    await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })
  ).toMatchObject({
    code: 'local-edits',
  });
  expect(editor.surface!.session.bodyText()).toContain('06/05/2030');
});

test('a refresh observer cannot lose newly buffered input', async () => {
  const { editor, refresh } = open();
  const submission = await refresh.capture();
  let once = false;
  refresh.subscribe(() => {
    if (!once && refresh.snapshot().phase === 'refreshing') {
      once = true;
      editor.surface!.enqueueType('Observer input');
    }
  });
  expect(
    await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) })
  ).toMatchObject({
    code: 'local-edits',
  });
  expect(editor.surface!.session.bodyText()).toContain('Observer input');
  expect(refresh.recoveryBytes()).toBeNull();
});

test('a completion observer can switch documents without publishing stale state', async () => {
  const { editor, refresh } = open();
  const submission = await refresh.capture();
  refresh.subscribe(() => {
    if (refresh.snapshot().phase === 'complete') editor.load(refreshFixture(2));
  });
  expect(
    (
      await refresh.applyUpdate({
        submission,
        sequence: 1,
        bytes: refreshFixture(1),
        changes: refreshMetadata(),
      })
    ).ok
  ).toBe(true);
  expect(refresh.snapshot()).toMatchObject({ phase: 'idle', result: null, changes: [] });
});

test('cancellation from a mounted content observer preserves the accepted result', async () => {
  const { editor, refresh } = open();
  const submission = await refresh.capture();
  editor.on('change', (change) => {
    if (change.source === 'refresh') refresh.cancel();
  });
  const result = await refresh.applyUpdate({
    submission,
    sequence: 1,
    bytes: refreshFixture(1),
    changes: refreshMetadata(),
  });
  expect(result).toMatchObject({ ok: true });
  expect(editor.surface!.session.bodyText()).toContain('Updated delivery');
  expect(refresh.snapshot()).toMatchObject({ phase: 'complete', result });
  expect(refresh.highlightChanges({ animation: false })).toBe(1);
});

test('tracked revisions provide locations and distinguish existing revisions', async () => {
  const { editor, refresh } = open(refreshFixture(), true);
  const submission = await refresh.capture();
  const first = await refresh.applyUpdate({
    submission,
    sequence: 1,
    bytes: refreshFixture(1, false, true),
  });
  expect(first).toMatchObject({ ok: true, changeInformation: 'available' });
  expect(refresh.snapshot().changes).toHaveLength(1);
  expect(refresh.snapshot().changes[0]).toMatchObject({ status: 'available', isNew: true });
  const saved = await editor.save();
  const xml = strFromU8(unzipSync(new Uint8Array(saved))['word/document.xml']!);
  expect(xml).toContain('w:ins');
  expect(xml).toContain('Processor');
  await refresh.applyUpdate({ submission, sequence: 2, bytes: refreshFixture(2, false, true) });
  expect(refresh.snapshot().changes[0]!.isNew).toBe(false);
  const next = await refresh.capture();
  await refresh.applyUpdate({
    submission: next,
    sequence: 1,
    bytes: refreshFixture(2, false, true),
  });
  expect(refresh.snapshot().changes[0]!.isNew).toBe(false);
});

test('content changes within a stable tracked revision are recent', async () => {
  const { refresh } = open(refreshFixture(0, false, true), true);
  const submission = await refresh.capture();
  await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1, false, true) });
  expect(refresh.snapshot().changes[0]!.isNew).toBe(true);
});

test('undo cannot write while a deferred refresh is pending', async () => {
  const { editor, refresh } = open();
  editor.surface!.type('Existing edit');
  const submission = await refresh.capture();
  const applying = refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1, true) });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  const before = editor.surface!.session.bodyText();
  editor.surface!.undo();
  expect(editor.surface!.session.bodyText()).toBe(before);
  expect(editor.exec({ type: 'insertText', text: 'Blocked' }).ok).toBe(false);
  expect((await applying).ok).toBe(true);
});

test('a deferred mounting exception resolves through recovery', async () => {
  const { container, editor, refresh } = open();
  const submission = await refresh.capture();
  const original = container.replaceChildren.bind(container);
  let fail = true;
  container.replaceChildren = (...nodes) => {
    if (nodes.length && fail) {
      fail = false;
      throw new Error('deferred mount');
    }
    original(...nodes);
  };
  expect(
    await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1, true) })
  ).toMatchObject({ code: 'load-failed', recovered: true });
  expect(editor.surface!.session.bodyText()).not.toContain('Updated delivery date');
});

test('detaching during a deferred refresh never saves cancelled result bytes for remount', async () => {
  const { container, editor, refresh } = open();
  const submission = await refresh.capture();
  const applying = refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1, true) });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  editor.detach();
  editor.attach(container);
  expect(await applying).toMatchObject({ code: 'document-changed' });
  expect(editor.surface!.session.bodyText()).not.toContain('Updated delivery date');
});

test('finishing a failed request keeps its visible failure', async () => {
  const { refresh, editor } = open();
  const submission = await refresh.capture();
  editor.surface!.type('Local');
  await refresh.applyUpdate({ submission, sequence: 1, bytes: refreshFixture(1) });
  refresh.finish(submission);
  expect(refresh.snapshot()).toMatchObject({ phase: 'failed', result: { code: 'local-edits' } });
});

test('cancellation after an accepted result keeps its change navigation', async () => {
  const { refresh } = open();
  const submission = await refresh.capture();
  await refresh.applyUpdate({
    submission,
    sequence: 1,
    bytes: refreshFixture(1),
    changes: refreshMetadata(),
  });
  refresh.highlightChanges();
  refresh.cancel();
  expect(refresh.snapshot()).toMatchObject({ phase: 'complete', highlightsVisible: true });
  expect(refresh.snapshot().changes).toHaveLength(1);
});
