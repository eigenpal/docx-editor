/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
import './dom-setup.ts';

import { afterEach, describe, expect, test, mock } from 'bun:test';
import { createApp, defineComponent, h, nextTick, ref, watch } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { Translations } from '@docx-editor.dev/i18n';
import {
  DocxEditorRoot,
  provideDocxEditor,
  docxEditorFacadeListenerCount,
  type ProvideDocxEditorResult,
} from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { useDocxEditor } from '../src/editor/context';
import { useDocxSource } from '../src/editor/useDocxSource';
import type { DocxSource } from '../src/editor/useDocxSource';
import type { FontConfigurationFragment } from '@docx-editor.dev/core/editor';
import { useFonts } from '../src/editor/useFonts';
import { LocaleProvider } from '../src/i18n';

function bindRootProps(setup: ProvideDocxEditorResult): Record<string, unknown> {
  return { ...setup.rootProps.value, ...setup.rootListeners };
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>regression</w:t></w:r></w:p>');

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 150));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DocxEditorRoot lifecycle regressions', () => {
  test('ready fires after the painted surface exists', async () => {
    let editorAtReady: DocxEditorInstance | null = null;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          {
            document: SOURCE,
            onReady: (editor: Editor) => {
              editorAtReady = editor as DocxEditorInstance;
            },
          },
          {
            default: () =>
              h(DocxEditorViewport, null, {
                default: () => h(DocxEditorContent),
              }),
          }
        ),
    });
    try {
      app.mount(container);
      await flush();
      expect(editorAtReady).not.toBeNull();
      expect(container.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
    } finally {
      app.unmount();
    }
  });

  test('nested LocaleProvider catalogue change rebuilds exactly once', async () => {
    const instances: DocxEditorInstance[] = [];
    const outer = { _lang: 'en', toolbar: { file: 'File' } } as Translations;
    const inner = ref({ _lang: 'de', toolbar: { file: 'Datei' } } as Translations);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(
          LocaleProvider,
          { i18n: outer },
          {
            default: () =>
              h(
                LocaleProvider,
                { i18n: inner.value },
                {
                  default: () =>
                    h(
                      DocxEditorRoot,
                      {
                        document: SOURCE,
                        onReady: (editor: Editor) => {
                          instances.push(editor as DocxEditorInstance);
                        },
                      },
                      {
                        default: () =>
                          h(DocxEditorViewport, null, {
                            default: () => h(DocxEditorContent),
                          }),
                      }
                    ),
                }
              ),
          }
        ),
    });
    try {
      app.mount(container);
      await flush();
      inner.value = { _lang: 'fr', toolbar: { file: 'Fichier' } };
      await flush();
      expect(instances.length).toBe(2);
      expect(instances[0]).not.toBe(instances[1]);
    } finally {
      app.unmount();
      container.remove();
    }
  });

  test('unrelated parent re-render does not rebuild when deps are stable', async () => {
    const instances: DocxEditorInstance[] = [];
    const tick = ref(0);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () => {
          tick.value;
          return h(
            DocxEditorRoot,
            {
              document: SOURCE,
              onReady: (editor: Editor) => {
                instances.push(editor as DocxEditorInstance);
              },
            },
            {
              default: () =>
                h(DocxEditorViewport, null, {
                  default: () => h(DocxEditorContent),
                }),
            }
          );
        };
      },
    });
    try {
      app.mount(container);
      await flush();
      tick.value += 1;
      await flush();
      expect(instances.length).toBe(1);
    } finally {
      app.unmount();
    }
  });
});

