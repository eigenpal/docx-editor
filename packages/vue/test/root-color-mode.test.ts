// `colorMode` on `DocxEditorRoot`: the composed parts carry `.dark` beside `.docx-editor`.
import './dom-setup.ts';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createApp, h, nextTick, ref } from 'vue';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { DocxEditorMenu } from '../src/editor/menu';

type Listener = (event: { matches: boolean }) => void;

/** A controllable `(prefers-color-scheme: dark)` query. */
const media = {
  matches: false,
  listeners: new Set<Listener>(),
  set(matches: boolean) {
    media.matches = matches;
    for (const listener of media.listeners) listener({ matches });
  },
};

const realMatchMedia = window.matchMedia;

beforeEach(() => {
  media.matches = false;
  media.listeners.clear();
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    get matches() {
      return media.matches;
    },
    addEventListener: (_type: string, listener: Listener) => media.listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => media.listeners.delete(listener),
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  (window as unknown as { matchMedia: unknown }).matchMedia = realMatchMedia;
});

function mount(initial?: 'light' | 'dark' | 'system') {
  const colorMode = ref<'light' | 'dark' | 'system' | undefined>(initial);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({
    render: () =>
      h(DocxEditorRoot, colorMode.value ? { colorMode: colorMode.value } : {}, {
        default: () => [
          h(DocxEditorMenu),
          h(DocxEditorToolbar),
          h(DocxEditorViewport, null, { default: () => [h(DocxEditorContent)] }),
        ],
      }),
  });
  app.mount(container);
  const parts = (): HTMLElement[] => [
    container.querySelector<HTMLElement>('.docx-menubar')!,
    container.querySelector<HTMLElement>('[data-testid="docx-toolbar"]')!,
    container.querySelector<HTMLElement>('[data-testid="docx-editor-scroll"]')!,
  ];
  return { colorMode, parts, unmount: () => app.unmount() };
}

describe('DocxEditorRoot colorMode', () => {
  test("'dark' puts .dark on every self-scoped part", async () => {
    const view = mount('dark');
    await nextTick();
    for (const element of view.parts()) {
      expect(element.classList.contains('docx-editor')).toBe(true);
      expect(element.classList.contains('dark')).toBe(true);
    }
    view.unmount();
  });

  test("omitted and 'light' keep the light chrome", async () => {
    const view = mount();
    await nextTick();
    for (const element of view.parts()) expect(element.classList.contains('dark')).toBe(false);
    view.colorMode.value = 'light';
    await nextTick();
    for (const element of view.parts()) expect(element.classList.contains('dark')).toBe(false);
    view.unmount();
  });

  test('a changed colorMode applies without a remount', async () => {
    const view = mount('light');
    await nextTick();
    const toolbar = view.parts()[1]!;
    view.colorMode.value = 'dark';
    await nextTick();
    expect(view.parts()[1]).toBe(toolbar);
    expect(toolbar.classList.contains('dark')).toBe(true);
    view.unmount();
  });

  test("'system' follows the OS setting as it changes", async () => {
    media.matches = true;
    const view = mount('system');
    await nextTick();
    for (const element of view.parts()) expect(element.classList.contains('dark')).toBe(true);
    media.set(false);
    await nextTick();
    for (const element of view.parts()) expect(element.classList.contains('dark')).toBe(false);
    media.set(true);
    await nextTick();
    for (const element of view.parts()) expect(element.classList.contains('dark')).toBe(true);
    view.unmount();
  });

  test("leaving 'system' stops following the OS setting", async () => {
    media.matches = true;
    const view = mount('system');
    await nextTick();
    expect(media.listeners.size).toBeGreaterThan(0);
    view.colorMode.value = 'light';
    await nextTick();
    expect(media.listeners.size).toBe(0);
    view.unmount();
  });
});
