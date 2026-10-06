import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, ref, shallowRef, type VNodeChild } from 'vue';
import { DEFAULT_REVISION_MARKUP, resolveRevisionMarkup, type DocxEditorInstance, type RevisionMarkupDialogSession, type ResolvedRevisionMarkup } from '@docx-editor.dev/core/editor';
import { DocxEditorRevisionMarkupDialog as Dialog, useRevisionMarkupDialog, type UseRevisionMarkupDialogReturn } from '../src/editor/DocxEditorRevisionMarkupDialog';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorRevisionMarkup } from '../src/editor/DocxEditorRevisionMarkup';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { reviewModule } from '../../pro/src/index';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });
function session() {
  const controller = new AbortController();
  let value = DEFAULT_REVISION_MARKUP;
  const listeners = new Set<() => void>();
  const saved: ResolvedRevisionMarkup[] = [];
  const update = (next: ResolvedRevisionMarkup) => { value = next; for (const listener of listeners) listener(); };
  const session: RevisionMarkupDialogSession = {
    signal: controller.signal, get: () => value,
    set: (patch) => update(resolveRevisionMarkup(patch, value)),
    reset: () => update(DEFAULT_REVISION_MARKUP),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    canApply: () => !controller.signal.aborted,
    apply: () => { saved.push(value); controller.abort(); return true; },
    cancel: () => controller.abort(),
  };
  return { session, saved, controller };
}
function mount(render: () => VNodeChild) {
  const container = document.createElement('div'); document.body.append(container);
  const app = createApp({ render }); app.mount(container);
  cleanup.push(() => { app.unmount(); container.remove(); });
  return container;
}

test('Vue markup dialog parts preserve draft writes, reset, external updates, and custom Apply', async () => {
  const state = session();
  const container = mount(() => h(Dialog, { session: state.session }, { default: () => [
    h(Dialog.Title, {}, { default: () => 'Custom tracking options' }),
    h(Dialog.Field, { name: 'formatting', hidden: true }),
    h(Dialog.Apply, { asChild: true }, { default: () => h('button', { 'data-save': '' }, 'Save preferences') }),
  ] }));
  await nextTick();
  expect(container.querySelector('[data-docx-part="title"]')?.textContent).toBe('Custom tracking options');
  expect(container.querySelector('[data-docx-field="formatting"]')).toBeNull();
  const select = container.querySelector<HTMLSelectElement>('[data-docx-field="insertions"] select')!;
  select.value = 'bold'; select.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  expect(state.session.get().insertions.mark).toBe('bold');
  expect(state.saved).toHaveLength(0);
  state.session.set({ insertions: { mark: 'italic' }, changedLines: { mark: 'rightBorder' } });
  await nextTick();
  expect(select.value).toBe('italic');
  expect(container.querySelector<HTMLElement>('.docx-revision-markup-preview')?.dataset.position).toBe('rightBorder');
  container.querySelector<HTMLButtonElement>('[data-docx-part="reset"]')!.click();
  await nextTick();
  expect(state.session.get()).toEqual(DEFAULT_REVISION_MARKUP);
  container.querySelector<HTMLButtonElement>('[data-save]')!.click();
  await nextTick();
  expect(state.saved).toHaveLength(1);
  expect(container.querySelector('dialog')).toBeNull();
});

