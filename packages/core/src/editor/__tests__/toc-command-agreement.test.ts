// Commands that do not write at the selection, run while the selection is in or across a
// generated table of contents. `can` and `exec` agree, and a write aimed away from the TOC is
// not refused because of where the caret is.

import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';
import type { EditorCommand } from '../../contracts/editor.ts';
import { stubReviewModule } from './review-test-module.ts';
import { reviewModule } from './replace-accepted-text-fixture.ts';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';

const READ_ONLY = 'the table of contents is generated and read-only';
const run = (s: string) => `<w:r><w:t>${s}</w:t></w:r>`;
const begin =
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TOC \\o "1-1" \\h</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>';
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const inserted =
  '<w:ins w:id="7" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>New</w:t></w:r></w:ins>';
const bookmark = `<w:bookmarkStart w:id="1" w:name="mark"/>${run('x')}<w:bookmarkEnd w:id="1"/>`;
const control = `<w:sdt><w:sdtPr><w:id w:val="55"/><w:text/></w:sdtPr><w:sdtContent><w:p>${run('Field')}</w:p></w:sdtContent></w:sdt>`;
// 0 Before, 1-2 cached rows, 3 closing line, 4 After (bookmark, tracked insertion), 5 a control.
const BODY = `<w:p>${run('Before')}</w:p><w:p>${begin}${run('Entry 1')}</w:p><w:p>${run('Entry 2')}</w:p><w:p>${end}</w:p><w:p>${run('After')}${bookmark}${inserted}</w:p>${control}<w:p>${run('Last')}</w:p>`;
const CONTROL_AT = { container: { part: 'body' as const }, path: [5] };

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mountAt([a, ao, h, ho]: readonly [number, number, number, number]) {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(BODY),
    modules: [stubReviewModule()],
  });
  editors.push(editor);
  const surface = editor.surface!;
  const ids = surface.session.paragraphIds();
  surface.setSelection({
    anchor: { paragraphId: ids[a]!, offset: ao },
    head: { paragraphId: ids[h]!, offset: ho },
  });
  return editor;
}

// Each writes away from the selection, so each succeeds wherever the caret is.
const AWAY: readonly EditorCommand[] = [
  { type: 'acceptAllRevisions' },
  { type: 'rejectAllRevisions' },
  { type: 'deleteBookmark', name: 'mark' },
  { type: 'replaceAllMatches', query: 'After', text: 'Later' },
  { type: 'setNoteProperties', footnote: { numberFormat: 'lowerRoman' } } as EditorCommand,
  { type: 'convertAllNotes', fromKind: 'footnote' },
  { type: 'setPageSetup', marginTop: 900 },
  { type: 'setWatermark', watermark: { text: 'DRAFT' } } as EditorCommand,
  { type: 'toggleDocumentProtection' } as EditorCommand,
  { type: 'setContentControlValue', target: CONTROL_AT, value: 'v' },
  { type: 'removeContentControl', target: CONTROL_AT },
  { type: 'refreshToc' },
  { type: 'removeToc' },
];

const PLACES = [
  ['caret in a row', [1, 2, 1, 2]],
  ['caret on the closing line', [3, 0, 3, 0]],
  ['range across the TOC', [0, 2, 4, 2]],
] as const;

for (const [place, at] of PLACES) {
  for (const command of AWAY) {
    test(`${place}: ${command.type} is allowed by can and exec`, () => {
      const editor = mountAt(at);
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toMatchObject({ ok: true });
    });
  }

  test(`${place}: replacing only generated text is refused by can and exec alike`, () => {
    const editor = mountAt(at);
    const command: EditorCommand = { type: 'replaceAllMatches', query: 'Entry', text: 'Q' };
    expect(editor.can(command)).toEqual({ ok: false, code: 'invalidArgs', reason: READ_ONLY });
    expect(editor.exec(command)).toEqual(editor.can(command));
  });
}

test('replacing matches in and out of the TOC writes the others and counts the skips', () => {
  const editor = mountAt([1, 2, 1, 2]);
  const command: EditorCommand = { type: 'replaceAllMatches', query: 'e', text: 'E' };
  expect(editor.can(command)).toEqual({ ok: true });
  const result = editor.exec(command);
  expect(result).toMatchObject({ ok: true, changed: true });
  const counts = (result as { replacements: { replaced: number; skipped: number } }).replacements;
  expect(counts.replaced).toBeGreaterThan(0);
  expect(counts.skipped).toBeGreaterThan(0);
});

test('in suggesting mode an accepted-text fix lands after the end mark, and a row stays read-only', () => {
  // 0 "Before" + begin + row, 1 "Pg" + end mark + "Heading".
  const body = `<w:p>${run('Before')}${begin}${run('Entry 1')}</w:p><w:p>${run('Pg')}${end}${run('Heading')}</w:p>`;
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(body),
    author: 'Grace Hopper',
    modules: [reviewModule()],
  });
  editors.push(editor);
  expect(editor.setEditingMode('suggesting').ok).toBe(true);
  const [, closing] = editor.getParagraphs();
  const row: EditorCommand = {
    type: 'replaceAcceptedText',
    match: { blockId: closing!.blockId, start: 0, length: 2 },
    text: 'P9',
  };
  expect(editor.can(row)).toEqual({ ok: false, code: 'invalidArgs', reason: READ_ONLY });
  expect(editor.exec(row)).toEqual(editor.can(row));
  const insert: EditorCommand = {
    type: 'replaceAcceptedText',
    match: { blockId: closing!.blockId, start: 2, length: 0 },
    text: 'X',
  };
  expect(editor.can(insert)).toEqual({ ok: true });
  expect(editor.exec(insert)).toMatchObject({ ok: true, changed: true });
  const xml = serializeOoxmlPart(editor.surface!.session.part());
  const mark = xml.indexOf('w:fldCharType="end"');
  const tracked = xml.search(/<w:ins [^>]*w:author="Grace Hopper"[^>]*><w:r><w:t[^>]*>X</);
  expect(tracked).toBeGreaterThan(mark);
  expect(xml.indexOf('Heading')).toBeGreaterThan(tracked);
});
