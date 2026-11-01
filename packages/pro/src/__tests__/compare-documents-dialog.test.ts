/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { fireEvent, getByLabelText, getByRole, waitFor } from '@testing-library/react';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../review/review-module';
import { COMPARE_DOCUMENTS_ACCEPT } from '../review/compare-documents-dialog';
import { zipDocument } from '../collaboration/__tests__/document-peer-support';

const paragraphs = (...texts: string[]) =>
  texts.map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`).join('');

const ORIGINAL = zipDocument(paragraphs('The quick brown fox.', 'It jumps over the dog.'));
const REVISED = zipDocument(paragraphs('The quick red fox.', 'It jumps over the lazy dog.'));

let cleanup = () => {};
afterEach(() => cleanup());

function setup(): { container: HTMLElement; editor: DocxEditorInstance } {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: ORIGINAL,
    author: 'Reviewer',
    modules: [reviewModule({})],
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
  const file = getByLabelText(container, 'Revised document') as HTMLInputElement;
  expect(file.accept).toBe(COMPARE_DOCUMENTS_ACCEPT);
  expect((getByLabelText(container, 'Label changes with') as HTMLInputElement).value).toBe(
    'Reviewer'
  );
  const formatting = getByLabelText(container, 'Detect formatting changes') as HTMLInputElement;
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
    getByLabelText(container, 'Revised document') as HTMLInputElement,
    new Uint8Array([1, 2, 3])
  );
  fireEvent.click(getByRole(container, 'button', { name: 'Compare' }));
  const alert = await waitFor(
    () => {
      const node = container.querySelector('[role="alert"]');
      if (!node?.textContent?.includes('Could not compare the documents'))
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
  fireEvent.keyDown(getByLabelText(container, 'Label changes with'), { key: 'b', ctrlKey: true });
  expect(keydown).toBe(false);
  fireEvent.click(getByRole(container, 'button', { name: 'Cancel' }));
  expect(container.querySelector('dialog')).toBeNull();
  editor.exec({ type: 'openCompareDocumentsDialog' });
  fireEvent(container.querySelector('dialog')!, new Event('cancel', { cancelable: true }));
  expect(container.querySelector('dialog')).toBeNull();
  expect(bodyText(editor)).toBe('The quick brown fox.\nIt jumps over the dog.');
});