test('Vue markup dialog supports an empty preset and a headless hook', async () => {
  const state = session();
  let hook: UseRevisionMarkupDialogReturn | undefined;
  const Custom = defineComponent({ setup() { hook = useRevisionMarkupDialog(); return () => h('output', hook!.values.value.insertions.mark); } });
  const container = mount(() => h(Dialog, { session: state.session, preset: false }, { default: () => [
    h(Dialog.Header, {}, { default: () => h(Dialog.Title, {}, { default: () => 'Preferences' }) }),
    h(Custom), h(Dialog.Reset, {}, { default: () => 'Defaults' }), h(Dialog.Cancel, {}, { default: () => 'Close' }),
  ] }));
  await nextTick();
  expect(container.querySelector('select')).toBeNull();
  hook!.setValue('insertions', { mark: 'bold', color: 'red' });
  await nextTick();
  expect(container.querySelector('output')?.textContent).toBe('bold');
  container.querySelector<HTMLButtonElement>('[data-docx-part="reset"]')!.click();
  await nextTick();
  expect(hook!.values.value.insertions.mark).toBe('underline');
  container.querySelector<HTMLButtonElement>('[data-docx-part="cancel"]')!.click();
  await nextTick();
  expect(state.saved).toHaveLength(0);
  expect(container.querySelector('dialog')).toBeNull();
});

test('Vue color controls preserve keyboard radio changes and close on Escape', async () => {
  const state = session();
  const container = mount(() => h(Dialog, { session: state.session }));
  await nextTick();
  const trigger = container.querySelector<HTMLButtonElement>('.docx-revision-color-trigger')!;
  trigger.click(); await nextTick();
  const group = container.querySelector<HTMLElement>('[role="radiogroup"]')!;
  const blue = group.querySelector<HTMLInputElement>('input[value="blue"]')!;
  blue.checked = true; blue.dispatchEvent(new Event('change', { bubbles: true }));
  blue.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  await nextTick();
  expect(group.hidden).toBe(false);
  expect(state.session.get().insertions.color).toBe('blue');
  blue.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await nextTick();
  expect(group.hidden).toBe(true);
  expect(document.activeElement).toBe(trigger);
  expect(container.querySelector('dialog')).not.toBeNull();
});

for (const mode of ['default', 'false', 'replacement'] as const) {
  test(`Vue popup configuration: revisionMarkup ${mode}`, async () => {
    let editor: DocxEditorInstance | undefined;
    let requested: RevisionMarkupDialogSession | undefined;
    const popups = mode === 'false' ? { revisionMarkup: false as const } : mode === 'replacement'
      ? { revisionMarkup: ({ session }: { session: RevisionMarkupDialogSession | null }) => { requested = session ?? undefined; return h('button', { 'data-replacement': '', onClick: () => session?.cancel() }, 'Custom options'); } } : undefined;
    const container = mount(() => h(DocxEditorRoot, { document: 'blank', modules: [reviewModule()], popups, onReady: (value: unknown) => { editor = value as DocxEditorInstance; } }, { default: () => h(DocxEditorViewport, {}, { default: () => h(DocxEditorContent) }) }));
    await nextTick(); await nextTick();
    expect(editor!.exec({ type: 'openRevisionMarkupDialog' }).ok).toBe(true);
    await nextTick();
    if (mode === 'default') expect(container.querySelector('[data-docx-dialog="revisionMarkup"]')).not.toBeNull();
    if (mode === 'false') expect(container.querySelector('dialog')).toBeNull();
    if (mode === 'replacement') {
      expect(container.querySelector('[data-replacement]')).not.toBeNull();
      expect(container.querySelector('dialog')).toBeNull();
      requested!.set({ insertions: { mark: 'bold' } });
      expect(editor!.snapshot().revisionMarkup.insertions.mark).toBe('underline');
      requested!.apply(); await nextTick();
      expect(editor!.snapshot().revisionMarkup.insertions.mark).toBe('bold');
      expect(container.querySelector('[data-replacement]')).toBeNull();
    }
  });
}

test('Vue hides the changed-line preview with its field and closes palettes outside their group', async () => {
  const state = session();
  const container = mount(() => h(Dialog, { session: state.session }, { default: () => h(Dialog.Field, { name: 'changedLines', hidden: true }) }));
  await nextTick();
  expect(container.querySelector('.docx-revision-markup-preview')).toBeNull();
  const triggers = container.querySelectorAll<HTMLButtonElement>('.docx-revision-color-trigger');
  const groups = container.querySelectorAll<HTMLElement>('[role="radiogroup"]');
  triggers[0]!.click(); await nextTick();
  expect(groups[0]!.hidden).toBe(false);
  triggers[1]!.focus(); triggers[1]!.click(); await nextTick();
  expect(groups[0]!.hidden).toBe(true);
  expect(groups[1]!.hidden).toBe(false);
  container.querySelector('legend')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await nextTick();
  expect(groups[1]!.hidden).toBe(true);
});

