// The Vue twin of `packages/react/test/context-menu-target.test.tsx`.

import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, h } from 'vue';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor';
import { docx, flush } from './helpers/fixtures';

const SOURCE = docx(
  '<w:p><w:r><w:t>Visit example today</w:t></w:r></w:p>' +
    '<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Color"/><w:enabled/><w:ddList><w:result w:val="1"/><w:listEntry w:val="Red"/><w:listEntry w:val="Green"/><w:listEntry w:val="Blue"/></w:ddList></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMDROPDOWN </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Green</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
);
const PID = '/word/document.xml#0.0.0';
const SELECTION = {
  anchor: { paragraphId: PID, offset: 6 },
  head: { paragraphId: PID, offset: 13 },
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  let instance: DocxEditorInstance | null = null;
  const app = createApp({
    render: () =>
      h(DocxEditor, {
        document: SOURCE,
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
  instance!.surface!.setSelection(SELECTION);
  await flush();
  return { container, editor: () => instance! };
}

const pages = (container: HTMLElement) => container.querySelector<HTMLElement>('.docx-pages')!;
const byTestId = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

async function keyDown(target: Element, init: KeyboardEventInit): Promise<void> {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  await flush();
}

/** Open the link popover over the selection, the way Ctrl/Cmd+K does. */
async function openLinkPopover(container: HTMLElement): Promise<HTMLInputElement> {
  await keyDown(pages(container), { key: 'k', ctrlKey: true, metaKey: true });
  const url = byTestId(container, 'hyperlink-popup-url-input') as HTMLInputElement;
  url.focus();
  url.value = 'https://example.com';
  url.dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
  url.setSelectionRange(0, 5);
  return url;
}

/** Dispatch a right-click, or the keyboard's context-menu key when `keyboard` is set. */
async function rightClick(target: Element, keyboard = false): Promise<MouseEvent> {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: keyboard ? -1 : 2,
    clientX: keyboard ? 0 : 120,
    clientY: keyboard ? 0 : 140,
  });
  target.dispatchEvent(event);
  await flush();
  return event;
}

const menu = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[role="menu"].docx-contextmenu');

test('the link popover renders inside the content mount, beside the pages', async () => {
  const { container } = await mount();
  const url = await openLinkPopover(container);
  expect(url.closest('.docx-content-mount')).not.toBeNull();
  expect(url.closest('.docx-paginated-surface')).toBeNull();
});

test('a right-click in the link URL field keeps the browser menu, focus and selection', async () => {
  const { container, editor } = await mount();
  const url = await openLinkPopover(container);
  const before = JSON.stringify(editor().surface!.session.part().root);
  const event = await rightClick(url);
  expect(event.defaultPrevented).toBe(false);
  expect(menu(container)).toBeNull();
  expect(document.activeElement).toBe(url);
  expect(url.value).toBe('https://example.com');
  expect([url.selectionStart, url.selectionEnd]).toEqual([0, 5]);
  expect(byTestId(container, 'hyperlink-popup').dataset.mode).toBe('editing');
  expect(editor().surface!.state().selection).toEqual(SELECTION);
  expect(JSON.stringify(editor().surface!.session.part().root)).toBe(before);
});

test('the context-menu key in the URL field keeps the browser menu', async () => {
  const { container } = await mount();
  const url = await openLinkPopover(container);
  expect((await rightClick(url, true)).defaultPrevented).toBe(false);
  expect(menu(container)).toBeNull();
  expect(document.activeElement).toBe(url);
});

test('the popover panel and its buttons keep the browser menu', async () => {
  const { container } = await mount();
  const url = await openLinkPopover(container);
  for (const id of ['hyperlink-popup', 'hyperlink-popup-cancel']) {
    expect((await rightClick(byTestId(container, id))).defaultPrevented).toBe(false);
    expect(menu(container)).toBeNull();
    expect(document.activeElement).toBe(url);
  }
});

test('a dialog keeps the browser menu', async () => {
  const { container } = await mount();
  await keyDown(pages(container), { key: 'F5', ctrlKey: true, shiftKey: true });
  const dialog = container.querySelector<HTMLElement>('[data-docx-dialog="bookmark"]')!;
  expect(dialog).not.toBeNull();
  expect(dialog.closest('.docx-content-mount')).not.toBeNull();
  expect((await rightClick(dialog.querySelector('label')!)).defaultPrevented).toBe(false);
  expect((await rightClick(dialog)).defaultPrevented).toBe(false);
  expect(menu(container)).toBeNull();
});

test('the pages and the canvas around them still open the document menu', async () => {
  const { container } = await mount();
  expect((await rightClick(pages(container))).defaultPrevented).toBe(true);
  expect(menu(container)).not.toBeNull();
  await keyDown(document.body, { key: 'Escape' });
  expect(menu(container)).toBeNull();
  const canvas = container.querySelector('.docx-editor__scroll-container')!;
  expect((await rightClick(canvas)).defaultPrevented).toBe(true);
  expect(menu(container)).not.toBeNull();
});

test('painted text, a painted drop-down field, and the mount beside the page open it', async () => {
  const { container } = await mount();
  const select = container.querySelector('.docx-pages select[data-docx-form-dropdown]');
  expect(select).not.toBeNull();
  const targets = [
    container.querySelector('.docx-pages [data-start]')!,
    select!,
    container.querySelector('.docx-content-mount')!,
  ];
  for (const target of targets) {
    expect((await rightClick(target)).defaultPrevented).toBe(true);
    expect(menu(container)).not.toBeNull();
    await keyDown(document.body, { key: 'Escape' });
  }
});

test('a right-click on the open menu keeps it in place and suppresses the browser menu', async () => {
  const { container } = await mount();
  await rightClick(pages(container));
  const panel = menu(container)!;
  const { left, top } = panel.style;
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: 400,
    clientY: 300,
  });
  panel.dispatchEvent(event);
  await flush();
  expect(event.defaultPrevented).toBe(true);
  expect(menu(container)).toBe(panel);
  expect([panel.style.left, panel.style.top]).toEqual([left, top]);
});
