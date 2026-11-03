/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, shallowRef, type VNodeChild } from 'vue';
import type {
  CompareDocumentsDialogSession,
  CompareDocumentsOutcome,
  CompareDocumentsProgress,
  DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import en from '../../i18n/en.json' with { type: 'json' };
import { LocaleProvider } from '../src/i18n/LocaleContext';
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
import {
  answeringCompareWorker,
  LOCKED_CONTENT_REFUSAL,
} from '../../pro/src/compare/__tests__/support/fake-compare-worker';

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

async function mountEditor(
  popups?: DocxEditorPopups,
  review: Parameters<typeof reviewModule>[0] = {}
) {
  let editor: DocxEditorInstance | undefined;
  const container = mount(() =>
    h(
      DocxEditorRoot,
      {
        document: ORIGINAL,
        author: 'Reviewer',
        modules: [reviewModule(review)],
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
  expect(label(container, 'Author of the changes').value).toBe('Reviewer');
  expect(label(container, 'Include formatting changes').checked).toBe(true);
  const compare = container.querySelector('[data-docx-part="apply"]') as HTMLButtonElement;
  expect(compare.disabled).toBe(true);
  chooseFile(label(container, 'Compare with'), REVISED);
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

test('the dialog host mounts a new form for each session, so no chosen file carries over', async () => {
  const { container, editor } = await mountEditor();
  editor.exec({ type: 'openCompareDocumentsDialog' });
  await nextTick();
  const firstInput = label(container, 'Compare with');
  chooseFile(firstInput, REVISED);
  await nextTick();
  const apply = () => container.querySelector('[data-docx-part="apply"]') as HTMLButtonElement;
  expect(apply().disabled).toBe(false);
  // A second request replaces the session while the dialog is open.
  expect(editor.exec({ type: 'openCompareDocumentsDialog' }).ok).toBe(true);
  await nextTick();
  await nextTick();
  // A new form: the file input is a new element with no file, and Compare waits for one.
  const nextInput = label(container, 'Compare with');
  expect(nextInput).not.toBe(firstInput);
  expect(nextInput.files?.length ?? 0).toBe(0);
  expect(apply().disabled).toBe(true);
});

test('a refused compare shows its reason in the error part', async () => {
  const { container, editor } = await mountEditor();
  editor.exec({ type: 'openCompareDocumentsDialog' });
  await nextTick();
  chooseFile(label(container, 'Compare with'), new Uint8Array([1]));
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
  chooseFile(label(container, 'Compare with'), ORIGINAL);
  await nextTick();
  (container.querySelector('[data-docx-part="apply"]') as HTMLButtonElement).click();
  await until(
    () =>
      container.querySelector('[data-docx-part="notice"]')?.textContent ===
      'The documents have no differences.'
  );
  expect(container.querySelector('[data-docx-part="error"]')?.textContent ?? '').toBe('');
  expect(container.querySelector('dialog')).not.toBeNull();
  expect(container.querySelector('[data-docx-part="cancel"]')?.textContent).toBe('Close');
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
      expect(container.textContent).not.toContain('Include formatting changes');
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

const WORKER = new URL('../../pro/src/compare-worker.ts', import.meta.url).href;

test('with the compare worker, the dialog compares off the main thread', async () => {
  const { container, editor } = await mountEditor(undefined, {
    compareWorker: () => new Worker(WORKER, { type: 'module' }),
  });
  editor.exec({ type: 'openCompareDocumentsDialog' });
  await nextTick();
  chooseFile(label(container, 'Compare with'), REVISED);
  await nextTick();
  (container.querySelector('[data-docx-part="apply"]') as HTMLButtonElement).click();
  await until(() => container.querySelector('dialog') === null, 10000);
  expect(editor.surface!.session.reviewItems().length).toBeGreaterThan(0);
});

test('Cancel stops a running background compare and leaves the document as it was', async () => {
  const ended: string[] = [];
  // A worker that never answers: the compare runs until Cancel.
  const silent = () =>
    ({
      postMessage() {},
      addEventListener() {},
      terminate: () => ended.push('terminated'),
    }) as unknown as Worker;
  const { container, editor } = await mountEditor(undefined, { compareWorker: silent });
  editor.exec({ type: 'openCompareDocumentsDialog' });
  await nextTick();
  chooseFile(label(container, 'Compare with'), REVISED);
  await nextTick();
  (container.querySelector('[data-docx-part="apply"]') as HTMLButtonElement).click();
  await until(() => container.querySelector('[data-docx-part="progress"]') !== null);
  const cancel = container.querySelector('[data-docx-part="cancel"]') as HTMLButtonElement;
  expect(cancel.disabled).toBe(false);
  cancel.click();
  await until(() => ended.length === 1);
  await until(() => container.querySelector('dialog') === null);
  expect(editor.surface!.session.bodyText()).toBe('The quick brown fox.');
  expect(editor.can({ type: 'undo' }).ok).toBe(false);
});

test('a refusal with a reason shows the message for that reason', async () => {
  const { container, editor } = await mountEditor(undefined, {
    compareWorker: answeringCompareWorker(LOCKED_CONTENT_REFUSAL),
  });
  editor.exec({ type: 'openCompareDocumentsDialog' });
  await nextTick();
  chooseFile(label(container, 'Compare with'), REVISED);
  await nextTick();
  (container.querySelector('[data-docx-part="apply"]') as HTMLButtonElement).click();
  await until(
    () =>
      container
        .querySelector('[data-docx-part="error"]')
        ?.textContent?.includes('locked or linked to data') ?? false
  );
  expect(container.querySelector('dialog')).not.toBeNull();
});

/** A session the test drives by hand: `apply` waits until the test answers it. */
function heldSession(cancelable: boolean, originalHasTrackedChanges = false) {
  const controller = new AbortController();
  const calls: {
    readonly onProgress?: (progress: CompareDocumentsProgress) => void;
    readonly answer: (outcome: CompareDocumentsOutcome) => void;
  }[] = [];
  const session: CompareDocumentsDialogSession = {
    signal: controller.signal,
    defaultAuthor: 'Reviewer',
    originalHasTrackedChanges,
    cancelable,
    canApply: () => !controller.signal.aborted,
    apply: (_request, options) =>
      new Promise((answer) => calls.push({ onProgress: options?.onProgress, answer })),
    cancel: () => controller.abort(),
  };
  return { session, calls };
}

// The source catalog, so the tests read strings this change adds before a build.
const inLocale = (node: () => VNodeChild) =>
  mount(() => h(LocaleProvider, { i18n: en as never }, { default: node }));

async function startCompare(container: HTMLElement) {
  chooseFile(label(container, 'Compare with'), REVISED);
  await nextTick();
  (container.querySelector('[data-docx-part="apply"]') as HTMLButtonElement).click();
  await nextTick();
  await nextTick();
}

test('a new session starts a fresh form: no busy state, progress, or draft carries over', async () => {
  const first = heldSession(true);
  const second = heldSession(true);
  const current = shallowRef(first.session);
  const container = inLocale(() => h(Dialog, { session: current.value }));
  await nextTick();
  await startCompare(container);
  expect(container.querySelector('[data-docx-part="apply"]')?.textContent).toBe('Comparing…');
  current.value = second.session;
  await nextTick();
  await nextTick();
  const compare = container.querySelector('[data-docx-part="apply"]') as HTMLButtonElement;
  expect(compare.textContent).toBe('Compare');
  expect(compare.disabled).toBe(true);
  expect(container.querySelector('[data-docx-part="progress"]')).toBeNull();
  expect(first.session.signal.aborted).toBe(true);
  // The old session's late answer does not reach the new form.
  first.calls[0]!.answer({ ok: false, code: 'closed', message: 'closed' });
  await nextTick();
  expect(container.querySelector('[data-docx-part="error"]')?.textContent ?? '').toBe('');
});

test('apply ignores a second submission while a compare runs', async () => {
  const held = heldSession(true);
  let state: ReturnType<typeof useCompareDocumentsDialog> | null = null;
  const Capture = defineComponent({
    setup() {
      state = useCompareDocumentsDialog();
      return () => null;
    },
  });
  const container = inLocale(() =>
    h(Dialog, { session: held.session }, { default: () => [h(Capture)] })
  );
  await nextTick();
  await startCompare(container);
  expect(state!.busy.value).toBe(true);
  state!.apply();
  await nextTick();
  expect(held.calls).toHaveLength(1);
});

test('the running step shows in words, with the bar, and the bar waits for the first step', async () => {
  const held = heldSession(true);
  const container = inLocale(() => h(Dialog, { session: held.session }));
  await nextTick();
  await startCompare(container);
  const progress = () => container.querySelector('progress')!;
  const phase = () => container.querySelector('.docx-compare-documents-phase')!;
  expect(progress().hasAttribute('value')).toBe(false);
  expect(phase().textContent).toBe(en.compareDocuments.comparing);
  held.calls[0]!.onProgress?.({ phase: 'checking', fraction: 0.6 });
  await nextTick();
  expect(phase().textContent).toBe('Checking the result…');
  expect(progress().getAttribute('aria-valuetext')).toBe('Checking the result…');
});

test('focus moves to Cancel or the busy status while busy, and to the file after a refusal', async () => {
  const background = heldSession(true);
  const first = inLocale(() => h(Dialog, { session: background.session }));
  await nextTick();
  await startCompare(first);
  expect(document.activeElement).toBe(first.querySelector('[data-docx-part="cancel"]'));
  for (const fn of cleanup.splice(0)) fn();

  const main = heldSession(false);
  const second = inLocale(() => h(Dialog, { session: main.session }));
  await nextTick();
  await startCompare(second);
  expect(document.activeElement?.classList.contains('docx-compare-documents-phase')).toBe(true);
  main.calls[0]!.answer({ ok: false, code: 'busy', message: 'busy' });
  await until(() => !!second.querySelector('[data-docx-part="error"]')?.textContent);
  await nextTick();
  expect(second.querySelector('[data-docx-part="error"]')?.textContent).toBe(
    en.compareDocuments.errors.busy
  );
  expect(document.activeElement).toBe(label(second, 'Compare with'));
});

test('Progress and Notice are named parts', async () => {
  const held = heldSession(true);
  const container = inLocale(() =>
    h(
      Dialog,
      { session: held.session },
      {
        default: () => [
          h(Dialog.Progress, { className: 'host-progress' }),
          h(Dialog.Notice, { className: 'host-notice' }),
        ],
      }
    )
  );
  await nextTick();
  await nextTick();
  expect(container.querySelector('.host-notice')?.getAttribute('role')).toBe('status');
  await startCompare(container);
  expect(container.querySelector('.host-progress progress')).not.toBeNull();
});

test('the dialog says before a compare that the open tracked changes count as accepted', async () => {
  const noteOf = async (tracked: boolean) => {
    const container = inLocale(() => h(Dialog, { session: heldSession(true, tracked).session }));
    await nextTick();
    const dialog = container.querySelector('dialog')!;
    const note = dialog.querySelector('[data-docx-part="trackedChanges"]');
    return {
      text: note?.textContent ?? null,
      described: note ? (dialog.getAttribute('aria-describedby') ?? '').includes(note.id) : false,
    };
  };
  expect(await noteOf(true)).toEqual({
    text: 'The open document has tracked changes. The compare treats them as accepted.',
    described: true,
  });
  expect(await noteOf(false)).toEqual({ text: null, described: false });
});
