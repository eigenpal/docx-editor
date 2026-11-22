// The enabled state of editing commands around a generated table of contents. `can`, the
// toolbar, and `exec` give the same answer, and a refused command leaves the document as it was.

import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { detectBodyTocs, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { EditorCommand } from '../../contracts/editor.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import { capturePointPosition } from '../editor-point-target.ts';
import { stubReviewModule } from './review-test-module.ts';
import { validateRasterHeader, type ImageDecodePort } from '../../store/package/image-resources.ts';
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
// 0 Before, 1 cached row, 2 end mark + "Heading" (a closing line the next paragraph joined), 3 After.
const JOINED = `<w:p>${run('Before')}</w:p><w:p>${begin}${run('Entry 1')}</w:p><w:p>${end}${run('Heading')}</w:p><w:p>${run('After')}</w:p>`;

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
const SECTION = { type: 'insertBreak', kind: 'section' } as EditorCommand;
const MARGINS = { type: 'setPageSetup', marginTop: 90 } as EditorCommand;
const CHART = { type: 'insertChart', chartType: 'columnClustered' } as EditorCommand;
const TOC: EditorCommand = { type: 'insertToc' };
const INDENT = { type: 'setIndent', left: 360 } as EditorCommand;
const UNLINK = { type: 'removeHyperlink' } as EditorCommand;
const WATERMARK = { type: 'setWatermark', watermark: { text: 'DRAFT' } } as EditorCommand;

// [label, body, selection, command, refused]
const CASES: readonly (readonly [string, string, Place, EditorCommand, boolean])[] = [
  ['caret in a row: Bold', BODY, [1, 2, 1, 2], BOLD, true],
  ['caret in a row: alignment', BODY, [1, 2, 1, 2], CENTER, true],
  ['caret in a row: typing', BODY, [1, 2, 1, 2], TYPE, true],
  ['caret in a row: clear formatting', BODY, [1, 2, 1, 2], CLEAR, true],
  ['range in a row: Bold', BODY, [1, 1, 1, 4], BOLD, true],
  ['range over rows: alignment', BODY, [1, 1, 2, 3], CENTER, true],
  ['closing line: clear formatting writes its mark', BODY, [3, 0, 3, 0], CLEAR, true],
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
  [
    'end mark after cached text: merge the next paragraph after it',
    INLINE,
    [1, 9, 1, 9],
    MERGE,
    false,
  ],
  [
    'end mark after cached text: delete into the next paragraph',
    INLINE,
    [1, 9, 2, 0],
    REPLACE,
    false,
  ],
  ['cached page number: delete into the next paragraph', INLINE, [1, 1, 2, 0], REPLACE, true],
  ['caret in a row: table', BODY, [1, 2, 1, 2], TABLE, true],
  ['range from a row into the next paragraph: table', BODY, [1, 2, 4, 1], TABLE, true],
  ['closing line: table goes after it', BODY, [3, 0, 3, 0], TABLE, false],
  ['after the TOC: table', BODY, [4, 1, 4, 1], TABLE, false],
  ['caret in a row: text box', BODY, [1, 2, 1, 2], TEXT_BOX, true],
  ['closing line: text box anchors after the end mark', BODY, [3, 0, 3, 0], TEXT_BOX, false],
  ['caret in a row: footnote', BODY, [1, 2, 1, 2], NOTE, true],
  ['closing line: a footnote goes after the end mark', BODY, [3, 0, 3, 0], NOTE, false],
  ['closing line: a bookmark goes after the end mark', BODY, [3, 0, 3, 0], BOOKMARK, false],
  ['closing line: a link goes after the end mark', BODY, [3, 0, 3, 0], LINK, false],
  ['after the TOC: footnote', BODY, [4, 1, 4, 1], NOTE, false],
  ['after the TOC: bookmark', BODY, [4, 1, 4, 3], BOOKMARK, false],
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
  ['caret in a row: page setup is not written at the caret', BODY, [1, 2, 1, 2], MARGINS, false],
  ['caret in a row: section break', BODY, [1, 2, 1, 2], SECTION, true],
  ['closing line: section break ends a section after the TOC', BODY, [3, 0, 3, 0], SECTION, false],
  ['text before the field: section break', INLINE, [0, 2, 0, 2], SECTION, true],
  ['heading after the end mark: section break', INLINE, [1, 5, 1, 5], SECTION, true],
  ['after the TOC: section break', INLINE, [2, 2, 2, 2], SECTION, false],
  ['end mark after cached text: link', INLINE, [1, 2, 1, 2], LINK, false],
  ['end mark after cached text: link over the heading', INLINE, [1, 2, 1, 5], LINK, false],
  ['end mark after cached text: bookmark', INLINE, [1, 2, 1, 2], BOOKMARK, false],
  ['end mark after cached text: content control', INLINE, [1, 2, 1, 2], CONTROL, false],
  ['end mark after cached text: footnote', INLINE, [1, 2, 1, 2], NOTE, false],
  ['end mark after cached text: typing', INLINE, [1, 2, 1, 2], TYPE, false],
  ['inside the heading: link', INLINE, [1, 3, 1, 5], LINK, false],
  ['before a TOC that begins mid-paragraph: footnote', INLINE, [0, 6, 0, 6], NOTE, false],
  ['before a TOC that begins mid-paragraph: chart', INLINE, [0, 6, 0, 6], CHART, false],
  ['before a TOC that begins mid-paragraph: typing', INLINE, [0, 6, 0, 6], TYPE, false],
  ['before a TOC that begins mid-paragraph: bookmark', INLINE, [0, 6, 0, 6], BOOKMARK, false],
  ['text before a TOC: footnote', INLINE, [0, 3, 0, 3], NOTE, false],
  ['caret in a row: chart', BODY, [1, 2, 1, 2], CHART, true],
  ['range across the TOC: chart would remove it', BODY, [0, 1, 4, 2], CHART, true],
  ['closing line: a new TOC goes after it', BODY, [3, 0, 3, 0], TOC, false],
  ['caret in a row: TOC', BODY, [1, 2, 1, 2], TOC, true],
  ['joined heading: a new TOC goes after the closing line', JOINED, [2, 3, 2, 3], TOC, false],
  ['after the TOC: TOC', BODY, [4, 1, 4, 1], TOC, false],
  [
    'range across the TOC: indent writes the selection as one unit',
    BODY,
    [0, 1, 4, 2],
    INDENT,
    true,
  ],
  ['range in a row: remove link', BODY, [1, 1, 1, 4], UNLINK, true],
  ['joined heading: table goes after the closing line', JOINED, [2, 3, 2, 3], TABLE, false],
  ['joined heading start: table goes after the closing line', JOINED, [2, 0, 2, 0], TABLE, false],
  [
    'joined heading start: a bookmark goes after the end mark',
    JOINED,
    [2, 0, 2, 0],
    BOOKMARK,
    false,
  ],
  ['joined heading start: a footnote goes after the end mark', JOINED, [2, 0, 2, 0], NOTE, false],
  ['joined heading: bookmark', JOINED, [2, 3, 2, 5], BOOKMARK, false],
  ['joined heading: footnote', JOINED, [2, 3, 2, 3], NOTE, false],
  ['joined heading start: typing lands after the end mark', JOINED, [2, 0, 2, 0], TYPE, false],
  ['after the TOC: chart', BODY, [4, 1, 4, 1], CHART, false],
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

test('toolbar controls are disabled inside the TOC, and on the closing line where they write it', () => {
  const run: ChromeSlotId[] = ['text.bold', 'text.italic'];
  const paragraph: ChromeSlotId[] = ['alignment.center', 'list.bullet', 'table.insert'];
  const disabled = { enabled: false, disabledReason: READ_ONLY };
  const inRow = mountAt(BODY, [1, 2, 1, 2]).editor;
  for (const slot of [...run, ...paragraph]) {
    expect(toolbarCommandState(inRow, slot)).toMatchObject(disabled);
  }
  // On the closing line, a run format is armed for the text typed next, and a table goes
  // after the line. Paragraph formats would write the line's mark.
  const closing = mountAt(BODY, [3, 0, 3, 0]).editor;
  for (const slot of [...run, 'table.insert' as const]) {
    expect(toolbarCommandState(closing, slot).enabled).toBe(true);
  }
  for (const slot of paragraph.filter((slot) => slot !== 'table.insert')) {
    expect(toolbarCommandState(closing, slot)).toMatchObject(disabled);
  }
  const after = mountAt(BODY, [4, 1, 4, 1]).editor;
  for (const slot of [...run, ...paragraph]) {
    expect(toolbarCommandState(after, slot).enabled).toBe(true);
  }
});

test('Bold on an empty closing line formats the text typed next, after the end mark', () => {
  const { editor, surface } = mountAt(BODY, [3, 0, 3, 0]);
  const before = serializeOoxmlPart(surface.session.part());
  expect(editor.can(BOLD)).toEqual({ ok: true });
  expect(editor.exec(BOLD)).toMatchObject({ ok: true, changed: false });
  // The mark is untouched; the format waits for typed text.
  expect(serializeOoxmlPart(surface.session.part())).toBe(before);
  expect(editor.exec(TYPE)).toMatchObject({ ok: true, changed: true });
  const closing = serializeOoxmlPart(surface.session.part())
    .split('<w:p')
    .find((paragraph) => paragraph.includes('fldCharType="end"'))!;
  const endMark = closing.indexOf('fldCharType="end"');
  expect(closing.indexOf('<w:b/>')).toBeGreaterThan(endMark);
  expect(closing.indexOf('>X<')).toBeGreaterThan(endMark);
  expect(detectBodyTocs(surface.session.part())).toHaveLength(1);
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

test('a section break on the closing line keeps the field and survives save and reopen', async () => {
  const { editor, surface } = mountAt(BODY, [3, 0, 3, 0]);
  expect(editor.exec(SECTION)).toMatchObject({ ok: true, changed: true });
  expect(detectBodyTocs(surface.session.part())).toHaveLength(1);
  expect(serializeOoxmlPart(surface.session.part()).match(/<w:sectPr[ >]/g)?.length ?? 0).toBe(1);
  editor.load(await editor.save());
  expect(detectBodyTocs(editor.surface!.session.part())).toHaveLength(1);
});

test('a picture is not inserted into a cached row', async () => {
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    ),
    (character) => character.charCodeAt(0)
  );
  const picture = {
    type: 'insertImage',
    data: png,
    mime: 'image/png',
    widthPoints: 10,
    heightPoints: 10,
  } as const;
  const inRow = mountAt(BODY, [1, 2, 1, 2]);
  const before = serializeOoxmlPart(inRow.surface.session.part());
  expect(inRow.editor.canExecuteImageCommand(picture)).toMatchObject({
    ok: false,
    reason: READ_ONLY,
  });
  expect(await inRow.editor.executeImageCommand(picture)).toMatchObject({
    ok: false,
    reason: READ_ONLY,
  });
  expect(serializeOoxmlPart(inRow.surface.session.part())).toBe(before);
  const after = mountAt(BODY, [4, 1, 4, 1]);
  expect(after.editor.canExecuteImageCommand(picture).ok).toBe(true);
  // A drop point inside a row is refused even when the caret is elsewhere.
  const row = after.surface.session.paragraphIds()[1]!;
  const at = capturePointPosition(after.surface, { paragraphId: row, offset: 2 });
  const dropped = { ...picture, at };
  expect(after.editor.canExecuteImageCommand(dropped)).toMatchObject({
    ok: false,
    reason: READ_ONLY,
  });
  expect(await after.editor.executeImageCommand(dropped)).toMatchObject({
    ok: false,
    reason: READ_ONLY,
  });
});

test('replacing a match is refused in generated text and allowed outside it', () => {
  const { editor } = mountAt(BODY, [4, 1, 4, 1]);
  const [entry] = editor.findMatches('Entry 1');
  const replace = { type: 'replaceMatch', match: entry!, text: 'Z' } as EditorCommand;
  expect(editor.can(replace)).toEqual({ ok: false, code: 'invalidArgs', reason: READ_ONLY });
  expect(editor.exec(replace)).toEqual(editor.can(replace));
  const [after] = editor.findMatches('After');
  const allowed = { type: 'replaceMatch', match: after!, text: 'Z' } as EditorCommand;
  expect(editor.can(allowed)).toEqual({ ok: true });
  expect(editor.exec(allowed)).toMatchObject({ ok: true, changed: true });
});

test('a table inserted on a closing line that holds a heading goes after it', () => {
  for (const offset of [0, 3]) {
    const { editor, surface } = mountAt(JOINED, [2, offset, 2, offset]);
    expect(editor.exec(TABLE)).toMatchObject({ ok: true, changed: true });
    const xml = serializeOoxmlPart(surface.session.part());
    expect(xml.indexOf('<w:tbl>')).toBeGreaterThan(xml.indexOf('Heading'));
    expect(xml.indexOf('<w:tbl>')).toBeLessThan(xml.indexOf('After'));
    expect(detectBodyTocs(surface.session.part())).toHaveLength(1);
    expect(editor.exec({ type: 'refreshToc', mode: 'entire' })).toMatchObject({ ok: true });
  }
});

test('a table is unavailable on a closing line with a heading that ends its container', () => {
  const inControl = `<w:p>${run('Before')}</w:p><w:sdt><w:sdtPr/><w:sdtContent><w:p>${begin}${run('Entry 1')}</w:p><w:p>${end}${run('Heading')}</w:p></w:sdtContent></w:sdt><w:p>${run('After')}</w:p>`;
  const atEnd = `<w:p>${run('Before')}</w:p><w:p>${begin}${run('Entry 1')}</w:p><w:p>${end}${run('Heading')}</w:p>`;
  for (const [body, offset] of [
    [inControl, 3],
    [atEnd, 0],
  ] as const) {
    const { editor, surface } = mountAt(body, [2, offset, 2, offset]);
    const before = serializeOoxmlPart(surface.session.part());
    expect(editor.can(TABLE)).toMatchObject({ ok: false, code: 'invalidArgs' });
    expect((editor.can(TABLE) as { reason: string }).reason).toContain('add a paragraph after');
    expect(editor.exec(TABLE)).toEqual(editor.can(TABLE));
    expect(serializeOoxmlPart(surface.session.part())).toBe(before);
  }
});

test('a link typed in text before a TOC that begins mid-paragraph is written', () => {
  for (const offset of [0, 3, 6]) {
    for (const command of [LINK, { ...LINK, text: 'site' } as EditorCommand]) {
      const { editor, surface } = mountAt(INLINE, [0, offset, 0, offset]);
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
      const xml = serializeOoxmlPart(surface.session.part());
      expect(xml.indexOf('</w:hyperlink>')).toBeLessThan(xml.indexOf('w:fldCharType="begin"'));
    }
  }
});

test('a table on an empty closing line goes after it', () => {
  const { editor, surface } = mountAt(BODY, [3, 0, 3, 0]);
  expect(editor.exec(TABLE)).toMatchObject({ ok: true, changed: true });
  const xml = serializeOoxmlPart(surface.session.part());
  expect(xml.indexOf('<w:tbl>')).toBeGreaterThan(xml.indexOf('w:fldCharType="end"'));
  expect(xml.indexOf('<w:tbl>')).toBeLessThan(xml.indexOf('After'));
  expect(editor.exec({ type: 'refreshToc', mode: 'entire' })).toMatchObject({ ok: true });
});

test('replacing accepted text is refused in generated text and allowed outside it', () => {
  const { editor } = mountAt(JOINED, [3, 1, 3, 1]);
  const [, entry, heading] = editor.getParagraphs();
  const row = {
    type: 'replaceAcceptedText',
    match: { blockId: entry!.blockId, start: 0, length: 5 },
    text: 'Z',
  } as EditorCommand;
  expect(editor.can(row)).toEqual({ ok: false, code: 'invalidArgs', reason: READ_ONLY });
  expect(editor.exec(row)).toEqual(editor.can(row));
  const fix = {
    type: 'replaceAcceptedText',
    match: { blockId: heading!.blockId, start: 0, length: 7, expectedText: 'Heading' },
    text: 'Heeding',
  } as EditorCommand;
  expect(editor.can(fix)).toEqual({ ok: true });
  expect(editor.exec(fix)).toMatchObject({ ok: true, changed: true });
});

test('a chart and a text box inserted on the closing line land after the end mark', () => {
  for (const command of [CHART, TEXT_BOX]) {
    const { editor, surface } = mountAt(BODY, [3, 0, 3, 0]);
    expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
    const closing = serializeOoxmlPart(surface.session.part())
      .split('<w:p')
      .find((paragraph) => paragraph.includes('fldCharType="end"'))!;
    expect(closing.indexOf('<w:drawing')).toBeGreaterThan(closing.indexOf('fldCharType="end"'));
    expect(detectBodyTocs(surface.session.part())).toHaveLength(1);
  }
});

test('a picture inserted on the closing line lands after the end mark', async () => {
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    ),
    (character) => character.charCodeAt(0)
  );
  const imageDecodePort: ImageDecodePort = {
    async decode(bytes, mime) {
      const header = validateRasterHeader(bytes, mime);
      if (!header) throw new Error('invalid image');
      return { pixelWidth: header.pixelWidth, pixelHeight: header.pixelHeight, dpiX: 96, dpiY: 96 };
    },
  };
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(BODY),
    imageDecodePort,
  });
  editors.push(editor);
  const surface = editor.surface!;
  const closingId = surface.session.paragraphIds()[3]!;
  surface.setSelection({
    anchor: { paragraphId: closingId, offset: 0 },
    head: { paragraphId: closingId, offset: 0 },
  });
  const picture = {
    type: 'insertImage',
    data: png,
    mime: 'image/png',
    widthPoints: 10,
    heightPoints: 10,
  } as const;
  expect(await editor.executeImageCommand(picture)).toMatchObject({ ok: true, changed: true });
  const closing = serializeOoxmlPart(surface.session.part())
    .split('<w:p')
    .find((paragraph) => paragraph.includes('fldCharType="end"'))!;
  expect(closing.indexOf('<w:drawing')).toBeGreaterThan(closing.indexOf('fldCharType="end"'));
});

