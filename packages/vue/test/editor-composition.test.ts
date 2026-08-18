/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import type { Editor, EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { useDocxEditor } from '../src/editor/context';
import { useEditorState } from '../src/editor/useEditorState';
import { useEditorCommand } from '../src/editor/useEditorCommand';
import { docxEditorFacadeListenerCount } from '../src/editor/DocxEditorRoot';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/package/2006/relationships/officeDocument';

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
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => queueMicrotask(r));
  }
  await new Promise((r) => setTimeout(r, 50));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DocxEditorRoot lifecycle', () => {
  test('creates the facade and publishes an editor on mount', async () => {
    const ready: Editor[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
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
                default: () => h(DocxEditorContent),
              }),
          }
        ),
    });
    try {
      app.mount(container);
      await flush();
      expect(ready.length).toBe(1);
      expect(ready[0]!.snapshot().isLoading).toBe(false);
    } finally {
      app.unmount();
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
    const container = document.createElement('div');
    const app = createApp(Probe);
    app.mount(container);
    expect(seen).toBeNull();
    app.unmount();
  });
});

describe('useEditorState', () => {
  test('answers loading snapshot outside Root', () => {
    let page: EditorSnapshot['page'] | null = null;
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

  test('re-renders when slice changes after mount', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const PageProbe = defineComponent({
      setup() {
        const page = useEditorState(selectPage);
        return () =>
          h('span', { 'data-testid': 'page-count' }, `${page.value.current} / ${page.value.total}`);
      },
    });

    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          {
            document: SOURCE,
          },
          {
            default: () =>
              h(DocxEditorViewport, null, {
                default: () => [h(PageProbe), h(DocxEditorContent)],
              }),
          }
        ),
    });
    try {
      app.mount(container);
      await flush();
      expect(container.querySelector('[data-testid="page-count"]')?.textContent).toContain('1 /');
    } finally {
      app.unmount();
    }
  });
});

describe('useEditorCommand', () => {
  test('slot command exposes enabled state after attach', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const BoldProbe = defineComponent({
      setup() {
        const bold = useEditorCommand('text.bold');
        return () =>
          h('button', {
            'data-testid': 'bold',
            disabled: !bold.isEnabled.value,
          });
      },
    });
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          { document: SOURCE },
          {
            default: () =>
              h(DocxEditorViewport, null, {
                default: () => [h(BoldProbe), h(DocxEditorContent)],
              }),
          }
        ),
    });
    try {
      app.mount(container);
      await flush();
      const button = container.querySelector('[data-testid="bold"]') as HTMLButtonElement;
      expect(button).not.toBeNull();
    } finally {
      app.unmount();
    }
  });
});

describe('facade listeners', () => {
  test('Root registers three facade listeners while mounted', async () => {
    const container = document.createElement('div');
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          { document: SOURCE },
          {
            default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }),
          }
        ),
    });
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
