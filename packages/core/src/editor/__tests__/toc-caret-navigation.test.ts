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
  // Down crosses the first TOC and its closing line to the paragraph between the two.
  expect(from(0, 0, 'down').head.paragraphId).toBe(at(3, 0).paragraphId);
});

test('Ctrl+End stops on the closing line of an earlier TOC when nothing lies between', () => {
  const lastToc = `<w:p>${begin}${run('F1')}</w:p><w:p>${run('F2')}${end}</w:p>`;
  const { at, from } = mount(`<w:p>${run('Before')}</w:p>${bare}${lastToc}`);
  expect(from(0, 0, 'documentEnd').head).toEqual(at(2, 0));
});

test('Shift+arrows extend a selection across a TOC as the plain motion moves the caret', () => {
  const { surface, editor, at, from } = mount(
    `<w:p>${run('Before')}</w:p>${bare}<w:p>${run('After')}</w:p>`
  );
  // [command, start paragraph, start offset, paragraph the head reaches]
  for (const [command, index, offset, far] of [
    ['down', 0, 6, 3],
    ['right', 0, 6, 3],
    ['up', 3, 0, 0],
    ['left', 3, 0, 0],
  ] as const) {
    const plain = from(index, offset, command).head;
    expect(plain.paragraphId).toBe(at(far, 0).paragraphId);
    expect(from(index, offset, command, true)).toEqual({ anchor: at(index, offset), head: plain });
  }
  // Shift in the opposite direction shrinks the selection back across the TOC.
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

test('Left, Right, and word steps across a TOC continue at the text beside it', () => {
  const { at, from } = mount(
    `<w:p>${run('Before text')}</w:p>${bare}<w:p>${run('After text')}</w:p>`
  );
  for (const command of ['left', 'wordLeft'] as const) {
    expect(from(3, 0, command).head).toEqual(at(0, 11));
    expect(from(3, 0, command, true)).toEqual({ anchor: at(3, 0), head: at(0, 11) });
    // From the closing line, too.
    expect(from(2, 0, command).head).toEqual(at(0, 11));
  }
  for (const command of ['right', 'wordRight'] as const) {
    expect(from(0, 11, command).head).toEqual(at(3, 0));
    expect(from(0, 11, command, true)).toEqual({ anchor: at(0, 11), head: at(3, 0) });
  }
});

test('Left after a TOC that starts the document stops on its closing line', () => {
  const { at, from } = mount(`${bare}<w:p>${run('After')}</w:p>`);
  expect(from(2, 0, 'left').head).toEqual(at(1, 0));
  expect(from(1, 0, 'left').head).toEqual(at(1, 0));
});