test('typing on the closing line of a TOC inside a content control lands after the end mark', () => {
  const controlled = `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr><w:sdtContent>${BODY.replace(/<w:p><w:r><w:t>(Before|After)<\/w:t><\/w:r><\/w:p>/g, '')}</w:sdtContent></w:sdt><w:p>${run('After')}</w:p>`;
  const closingIndex = 2;
  const { editor, surface } = mountAt(controlled, [closingIndex, 0, closingIndex, 0]);
  expect(editor.can(TYPE)).toEqual({ ok: true });
  expect(editor.exec(TYPE)).toMatchObject({ ok: true, changed: true });
  const closing = serializeOoxmlPart(surface.session.part())
    .split('<w:p')
    .find((paragraph) => paragraph.includes('fldCharType="end"'))!;
  expect(closing.indexOf('>X<')).toBeGreaterThan(closing.indexOf('fldCharType="end"'));
  // A cached row inside the control stays read-only.
  const row = mountAt(controlled, [0, 2, 0, 2]);
  expect(row.editor.can(TYPE)).toEqual({ ok: false, code: 'invalidArgs', reason: READ_ONLY });
  expect(row.editor.exec(TYPE)).toEqual(row.editor.can(TYPE));
});

test('a comment is refused on cached rows, and allowed from the closing line edge and beside them', () => {
  const comment = { type: 'addComment', text: 'Note', author: 'A' } as EditorCommand;
  const mountReview = (place: Place) => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(BODY),
      author: 'A',
      modules: [stubReviewModule()],
    });
    editors.push(editor);
    const ids = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: ids[place[0]]!, offset: place[1] },
      head: { paragraphId: ids[place[2]]!, offset: place[3] },
    });
    return editor;
  };
  const refused = mountReview([1, 1, 1, 4]);
  expect(refused.can(comment)).toEqual({ ok: false, code: 'invalidArgs', reason: READ_ONLY });
  expect(refused.exec(comment)).toEqual(refused.can(comment));
  // From the closing line edge the comment starts after the end mark, outside the field.
  for (const place of [
    [4, 0, 4, 3],
    [3, 0, 4, 3],
  ] as const) {
    const allowed = mountReview(place);
    expect(allowed.can(comment)).toEqual({ ok: true });
    expect(allowed.exec(comment)).toMatchObject({ ok: true });
  }
  // A comment draft pins its range; the pinned range decides, not the caret moved inside it.
  const pinned = mountReview([2, 2, 4, 3]);
  pinned.surface!.retainSelection();
  const after = pinned.surface!.session.paragraphIds()[4]!;
  pinned.surface!.setSelection({
    anchor: { paragraphId: after, offset: 1 },
    head: { paragraphId: after, offset: 1 },
  });
  expect(pinned.can(comment)).toEqual({ ok: false, code: 'invalidArgs', reason: READ_ONLY });
  expect(pinned.exec(comment)).toEqual(pinned.can(comment));
});

