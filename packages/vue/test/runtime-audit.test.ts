/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */

import './dom-setup.ts';

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createApp, createSSRApp, h, nextTick, ref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorNotesChrome } from '../src/editor/DocxEditorNotes';
import { editorScopeFor } from '../src/editor/editor-scope';
import { DocxEditorNavigation } from '../src/editor/navigation/DocxEditorNavigation';
import { DocxEditorToolbar, ToolbarAction, ToolbarSeparator } from '../src/editor/toolbar';
import {
  useDocxSource,
  type DocxSource,
  type UseDocxSourceOptions,
} from '../src/editor/useDocxSource';
import { mergeHostClass } from '../src/lib/mergeHostClass';
import { useStableDocxId } from '../src/lib/stable-id';
import { SOURCE, flush } from './helpers/fixtures';
import { mountEditorTree } from './helpers/mount';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('mergeHostClass', () => {
  test('keeps required classes and appends host class and className', () => {
    expect(mergeHostClass('required', 'host', 'legacy')).toBe('required host legacy');
    expect(mergeHostClass('required', undefined, 'legacy')).toBe('required legacy');
    expect(mergeHostClass('required')).toBe('required');
  });
});

describe('paired host class props', () => {
  test('Viewport and Content preserve load-bearing classes', async () => {
    const view = mountEditorTree(
      () => h(DocxEditorViewport, { class: 'host-viewport' }),
      SOURCE,
      () => h(DocxEditorContent, { className: 'host-content' })
    );
    await flush();
    const viewport = view.container.querySelector('[data-testid="docx-editor-scroll"]')!;
    const content = [
      ...view.container.querySelectorAll('.docx-content-mount > .docx-paginated-surface'),
    ].find((node) => node.className.includes('host-content'));
    expect(viewport.className).toContain('docx-editor__scroll-container');
    expect(viewport.className).toContain('host-viewport');
    expect(content?.className).toContain('docx-paginated-surface');
    expect(content?.className).toContain('host-content');
    view.unmount();
  });

  test('toolbar parts merge custom classes', async () => {
    const view = mountEditorTree(() =>
      h(DocxEditorToolbar, null, {
        default: () => [
          h(DocxEditorToolbar.Bold, { className: 'custom-bold' }),
          h(ToolbarAction, { label: 'Action', className: 'custom-action' }),
          h(ToolbarSeparator, { className: 'custom-separator' }),
        ],
      })
    );
    await flush();
    const bold = view.container.querySelector('[data-slot="text.bold"]')!;
    const action = view.container.querySelector('[aria-label="Action"]')!;
    const separator = view.container.querySelector('.custom-separator')!;
    expect(bold.className).toContain('docx-toolbar__button');
    expect(bold.className).toContain('custom-bold');
    expect(action.className).toContain('docx-toolbar__button');
    expect(action.className).toContain('custom-action');
    expect(separator.className).toContain('docx-toolbar__separator');
    expect(separator.className).toContain('custom-separator');
    view.unmount();
  });
});

describe('toolbar context reactivity', () => {
  test('updates labels and onSave when props change', async () => {
    const onSaveCalls: number[] = [];
    const tProp = ref<(key: string) => string>((key) => `X:${key}`);
    const onSaveProp = ref<(() => void) | undefined>(() => onSaveCalls.push(1));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(
            DocxEditorRoot,
            { document: SOURCE },
            {
              default: () =>
                h(
                  DocxEditorToolbar,
                  { t: tProp.value, onSave: onSaveProp.value },
                  { default: () => h(DocxEditorToolbar.Save) }
                ),
            }
          );
      },
    });
    app.mount(container);
    await flush();
    const save = () => container.querySelector('[data-slot="file.save"]') as HTMLButtonElement;
    expect(save().disabled).toBe(false);
    save().click();
    expect(onSaveCalls).toEqual([1]);
    onSaveProp.value = undefined;
    await nextTick();
    expect(save().disabled).toBe(true);
    tProp.value = (key) => `Y:${key}`;
    await nextTick();
    expect(save().getAttribute('aria-label')).toBe('Y:toolbar.saveShortcut');
    app.unmount();
    container.remove();
  });
});

describe('controlled navigation props', () => {
  test('reports open changes without moving itself when controlled', async () => {
    const seen: boolean[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          { document: SOURCE },
          {
            default: () =>
              h(DocxEditorNavigation, {
                open: false,
                onOpenChange: (next: boolean) => seen.push(next),
              }),
          }
        ),
    });
    app.mount(container);
    await flush();
    const nav = container.querySelector('.docx-nav')!;
    expect(nav.getAttribute('data-open')).toBe('false');
    (container.querySelector('.docx-nav__toggle') as HTMLButtonElement).click();
    expect(seen).toEqual([true]);
    expect(nav.getAttribute('data-open')).toBe('false');
    app.unmount();
    container.remove();
  });

  test('honours controlled tab prop', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const tab = ref<'headings' | 'find'>('headings');
    const app = createApp({
      setup() {
        return () =>
          h(
            DocxEditorRoot,
            { document: SOURCE },
            {
              default: () =>
                h(DocxEditorNavigation, {
                  open: true,
                  tab: tab.value,
                  onTabChange: (next: 'headings' | 'find') => {
                    tab.value = next;
                  },
                }),
            }
          );
      },
    });
    app.mount(container);
    await flush();
    const findTab = container.querySelector('#docx-nav-tab-find') as HTMLButtonElement;
    findTab.click();
    await nextTick();
    expect(tab.value).toBe('find');
    expect(findTab.getAttribute('aria-selected')).toBe('true');
    expect(
      (container.querySelector('#docx-nav-tab-headings') as HTMLButtonElement).getAttribute(
        'aria-selected'
      )
    ).toBe('false');
    app.unmount();
    container.remove();
  });
});

