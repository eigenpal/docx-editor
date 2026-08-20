/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, ref, KeepAlive, watch } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import type { Editor, EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { useDocxEditor } from '../src/editor/context';
import { useEditorState } from '../src/editor/useEditorState';
import { useEditorCommand } from '../src/editor/useEditorCommand';
import { useEditorEvent } from '../src/editor/useEditorEvent';
import { useEditorCaret } from '../src/editor/useEditorCaret';
import { docxEditorFacadeListenerCount } from '../src/editor/DocxEditorRoot';
import {
  DocxEditorAuthorStyle,
  DocxEditorColorByChangeType,
} from '../src/editor/DocxEditorAuthorStyle';
import { useReviewAuthors } from '../src/editor/useReviewAuthors';

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

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');
const TRACKED_SOURCE = docx(
  '<w:p><w:r><w:t xml:space="preserve">base </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:t>added</w:t></w:r></w:ins></w:p>'
);
const selectPage = (snapshot: EditorSnapshot) => snapshot.page;

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 150));
}

function mountEditor(children: () => ReturnType<typeof h>[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ready: Editor[] = [];
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: SOURCE,
          onReady: (editor: Editor) => ready.push(editor),
        },
        {
          default: () =>
            h(DocxEditorViewport, null, {
              default: children,
            }),
        }
      ),
  });
  return { container, app, ready };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DocxEditorRoot lifecycle', () => {
  test('creates the facade, paints through Content, and destroys on unmount', async () => {
    const { container, app, ready } = mountEditor(() => [h(DocxEditorContent)]);
    try {
      app.mount(container);
      await flush();
      expect(ready.length).toBe(1);
      expect(ready[0]!.snapshot().isLoading).toBe(false);
      expect(container.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
      expect(container.textContent).toContain('hello world');
      const surface = container.querySelector('.docx-paginated-surface')!;
      expect(surface.closest('.docx-editor__scroll-container')).not.toBeNull();
      expect((ready[0] as DocxEditorInstance).surface).not.toBeNull();
    } finally {
      app.unmount();
      expect(document.querySelectorAll('.docx-page').length).toBe(0);
    }
  });

  test('useDocxEditor returns null outside Root', () => {
    let seen: unknown = 'unset';
    const Probe = defineComponent({
      setup() {
        seen = useDocxEditor().value;
        return () => null;
      },
    });
    const app = createApp(Probe);
    app.mount(document.createElement('div'));
    expect(seen).toBeNull();
    app.unmount();
  });

  test('injected instance is the engine object, not a proxy', async () => {
    const identities: DocxEditorInstance[] = [];
    const Probe = defineComponent({
      setup() {
        const editorRef = useDocxEditor();
        watch(
          editorRef,
          (editor) => {
            if (editor) identities.push(editor);
          },
          { immediate: true }
        );
        return () => null;
      },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          {
            document: SOURCE,
            onReady: (editor: Editor) => {
              identities.push(editor as DocxEditorInstance);
            },
          },
          {
            default: () =>
              h(DocxEditorViewport, null, {
                default: () => [h(Probe), h(DocxEditorContent)],
              }),
          }
        ),
    });
    try {
      app.mount(container);
      await flush();
      expect(identities.length).toBeGreaterThanOrEqual(2);
      expect(identities.every((id) => id === identities[0]!)).toBe(true);
      expect(identities[0]!.snapshot()).toBe(identities[0]!.snapshot());
    } finally {
      app.unmount();
    }
  });
});