test('link commands at a caret beside a generated row link change the row, so they are refused', () => {
  // 0 field code + row, 1 a linked row, the end mark, then "Tail".
  const linked = `<w:p>${begin}${run('Entry 1')}</w:p><w:p><w:hyperlink w:anchor="_Toc1">${run('Row')}</w:hyperlink>${end}${run('Tail')}</w:p>`;
  for (const command of [LINK, UNLINK]) {
    const { editor, surface } = mountAt(linked, [1, 3, 1, 3]);
    const before = serializeOoxmlPart(surface.session.part());
    expect(editor.can(command)).toEqual({ ok: false, code: 'invalidArgs', reason: READ_ONLY });
    expect(editor.exec(command)).toEqual(editor.can(command));
    expect(serializeOoxmlPart(surface.session.part())).toBe(before);
  }
  // Over the text after the end mark, a new link is written there.
  const { editor } = mountAt(linked, [1, 4, 1, 7]);
  expect(editor.exec(LINK)).toMatchObject({ ok: true, changed: true });
});

test('a table after an end mark inside a paragraph has no place, and says so', () => {
  const { editor } = mountAt(INLINE, [1, 3, 1, 3]);
  const reason =
    'this would land inside the table of contents; add a paragraph after this line first';
  expect(editor.can(TABLE)).toEqual({ ok: false, code: 'invalidArgs', reason });
  expect(editor.exec(TABLE)).toEqual(editor.can(TABLE));
});

