import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { paragraphTextOf, directParagraphProperties, findNode } from '@docx-editor.dev/core/store';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STY = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLE = '<w:pStyle w:val="ListParagraph"/>';
const AUTO =
  '<w:spacing w:before="100" w:beforeAutospacing="1" w:after="100" w:afterAutospacing="1"/>';
const LIST = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
const paragraph = (text: string, props = '') =>
  `<w:p><w:pPr>${props}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const item = (text: string, props = AUTO) => paragraph(text, STYLE + LIST + props);
const NORMAL =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>';
const NUMBERING = `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

function docx(
  body: string,
  styles = NORMAL +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:basedOn w:val="Normal"/><w:pPr><w:contextualSpacing/></w:pPr></w:style>',
  numbering = NUMBERING
): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STY}" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`),
    'word/numbering.xml': strToU8(numbering),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const open: DocxEditorInstance[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
});

function mount(bytes: Uint8Array, author?: string): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: bytes, author });
  open.push(editor);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const fragments = (editor: DocxEditorInstance) =>
  editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .filter((fragment) => fragment.kind === 'paragraph');
function enter(editor: DocxEditorInstance, index: number, offset: number): void {
  const surface = editor.surface!;
  const point = { paragraphId: surface.session.paragraphIds()[index]!, offset };
  surface.setSelection({ anchor: point, head: point });
  surface.splitParagraph();
}

const texts = (editor: DocxEditorInstance) =>
  editor
    .surface!.session.paragraphIds()
    .map((id) => paragraphTextOf(editor.surface!.session.part(), id));
const markers = (editor: DocxEditorInstance) =>
  fragments(editor).map((fragment) => fragment.marker?.text ?? null);
const gap = paragraph('', STYLE);
const sequence = (second = item('Second')) => item('First') + gap + second + item('Third');

