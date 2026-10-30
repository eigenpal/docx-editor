// `colorMode` on `DocxEditorRoot`: the composed parts carry `.dark` beside `.docx-editor`.
import './dom-setup.ts';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { DocxEditorMenu } from '../src/editor/menu';
import { DocxEditorWindow } from '../src/editor/DocxEditorWindow';
import { useEditorColorMode, useScopeClassName } from '../src/index';

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

  test("a pop-out window's editor root follows Root's colorMode", async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const view = frame.contentWindow as Window & typeof globalThis;
    view.close = () => {};
    const original = window.open;
    window.open = (() => view) as typeof window.open;
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({
      setup: () => () =>
        h(
          DocxEditorRoot,
          { colorMode: 'dark' },
          {
            default: () =>
              h(
                DocxEditorWindow,
                { open: true },
                { default: () => h('p', { 'data-testid': 'panel' }, 'panel') }
              ),
          }
        ),
    });
    try {
      app.mount(host);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await nextTick();
      const panel = view.document.querySelector('[data-testid="panel"]');
      expect(panel?.closest('.docx-editor')?.classList.contains('dark')).toBe(true);
    } finally {
      // Unmount while the window still exists; the teleport lives in its document.
      app.unmount();
      host.remove();
      frame.remove();
      window.open = original;
    }
  });

  test('useEditorColorMode reports the resolved theme to host parts', async () => {
    // A Vue setup function, named like a composable so the shared hooks lint rule reads it.
    function useProbeSetup() {
      const { colorMode } = useEditorColorMode();
      return () => h('output', { 'data-testid': 'theme' }, colorMode.value);
    }
    const Probe = defineComponent({ setup: useProbeSetup });
    const colorMode = ref<'light' | 'dark' | 'system' | undefined>();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(DocxEditorRoot, colorMode.value ? { colorMode: colorMode.value } : {}, {
          default: () => [h(Probe)],
        }),
    });
    app.mount(container);
    const theme = () => container.querySelector('[data-testid="theme"]')?.textContent;
    try {
      await nextTick();
      expect(theme()).toBe('light');
      colorMode.value = 'dark';
      await nextTick();
      expect(theme()).toBe('dark');
      colorMode.value = 'system';
      await nextTick();
      expect(theme()).toBe('light');
      media.set(true);
      await nextTick();
      expect(theme()).toBe('dark');
    } finally {
      app.unmount();
      container.remove();
    }
  });

  test('useScopeClassName adds dark under a dark Root', async () => {
    // A Vue setup function, named like a composable so the shared hooks lint rule reads it.
    function usePartSetup() {
      const scope = useScopeClassName();
      return () => h('div', { 'data-testid': 'part', class: `${scope}my-part` });
    }
    const Part = defineComponent({ setup: usePartSetup });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () => h(DocxEditorRoot, { colorMode: 'dark' }, { default: () => [h(Part)] }),
    });
    app.mount(container);
    try {
      await nextTick();
      expect(container.querySelector('[data-testid="part"]')!.className).toBe(
        'docx-editor dark my-part'
      );
    } finally {
      app.unmount();
      container.remove();
    }
  });
});
