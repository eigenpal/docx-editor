/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
// `useEditorState((s) => s.selectionRange)`: the caret as a paragraph id and offset, live.
//
// The twin of the React adapter's test. The slice is reference-stable while the selection
// does not move, so a watcher fires for a caret move inside one paragraph and not for an
// unrelated change such as zoom.

import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { createApp, type App, defineComponent, h, watch, type ShallowRef } from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { useDocxEditor } from '../src/editor/context';
import { useEditorState } from '../src/editor/useEditorState';
import { flush, SOURCE } from './helpers/fixtures.ts';

const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.innerHTML = '';
});

const selectRange = (snapshot: EditorSnapshot) => snapshot.selectionRange;

test('a selectionRange consumer updates for caret moves only', async () => {
  let editorRef: ShallowRef<DocxEditorInstance | null> | null = null;
  const offsets: (number | null)[] = [];
  const CaretProbe = defineComponent({
    setup() {
      editorRef = useDocxEditor();
      const range = useEditorState(selectRange);
      watch(range, (next) => offsets.push(next ? next.head.offset : null));
      return () => null;
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
              default: () => [h(DocxEditorContent), h(CaretProbe)],
            }),
        }
      ),
  });
  apps.push(app);
  app.mount(container);
  await flush();
  const editor = editorRef!.value!;
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  const caret = async (offset: number) => {
    const at = { paragraphId, offset };
    expect(editor.exec({ type: 'setSelection', range: { anchor: at, head: at } }).ok).toBe(true);
    await flush();
  };
  await caret(3);
  expect(offsets.at(-1)).toBe(3);
  await caret(7);
  expect(offsets.at(-1)).toBe(7);
  const updates = offsets.length;
  expect(editor.setZoom(1.5).ok).toBe(true);
  await flush();
  expect(editor.snapshot().zoom).toBe(1.5);
  expect(offsets.length).toBe(updates);
});
