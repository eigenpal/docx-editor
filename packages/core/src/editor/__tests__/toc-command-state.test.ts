// The enabled state of editing commands around a generated table of contents. `can`, the
// toolbar, and `exec` give the same answer, and a refused command leaves the document as it was.

import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { EditorCommand } from '../../contracts/editor.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import type { ChromeSlotId } from '../chrome-controls.ts';

const READ_ONLY = 'the table of contents is generated and read-only';
const run = (s: string) => `<w:r><w:t>${s}</w:t></w:r>`;
const begin =
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TOC \\o "1-1" \\h</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>';
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
// 0 Before, 1-2 cached rows, 3 closing line (only the end mark), 4 After.
const BODY = `<w:p>${run('Before')}</w:p><w:p>${begin}${run('Entry 1')}</w:p><w:p>${run('Entry 2')}</w:p><w:p>${end}</w:p><w:p>${run('After')}</w:p>`;
// 0 "Before" + begin + row, 1 "Pg" + end mark + "Heading", 2 After.
const INLINE = `<w:p>${run('Before')}${begin}${run('Entry 1')}</w:p><w:p>${run('Pg')}${end}${run('Heading')}</w:p><w:p>${run('After')}</w:p>`;

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

type Place = readonly [anchor: number, anchorOffset: number, head: number, headOffset: number];

function mountAt(body: string, [a, ao, h, ho]: Place) {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
  });
  editors.push(editor);
  const surface = editor.surface!;
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[a]!, offset: ao },
    head: { paragraphId: ids[h]!, offset: ho },
  });
  return { editor, surface };
}

const BOLD: EditorCommand = { type: 'toggleMark', mark: 'bold' };
const CENTER: EditorCommand = { type: 'setAlignment', align: 'center' };
const TYPE: EditorCommand = { type: 'insertText', text: 'X' };
const BULLETS: EditorCommand = { type: 'toggleList', kind: 'bullet' };
const CLEAR: EditorCommand = { type: 'clearFormatting' };
const FORMAT = { type: 'applyFormatting', marks: { bold: true } } as EditorCommand;
const REPLACE = { type: 'replaceText', text: 'Q' } as EditorCommand;
const MERGE = { type: 'mergeParagraphs' } as EditorCommand;
const TABLE = { type: 'insertTable', rows: 2, cols: 2 } as EditorCommand;
const TEXT_BOX: EditorCommand = { type: 'insertTextBox' };
const NOTE: EditorCommand = { type: 'insertNote', noteKind: 'footnote' };
const BOOKMARK: EditorCommand = { type: 'insertBookmark', name: 'mark' };
const CONTROL = { type: 'insertContentControl', subtype: 'plainText' } as EditorCommand;
const LINK = { type: 'insertHyperlink', href: 'https://example.com/' } as EditorCommand;
const PROPOSE = { type: 'proposeInsertion', text: 'P', author: 'A' } as EditorCommand;
const PROPOSE_DELETE = { type: 'proposeDeletion', author: 'A' } as EditorCommand;
const HEADER: EditorCommand = { type: 'editHeaderFooter', position: 'header' };
const WATERMARK = { type: 'setWatermark', watermark: { text: 'DRAFT' } } as EditorCommand;

