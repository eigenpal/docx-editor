// Caret motion and Shift selection around a generated table of contents. Its cached rows are
// read-only: a motion crosses them, stops on an editable closing line, or stops at the nearest
// editable position on its own side when nothing editable lies past the TOC.

import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';
import type { NavigationCommand } from '../../layout/semantic-interaction.ts';

const run = (s: string) => `<w:r><w:t>${s}</w:t></w:r>`;
const begin =
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TOC \\o "1-1" \\h</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>';
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const bare = `<w:p>${begin}${run('Entry')}</w:p><w:p>${end}</w:p>`;
const controlled = `<w:sdt><w:sdtPr/><w:sdtContent>${bare}</w:sdtContent></w:sdt>`;

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(body: string) {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
  });
  editors.push(editor);
  const surface = editor.surface!;
  const ids = surface.session.paragraphIds();
  const at = (index: number, offset: number) => ({ paragraphId: ids[index]!, offset });
  const from = (index: number, offset: number, command: NavigationCommand, extend = false) => {
    surface.setSelection({ anchor: at(index, offset), head: at(index, offset) });
    surface.navigate(command, extend);
    return surface.state().selection;
  };
  return { editor, surface, at, from };
}

for (const [shape, toc] of [
  ['bare field', bare],
  ['content control', controlled],
] as const) {
  test(`Ctrl+Home and Page Up after a TOC that starts the document stop on its closing line (${shape})`, () => {
    const { at, from } = mount(`${toc}<w:p>${run('After')}</w:p><w:p>${run('More')}</w:p>`);
    for (const command of ['documentStart', 'pageUp', 'up'] as const) {
      expect(from(2, 3, command).head).toEqual(at(1, 0));
      expect(from(2, 3, command, true)).toEqual({ anchor: at(2, 3), head: at(1, 0) });
    }
    // Home stays on the caret's own line.
    expect(from(2, 3, 'lineStart').head).toEqual(at(2, 0));
  });
}

test('Ctrl+Home after a TOC without a closing line stops at the first editable position', () => {
  const { at, from } = mount(`<w:p>${begin}${run('Entry')}${end}</w:p><w:p>${run('After')}</w:p>`);
  for (const command of ['documentStart', 'pageUp'] as const) {
    expect(from(1, 3, command).head).toEqual(at(1, 0));
  }
});

test('Ctrl+End and Page Down stop before a TOC whose end mark sits in its last row', () => {
  const lastToc = `<w:p>${begin}${run('F1')}</w:p><w:p>${run('F2')}${end}</w:p>`;
  const { at, from } = mount(
    `<w:p>${run('Before')}</w:p>${bare}<w:p>${run('Mid')}</w:p>${lastToc}`
  );
  for (const command of ['documentEnd', 'pageDown'] as const) {
    expect(from(0, 0, command).head).toEqual(at(3, 3));
    expect(from(3, 0, command).head).toEqual(at(3, 3));
    expect(from(0, 2, command, true)).toEqual({ anchor: at(0, 2), head: at(3, 3) });
  }
  // Down crosses the first TOC's rows to its closing line, then to the paragraph after it.
  expect(from(0, 0, 'down').head).toEqual(at(2, 0));
  expect(from(2, 0, 'down').head.paragraphId).toBe(at(3, 0).paragraphId);
});

test('Ctrl+End stops on the closing line of an earlier TOC when nothing lies between', () => {
  const lastToc = `<w:p>${begin}${run('F1')}</w:p><w:p>${run('F2')}${end}</w:p>`;
  const { at, from } = mount(`<w:p>${run('Before')}</w:p>${bare}${lastToc}`);
  expect(from(0, 0, 'documentEnd').head).toEqual(at(2, 0));
});

test('arrows and Shift+arrows stop on the closing line, then cross the rows', () => {
  const { surface, editor, at, from } = mount(
    `<w:p>${run('Before')}</w:p>${bare}<w:p>${run('After')}</w:p>`
  );
  // [command, start paragraph, start offset, where the head lands]
  for (const [command, index, offset, landing] of [
    ['down', 0, 6, at(2, 0)],
    ['right', 0, 6, at(2, 0)],
    ['up', 3, 0, at(2, 0)],
    ['left', 3, 0, at(2, 0)],
    ['up', 2, 0, at(0, 0)],
    ['left', 2, 0, at(0, 6)],
    ['down', 2, 0, at(3, 0)],
    ['right', 2, 0, at(3, 0)],
  ] as const) {
    const plain = from(index, offset, command).head;
    expect(plain.paragraphId).toBe(landing.paragraphId);
    if (command !== 'up') expect(plain).toEqual(landing);
    expect(from(index, offset, command, true)).toEqual({ anchor: at(index, offset), head: plain });
  }
  // Shift in the opposite direction shrinks the selection back.
  from(0, 6, 'down', true);
  surface.navigate('up', true);
  expect(surface.state().selection.head.paragraphId).toBe(at(0, 0).paragraphId);
  // Typing over a selection that covers the rows is refused, as for a mouse selection.
  from(0, 6, 'documentEnd', true);
  expect(surface.state().selection.head).toEqual(at(3, 5));
  expect(editor.exec({ type: 'insertText', text: 'X' })).toMatchObject({ ok: false });
});

