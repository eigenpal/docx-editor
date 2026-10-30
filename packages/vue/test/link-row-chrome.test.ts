// The Vue twin of `packages/react/test/link-row-chrome.test.tsx`.

import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, defineComponent, h } from 'vue';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { useHyperlinkPopup } from '../src/editor/useHyperlinkPopup';
import { docx, flush } from './helpers/fixtures';

const SOURCE = docx('<w:p><w:r><w:t>Visit example today</w:t></w:r></w:p>');
const PID = '/word/document.xml#0.0.0';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function mount(hyperlinkPopup: boolean) {
  const container = document.createElement('div');
  document.body.append(container);
  let instance: DocxEditorInstance | null = null;
  const app = createApp({
    render: () =>
      h(DocxEditor, {
        document: SOURCE,
        hyperlinkPopup,
        onReady: (editor: unknown) => {
          instance = editor as DocxEditorInstance;
        },
      }),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await flush();
  instance!.surface!.setSelection({
    anchor: { paragraphId: PID, offset: 6 },
    head: { paragraphId: PID, offset: 13 },
  });
  await flush();
  return { container, editor: () => instance! };
}

async function openContextMenu(container: HTMLElement): Promise<HTMLElement> {
  container
    .querySelector('.docx-paginated-surface')!
    .dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 140 })
    );
  await flush();
  return container.querySelector<HTMLElement>('[role="menu"] [data-slot="text.link"]')!;
}

const toolbarLink = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>('.docx-toolbar button[data-slot="text.link"]')!;
const popup = (container: HTMLElement) =>
  container.querySelector('[data-testid="hyperlink-popup"]');

test('with the packaged popover, the row and the button are enabled', async () => {
  const { container } = await mount(true);
  expect(toolbarLink(container).disabled).toBe(false);
  expect((await openContextMenu(container)).getAttribute('aria-disabled')).toBeNull();
});

test('without a link UI, the row and the button are disabled with a reason', async () => {
  const { container } = await mount(false);
  const button = toolbarLink(container);
  expect(button.disabled).toBe(true);
  expect(button.title).toBe("Links can't be added here");
  const row = await openContextMenu(container);
  expect(row.getAttribute('aria-disabled')).toBe('true');
  expect(row.title).toBe("Links can't be added here");
  row.click();
  await flush();
  expect(popup(container)).toBeNull();
});

test("a host's own link UI enables both controls, and they open it", async () => {
  const { container, editor } = await mount(false);
  let requests = 0;
  const unregister = editor().setHyperlinkChrome({ onRequest: () => (requests += 1) });
  await flush();
  const button = toolbarLink(container);
  expect(button.disabled).toBe(false);
  button.click();
  expect(requests).toBe(1);
  const row = await openContextMenu(container);
  expect(row.getAttribute('aria-disabled')).toBeNull();
  row.click();
  await flush();
  expect(requests).toBe(2);
  expect(container.querySelector('[role="menu"].docx-contextmenu')).toBeNull();
  expect(popup(container)).toBeNull();

  unregister();
  await flush();
  expect(toolbarLink(container).disabled).toBe(true);
});

const HostLinkPanel = defineComponent({
  setup() {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- a Vue composable in setup
    const { state } = useHyperlinkPopup();
    return () => h('output', { 'data-testid': 'host-link-panel' }, state.value.mode);
  },
});

test('a host panel that calls useHyperlinkPopup() keeps the controls working', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  let instance: DocxEditorInstance | null = null;
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: SOURCE,
          onReady: (editor: unknown) => {
            instance = editor as DocxEditorInstance;
          },
        },
        {
          default: () => [
            h(
              DocxEditorToolbar,
              { preset: false, overflow: false },
              { default: () => [h(DocxEditorToolbar.Link)] }
            ),
            h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
            h(HostLinkPanel),
          ],
        }
      ),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await flush();
  instance!.surface!.setSelection({
    anchor: { paragraphId: PID, offset: 6 },
    head: { paragraphId: PID, offset: 13 },
  });
  await flush();
  const button = container.querySelector<HTMLButtonElement>('button[data-slot="text.link"]')!;
  expect(button.disabled).toBe(false);
  button.click();
  await flush();
  expect(container.querySelector('[data-testid="host-link-panel"]')!.textContent).toBe('editing');
});