describe('useEditorState', () => {
  test('answers loading snapshot outside Root', () => {
    let page: EditorSnapshot['page'] | undefined;
    const Probe = defineComponent({
      setup() {
        page = useEditorState(selectPage).value;
        return () => null;
      },
    });
    const app = createApp(Probe);
    app.mount(document.createElement('div'));
    expect(page).toEqual({ current: 0, total: 0 });
    app.unmount();
  });

  test('re-renders only when its slice changes', async () => {
    let pageRenders = 0;
    let instance: DocxEditorInstance | null = null;
    const container = document.createElement('div');
    document.body.appendChild(container);

    const PageProbe = defineComponent({
      setup() {
        const page = useEditorState(selectPage);
        pageRenders += 1;
        return () =>
          h('span', { 'data-testid': 'page-count' }, `${page.value.current} / ${page.value.total}`);
      },
    });
    const BoldProbe = defineComponent({
      setup() {
        const bold = useEditorCommand('text.bold');
        return () =>
          h('button', {
            'data-testid': 'bold',
            'aria-pressed': String(bold.isActive.value),
            disabled: !bold.isEnabled.value,
            onClick: bold.execute,
          });
      },
    });

    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          {
            document: SOURCE,
            onReady: (editor: Editor) => {
              instance = editor as DocxEditorInstance;
            },
          },
          {
            default: () =>
              h(DocxEditorViewport, null, {
                default: () => [h(PageProbe), h(BoldProbe), h(DocxEditorContent)],
              }),
          }
        ),
    });
    try {
      app.mount(container);
      await flush();
      expect(container.querySelector('[data-testid="page-count"]')?.textContent).toBe('1 / 1');
      const editor = instance!;
      editor.surface!.selectAll();
      await flush();
      const rendersBeforeBold = pageRenders;
      const bold = container.querySelector('[data-testid="bold"]') as HTMLButtonElement;
      bold.click();
      await flush();
      expect(bold.getAttribute('aria-pressed')).toBe('true');
      expect(editor.getSelectionFormatting()?.bold).toBe(true);
      expect(pageRenders).toBe(rendersBeforeBold);
    } finally {
      app.unmount();
    }
  });
});

describe('useEditorCommand', () => {
  test('unwired slot is disabled with the engine reason', async () => {
    let binding: ReturnType<typeof useEditorCommand> | null = null;
    const Probe = defineComponent({
      setup() {
        binding = useEditorCommand('insert.sectionBreakContinuous');
        return () => null;
      },
    });
    const { container, app } = mountEditor(() => [h(Probe), h(DocxEditorContent)]);
    try {
      app.mount(container);
      await flush();
      expect(binding!.isEnabled.value).toBe(false);
      expect(binding!.disabledReason.value).toBe(
        'This control is not connected to an editor command'
      );
    } finally {
      app.unmount();
    }
  });
});

describe('useEditorEvent', () => {
  test('subscribes for the component lifetime', async () => {
    const changes: number[] = [];
    let instance: DocxEditorInstance | null = null;
    const Probe = defineComponent({
      setup() {
        useEditorEvent('change', (change) => changes.push(change.revision));
        return () => null;
      },
    });
    const { container } = mountEditor(() => [h(Probe), h(DocxEditorContent)]);
    const readyApp = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          {
            document: SOURCE,
            onReady: (editor: Editor) => {
              instance = editor as DocxEditorInstance;
            },
          },
          {
            default: () =>
              h(DocxEditorViewport, null, {
                default: () => [h(Probe), h(DocxEditorContent)],
              }),
          }
        ),
    });
    try {
      readyApp.mount(container);
      await flush();
      const countAfterMount = changes.length;
      instance!.exec({ type: 'insertText', text: 'X' });
      await flush();
      expect(changes.length).toBe(countAfterMount + 1);
    } finally {
      readyApp.unmount();
    }
  });
});

describe('facade listeners', () => {
  test('Root registers three facade listeners while mounted', async () => {
    const { container, app } = mountEditor(() => [h(DocxEditorContent)]);
    try {
      app.mount(container);
      await flush();
      expect(docxEditorFacadeListenerCount()).toBe(3);
    } finally {
      app.unmount();
      expect(docxEditorFacadeListenerCount()).toBe(0);
    }
  });
});

describe('DocxEditorRoot document identity', () => {
  test('replacing document bytes rebuilds painted content', async () => {
    const other = docx('<w:p><w:r><w:t>other doc</w:t></w:r></w:p>');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const docRef = ref(SOURCE);
    const app = createApp({
      setup() {
        return () =>
          h(
            DocxEditorRoot,
            { document: docRef.value },
            {
              default: () =>
                h(DocxEditorViewport, null, {
                  default: () => [h(DocxEditorContent)],
                }),
            }
          );
      },
    });
    try {
      app.mount(container);
      await flush();
      expect(container.textContent).toContain('hello world');
      docRef.value = other;
      await flush();
      expect(container.textContent).toContain('other doc');
    } finally {
      app.unmount();
    }
  });
});

