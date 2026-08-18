/* eslint-disable react-hooks/rules-of-hooks */
import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { useEditorCommand } from '../src/editor/useEditorCommand';
import { docxEditorFacadeListenerCount } from '../src/editor/DocxEditorRoot';
import { editorStateActiveSubscriptionCount, useEditorState } from '../src/editor/useEditorState';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
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
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold text</w:t></w:r></w:p>' +
      '</w:body></w:document>'
  ),
});

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 150));
}

afterEach(() => {
  document.body.innerHTML = '';
  expect(editorStateActiveSubscriptionCount()).toBe(0);
});

function mountProbe(probe: () => ReturnType<typeof h> | null) {
  let instance: DocxEditorInstance | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
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
              default: () => [probe(), h(DocxEditorContent)],
            }),
        }
      ),
  });
  return {
    container,
    app,
    editor: () => instance!,
  };
}

describe('useEditorCommand raw target', () => {
  test('re-derives when the payload changes but the type does not', async () => {
    const seen: { mark: string; active: boolean }[] = [];
    const MarkProbe = defineComponent({
      setup() {
        const mark = ref('bold');
        const { isActive } = useEditorCommand(() => ({
          type: 'toggleMark' as const,
          mark: mark.value,
        }));
        return () => {
          seen.push({ mark: mark.value, active: isActive.value });
          return h('button', {
            'data-testid': 'switch',
            onClick: () => {
              mark.value = 'italic';
            },
          });
        };
      },
    });
    const { container, app, editor } = mountProbe(() => h(MarkProbe));
    try {
      app.mount(container);
      await flush();
      editor().surface!.selectAll();
      await flush();
      expect(seen.at(-1)).toEqual({ mark: 'bold', active: true });
      (container.querySelector('[data-testid="switch"]') as HTMLButtonElement).click();
      await flush();
      expect(seen.at(-1)).toEqual({ mark: 'italic', active: false });
    } finally {
      app.unmount();
    }
  });

  test('execute returns false when the engine refuses', async () => {
    let run: (() => boolean) | null = null;
    const Probe = defineComponent({
      setup() {
        run = useEditorCommand({ type: 'cut' }).execute;
        return () => null;
      },
    });
    const { app, container, editor } = mountProbe(() => h(Probe));
    try {
      app.mount(container);
      await flush();
      const before = editor().surface!.session.revision();
      expect(run!()).toBe(false);
      expect(editor().surface!.session.revision()).toBe(before);
    } finally {
      app.unmount();
    }
  });
});

describe('useEditorState subscriptions', () => {
  test('many consumers share one facade listener budget', async () => {
    const Probes = defineComponent({
      setup() {
        for (let i = 0; i < 40; i++) useEditorState((s) => s.page.current);
        return () => null;
      },
    });
    const { app, container } = mountProbe(() => h(Probes));
    try {
      app.mount(container);
      await flush();
      expect(editorStateActiveSubscriptionCount()).toBeGreaterThanOrEqual(40);
      expect(docxEditorFacadeListenerCount()).toBe(3);
    } finally {
      app.unmount();
    }
  });

  test('custom equality prevents slice updates', async () => {
    let renders = 0;
    const Probe = defineComponent({
      setup() {
        useEditorState(
          (s) => s.page,
          (a, b) => a.current === b.current && a.total === b.total
        );
        renders += 1;
        return () => null;
      },
    });
    const { app, container, editor } = mountProbe(() => h(Probe));
    try {
      app.mount(container);
      await flush();
      const before = renders;
      editor().exec({ type: 'insertText', text: 'z' });
      await flush();
      expect(renders).toBe(before);
    } finally {
      app.unmount();
    }
  });

  test('burst changes collapse through deferred notifier', async () => {
    let renders = 0;
    const Probe = defineComponent({
      setup() {
        useEditorState((s) => s.formatting?.bold ?? false);
        renders += 1;
        return () => null;
      },
    });
    const { app, container, editor } = mountProbe(() => h(Probe));
    try {
      app.mount(container);
      await flush();
      const before = renders;
      for (let i = 0; i < 5; i++) editor().exec({ type: 'insertText', text: 'a' });
      await flush();
      expect(renders - before).toBeLessThanOrEqual(2);
    } finally {
      app.unmount();
    }
  });
});

describe('useEditorCommand lifecycle', () => {
  test('inline command literal does not multiply facade listeners', async () => {
    const { app, container } = mountProbe(() => {
      const Probe = defineComponent({
        setup() {
          useEditorCommand({ type: 'selectAll' });
          return () => null;
        },
      });
      return h(Probe);
    });
    try {
      app.mount(container);
      await flush();
      expect(docxEditorFacadeListenerCount()).toBe(3);
    } finally {
      app.unmount();
    }
  });

  test('execute before mount returns false', () => {
    let ok = true;
    const Probe = defineComponent({
      setup() {
        ok = useEditorCommand('text.bold').execute();
        return () => null;
      },
    });
    const app = createApp(Probe);
    app.mount(document.createElement('div'));
    expect(ok).toBe(false);
    app.unmount();
  });
});
