/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fireEvent, getByLabelText, getByRole, waitFor } from '@testing-library/react';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../review/review-module';
import { COMPARE_DOCUMENTS_ACCEPT } from '@docx-editor.dev/core/editor';
import { zipDocument } from '../collaboration/__tests__/document-peer-support';
import { COMPARE_WORKER_PROTOCOL } from '../compare/worker-protocol';
import { createT, type LocaleStrings } from '@docx-editor.dev/i18n';
import en from '../../../i18n/en.json' with { type: 'json' };
import {
  answeringCompareWorker,
  LOCKED_CONTENT_REFUSAL,
} from '../compare/__tests__/support/fake-compare-worker';

const paragraphs = (...texts: string[]) =>
  texts.map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`).join('');

const ORIGINAL = zipDocument(paragraphs('The quick brown fox.', 'It jumps over the dog.'));
const REVISED = zipDocument(paragraphs('The quick red fox.', 'It jumps over the lazy dog.'));

let cleanup = () => {};
afterEach(() => cleanup());

function setup(
  review: Parameters<typeof reviewModule>[0] = {},
  // The source catalog, so the tests read strings this change adds before a build.
  translate = createT(en as unknown as LocaleStrings) as (
    key: string,
    params?: Record<string, string | number>
  ) => string
): {
  container: HTMLElement;
  editor: DocxEditorInstance;
} {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: ORIGINAL,
    author: 'Reviewer',
    modules: [reviewModule(review)],
    translate,
  });
  cleanup = () => {
    editor.destroy();
    container.remove();
  };
  return { container, editor };
}

const bodyText = (editor: DocxEditorInstance) => editor.surface!.session.bodyText();

function chooseFile(input: HTMLInputElement, bytes: Uint8Array, name = 'revised.docx') {
  const file = new File([new Uint8Array(bytes)], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
}

test('the review module enables the command; the dialog compares into the open document', async () => {
  const { container, editor } = setup();
  expect(editor.can({ type: 'openCompareDocumentsDialog' }).ok).toBe(true);
  expect(editor.exec({ type: 'openCompareDocumentsDialog' }).ok).toBe(true);
  const dialog = getByRole(container, 'dialog', { name: 'Compare documents' });
  expect(dialog.getAttribute('data-docx-marker')).toBe('');
  expect(dialog.contentEditable).toBe('false');
  const file = getByLabelText(container, 'Compare with') as HTMLInputElement;
  expect(file.accept).toBe(COMPARE_DOCUMENTS_ACCEPT);
  expect((getByLabelText(container, 'Author of the changes') as HTMLInputElement).value).toBe(
    'Reviewer'
  );
  const formatting = getByLabelText(container, 'Include formatting changes') as HTMLInputElement;
  expect(formatting.checked).toBe(true);
  const compare = getByRole(container, 'button', { name: 'Compare' }) as HTMLButtonElement;
  expect(compare.disabled).toBe(true);

  chooseFile(file, REVISED);
  expect(compare.disabled).toBe(false);
  fireEvent.click(compare);
  // A cheap check: a failed matcher would print the whole painted page on every poll.
  await waitFor(
    () => {
      if (container.querySelector('dialog')) throw new Error('the dialog is still open');
    },
    { timeout: 5000 }
  );

  const items = editor.surface!.session.reviewItems();
  expect(items.length).toBeGreaterThan(0);
  // The dialog closed, so the editor's own live region says what the compare recorded.
  await waitFor(() => {
    const text = container.querySelector('.docx-editor-announcer')?.textContent ?? '';
    if (!/^Compare recorded \d+ changes\.$/.test(text)) throw new Error(text);
  });
  expect(items.every((item) => !('author' in item) || item.author === 'Reviewer')).toBe(true);
  // One undo step restores the original; redo reapplies the compare.
  editor.exec({ type: 'undo' });
  expect(editor.surface!.session.reviewItems()).toHaveLength(0);
  expect(bodyText(editor)).toBe('The quick brown fox.\nIt jumps over the dog.');
  expect(editor.surface!.session.canUndo()).toBe(false);
  editor.exec({ type: 'redo' });
  expect(editor.surface!.session.reviewItems()).toHaveLength(items.length);
});

test('a refused compare shows the reason and keeps the dialog open', async () => {
  const { container, editor } = setup();
  editor.exec({ type: 'openCompareDocumentsDialog' });
  chooseFile(
    getByLabelText(container, 'Compare with') as HTMLInputElement,
    new Uint8Array([1, 2, 3])
  );
  fireEvent.click(getByRole(container, 'button', { name: 'Compare' }));
  const alert = await waitFor(
    () => {
      const node = container.querySelector('[role="alert"]');
      if (!node?.textContent?.includes('not a document that can be compared'))
        throw new Error('no refusal yet');
      return node;
    },
    { timeout: 5000 }
  );
  expect(alert.closest('dialog')).not.toBeNull();
  expect((getByRole(container, 'button', { name: 'Compare' }) as HTMLButtonElement).disabled).toBe(
    false
  );
  expect(bodyText(editor)).toBe('The quick brown fox.\nIt jumps over the dog.');
});

test('Cancel and Escape close without comparing; editing keys stay in the dialog', () => {
  const { container, editor } = setup();
  editor.exec({ type: 'openCompareDocumentsDialog' });
  let keydown = false;
  container.addEventListener('keydown', () => {
    keydown = true;
  });
  fireEvent.keyDown(getByLabelText(container, 'Author of the changes'), {
    key: 'b',
    ctrlKey: true,
  });
  expect(keydown).toBe(false);
  fireEvent.click(getByRole(container, 'button', { name: 'Cancel' }));
  expect(container.querySelector('dialog')).toBeNull();
  editor.exec({ type: 'openCompareDocumentsDialog' });
  fireEvent(container.querySelector('dialog')!, new Event('cancel', { cancelable: true }));
  expect(container.querySelector('dialog')).toBeNull();
  expect(bodyText(editor)).toBe('The quick brown fox.\nIt jumps over the dog.');
});

test('a compare with no differences shows a notice and records nothing', async () => {
  const { container, editor } = setup();
  const revision = editor.surface!.session.packageRevision();
  editor.exec({ type: 'openCompareDocumentsDialog' });
  chooseFile(getByLabelText(container, 'Compare with') as HTMLInputElement, ORIGINAL);
  fireEvent.click(getByRole(container, 'button', { name: 'Compare' }));
  const notice = await waitFor(
    () => {
      const node = container.querySelector('[role="status"]');
      if (node?.textContent !== 'The documents have no differences.') throw new Error('not yet');
      return node;
    },
    { timeout: 5000 }
  );
  expect(notice.closest('dialog')).not.toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('');
  const buttons = [...notice.closest('dialog')!.querySelectorAll('button')];
  expect(buttons.map((button) => button.textContent)).toContain('Close');
  expect(editor.surface!.session.packageRevision()).toBe(revision);
  expect(editor.can({ type: 'undo' }).ok).toBe(false);
});

const WORKER = new URL('../compare-worker.ts', import.meta.url).href;

test('with the compare worker, the dialog shows progress and compares off the main thread', async () => {
  const { container, editor } = setup({
    compareWorker: () => new Worker(WORKER, { type: 'module' }),
  });
  editor.exec({ type: 'openCompareDocumentsDialog' });
  const progress = container.querySelector('.docx-compare-documents-progress') as HTMLElement;
  expect(progress.hidden).toBe(true);
  chooseFile(getByLabelText(container, 'Compare with') as HTMLInputElement, REVISED);
  fireEvent.click(getByRole(container, 'button', { name: 'Compare' }));
  await waitFor(() => {
    if (progress.hidden) throw new Error('no progress');
  });
  await waitFor(
    () => {
      if (container.querySelector('dialog')) throw new Error('the dialog is still open');
    },
    { timeout: 10000 }
  );
  expect(bodyText(editor)).toContain('red');
});

test('Cancel stops a running background compare and leaves the document as it was', async () => {
  const ended: string[] = [];
  const silent = () =>
    ({
      postMessage() {},
      addEventListener() {},
      terminate: () => ended.push('terminated'),
    }) as unknown as Worker;
  const { container, editor } = setup({ compareWorker: silent });
  const before = bodyText(editor);
  editor.exec({ type: 'openCompareDocumentsDialog' });
  chooseFile(getByLabelText(container, 'Compare with') as HTMLInputElement, REVISED);
  fireEvent.click(getByRole(container, 'button', { name: 'Compare' }));
  const cancel = getByRole(container, 'button', { name: 'Cancel' }) as HTMLButtonElement;
  await waitFor(() => {
    if (container.querySelector('progress')?.getAttribute('aria-busy') !== 'true')
      throw new Error('not busy');
  });
  expect(cancel.disabled).toBe(false);
  fireEvent.click(cancel);
  await waitFor(() => expect(ended).toEqual(['terminated']));
  expect(container.querySelector('dialog')).toBeNull();
  expect(bodyText(editor)).toBe(before);
  expect(editor.can({ type: 'undo' }).ok).toBe(false);
});

test('reviewModule refuses a compareWorker that is not a function', () => {
  expect(() => reviewModule({ compareWorker: 'worker.js' as never })).toThrow(TypeError);
  expect(() => reviewModule({ compareWorker: true as never })).toThrow(TypeError);
});

test('the packaged worker is the default, and false compares on the main thread', () => {
  expect(reviewModule().review?.compareDocumentsInBackground).toBeFunction();
  expect(reviewModule({ compareWorker: false }).review?.compareDocumentsInBackground).toBe(
    undefined
  );
});

test('without web workers, the default compares on the main thread', async () => {
  const saved = globalThis.Worker;
  // A server or an old runtime: the packaged worker cannot start.
  delete (globalThis as { Worker?: unknown }).Worker;
  try {
    const { container, editor } = setup();
    editor.exec({ type: 'openCompareDocumentsDialog' });
    chooseFile(getByLabelText(container, 'Compare with') as HTMLInputElement, REVISED);
    fireEvent.click(getByRole(container, 'button', { name: 'Compare' }));
    await waitFor(
      () => {
        if (container.querySelector('dialog')) throw new Error('not yet');
      },
      { timeout: 5000 }
    );
    expect(bodyText(editor)).toContain('red');
    expect(editor.can({ type: 'undo' }).ok).toBe(true);
  } finally {
    globalThis.Worker = saved;
  }
});

test('a refusal with a reason shows the message for that reason', async () => {
  const { container, editor } = setup({
    compareWorker: answeringCompareWorker(LOCKED_CONTENT_REFUSAL),
  });
  editor.exec({ type: 'openCompareDocumentsDialog' });
  chooseFile(getByLabelText(container, 'Compare with') as HTMLInputElement, REVISED);
  fireEvent.click(getByRole(container, 'button', { name: 'Compare' }));
  await waitFor(
    () => {
      const node = container.querySelector('[role="alert"]');
      if (!node?.textContent?.includes('locked or linked to data')) throw new Error('no refusal');
    },
    { timeout: 5000 }
  );
  expect(bodyText(editor)).toBe('The quick brown fox.\nIt jumps over the dog.');
});

/** A worker that reports one step and never finishes: the compare runs until Cancel. */
function steppingWorker(phase: string, fraction: number): () => Worker {
  return () => {
    let listener: ((event: { data: unknown }) => void) | undefined;
    return {
      postMessage() {
        queueMicrotask(() =>
          listener?.({
            data: { protocol: COMPARE_WORKER_PROTOCOL, type: 'progress', phase, fraction },
          })
        );
      },
      addEventListener(type: string, handler: (event: { data: unknown }) => void) {
        if (type === 'message') listener = handler;
      },
      terminate() {},
    } as unknown as Worker;
  };
}

test('the running step shows in words, with the bar, and the bar waits for the first step', async () => {
  const { container, editor } = setup({ compareWorker: steppingWorker('checking', 0.6) });
  editor.exec({ type: 'openCompareDocumentsDialog' });
  chooseFile(getByLabelText(container, 'Compare with') as HTMLInputElement, REVISED);
  fireEvent.click(getByRole(container, 'button', { name: 'Compare' }));
  const progress = container.querySelector('progress')!;
  const phase = container.querySelector('.docx-compare-documents-phase')!;
  // Indeterminate until the first step arrives.
  expect(progress.hasAttribute('value')).toBe(false);
  expect(phase.textContent).toBe('Comparing…');
  await waitFor(() => {
    if (phase.textContent !== 'Checking the result…') throw new Error(phase.textContent ?? '');
  });
  expect(progress.getAttribute('aria-valuetext')).toBe('Checking the result…');
  expect(progress.value).toBe(0.6);
  fireEvent.click(getByRole(container, 'button', { name: 'Cancel' }));
});

test('focus stays in the dialog when Compare disables itself, and returns after a refusal', async () => {
  const background = setup({ compareWorker: steppingWorker('comparing', 0.2) });
  background.editor.exec({ type: 'openCompareDocumentsDialog' });
  const container = background.container;
  chooseFile(getByLabelText(container, 'Compare with') as HTMLInputElement, REVISED);
  const compare = getByRole(container, 'button', { name: 'Compare' });
  compare.focus();
  fireEvent.click(compare);
  // A background compare can stop: Cancel takes focus.
  expect(document.activeElement?.textContent).toBe('Cancel');
  fireEvent.click(getByRole(container, 'button', { name: 'Cancel' }));
  cleanup();

  // On the main thread nothing can stop the compare: the busy status takes focus.
  const main = setup({ compareWorker: false });
  main.editor.exec({ type: 'openCompareDocumentsDialog' });
  const file = getByLabelText(main.container, 'Compare with') as HTMLInputElement;
  chooseFile(file, new Uint8Array([1, 2, 3]));
  fireEvent.click(getByRole(main.container, 'button', { name: 'Compare' }));
  expect(document.activeElement?.classList.contains('docx-compare-documents-phase')).toBe(true);
  await waitFor(
    () => {
      if (!main.container.querySelector('[role="alert"]')?.textContent) throw new Error('not yet');
    },
    { timeout: 5000 }
  );
  // After the refusal, the file input takes focus to choose another file.
  expect(document.activeElement).toBe(file);
});

test('an empty notice stays in the accessibility tree', () => {
  const { container, editor } = setup();
  editor.exec({ type: 'openCompareDocumentsDialog' });
  const notice = container.querySelector('.docx-compare-documents-notice') as HTMLElement;
  expect(notice.getAttribute('role')).toBe('status');
  expect(notice.hidden).toBe(false);
  expect(notice.hasAttribute('aria-hidden')).toBe(false);
  // Hidden from view only: the stylesheet never takes the empty region out of the tree.
  const css = readFileSync(
    new URL('../../../core/src/styles/editor.css', import.meta.url).pathname,
    'utf8'
  );
  const rule = css.slice(css.indexOf('.docx-compare-documents-notice:empty {'));
  expect(rule.slice(0, rule.indexOf('}'))).not.toContain('display: none');
});

test('the dialog says before a compare that the open tracked changes count as accepted', () => {
  const tracked = zipDocument(
    `${paragraphs('Before.')}<w:p><w:ins w:id="1" w:author="Ana" w:date="2026-01-01T00:00:00Z">` +
      '<w:r><w:t>Added.</w:t></w:r></w:ins></w:p>'
  );
  const noteOf = (bytes: Uint8Array) => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: bytes,
      modules: [reviewModule()],
      translate: createT(en as unknown as LocaleStrings) as (key: string) => string,
    });
    editor.exec({ type: 'openCompareDocumentsDialog' });
    const dialog = container.querySelector('dialog')!;
    const note = dialog.querySelector('.docx-compare-documents-tracked');
    const result = {
      text: note?.textContent ?? null,
      described: note ? (dialog.getAttribute('aria-describedby') ?? '').includes(note.id) : false,
    };
    editor.destroy();
    container.remove();
    return result;
  };
  expect(noteOf(tracked)).toEqual({
    text: 'The open document has tracked changes. The compare treats them as accepted.',
    described: true,
  });
  expect(noteOf(ORIGINAL)).toEqual({ text: null, described: false });
});