test('Enter right before a TOC that begins mid-paragraph leaves a caret that can type before it', () => {
  const { editor, surface } = mountAt(INLINE, [0, 6, 0, 6]);
  expect(editor.exec({ type: 'splitParagraph' } as EditorCommand)).toMatchObject({ ok: true });
  expect(surface.state().selection.head.offset).toBe(0);
  expect(editor.can(TYPE)).toEqual({ ok: true });
  expect(editor.exec(TYPE)).toMatchObject({ ok: true, changed: true });
  const xml = serializeOoxmlPart(surface.session.part());
  expect(xml.indexOf('>X<')).toBeLessThan(xml.indexOf('fldCharType="begin"'));
  expect(xml.indexOf('>X<')).toBeGreaterThan(xml.indexOf('Before'));
  expect(detectBodyTocs(surface.session.part())).toHaveLength(1);
});

test('joining the next paragraph into the paragraph a TOC ends in keeps the text after the end mark', () => {
  const { editor, surface } = mountAt(INLINE, [1, 9, 1, 9]);
  expect(editor.exec(MERGE)).toMatchObject({ ok: true, changed: true });
  const xml = serializeOoxmlPart(surface.session.part());
  expect(xml.indexOf('After')).toBeGreaterThan(xml.indexOf('fldCharType="end"'));
  expect(detectBodyTocs(surface.session.part())).toHaveLength(1);
  expect(editor.exec({ type: 'refreshToc' })).toMatchObject({ ok: true });
  expect(serializeOoxmlPart(surface.session.part())).toContain('After');
});
