/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
// A context menu opened from the keyboard (Shift+F10 or the Menu key) opens at the caret.
//
// The twin of the React adapter's keyboard tests. The keyboard event reports no pointer
// position, so the menu reads the caret rectangle from the editor and opens below it. Rows in
// `ContextMenu.Start` learn how the menu was opened.

import './dom-setup.ts';

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createApp, type App, defineComponent, h, type ShallowRef } from 'vue';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { useDocxEditor } from '../src/editor/context';
import {
  ContextMenuStart,
  DocxEditorContextMenu,
  useContextMenuAnchor,
  useContextMenuTarget,
} from '../src/editor/contextmenu/index.ts';
import { flush, SOURCE } from './helpers/fixtures.ts';

const t = (key: string): string => key;
const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalSize = { width: window.innerWidth, height: window.innerHeight };

function rectOf(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (this.classList.contains('docx-contextmenu')) {
      const left = Number.parseFloat(this.style.left) || 0;
      const top = Number.parseFloat(this.style.top) || 0;
      return rectOf(left, top, 200, 240);
    }
    // The page content box the caret is placed in, as if the page were scrolled into view.
    if (this.classList.contains('docx-page-content')) return rectOf(300, 120, 600, 800);
    if (this.classList.contains('docx-editor__scroll-container')) return rectOf(0, 0, 1200, 900);
    return originalRect.call(this);
  };
});

const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = '';
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  Object.defineProperty(window, 'innerWidth', { value: originalSize.width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: originalSize.height, configurable: true });
});

let editorRef: ShallowRef<DocxEditorInstance | null> | null = null;
const Probe = defineComponent({
  setup() {
    editorRef = useDocxEditor();
    return () => null;
  },
});

const seen: { trigger: string | null; target: HTMLElement | null }[] = [];
const OpenedBy = defineComponent({
  setup() {
    const anchor = useContextMenuAnchor();
    const target = useContextMenuTarget();
    seen.push({ trigger: anchor?.trigger ?? null, target });
    return () => null;
  },
});

async function mount(): Promise<HTMLElement> {
  seen.length = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        { document: SOURCE },
        {
          default: () =>
            h(DocxEditorViewport, null, {
              default: () => [
                h(DocxEditorContent),
                h(Probe),
                h(
                  DocxEditorContextMenu,
                  { t },
                  { default: () => [h(ContextMenuStart, null, { default: () => [h(OpenedBy)] })] }
                ),
              ],
            }),
        }
      ),
  });
  apps.push(app);
  app.mount(container);
  await flush();
  return container;
}

async function open(container: HTMLElement, init: MouseEventInit): Promise<HTMLElement> {
  const surface = container.querySelector('.docx-paginated-surface');
  if (!surface) throw new Error('no painted surface');
  surface.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...init })
  );
  await flush();
  const panel = container.querySelector<HTMLElement>('.docx-contextmenu');
  if (!panel) throw new Error('the menu did not open');
  return panel;
}

async function placeCaret(offset: number): Promise<void> {
  const editor = editorRef!.value!;
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  const at = { paragraphId, offset };
  expect(editor.exec({ type: 'setSelection', range: { anchor: at, head: at } }).ok).toBe(true);
  await flush();
}

const KEYBOARD: MouseEventInit = { button: -1, clientX: 0, clientY: 0 };

test('a keyboard-opened menu opens below the caret', async () => {
  const container = await mount();
  await placeCaret(5);
  const caret = editorRef!.value!.getCaretRect();
  expect(caret).not.toBeNull();
  expect(caret!.left).toBeGreaterThan(300);
  const panel = await open(container, KEYBOARD);
  expect(Number.parseFloat(panel.style.left)).toBeCloseTo(caret!.left, 5);
  expect(Number.parseFloat(panel.style.top)).toBeCloseTo(caret!.bottom, 5);
  expect(seen.at(-1)).toEqual({ trigger: 'keyboard', target: null });
});

test('a keyboard-opened menu follows the caret to another position', async () => {
  const container = await mount();
  await placeCaret(0);
  const start = editorRef!.value!.getCaretRect()!;
  await placeCaret(11);
  const end = editorRef!.value!.getCaretRect()!;
  expect(end.left).toBeGreaterThan(start.left);
  const panel = await open(container, KEYBOARD);
  expect(Number.parseFloat(panel.style.left)).toBeCloseTo(end.left, 5);
});

test('a right-click opens at the pointer and names its target', async () => {
  const container = await mount();
  const panel = await open(container, { button: 2, clientX: 420, clientY: 260 });
  expect(Number.parseFloat(panel.style.left)).toBe(420);
  expect(Number.parseFloat(panel.style.top)).toBe(260);
  expect(seen.at(-1)?.trigger).toBe('pointer');
  expect(seen.at(-1)?.target).not.toBeNull();
});

test('a keyboard-opened menu with no painted caret opens at the document corner', async () => {
  const container = await mount();
  await placeCaret(3);
  for (const page of container.querySelectorAll('.docx-page-content')) {
    page.classList.remove('docx-page-content');
  }
  expect(editorRef!.value!.getCaretRect()).toBeNull();
  const panel = await open(container, KEYBOARD);
  expect(Number.parseFloat(panel.style.left)).toBe(16);
  expect(Number.parseFloat(panel.style.top)).toBe(16);
  expect(seen.at(-1)?.trigger).toBe('keyboard');
});