describe('provideDocxEditor', () => {
  test('returns Root, reactive rootProps, and editorRef for host composition', async () => {
    let setup: ReturnType<typeof provideDocxEditor> | null = null;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        setup = provideDocxEditor({ document: SOURCE, zoom: 1.25 });
        return () =>
          h(setup!.DocxEditorRoot, bindRootProps(setup!), {
            default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
          });
      },
    });
    try {
      app.mount(container);
      await flush();
      expect(setup!.DocxEditorRoot).toBe(DocxEditorRoot);
      expect(setup!.rootProps.value.document).toBe(SOURCE);
      expect(setup!.rootProps.value.zoom).toBe(1.25);
      expect(setup!.editorRef.value).not.toBeNull();
    } finally {
      app.unmount();
      container.remove();
    }
  });

  test('creates the editor and injects the same instance to descendants', async () => {
    let injected: DocxEditorInstance | null = null;
    let ownerRef: ReturnType<typeof useDocxEditor> | null = null;
    const Probe = defineComponent({
      setup() {
        const editorRef = useDocxEditor();
        watch(
          editorRef,
          (instance) => {
            injected = instance;
          },
          { immediate: true }
        );
        return () => null;
      },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        const setupResult = provideDocxEditor({ document: SOURCE });
        ownerRef = setupResult.editorRef;
        return () =>
          h(setupResult.DocxEditorRoot, bindRootProps(setupResult), {
            default: () => [
              h(Probe),
              h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
            ],
          });
      },
    });
    try {
      app.mount(container);
      await flush();
      expect(injected).not.toBeNull();
      expect(ownerRef!.value).toBe(injected);
      expect(container.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
    } finally {
      app.unmount();
    }
  });

  test('forwards ready, change, and fontError through rendered Root exactly once', async () => {
    const ready: Editor[] = [];
    const changes: unknown[] = [];
    const fontErrors: unknown[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        const setupResult = provideDocxEditor({
          document: SOURCE,
          onReady: (editor) => ready.push(editor),
          onChange: (change) => changes.push(change),
        });
        return () =>
          h(setupResult.DocxEditorRoot, bindRootProps(setupResult), {
            default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
          });
      },
    });
    try {
      app.mount(container);
      await flush();
      expect(ready.length).toBe(1);
      const changeCountBefore = changes.length;
      ready[0]!.exec({ type: 'insertText', text: '!' });
      await flush();
      expect(changes.length).toBe(changeCountBefore + 1);
      app.unmount();
      const errorContainer = document.createElement('div');
      document.body.appendChild(errorContainer);
      const fontErrorsBefore = fontErrors.length;
      const errorApp = createApp({
        setup() {
          const setupResult = provideDocxEditor({
            document: SOURCE,
            fonts: () => {
              throw new Error('font exploded');
            },
            onFontError: (error) => fontErrors.push(error),
          });
          return () =>
            h(setupResult.DocxEditorRoot, bindRootProps(setupResult), {
              default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
            });
        },
      });
      errorApp.mount(errorContainer);
      await flush();
      expect(fontErrors.length).toBe(fontErrorsBefore + 1);
      errorApp.unmount();
      errorContainer.remove();
    } finally {
      container.remove();
    }
  });

  test('keeps document, fonts, and bytes at stable identity in rootProps', () => {
    const fonts = { sources: [] } as FontConfigurationFragment;
    let setupResult: ReturnType<typeof provideDocxEditor> | null = null;
    const app = createApp({
      setup() {
        setupResult = provideDocxEditor({ document: SOURCE, fonts });
        return () => null;
      },
    });
    app.mount(document.createElement('div'));
    expect(setupResult!.rootProps.value.document).toBe(SOURCE);
    expect(setupResult!.rootProps.value.fonts).toBe(fonts);
    setupResult!.rootProps.value = { ...setupResult!.rootProps.value, zoom: 1.1 };
    expect(setupResult!.rootProps.value.document).toBe(SOURCE);
    expect(setupResult!.rootProps.value.fonts).toBe(fonts);
    app.unmount();
  });

  test('destroys the editor when the host scope ends', async () => {
    let ownerRef: ReturnType<typeof useDocxEditor> | null = null;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        const setupResult = provideDocxEditor({ document: SOURCE });
        ownerRef = setupResult.editorRef;
        return () =>
          h(setupResult.DocxEditorRoot, bindRootProps(setupResult), {
            default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
          });
      },
    });
    try {
      app.mount(container);
      await flush();
      expect(ownerRef!.value).not.toBeNull();
      const listenersBeforeUnmount = docxEditorFacadeListenerCount();
      expect(listenersBeforeUnmount).toBeGreaterThan(0);
      app.unmount();
      expect(ownerRef!.value).toBeNull();
      expect(docxEditorFacadeListenerCount()).toBeLessThan(listenersBeforeUnmount);
    } finally {
      container.remove();
    }
  });
});

describe('useDocxSource reactivity', () => {
  test('follows reactive byte source ref', async () => {
    const first = SOURCE;
    const second = zipSync({
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>other</w:t></w:r></w:p></w:body></w:document>`
      ),
    });
    const source = ref<Uint8Array>(first);
    let result: ReturnType<typeof useDocxSource> | null = null;
    const app = createApp({
      setup() {
        result = useDocxSource(source as unknown as DocxSource);
        return () => null;
      },
    });
    app.mount(document.createElement('div'));
    await flush();
    expect(result!.document.value).toEqual(first);
    source.value = second;
    await flush();
    expect(result!.document.value).toEqual(second);
    app.unmount();
  });

  test('aborts stale URL fetch when source changes', async () => {
    const source = ref<string>('/first.docx');
    let resolveFirst: ((value: Response) => void) | undefined;
    const fetchMock = mock((input: string) => {
      if (input.endsWith('first.docx')) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(
        new Response(new Uint8Array(SOURCE).buffer as ArrayBuffer, { status: 200 })
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let result: ReturnType<typeof useDocxSource> | null = null;
    const app = createApp({
      setup() {
        result = useDocxSource(source as unknown as DocxSource);
        return () => null;
      },
    });
    app.mount(document.createElement('div'));
    source.value = '/second.docx';
    await flush();
    expect(result!.document.value).toEqual(SOURCE);
    resolveFirst!(
      new Response(new Uint8Array([9, 9, 9]), {
        status: 200,
      })
    );
    await flush();
    expect(result!.document.value).toEqual(SOURCE);
    app.unmount();
  });
});

describe('useFonts reactivity', () => {
  test('reads current fragment values through resolver', async () => {
    const fragment = ref<FontConfigurationFragment | undefined>({ sources: [] });
    let resolver: ReturnType<typeof useFonts> | null = null;
    const app = createApp({
      setup() {
        resolver = useFonts(undefined, fragment as unknown as FontConfigurationFragment);
        return () => null;
      },
    });
    app.mount(document.createElement('div'));
    const request = { families: ['Calibri'], defaultFamily: 'Calibri' };
    const before = await resolver!(request);
    fragment.value = undefined;
    const after = await resolver!(request);
    expect(before).toBeDefined();
    expect(after).toBeUndefined();
    app.unmount();
  });
});