describe('useDocxSource stale clearing', () => {
  test('clears bytes without discarding app fonts when source becomes null', async () => {
    const source = ref<DocxSource | null>(SOURCE);
    let result: ReturnType<typeof useDocxSource> | null = null;
    const app = createApp({
      setup() {
        result = useDocxSource(source, {
          fonts: { sources: [] },
        });
        return () => null;
      },
    });
    app.mount(document.createElement('div'));
    await flush();
    expect(result!.document.value).toEqual(SOURCE);
    source.value = null;
    await flush();
    expect(result!.document.value).toBeUndefined();
    expect(result!.fonts.value).toBeDefined();
    expect(result!.error.value).toBeNull();
    app.unmount();
  });

  test('clears bytes on fetch failure', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 404, statusText: 'missing' }))
    ) as unknown as typeof fetch;
    const source = ref<DocxSource>('/missing.docx');
    let result: ReturnType<typeof useDocxSource> | null = null;
    const app = createApp({
      setup() {
        result = useDocxSource(source);
        return () => null;
      },
    });
    app.mount(document.createElement('div'));
    await flush();
    expect(result!.document.value).toBeUndefined();
    expect(result!.error.value).not.toBeNull();
    app.unmount();
  });

  test('clears fonts when the font option is removed', async () => {
    const options = ref<UseDocxSourceOptions>({ fonts: { sources: [] } });
    let result: ReturnType<typeof useDocxSource> | null = null;
    const app = createApp({
      setup() {
        result = useDocxSource(SOURCE, options);
        return () => null;
      },
    });
    app.mount(document.createElement('div'));
    await flush();
    expect(result!.fonts.value).toBeDefined();
    options.value = {};
    await flush();
    expect(result!.fonts.value).toBeUndefined();
    app.unmount();
  });
});

describe('scoped notes DOM lookup', () => {
  test('two editors each paint their own pages root', async () => {
    const container = document.createElement('div');
    const editors: Editor[] = [];
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h('div', { class: 'two-editors' }, [
          h('div', { class: 'docx-editor editor-one' }, [
            h(
              DocxEditorRoot,
              { document: SOURCE, onReady: (editor: Editor) => editors.push(editor) },
              {
                default: () => [
                  h(DocxEditorNotesChrome),
                  h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
                ],
              }
            ),
          ]),
          h('div', { class: 'docx-editor editor-two' }, [
            h(
              DocxEditorRoot,
              { document: SOURCE, onReady: (editor: Editor) => editors.push(editor) },
              {
                default: () => [
                  h(DocxEditorNotesChrome),
                  h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
                ],
              }
            ),
          ]),
        ]),
    });
    app.mount(container);
    await flush();
    const pagesRoots = container.querySelectorAll('.docx-pages');
    expect(pagesRoots.length).toBe(2);
    const firstChrome = container.querySelector('.editor-one [data-docx-notes-chrome]');
    const secondChrome = container.querySelector('.editor-two [data-docx-notes-chrome]');
    expect(editorScopeFor(firstChrome)).toBe(container.querySelector('.editor-one'));
    expect(editorScopeFor(secondChrome)).toBe(container.querySelector('.editor-two'));
    expect(editors).toHaveLength(2);
    const scopeSpies = editors.map((editor) => spyOn(editor, 'setActiveScope'));
    const firstReference = document.createElement('button');
    firstReference.dataset.docxNoteRef = '';
    firstReference.dataset.docxNoteScope = 'footnote:1';
    pagesRoots[0]?.appendChild(firstReference);
    firstReference.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const noteCalls = scopeSpies.flatMap((spy) =>
      spy.mock.calls.filter(([scope]) => scope.kind === 'note')
    );
    expect(noteCalls).toEqual([[{ kind: 'note', id: 'footnote:1' }]]);
    for (const spy of scopeSpies) spy.mockRestore();
    app.unmount();
    container.remove();
  });
});

describe('hydration-safe stable ids', () => {
  test('useStableDocxId remains stable during hydration', async () => {
    const Probe = {
      setup() {
        const id = useStableDocxId('probe');
        return () => h('div', { id, 'data-probe': '' });
      },
    };
    const ssrHtml = await renderToString(createSSRApp(Probe));
    const container = document.createElement('div');
    container.innerHTML = ssrHtml;
    document.body.appendChild(container);
    const ssrId = container.querySelector('[data-probe]')?.id;
    const app = createSSRApp(Probe);
    app.mount(container);
    await nextTick();
    const clientId = container.querySelector('[data-probe]')?.id;
    expect(clientId).toBe(ssrId);
    app.unmount();
    container.remove();
  });
});

describe('image paste wiring', () => {
  test('Content prevents default paste when clipboard carries an image', async () => {
    const view = mountEditorTree(() => []);
    await flush();
    const surface = view.container.querySelector('.docx-paginated-surface') as HTMLElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'x.png', { type: 'image/png' });
    const item = { kind: 'file', type: 'image/png', getAsFile: () => file };
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [file], items: [item] },
    });
    surface.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    view.unmount();
  });

  test('Content permits image drops during dragover', async () => {
    const view = mountEditorTree(() => []);
    await flush();
    const surface = view.container.querySelector('.docx-paginated-surface') as HTMLElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'x.png', { type: 'image/png' });
    const item = { kind: 'file', type: 'image/png', getAsFile: () => file };
    const event = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [file], items: [item] },
    });
    surface.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    view.unmount();
  });
});
