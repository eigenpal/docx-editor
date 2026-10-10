import { definePopup } from '../src/editor/popup-renderer';
import { renderPopup } from '../src/editor/popup-renderer';
import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, h, nextTick, ref } from 'vue';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { createPackagedPopups, type DocxEditorPopups } from '../src/editor/popup-config';
import { SOURCE, flush } from './helpers/fixtures';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const t = (key: string) => key;

test('explicit nonmodal entries override legacy flags, including false', () => {
  const custom = () => h('span');
  const config = createPackagedPopups(
    { hyperlink: custom, contextMenu: custom, contentControl: false, equation: false },
    false,
    false,
    t
  );
  expect(config.hyperlink).toBe(custom);
  expect(typeof config.contextMenu).toBe('function');
  expect(config.contentControl).toBe(false);
  expect(config.equation).toBe(false);
  const disabled = createPackagedPopups({ hyperlink: false, contextMenu: false }, true, {}, t);
  expect(disabled.hyperlink).toBe(false);
  expect(disabled.contextMenu).toBe(false);
});

test('the packaged editor mounts a configured hyperlink exactly once inside Content', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(DocxEditor, {
        document: SOURCE,
        hyperlinkPopup: false,
        popups: { hyperlink: () => h('span', { 'data-custom-hyperlink': '' }, 'Link') },
      }),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await flush();
  const matches = container.querySelectorAll('[data-custom-hyperlink]');
  expect(matches.length).toBe(1);
  expect(matches[0]!.closest('.docx-content-mount')).not.toBeNull();
  expect(matches[0]!.closest('.docx-paginated-surface')).toBeNull();
});

test('Root hosts only configured nonmodal popups and honors live false entries', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const popups = ref<DocxEditorPopups>({});
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        { document: SOURCE, popups: popups.value },
        { default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }) }
      ),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await flush();
  expect(container.querySelector('[data-custom-hyperlink]')).toBeNull();
  popups.value = { hyperlink: () => h('span', { 'data-custom-hyperlink': '' }) };
  await nextTick();
  expect(container.querySelectorAll('[data-custom-hyperlink]').length).toBe(1);
  popups.value = { hyperlink: false };
  await nextTick();
  expect(container.querySelector('[data-custom-hyperlink]')).toBeNull();
});

test('note popup callbacks stay within the editor that receives the gesture', async () => {
  const { DocxEditorNotesChrome } = await import('../src/editor/DocxEditorNotes');
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(
        'div',
        [1, 2].map((id) =>
          h(
            DocxEditorRoot,
            {
              document: SOURCE,
              popups: {
                notesContextMenu: (props) =>
                  h('button', { 'data-note-owner': id, onClick: props.onClose }, props.scopeId),
              },
            },
            {
              default: () =>
                h(DocxEditorViewport, null, {
                  default: () => [
                    h(DocxEditorContent),
                    h(DocxEditorNotesChrome),
                    h(
                      'span',
                      { 'data-docx-note-scope': 'footnote:1', 'data-note-trigger': id },
                      'Note'
                    ),
                  ],
                }),
            }
          )
        )
      ),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await flush();
  container
    .querySelector('[data-note-trigger="2"]')!
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 30 }));
  await flush();
  expect(container.querySelector('[data-note-owner="1"]')).toBeNull();
  expect(container.querySelectorAll('[data-note-owner="2"]').length).toBe(1);
  (container.querySelector('[data-note-owner="2"]') as HTMLButtonElement).click();
  await nextTick();
  expect(container.querySelector('[data-note-owner]')).toBeNull();
});

test('explicit context menu receives editor translation without legacy options', () => {
  let received: unknown;
  const config = createPackagedPopups(
    {
      contextMenu: (props) => {
        received = props;
        return h('span', props.t?.('menu.copy'));
      },
    },
    true,
    { t: () => 'legacy', className: 'legacy-menu' },
    () => 'editor'
  ).contextMenu;
  if (!config) throw new Error('Expected custom renderer');
  const node = renderPopup(config, { t: () => 'catalog' });
  expect(node?.children).toBe('editor');
  expect(received).not.toHaveProperty('className');
});

test('component adapters retain setup state across recreated maps and isolate editors', async () => {
  const { defineComponent, onUnmounted } = await import('vue');
  const { useDocxEditor: editorContext } = await import('../src/editor/context');
  const revision = ref(0);
  const disabled = ref(false);
  const owners: unknown[] = [];
  let setups = 0;
  let unmounts = 0;
  const Custom = defineComponent({
    setup() {
      setups++;
      const editor = editorContext();
      const count = ref(0);
      onUnmounted(() => unmounts++);
      return () =>
        h(
          'button',
          {
            'data-component-popup': '',
            onClick: () => {
              owners.push(editor.value);
              count.value++;
            },
          },
          String(count.value)
        );
    },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      [0, 1].map((key) =>
        h(DocxEditor, {
          key,
          document: SOURCE,
          className: `revision-${revision.value}`,
          hyperlinkPopup: false,
          popups: { hyperlink: disabled.value ? false : definePopup(Custom) },
        })
      ),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await flush();
  const buttons = container.querySelectorAll<HTMLButtonElement>('[data-component-popup]');
  expect(buttons.length).toBe(2);
  expect(setups).toBe(2);
  buttons[0]!.click();
  await nextTick();
  revision.value++;
  await flush();
  expect(container.querySelector('[data-component-popup]')).toBe(buttons[0]);
  expect(buttons[0]!.textContent).toBe('1');
  expect(buttons[1]!.textContent).toBe('0');
  expect(setups).toBe(2);
  buttons[1]!.click();
  expect(owners[0]).not.toBeNull();
  expect(owners[1]).not.toBe(owners[0]);
  disabled.value = true;
  await nextTick();
  expect(container.querySelector('[data-component-popup]')).toBeNull();
  expect(unmounts).toBe(2);
});

test('session replacement resets custom component drafts while map recreation preserves them', async () => {
  const { defineComponent, shallowRef } = await import('vue');
  const session = shallowRef({ value: 'First' });
  let setups = 0;
  const Custom = defineComponent({
    props: { session: { type: Object, required: true } },
    setup(props) {
      setups++;
      const draft = ref(props.session.value);
      return () =>
        h('input', {
          value: draft.value,
          onInput: (e: Event) => {
            draft.value = (e.target as HTMLInputElement).value;
          },
        });
    },
  });
  const revision = ref(0);
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () => {
      revision.value;
      return renderPopup(definePopup(Custom), { session: session.value }, session.value);
    },
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  const input = container.querySelector('input')!;
  input.value = 'Draft';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  revision.value++;
  await nextTick();
  expect(container.querySelector('input')).toBe(input);
  expect(input.value).toBe('Draft');
  expect(setups).toBe(1);
  session.value = { value: 'Second' };
  await nextTick();
  expect(container.querySelector('input')).not.toBe(input);
  expect(container.querySelector('input')!.value).toBe('Second');
  expect(setups).toBe(2);
});
