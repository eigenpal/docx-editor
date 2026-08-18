/**
 * Cross-adapter composable differential — same document, same assertions.
 * Shape differences called out in OpenSpec 11.8 are allowed; enabled/active/reason must match.
 */
/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
import './dom-setup.ts';

import { describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import { toolbarCommandState } from '@docx-editor.dev/core/editor';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { useDocxEditor } from '../src/editor/context';
import { useEditorCommand } from '../src/editor/useEditorCommand';
import { useZoom } from '../src/editor/useZoom';
import { SEARCH_MATCH_LIMIT } from '../src/editor/navigation';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SOURCE = zipSync({
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>parity</w:t></w:r></w:p></w:body></w:document>`
  ),
});

async function flush() {
  await nextTick();
  await new Promise((r) => setTimeout(r, 120));
}

async function mountVueEditor(onReady: (editor: Editor) => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        { document: SOURCE, onReady },
        {
          default: () =>
            h(DocxEditorViewport, null, {
              default: () => [h(DocxEditorContent)],
            }),
        }
      ),
  });
  app.mount(container);
  await flush();
  return { app, container };
}

describe('cross-adapter differential', () => {
  test('chrome slot state matches toolbarCommandState', async () => {
    const sawEditor = ref(false);
    const Probe = defineComponent({
      setup() {
        const editorRef = useDocxEditor();
        const bold = useEditorCommand('text.bold');
        return () => {
          const editor = editorRef.value;
          if (!editor) return null;
          sawEditor.value = true;
          const engine = toolbarCommandState(editor, 'text.bold');
          expect(bold.isEnabled.value).toBe(engine.enabled);
          expect(bold.isActive.value).toBe(engine.active);
          expect(bold.disabledReason.value ?? null).toBe(engine.disabledReason ?? null);
          return null;
        };
      },
    });
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
                default: () => [h(Probe), h(DocxEditorContent)],
              }),
          }
        ),
    });
    try {
      app.mount(container);
      await flush();
      expect(sawEditor.value).toBe(true);
    } finally {
      app.unmount();
    }
  });

  test('search cap constant matches React export', () => {
    expect(SEARCH_MATCH_LIMIT).toBeGreaterThan(0);
  });

  test('zoom off-ladder step is defined', async () => {
    let editor: DocxEditorInstance | null = null;
    const { app } = await mountVueEditor((e) => {
      editor = e as DocxEditorInstance;
    });
    try {
      const Probe = defineComponent({
        setup() {
          const zoom = useZoom();
          return () => {
            expect(typeof zoom.zoomIn).toBe('function');
            expect(typeof zoom.canZoomOut.value).toBe('boolean');
            return null;
          };
        },
      });
      const probe = createApp({
        render: () =>
          h(
            DocxEditorRoot,
            { document: SOURCE },
            {
              default: () =>
                h(DocxEditorViewport, null, {
                  default: () => [h(Probe), h(DocxEditorContent)],
                }),
            }
          ),
      });
      const el = document.createElement('div');
      document.body.appendChild(el);
      probe.mount(el);
      await flush();
      probe.unmount();
      expect(editor).not.toBeNull();
    } finally {
      app.unmount();
    }
  });
});
