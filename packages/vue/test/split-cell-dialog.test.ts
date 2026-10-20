// The Vue twin of `packages/react/test/split-cell-dialog.test.tsx`: the table context menu
// carries Merge cells and Split cells, the Split cells dialog checks each count with the
// engine, Split applies it, and Escape dismisses the dialog.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, h } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorContextMenu } from '../src/editor/contextmenu/index.ts';
import { docx, flush } from './helpers/fixtures.ts';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const TABLE = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr><w:tc>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr></w:tbl><w:p/>`
);

// A1 is merged over three rows, so it splits only into one or three rows.
const THREE_ROW_MERGE = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr>` +
    `<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc>${p('B2')}</w:tc></w:tr>` +
    `<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc>${p('B3')}</w:tc></w:tr></w:tbl><w:p/>`
);

function mount(source: Uint8Array) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ready: DocxEditorInstance[] = [];
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: source,
          onReady: (editor: Editor) => {
            ready.push(editor as DocxEditorInstance);
          },
        },
        {
          default: () =>
            h(DocxEditorViewport, null, {
              default: () => [
                h(DocxEditorContent),
                h(DocxEditorContextMenu, { t: (key: string) => key }),
              ],
            }),
        }
      ),
  });
  app.mount(container);
  return {
    container,
    editor: () => ready.at(-1)!,
    unmount: () => {
      app.unmount();
      container.remove();
    },
  };
}

async function caretInFirstCell(editor: DocxEditorInstance): Promise<void> {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 1 },
    head: { paragraphId, offset: 1 },
  });
  await flush();
}

async function openMenu(container: HTMLElement): Promise<void> {
  container.querySelector('.docx-editor__scroll-container')!.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 140,
      button: 2,
    })
  );
  await flush();
}

const dialog = () => document.querySelector<HTMLElement>('[data-docx-dialog="splitCell"]');
const field = (name: 'columns' | 'rows') =>
  dialog()!.querySelector<HTMLInputElement>(`[data-docx-field="${name}"] input`)!;
const apply = () => dialog()!.querySelector<HTMLButtonElement>('[data-docx-part="apply"]')!;
const message = () => dialog()!.querySelector('[data-docx-part="error"]')!.textContent;

async function type(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await flush();
}

async function openDialog(container: HTMLElement): Promise<void> {
  await openMenu(container);
  const row = container.querySelector<HTMLElement>(
    '.docx-contextmenu [data-slot="table.splitCell"]'
  );
  expect(row).not.toBeNull();
  expect(row!.getAttribute('aria-disabled')).not.toBe('true');
  row!.click();
  await flush();
  expect(dialog()).not.toBeNull();
}

/** How many cells the table's first row holds. */
function firstRowCells(editor: DocxEditorInstance): number {
  const find = (node: OoxmlNode, kind: string): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === kind) return node;
    for (const child of node.children) {
      const found = find(child, kind);
      if (found) return found;
    }
    return null;
  };
  const row = find(editor.surface!.session.part().root, 'tableRow');
  if (!row || row.kind === 'textValue') return 0;
  return row.children.filter((child) => child.kind === 'tableCell').length;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('table cell structure (Vue)', () => {
  test('the table context rows carry Merge cells and Split cells after the column inserts', async () => {
    const mounted = mount(TABLE);
    try {
      await flush();
      await caretInFirstCell(mounted.editor());
      await openMenu(mounted.container);
      const slots = [
        ...mounted.container.querySelectorAll<HTMLElement>('.docx-contextmenu [role="menuitem"]'),
      ].map((row) => row.dataset.slot);
      const at = slots.indexOf('table.insertColumnRight');
      expect(slots.slice(at, at + 4)).toEqual([
        'table.insertColumnRight',
        'table.mergeCells',
        'table.splitCell',
        'table.deleteRow',
      ]);
      // A caret is not a cell selection, so Merge cells says what it needs.
      const merge = mounted.container.querySelector<HTMLElement>('[data-slot="table.mergeCells"]')!;
      expect(merge.getAttribute('aria-disabled')).toBe('true');
      expect(merge.getAttribute('title')).toBe(
        'Select two or more cells to merge them'
      );
    } finally {
      mounted.unmount();
    }
  });

  test('Split cells opens from the context menu and splits into the typed columns', async () => {
    const mounted = mount(TABLE);
    try {
      await flush();
      await caretInFirstCell(mounted.editor());
      await openDialog(mounted.container);
      expect(field('columns').value).toBe('2');
      expect(field('rows').value).toBe('1');
      await type(field('columns'), '3');
      expect(apply().disabled).toBe(false);
      apply().click();
      await flush();
      expect(dialog()).toBeNull();
      expect(firstRowCells(mounted.editor())).toBe(4);
    } finally {
      mounted.unmount();
    }
  });

  test('the dialog shows the engine reason and disables Split for a refused count', async () => {
    const mounted = mount(THREE_ROW_MERGE);
    try {
      await flush();
      await caretInFirstCell(mounted.editor());
      await openDialog(mounted.container);
      await type(field('columns'), '1');
      await type(field('rows'), '2');
      expect(apply().disabled).toBe(true);
      expect(message()).toBe(
        'A merged cell splits only into a number of rows that divides evenly into its rows'
      );
      await type(field('rows'), '3');
      expect(apply().disabled).toBe(false);
      expect(message()).toBe('');
      await type(field('columns'), '0');
      expect(apply().disabled).toBe(true);
      expect(message()).toBe('Enter a whole number from 1 to 8');
      expect(field('columns').getAttribute('aria-invalid')).toBe('true');
      expect(field('rows').getAttribute('aria-invalid')).toBeNull();
    } finally {
      mounted.unmount();
    }
  });

  test('Escape closes the dialog without splitting', async () => {
    const mounted = mount(TABLE);
    try {
      await flush();
      await caretInFirstCell(mounted.editor());
      await openDialog(mounted.container);
      dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
      expect(dialog()).toBeNull();
      expect(firstRowCells(mounted.editor())).toBe(2);
    } finally {
      mounted.unmount();
    }
  });
});