for (const disabled of [false, true]) {
  test(`Vue direct attach keeps native markup fallback unless disabled (${disabled})`, async () => {
    let editor: DocxEditorInstance | undefined;
    const surface = document.createElement('div'); document.body.append(surface);
    cleanup.push(() => surface.remove());
    mount(() => h(DocxEditorRoot, { document: 'blank', modules: [reviewModule()],
      popups: disabled ? { revisionMarkup: false } : undefined,
      onReady: (value: unknown) => { editor = value as DocxEditorInstance; },
    }));
    await nextTick(); await nextTick();
    editor!.attach(surface);
    expect(editor!.exec({ type: 'openRevisionMarkupDialog' }).ok).toBe(true);
    await nextTick();
    expect(surface.querySelector('dialog') !== null).toBe(!disabled);
  });
}

for (const declaration of [false, true]) {
  test(`Vue equivalent markup props preserve an open draft (declaration=${declaration})`, async () => {
    let editor: DocxEditorInstance | undefined;
    let requested: RevisionMarkupDialogSession | undefined;
    const renderCount = ref(0);
    mount(() => h(DocxEditorRoot, {
      document: 'blank', modules: [reviewModule()],
      revisionMarkup: declaration ? undefined : { insertions: { mark: 'underline' } },
      zoom: 1 + renderCount.value / 10,
      popups: { revisionMarkup: ({ session }: { session: RevisionMarkupDialogSession | null }) => { requested = session ?? undefined; return null; } },
      onReady: (value: unknown) => { editor = value as DocxEditorInstance; },
    }, { default: () => [
      declaration ? h(DocxEditorRevisionMarkup, { insertions: { mark: 'underline' } }) : null,
      h(DocxEditorViewport, {}, { default: () => h(DocxEditorContent) }),
    ] }));
    await nextTick(); await nextTick();
    editor!.exec({ type: 'openRevisionMarkupDialog' }); await nextTick();
    requested!.set({ insertions: { mark: 'bold' } });
    renderCount.value++; await nextTick(); await nextTick();
    expect(requested!.get().insertions.mark).toBe('bold');
    expect(editor!.snapshot().revisionMarkup.insertions.mark).toBe('underline');
  });
}

test('Vue manual markup dialog cancels disposed and replaced sessions', async () => {
  const first = session(); const second = session();
  const current = shallowRef<RevisionMarkupDialogSession | null>(first.session);
  const visible = ref(true);
  mount(() => visible.value ? h(Dialog, { session: current.value }) : null);
  await nextTick();
  current.value = second.session; await nextTick();
  expect(first.controller.signal.aborted).toBe(true);
  expect(second.controller.signal.aborted).toBe(false);
  visible.value = false; await nextTick();
  expect(second.controller.signal.aborted).toBe(true);
});

test.each(['byAuthor', 'lightPurple', 'lightGreen', 'gray'] as const)(
  'Vue cell palette applies %s',
  async (value) => {
    const state = session();
    const container = mount(() => h(Dialog, { session: state.session }));
    await nextTick();
    const field = container.querySelector('[data-docx-field="cells"]')!;
    field.querySelector<HTMLButtonElement>('.docx-revision-color-trigger')!.click();
    await nextTick();
    const radio = field.querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
    expect(radio).not.toBeNull();
    radio.click();
    await nextTick();
    expect(state.saved).toHaveLength(0);
    container.querySelector<HTMLButtonElement>('[data-docx-part="apply"]')!.click();
    await nextTick();
    expect(state.saved[0]!.cells.inserted).toBe(value);
  }
);