describe('Enter continues a single blank separator between list items', () => {
  test('before a trailing soft break, inserts an unnumbered separator and lands on the new item', async () => {
    const second = item('Second').replace('</w:r>', '<w:br/></w:r>');
    const editor = mount(docx(sequence(second)));
    enter(editor, 2, 6);
    expect(texts(editor)).toEqual(['First', '', 'Second', '', '\n', 'Third']);
    expect(markers(editor)).toEqual(['1.', null, '2.', null, '3.', '4.']);
    const rows = fragments(editor);
    expect(rows[4]!.lines[0]!.box.y - rows[2]!.lines[0]!.box.y).toBeCloseTo(
      rows[2]!.lines[0]!.box.y - rows[0]!.lines[0]!.box.y,
      5
    );
    editor.surface!.type('New');
    expect(texts(editor)).toEqual(['First', '', 'Second', '', 'New\n', 'Third']);
    const reloaded = mount(new Uint8Array(await editor.save()));
    expect(texts(reloaded)).toEqual(texts(editor));
    expect(markers(reloaded)).toEqual(markers(editor));
  });

  test('plain endings and middle splits continue the same separator', () => {
    for (const offset of [0, 3, 6]) {
      const editor = mount(docx(sequence()));
      enter(editor, 2, offset);
      expect(texts(editor)).toEqual([
        'First',
        '',
        'Second'.slice(0, offset),
        '',
        'Second'.slice(offset),
        'Third',
      ]);
    }
  });

  test('one undo restores the original paragraphs, and redo restores the separator', () => {
    const editor = mount(docx(sequence()));
    const before = texts(editor);
    enter(editor, 2, 6);
    const after = texts(editor);
    editor.surface!.undo();
    expect(texts(editor)).toEqual(before);
    editor.surface!.redo();
    expect(texts(editor)).toEqual(after);
    editor.surface!.type('New');
    expect(texts(editor)[4]).toBe('New');
  });

  test('typing and Enter on the new item repeats the established pattern', () => {
    const editor = mount(docx(sequence()));
    enter(editor, 2, 6);
    editor.surface!.type('New');
    editor.surface!.splitParagraph();
    expect(texts(editor)).toEqual(['First', '', 'Second', '', 'New', '', '', 'Third']);
    expect(markers(editor)).toEqual(['1.', null, '2.', null, '3.', null, '4.', '5.']);
  });

  test('does not invent a separator without one preceding list item and one empty paragraph', () => {
    for (const [body, target] of [
      [item('First') + item('Second'), 1],
      [item('First') + gap + gap + item('Second'), 3],
      [paragraph('Lead') + gap + item('Second'), 2],
      [item('First') + paragraph('Text', STYLE) + item('Second'), 2],
      [item('First') + item('') + item('Second'), 2],
      [paragraph('Lead') + gap + paragraph('Second'), 2],
    ] as const) {
      const editor = mount(docx(body));
      const count = texts(editor).length;
      enter(editor, target, 6);
      expect(texts(editor)).toHaveLength(count + 1);
    }
  });

  test('a separator has only the current style and typing face', () => {
    const second = item(
      'Second',
      AUTO + '<w:ind w:left="960"/><w:rPr><w:sz w:val="32"/></w:rPr>'
    ).replace('<w:r>', '<w:r><w:rPr><w:sz w:val="32"/></w:rPr>');
    const editor = mount(docx(sequence(second)));
    enter(editor, 2, 6);
    const surface = editor.surface!;
    const props = directParagraphProperties(
      surface.session.part(),
      surface.session.paragraphIds()[3]!
    );
    expect(props.map((p) => p.localName)).toEqual(['pStyle']);
    const separator = findNode(surface.session.part(), surface.session.paragraphIds()[3]!);
    expect(JSON.stringify(separator)).toContain('32');
    expect(fragments(editor)[3]!.lines[0]!.height).toBe(fragments(editor)[4]!.lines[0]!.height);
  });

  test('section properties remain on the tail alone', () => {
    const section = '<w:sectPr><w:type w:val="continuous"/></w:sectPr>';
    const editor = mount(docx(sequence(item('Second', AUTO + section))));
    enter(editor, 2, 6);
    const surface = editor.surface!;
    const owners = surface.session
      .paragraphIds()
      .filter((id) =>
        JSON.stringify(findNode(surface.session.part(), id)).includes('\"localName\":\"sectPr\"')
      );
    expect(owners).toEqual([surface.session.paragraphIds()[4]!]);
  });

  test('continues separators within a table cell without crossing cell boundaries', () => {
    const table = `<w:tbl><w:tr><w:tc>${sequence()}</w:tc><w:tc>${item('Other')}</w:tc></w:tr></w:tbl>`;
    const editor = mount(docx(table));
    enter(editor, 2, 6);
    expect(texts(editor)).toEqual(['First', '', 'Second', '', '', 'Third', 'Other']);
  });
  test('tracked Enter proposes both new marks and rejects without leaving a separator', async () => {
    const editor = mount(docx(sequence()), 'Test author');
    editor.surface!.setEditingMode('suggest');
    enter(editor, 2, 6);
    expect(texts(editor)).toEqual(['First', '', 'Second', '', '', 'Third']);
    const reloaded = mount(new Uint8Array(await editor.save()), 'Test author');
    reloaded.surface!.session.applyTreeOps([{ op: 'rejectAllRevisions' }]);
    expect(texts(reloaded)).toEqual(['First', '', 'Second', 'Third']);
    editor.surface!.session.applyTreeOps([{ op: 'acceptAllRevisions' }]);
    expect(texts(editor)).toEqual(['First', '', 'Second', '', '', 'Third']);
    expect(markers(editor)).toEqual(['1.', null, '2.', null, '3.', '4.']);
  });

  test('style-based numbering stays off on the separator', () => {
    const styles =
      NORMAL +
      `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:basedOn w:val="Normal"/><w:pPr>${LIST}<w:contextualSpacing/></w:pPr></w:style>`;
    const styledItem = (text: string) => paragraph(text, STYLE);
    const blank = paragraph('', STYLE + '<w:numPr><w:numId w:val="0"/></w:numPr>');
    const editor = mount(
      docx(styledItem('First') + blank + styledItem('Second') + styledItem('Third'), styles)
    );
    enter(editor, 2, 6);
    expect(markers(editor)).toEqual(['1.', null, '2.', null, '3.', '4.']);
  });
});