describe('DocxEditorRoot reactive props', () => {
  test('zoom prop changes reuse the same editor instance', async () => {
    const zoom = ref(1);
    const instances = new Set<DocxEditorInstance>();
    const Probe = defineComponent({
      setup() {
        const editorRef = useDocxEditor();
        watch(
          editorRef,
          (editor) => {
            if (editor) instances.add(editor as DocxEditorInstance);
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
        return () =>
          h(
            DocxEditorRoot,
            { document: SOURCE, zoom: zoom.value },
            {
              default: () =>
                h(DocxEditorViewport, null, {
                  default: () => [h(Probe), h(DocxEditorContent)],
                }),
            }
          );
      },
    });
    try {
      app.mount(container);
      await flush();
      zoom.value = 1.25;
      await flush();
      expect(instances.size).toBe(1);
    } finally {
      app.unmount();
    }
  });

  test('KeepAlive round trip keeps the mounted surface', async () => {
    const active = ref(true);
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
                h(DocxEditorViewport, null, {
                  default: () =>
                    h(KeepAlive, null, {
                      default: () => (active.value ? h(DocxEditorContent) : null),
                    }),
                }),
            }
          );
      },
    });
    try {
      app.mount(container);
      await flush();
      expect(container.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
      active.value = false;
      await flush();
      active.value = true;
      await flush();
      expect(container.textContent).toContain('hello world');
    } finally {
      app.unmount();
    }
  });
});

describe('useEditorCaret', () => {
  test('caret position updates after typing', async () => {
    const positions: Array<{ paragraphId: string; offset: number } | null> = [];
    const Probe = defineComponent({
      setup() {
        const caret = useEditorCaret();
        watch(caret, (value) => positions.push(value), { immediate: true });
        return () => null;
      },
    });
    const { container, app, ready } = mountEditor(() => [h(Probe), h(DocxEditorContent)]);
    try {
      app.mount(container);
      await flush();
      const editor = ready[0] as DocxEditorInstance;
      editor.focus();
      editor.exec({ type: 'insertText', text: '!' });
      await flush();
      expect(positions.some((pos) => pos !== null)).toBe(true);
    } finally {
      app.unmount();
    }
  });
});

describe('declarative revision styles', () => {
  function mountTracked(declaration: ReturnType<typeof h>, probe?: ReturnType<typeof h>) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          { document: TRACKED_SOURCE },
          {
            default: () => [
              declaration,
              h(DocxEditorViewport, null, {
                default: () => [probe, h(DocxEditorContent)].filter(Boolean),
              }),
            ],
          }
        ),
    });
    return { app, container };
  }

  test('AuthorStyle and ColorByChangeType match the React declarations', async () => {
    const author = mountTracked(
      h(DocxEditorAuthorStyle, {
        author: 'Ada Lovelace',
        color: 'var(--brand-ada)',
      })
    );
    try {
      author.app.mount(author.container);
      await flush();
      expect(author.container.querySelector<HTMLElement>('.docx-revision')?.style.color).toBe(
        'var(--brand-ada)'
      );
    } finally {
      author.app.unmount();
    }

    const kind = mountTracked(h(DocxEditorColorByChangeType));
    try {
      kind.app.mount(kind.container);
      await flush();
      expect(kind.container.querySelector<HTMLElement>('.docx-revision')?.style.color).toBe(
        'var(--doc-revision-insertion)'
      );
    } finally {
      kind.app.unmount();
    }
  });

  test('useReviewAuthors returns the live author roster', async () => {
    const Probe = defineComponent({
      setup() {
        const authors = useReviewAuthors();
        return () =>
          h(
            'div',
            { 'data-testid': 'review-authors' },
            authors.value.map((entry) => `${entry.author}:${entry.color}`).join('|')
          );
      },
    });
    const view = mountTracked(h('span'), h(Probe));
    try {
      view.app.mount(view.container);
      await flush();
      expect(view.container.querySelector('[data-testid="review-authors"]')?.textContent).toBe(
        'Ada Lovelace:var(--doc-review-author-0)'
      );
    } finally {
      view.app.unmount();
    }
  });
});
