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
  const node = config({ t: () => 'catalog' });
  expect(node?.children).toBe('editor');
  expect(received).not.toHaveProperty('className');
});
