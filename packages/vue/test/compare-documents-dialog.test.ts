import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, type VNodeChild } from 'vue';
import type {
  CompareDocumentsDialogSession,
  DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import {
  DocxEditorCompareDocumentsDialog as Dialog,
  useCompareDocumentsDialog,
} from '../src/editor/DocxEditorCompareDocumentsDialog';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import type { DocxEditorPopups } from '../src/editor/popup-config';
import { reviewModule } from '../../pro/src/index';
import { zipDocument } from '../../pro/src/collaboration/__tests__/document-peer-support';

const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const ORIGINAL = zipDocument(paragraph('The quick brown fox.'));
const REVISED = zipDocument(paragraph('The quick red fox.'));

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

function mount(render: () => VNodeChild) {
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({ render });
  app.mount(container);
  cleanup.push(() => {
    app.unmount();
    container.remove();
  });
  return container;
}

async function mountEditor(popups?: DocxEditorPopups) {
  let editor: DocxEditorInstance | undefined;
  const container = mount(() =>
    h(
      DocxEditorRoot,
      {
        document: ORIGINAL,
        author: 'Reviewer',
        modules: [reviewModule()],
        popups,
        onReady: (value: unknown) => {
          editor = value as DocxEditorInstance;
        },
      },
      { default: () => h(DocxEditorViewport, {}, { default: () => h(DocxEditorContent) }) }
    )
  );
  for (let i = 0; i < 20 && !editor; i += 1) await nextTick();
  // The dialog mount registers its chrome after the editor is ready.
  await nextTick();
  await nextTick();
  expect(editor).toBeDefined();
  return { container, editor: editor! };
}

const label = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll('label')]
    .find((node) => node.textContent?.includes(text))!
    .querySelector('input')!;

function chooseFile(input: HTMLInputElement, bytes: Uint8Array) {
  const file = new File([new Uint8Array(bytes)], 'revised.docx');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function until(check: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('the packaged Vue dialog compares into the open document as one undo step', async () => {
  const { container, editor } = await mountEditor();
  expect(editor.exec({ type: 'openCompareDocumentsDialog' }).ok).toBe(true);
  await nextTick();
  const dialog = container.querySelector('[data-docx-dialog="compareDocuments"]');
  expect(dialog).not.toBeNull();
  expect(label(container, 'Label changes with').value).toBe('Reviewer');
  expect(label(container, 'Detect formatting changes').checked).toBe(true);
  const compare = container.querySelector('[data-docx-part="apply"]') as HTMLButtonElement;
  expect(compare.disabled).toBe(true);
  chooseFile(label(container, 'Revised document'), REVISED);
  await nextTick();
  expect(compare.disabled).toBe(false);
  compare.click();
  await until(() => container.querySelector('dialog') === null);
  const session = editor.surface!.session;
  expect(session.reviewItems().length).toBeGreaterThan(0);
  editor.exec({ type: 'undo' });
  expect(session.reviewItems()).toHaveLength(0);
  expect(session.bodyText()).toBe('The quick brown fox.');
});

test('a refused compare shows its reason in the error part', async () => {
  const { container, editor } = await mountEditor();
  editor.exec({ type: 'openCompareDocumentsDialog' });
  await nextTick();
  chooseFile(label(container, 'Revised document'), new Uint8Array([1]));
  await nextTick();
  (container.querySelector('[data-docx-part="apply"]') as HTMLButtonElement).click();
  await until(
    () =>
      container
        .querySelector('[data-docx-part="error"]')
        ?.textContent?.includes('not a document that can be compared') ?? false
  );
  expect(container.querySelector('dialog')).not.toBeNull();
});

test('a compare with no differences shows a notice, not an error', async () => {
  const { container, editor } = await mountEditor();
  editor.exec({ type: 'openCompareDocumentsDialog' });
  await nextTick();
  chooseFile(label(container, 'Revised document'), ORIGINAL);
  await nextTick();
  (container.querySelector('[data-docx-part="apply"]') as HTMLButtonElement).click();
  await until(
    () =>
      container.querySelector('[data-docx-part="notice"]')?.textContent ===
      'The documents have no differences.'
  );
  expect(container.querySelector('[data-docx-part="error"]')?.textContent ?? '').toBe('');
  expect(container.querySelector('dialog')).not.toBeNull();
});

for (const mode of ['parts', 'false', 'replacement'] as const) {
  test(`Vue popup configuration: compareDocuments ${mode}`, async () => {
    let requested: CompareDocumentsDialogSession | undefined;
    const AuthorEcho = defineComponent({
      setup() {
        const state = useCompareDocumentsDialog();
        return () => h('span', `Author: ${state.values.value.authorName}`);
      },
    });
    const popups: DocxEditorPopups =
      mode === 'false'
        ? { compareDocuments: false }
        : mode === 'replacement'
          ? {
              compareDocuments: ({
                session,
              }: {
                session: CompareDocumentsDialogSession | null;
              }) => {
                requested = session ?? undefined;
                return h(
                  'button',
                  { 'data-replacement': '', onClick: () => session?.cancel() },
                  'Custom compare'
                );
              },
            }
          : {
              compareDocuments: (props: { session: CompareDocumentsDialogSession | null }) =>
                h(Dialog, props, {
                  default: () => [
                    h(Dialog.Title, null, { default: () => 'Custom compare' }),
                    h(Dialog.Field, { name: 'detectFormatChanges', hidden: true }),
                    h(AuthorEcho),
                  ],
                }),
            };
    const { container, editor } = await mountEditor(popups);
    expect(editor.exec({ type: 'openCompareDocumentsDialog' }).ok).toBe(true);
    await nextTick();
    await nextTick();
    if (mode === 'parts') {
      expect(container.textContent).toContain('Custom compare');
      expect(container.textContent).toContain('Author: Reviewer');
      expect(container.textContent).not.toContain('Detect formatting changes');
    }
    if (mode === 'false') expect(container.querySelector('dialog')).toBeNull();
    if (mode === 'replacement') {
      expect(container.querySelector('[data-replacement]')).not.toBeNull();
      expect(requested!.signal.aborted).toBe(false);
      (container.querySelector('[data-replacement]') as HTMLButtonElement).click();
      expect(requested!.signal.aborted).toBe(true);
    }
  });
}