// [label, body, selection, command, refused]
const CASES: readonly (readonly [string, string, Place, EditorCommand, boolean])[] = [
  ['caret in a row: Bold', BODY, [1, 2, 1, 2], BOLD, true],
  ['caret in a row: alignment', BODY, [1, 2, 1, 2], CENTER, true],
  ['caret in a row: typing', BODY, [1, 2, 1, 2], TYPE, true],
  ['caret in a row: clear formatting', BODY, [1, 2, 1, 2], CLEAR, true],
  ['range in a row: Bold', BODY, [1, 1, 1, 4], BOLD, true],
  ['range over rows: alignment', BODY, [1, 1, 2, 3], CENTER, true],
  ['closing line: Bold formats its mark', BODY, [3, 0, 3, 0], BOLD, true],
  ['closing line: alignment', BODY, [3, 0, 3, 0], CENTER, true],
  ['closing line: typing lands after the end mark', BODY, [3, 0, 3, 0], TYPE, false],
  ['after the TOC: Bold', BODY, [4, 1, 4, 1], BOLD, false],
  ['range across the TOC: Bold formats the other text', BODY, [0, 1, 4, 2], BOLD, false],
  ['range across the TOC: alignment', BODY, [0, 1, 4, 2], CENTER, false],
  ['range across the TOC: typing would remove it', BODY, [0, 1, 4, 2], TYPE, true],
  ['range across the TOC: bullets', BODY, [0, 1, 4, 2], BULLETS, true],
  ['closing line and the next paragraph: alignment', BODY, [3, 0, 4, 2], CENTER, false],
  ['closing line and the next paragraph: typing', BODY, [3, 0, 4, 2], TYPE, false],
  ['text before the field: Bold', INLINE, [0, 1, 0, 4], BOLD, false],
  ['text before the field and a row: Bold', INLINE, [0, 2, 0, 9], BOLD, false],
  ['heading after the end mark: Bold', INLINE, [1, 4, 1, 9], BOLD, false],
  ['cached page number: Bold', INLINE, [1, 0, 1, 1], BOLD, true],
  ['boundary with cached text: alignment', INLINE, [1, 6, 1, 6], CENTER, true],
  ['only the mark of a boundary paragraph: Bold', INLINE, [1, 9, 2, 0], BOLD, true],
  ['range in a row: automation format', BODY, [1, 1, 1, 4], FORMAT, true],
  ['after the TOC: automation format', BODY, [4, 0, 4, 3], FORMAT, false],
  ['range in a row: replace text', BODY, [1, 1, 1, 4], REPLACE, true],
  ['caret before the TOC: merge into the first row', BODY, [0, 6, 0, 6], MERGE, true],
  ['closing line: merge the next paragraph into it', BODY, [3, 0, 3, 0], MERGE, false],
  ['caret in a row: table', BODY, [1, 2, 1, 2], TABLE, true],
  ['closing line: table splits a TOC paragraph', BODY, [3, 0, 3, 0], TABLE, true],
  ['after the TOC: table', BODY, [4, 1, 4, 1], TABLE, false],
  ['caret in a row: text box', BODY, [1, 2, 1, 2], TEXT_BOX, true],
  ['closing line: text box anchors after the end mark', BODY, [3, 0, 3, 0], TEXT_BOX, false],
  ['caret in a row: footnote', BODY, [1, 2, 1, 2], NOTE, true],
  ['closing line: footnote', BODY, [3, 0, 3, 0], NOTE, false],
  ['caret in a row: bookmark', BODY, [1, 2, 1, 2], BOOKMARK, true],
  ['range in a row: content control', BODY, [1, 1, 1, 4], CONTROL, true],
  ['after the TOC: content control', BODY, [4, 1, 4, 3], CONTROL, false],
  ['range in a row: link', BODY, [1, 1, 1, 4], LINK, true],
  ['after the TOC: link', BODY, [4, 1, 4, 4], LINK, false],
  ['caret in a row: proposed insertion', BODY, [1, 2, 1, 2], PROPOSE, true],
  ['range across the TOC: proposed insertion lands outside it', BODY, [0, 1, 4, 2], PROPOSE, false],
  ['range across the TOC: proposed deletion', BODY, [0, 1, 4, 2], PROPOSE_DELETE, true],
  ['caret in a row: a header is not written at the caret', BODY, [1, 2, 1, 2], HEADER, false],
  ['caret in a row: a watermark is not written at the caret', BODY, [1, 2, 1, 2], WATERMARK, false],
];

for (const [label, body, place, command, refused] of CASES) {
  test(`can and exec agree: ${label}`, () => {
    const { editor, surface } = mountAt(body, place);
    const before = serializeOoxmlPart(surface.session.part());
    const can = editor.can(command);
    const result = editor.exec(command);
    if (refused) {
      expect(can).toEqual({ ok: false, code: 'invalidArgs', reason: READ_ONLY });
      expect(result).toEqual(can);
      expect(serializeOoxmlPart(surface.session.part())).toBe(before);
    } else {
      expect(can).toEqual({ ok: true });
      expect(result).toMatchObject({ ok: true, changed: true });
    }
  });
}

test('toolbar controls are disabled inside the TOC and on its closing line', () => {
  const slots: ChromeSlotId[] = [
    'text.bold',
    'text.italic',
    'alignment.center',
    'list.bullet',
    'table.insert',
  ];
  for (const place of [
    [1, 2, 1, 2],
    [3, 0, 3, 0],
  ] as const) {
    const { editor } = mountAt(BODY, place);
    for (const slot of slots) {
      expect(toolbarCommandState(editor, slot)).toMatchObject({
        enabled: false,
        disabledReason: READ_ONLY,
      });
    }
  }
  const { editor } = mountAt(BODY, [4, 1, 4, 1]);
  for (const slot of slots) expect(toolbarCommandState(editor, slot).enabled).toBe(true);
});

test('the Bold shortcut at a caret in a row is refused like the toolbar', () => {
  const { editor, surface } = mountAt(BODY, [1, 2, 1, 2]);
  expect(surface.toggleRunProperty('b')).toBe(READ_ONLY);
  expect(editor.isActive(BOLD)).toBe(false);
});

test('the format painter refuses a selection that reaches the TOC', () => {
  const { editor, surface } = mountAt(BODY, [4, 1, 4, 3]);
  expect(editor.exec({ type: 'copyFormatting' } as EditorCommand).ok).toBe(true);
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[3]!, offset: 0 },
    head: { paragraphId: ids[4]!, offset: 2 },
  });
  const paste = { type: 'pasteFormatting' } as EditorCommand;
  const before = serializeOoxmlPart(surface.session.part());
  expect(editor.can(paste)).toEqual({ ok: false, code: 'invalidArgs', reason: READ_ONLY });
  expect(editor.exec(paste)).toEqual(editor.can(paste));
  expect(serializeOoxmlPart(surface.session.part())).toBe(before);
});
