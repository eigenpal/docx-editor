/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick } from 'vue';
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
import { docxEditorFacadeListenerCount } from '../src/editor/DocxEditorRoot';

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
    let fromHook: DocxEditorInstance | null = null;
    let fromReady: DocxEditorInstance | null = null;
    const Probe = defineComponent({
      setup() {
        fromHook = useDocxEditor().value;
        const page = useEditorState(selectPage);
        expect(page.value).toEqual(fromHook?.snapshot().page ?? { current: 0, total: 0 });
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
              fromReady = editor as DocxEditorInstance;
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
      expect(fromHook).toBe(fromReady);
      expect(fromHook!.snapshot()).toBe(fromReady!.snapshot());
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
      expect(binding!.disabledReason.value).toBe('not wired to an editor command');
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