test('Shift+Down onto a closing line that ends the document selects up to it', () => {
  const { at, from } = mount(`<w:p>${run('Before')}</w:p>${bare}`);
  expect(from(0, 6, 'down', true)).toEqual({ anchor: at(0, 6), head: at(2, 0) });
  expect(from(0, 6, 'documentEnd', true)).toEqual({ anchor: at(0, 6), head: at(2, 0) });
});

test('a document that holds only a TOC keeps the caret on its closing line', () => {
  const { at, from } = mount(bare);
  for (const command of ['documentStart', 'documentEnd', 'up', 'down', 'pageUp'] as const) {
    expect(from(1, 0, command).head).toEqual(at(1, 0));
  }
});

test('Left, Right, and word steps across the rows continue at the text beside them', () => {
  const { at, from } = mount(
    `<w:p>${run('Before text')}</w:p>${bare}<w:p>${run('After text')}</w:p>`
  );
  for (const command of ['left', 'wordLeft'] as const) {
    expect(from(2, 0, command).head).toEqual(at(0, 11));
    expect(from(2, 0, command, true)).toEqual({ anchor: at(2, 0), head: at(0, 11) });
  }
  for (const command of ['right', 'wordRight'] as const) {
    expect(from(0, 11, command).head).toEqual(at(2, 0));
    expect(from(0, 11, command, true)).toEqual({ anchor: at(0, 11), head: at(2, 0) });
  }
});

test('Home and End stay in a paragraph that shares a line with the TOC', () => {
  const { at, from } = mount(
    `<w:p>${run('Before')}${begin}${run('Entry 1')}</w:p><w:p>${run('Pg')}${end}${run('Heading')}</w:p><w:p>${run('After')}</w:p>`
  );
  // End from the text before the field stops where the field begins.
  expect(from(0, 2, 'lineEnd').head).toEqual(at(0, 6));
  // Home from the heading after the end mark stops after the mark.
  expect(from(1, 6, 'lineStart').head).toEqual(at(1, 2));
  expect(from(1, 6, 'lineStart', true)).toEqual({ anchor: at(1, 6), head: at(1, 2) });
});

test('Left after a TOC that starts the document stops on its closing line', () => {
  const { at, from } = mount(`${bare}<w:p>${run('After')}</w:p>`);
  expect(from(2, 0, 'left').head).toEqual(at(1, 0));
  expect(from(1, 0, 'left').head).toEqual(at(1, 0));
});

test('Up and Down across a TOC keep the column on a closing line that holds a heading', () => {
  const { at, from } = mount(
    `<w:p>${run('Before')}</w:p><w:p>${begin}${run('Entry')}</w:p><w:p>${end}${run('Heading')}</w:p>`
  );
  expect(from(0, 3, 'down').head).toEqual(at(2, 3));
  expect(from(0, 3, 'down', true)).toEqual({ anchor: at(0, 3), head: at(2, 3) });
  expect(from(2, 3, 'up').head).toEqual(at(0, 3));
});

test('Shift+Up and Shift+Down cross a TOC with many rows in one step', () => {
  const rows = Array.from({ length: 12 }, (_, index) => `<w:p>${run(`Entry ${index + 2}`)}</w:p>`);
  const { at, from } = mount(
    `<w:p>${run('Before')}</w:p><w:p>${begin}${run('Entry 1')}</w:p>${rows.join('')}<w:p>${end}${run('Heading')}</w:p>`
  );
  // 0 Before, 1-13 cached rows, 14 the end mark + "Heading".
  expect(from(14, 3, 'up', true)).toEqual({ anchor: at(14, 3), head: at(0, 3) });
  expect(from(0, 3, 'down', true)).toEqual({ anchor: at(0, 3), head: at(14, 3) });
});

test('Up and Down cross two adjacent TOCs', () => {
  const second = `<w:p>${begin}${run('Other')}</w:p><w:p>${end}${run('Heading')}</w:p>`;
  const first = `<w:p>${begin}${run('Entry')}</w:p><w:p>${run('Last row')}${end}</w:p>`;
  const { at, from } = mount(`<w:p>${run('Before')}</w:p>${first}${second}`);
  // 0 Before, 1-2 the first TOC (end mark in its last row), 3 a row of the second, 4 its end.
  expect(from(0, 3, 'down').head).toEqual(at(4, 3));
  expect(from(4, 3, 'up').head).toEqual(at(0, 3));
  expect(from(0, 3, 'down', true)).toEqual({ anchor: at(0, 3), head: at(4, 3) });
});

test('arrows cross a TOC without cached rows, whose closing line is hidden', () => {
  const empty = `<w:p>${begin}</w:p><w:p>${end}</w:p>`;
  const { at, from } = mount(`<w:p>${run('Before')}</w:p>${empty}<w:p>${run('After')}</w:p>`);
  // 0 Before, 1 begin and separator only, 2 the hidden closing line, 3 After.
  expect(from(0, 6, 'right').head).toEqual(at(3, 0));
  expect(from(3, 0, 'left').head).toEqual(at(0, 6));
  expect(from(0, 3, 'down').head.paragraphId).toBe(at(3, 0).paragraphId);
});
