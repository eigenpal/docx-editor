/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
// An undoable document update through the Vue adapter: the toolbar's undo and redo commands
// see the update as one step, and the other adapter state follows it.
import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { createDocumentRefresh } from '../src/index';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { useEditorCommand } from '../src/editor/useEditorCommand';
import {
  BASE,
  EDITED,
  updateFixture,
} from '../../core/src/store/__tests__/package-update-fixture.ts';

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 50));
}

afterEach(() => {
  document.body.innerHTML = '';
});

test('one undo reverts an applied update and one redo restores it', async () => {
  let editor: DocxEditorInstance | null = null;
  let undo!: ReturnType<typeof useEditorCommand>;
  let redo!: ReturnType<typeof useEditorCommand>;
  const Probe = defineComponent({
    setup() {
      undo = useEditorCommand('history.undo');
      redo = useEditorCommand('history.redo');
      return () => null;
    },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: updateFixture(BASE),
          onReady: (instance: Editor) => {
            editor = instance as DocxEditorInstance;
          },
        },
        {
          default: () =>
            h(DocxEditorViewport, null, { default: () => [h(Probe), h(DocxEditorContent)] }),
        }
      ),
  });
  app.mount(container);
  await flush();
  expect(editor).not.toBeNull();
  const text = () => editor!.surface!.session.bodyText();
  expect(undo.isEnabled.value).toBe(false);

  const refresh = createDocumentRefresh(editor!);
  const submission = await refresh.capture();
  const result = await refresh.applyUpdate({
    submission,
    sequence: 1,
    bytes: updateFixture(EDITED),
    mode: 'edit',
  });
  await flush();
  expect(result).toMatchObject({ ok: true, mode: 'edit' });
  expect(text()).toContain('Goal of this agreement.');
  expect(undo.isEnabled.value).toBe(true);

  undo.execute();
  await flush();
  expect(text()).toContain('Purpose of this agreement.');
  expect(undo.isEnabled.value).toBe(false);
  expect(redo.isEnabled.value).toBe(true);

  redo.execute();
  await flush();
  expect(text()).toContain('Goal of this agreement.');
  app.unmount();
});
