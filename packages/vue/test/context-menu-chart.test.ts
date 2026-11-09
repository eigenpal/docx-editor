// The context menu's Edit chart row: present only while a chart is selected, and a press
// asks for the Chart pane, as a double press on the chart does. The React twin is
// `packages/react/test/context-menu-chart.test.tsx`.

import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { createApp, h } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { takePaneRequest, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorContextMenu } from '../src/editor/contextmenu/index.ts';
import { flush, SOURCE } from './helpers/fixtures.ts';

const t = (key: string): string => key;

afterEach(() => {
  document.body.innerHTML = '';
});

function mountMenu() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: SOURCE,
          onReady: (editor: Editor) => {
            ready.push(editor as DocxEditorInstance);
          },
        },
        {
          default: () =>
            h(DocxEditorViewport, null, {
              default: () => [h(DocxEditorContent), h(DocxEditorContextMenu, { t })],
            }),
        }
      ),
  });
  app.mount(container);
  return { container, editor: () => ready.at(-1)!, unmount: () => app.unmount() };
}

async function openMenu(container: HTMLElement): Promise<void> {
  const scroller = container.querySelector('.docx-editor__scroll-container');
  if (!scroller) throw new Error('no scroll container');
  scroller.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 140 })
  );
  await flush();
}

const editChartRow = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.docx-contextmenu [data-slot="image.editChart"]');

test('Edit chart shows only for a selected chart and asks for the Chart pane', async () => {
  const mounted = mountMenu();
  try {
    await flush();
    await openMenu(mounted.container);
    expect(editChartRow(mounted.container)).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();

    const editor = mounted.editor();
    const paragraph = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraph, offset: 1 },
      head: { paragraphId: paragraph, offset: 1 },
    });
    expect(editor.exec({ type: 'insertChart', chartType: 'pie' }).ok).toBe(true);
    await flush();
    expect(editor.snapshot().chart).not.toBeNull();
    takePaneRequest(editor);

    await openMenu(mounted.container);
    const row = editChartRow(mounted.container);
    expect(row?.textContent).toContain('chart.edit');
    row!.click();
    await flush();
    expect(takePaneRequest(editor)?.pane).toBe('chart');
  } finally {
    mounted.unmount();
  }
});
