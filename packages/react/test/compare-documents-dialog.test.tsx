import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import type {
  CompareDocumentsDialogSession,
  DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import { reviewModule } from '../../pro/src/index';
import { zipDocument } from '../../pro/src/collaboration/__tests__/document-peer-support';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import {
  DocxEditorCompareDocumentsDialog as Dialog,
  useCompareDocumentsDialog,
} from '../src/editor/DocxEditorCompareDocumentsDialog';
import type { DocxEditorPopups } from '../src/editor/popup-config';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const ORIGINAL = zipDocument(paragraph('The quick brown fox.'));
const REVISED = zipDocument(paragraph('The quick red fox.'));

function mount(popups?: DocxEditorPopups) {
  let instance: DocxEditorInstance;
  const view = render(
    <StrictMode>
      <DocxEditorRoot
        document={ORIGINAL}
        author="Reviewer"
        modules={[reviewModule({})]}
        popups={popups}
        onReady={(editor) => {
          instance = editor as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    </StrictMode>
  );
  return { view, editor: () => instance! };
}

function chooseFile(input: HTMLElement, bytes: Uint8Array) {
  const file = new File([new Uint8Array(bytes)], 'revised.docx');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
}

test('the packaged React dialog compares into the open document as one undo step', async () => {
  const { view, editor } = mount();
  await waitFor(() => expect(editor()).toBeTruthy());
  await act(async () => {
    expect(editor().exec({ type: 'openCompareDocumentsDialog' }).ok).toBe(true);
  });
  const dialog = view.getByRole('dialog', { name: 'Compare documents' });
  expect(dialog.getAttribute('data-docx-dialog')).toBe('compareDocuments');
  expect((view.getByLabelText('Label changes with') as HTMLInputElement).value).toBe('Reviewer');
  expect((view.getByLabelText('Detect formatting changes') as HTMLInputElement).checked).toBe(true);
  const compare = view.getByText('Compare') as HTMLButtonElement;
  expect(compare.disabled).toBe(true);
  await act(async () => chooseFile(view.getByLabelText('Revised document'), REVISED));
  expect(compare.disabled).toBe(false);
  await act(async () => {
    fireEvent.click(compare);
  });
  await waitFor(
    () => {
      if (view.container.querySelector('dialog')) throw new Error('the dialog is still open');
    },
    { timeout: 5000 }
  );
  const session = editor().surface!.session;
  expect(session.reviewItems().length).toBeGreaterThan(0);
  await act(async () => {
    editor().exec({ type: 'undo' });
  });
  expect(session.reviewItems()).toHaveLength(0);
  expect(session.bodyText()).toBe('The quick brown fox.');
});

test('a refused compare shows its reason in the error part', async () => {
  const { view, editor } = mount();
  await waitFor(() => expect(editor()).toBeTruthy());
  await act(async () => {
    editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  await act(async () => chooseFile(view.getByLabelText('Revised document'), new Uint8Array([1])));
  await act(async () => {
    fireEvent.click(view.getByText('Compare'));
  });
  await waitFor(
    () => {
      const text = view.container.querySelector('[data-docx-part="error"]')?.textContent ?? '';
      if (!text.includes('not a document that can be compared')) throw new Error(text);
    },
    { timeout: 5000 }
  );
  expect(view.getByRole('dialog')).toBeTruthy();
});

test('a compare with no differences says so and keeps the dialog open', async () => {
  const { view, editor } = mount();
  await waitFor(() => expect(editor()).toBeTruthy());
  await act(async () => {
    editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  await act(async () => chooseFile(view.getByLabelText('Revised document'), ORIGINAL));
  await act(async () => {
    fireEvent.click(view.getByText('Compare'));
  });
  await waitFor(
    () => {
      const text = view.container.querySelector('[data-docx-part="notice"]')?.textContent ?? '';
      if (!text.includes('The documents have no differences.')) throw new Error(text);
    },
    { timeout: 5000 }
  );
  // A notice, not an error.
  expect(view.container.querySelector('[data-docx-part="error"]')?.textContent).toBe('');
  expect(view.getByRole('status').textContent).toBe('The documents have no differences.');
  expect(view.getByRole('dialog')).toBeTruthy();
  // Nothing remains to cancel: the button closes the dialog.
  expect(view.getByRole('button', { name: 'Close' })).toBeTruthy();
});

test('named parts replace defaults; popup false and replacements get cancellable sessions', async () => {
  function AuthorEcho() {
    return <span>Author: {useCompareDocumentsDialog().values.authorName}</span>;
  }
  const custom = mount({
    compareDocuments: (props) => (
      <Dialog {...props}>
        <Dialog.Title>Custom compare</Dialog.Title>
        <Dialog.Field name="detectFormatChanges" hidden />
        <AuthorEcho />
      </Dialog>
    ),
  });
  await waitFor(() => expect(custom.editor()).toBeTruthy());
  await act(async () => {
    custom.editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  expect(custom.view.getByText('Custom compare')).toBeTruthy();
  expect(custom.view.queryByLabelText('Detect formatting changes')).toBeNull();
  expect(custom.view.getByText('Author: Reviewer')).toBeTruthy();
  await act(async () => {
    fireEvent.click(custom.view.getByText('Cancel'));
  });
  expect(custom.view.queryByRole('dialog')).toBeNull();
  custom.view.unmount();

  const disabled = mount({ compareDocuments: false });
  await waitFor(() => expect(disabled.editor()).toBeTruthy());
  await act(async () => {
    disabled.editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  expect(disabled.view.queryByRole('dialog')).toBeNull();
  disabled.view.unmount();

  let session: CompareDocumentsDialogSession | null = null;
  const replaced = mount({
    compareDocuments: (props) => {
      session = props.session;
      return <button onClick={() => props.session?.cancel()}>Custom popup</button>;
    },
  });
  await waitFor(() => expect(replaced.editor()).toBeTruthy());
  await act(async () => {
    replaced.editor().exec({ type: 'openCompareDocumentsDialog' });
  });
  expect(replaced.view.getByText('Custom popup')).toBeTruthy();
  expect(session!.signal.aborted).toBe(false);
  await act(async () => {
    fireEvent.click(replaced.view.getByText('Custom popup'));
  });
  expect(session!.signal.aborted).toBe(true);
});
