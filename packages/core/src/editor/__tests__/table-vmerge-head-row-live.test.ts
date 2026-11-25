// Live edits in a row whose cells all start a vertical merge (`w:vMerge`, `CT_VMerge`,
// ECMA-376 Part 1, 17.4.84). The row's first cell's end paragraph sets its floor, and an
// `atLeast` row height (`w:trHeight`, `CT_Height`, 17.4.80) below that floor does not lower
// it. Typing in a head grows the span, not the head row, and the incremental layout, undo, and
// a cold reopen of the saved file give the same rows.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { caretAt } from '../../layout/semantic-interaction.ts';
import type { TableFragmentRecord } from '../../layout/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const RESTART = '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>';
const CONTINUE = '<w:tcPr><w:vMerge/></w:tcPr>';

// Row 0 holds two merge heads and a 5pt minimum. Row 1 continues both heads.
const HEAD_ROW_TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  `<w:tr><w:trPr><w:trHeight w:val="100"/></w:trPr><w:tc>${RESTART}${p('A0')}</w:tc>` +
  `<w:tc>${RESTART}${p('B0')}</w:tc></w:tr>` +
  `<w:tr><w:tc>${CONTINUE}<w:p/></w:tc><w:tc>${CONTINUE}<w:p/></w:tc></w:tr>` +
  `<w:tr><w:tc>${p('C')}</w:tc><w:tc>${p('D')}</w:tc></w:tr></w:tbl>${p('After')}`;

const liveEditors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  while (liveEditors.length > 0) liveEditors.pop()?.destroy();
  while (containers.length > 0) containers.pop()?.remove();
  document.getSelection()?.removeAllRanges();
});

function packageOf(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  liveEditors.push(editor);
  return editor;
}

function paragraphByText(editor: DocxEditorInstance, text: string): string {
  for (const id of editor.surface!.session.paragraphIds()) {
    if (paragraphTextOf(editor.surface!.session.part(), id) === text) return id;
  }
  throw new Error(`paragraph ${text} not found`);
}

function tableOf(editor: DocxEditorInstance): TableFragmentRecord {
  const table = editor
    .surface!.layout()
    .pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('no table fragment');
  return table;
}

const rowHeights = (table: TableFragmentRecord): number[] =>
  table.rows.map((row) => row.box.height);

describe('a row of merge heads, edited live', () => {
  test('typing in a head grows its span, and undo and reopen agree with it', () => {
    const editor = mount(packageOf(HEAD_ROW_TABLE));
    const initial = rowHeights(tableOf(editor));
    // The head row keeps one end line, more than its 5pt minimum.
    expect(initial[0]!).toBeGreaterThan(5);

    let last = paragraphByText(editor, 'A0');
    for (const text of ['A1', 'A2', 'A3', 'A4']) {
      editor.surface!.setSelection({
        head: { paragraphId: last, offset: 2 },
        anchor: { paragraphId: last, offset: 2 },
      });
      editor.surface!.splitParagraph();
      expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
      last = paragraphByText(editor, text);
    }
    const edited = tableOf(editor);
    const grown = rowHeights(edited);
    // The head row keeps its floor; the span's last row takes the new lines.
    expect(grown[0]).toBeCloseTo(initial[0]!, 6);
    expect(grown[1]!).toBeGreaterThan(initial[1]!);
    expect(grown[2]).toBeCloseTo(initial[2]!, 6);
    const head = edited.rows[0]!.cells[0]!;
    expect(head.rowSpan).toBe(2);

    // The caret at the end of the new last line paints inside the merged cell.
    const caret = caretAt(editor.surface!.layout(), { paragraphId: last, offset: 2 })!;
    expect(caret).not.toBeNull();
    expect(caret.y).toBeGreaterThanOrEqual(head.box.y);
    expect(caret.y + caret.height).toBeLessThanOrEqual(head.box.y + head.box.height + 0.001);

    // A cold open of the saved file plans the same rows as the incremental pass did.
    const reopened = mount(editor.surface!.session.save());
    expect(rowHeights(tableOf(reopened))).toEqual(grown);

    for (let step = 0; step < 20 && editor.can({ type: 'undo' }).ok; step += 1) {
      editor.exec({ type: 'undo' });
    }
    expect(rowHeights(tableOf(editor))).toEqual(initial);
  });
});
