// The font box answers the face the selected text paints in, and a pick changes that face.
//
// A run names a face per script: `w:ascii`/`w:hAnsi` for Latin, `w:eastAsia` for Chinese,
// Japanese and Korean, `w:cs` for a complex-script run. The box used to read and write the
// Latin slot only, so Chinese text in a Calibri+SimSun run read "Calibri", and picking a font
// for it changed nothing on screen.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  AUTHORABLE_RUN_PROPERTIES,
  authoredProperties,
  findNode,
  propertyContainer,
} from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

const MIXED =
  '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="SimSun"/>' +
  '<w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr><w:t>中文DOCX</w:t></w:r></w:p>';
const RTL =
  '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/>' +
  '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Times New Roman"/></w:rPr><w:t>שלום</w:t></w:r></w:p>';

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function select(editor: DocxEditorInstance, from: number, to: number): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}

const boxFamily = (editor: DocxEditorInstance) => editor.snapshot().formatting?.fontFamily ?? null;

/** Every run's own `w:rFonts` in the first paragraph, with its text. */
function runFonts(editor: DocxEditorInstance) {
  const part = editor.surface!.session.part();
  const paragraph = findNode(part, editor.surface!.session.paragraphIds()[0]!);
  if (!paragraph || paragraph.kind === 'textValue') throw new Error('no paragraph');
  return paragraph.children
    .filter((child) => child.kind === 'run')
    .map((run) => ({
      text: editor.surface!.session.textOf?.(run) ?? '',
      fonts: authoredProperties(
        propertyContainer(run, 'runProperties', 'rPr'),
        AUTHORABLE_RUN_PROPERTIES
      ).find((property) => property.localName === 'rFonts')?.attributes,
    }));
}

describe('the font box reads the face the text paints in', () => {
  test('Chinese text in a Calibri+SimSun run reads SimSun', () => {
    const editor = mount(MIXED);
    select(editor, 0, 2);
    expect(boxFamily(editor)).toBe('SimSun');
    editor.destroy();
  });

  test('the Latin letters of the same run read Calibri', () => {
    const editor = mount(MIXED);
    select(editor, 2, 6);
    expect(boxFamily(editor)).toBe('Calibri');
    editor.destroy();
  });

  test('a selection over both scripts disagrees to blank', () => {
    const editor = mount(MIXED);
    select(editor, 0, 6);
    expect(boxFamily(editor)).toBeNull();
    editor.destroy();
  });

  test('a caret inside Chinese text reads SimSun', () => {
    const editor = mount(MIXED);
    select(editor, 1, 1);
    expect(boxFamily(editor)).toBe('SimSun');
    editor.destroy();
  });

  test('a right-to-left run reads its complex-script face', () => {
    const editor = mount(RTL);
    select(editor, 0, 4);
    expect(boxFamily(editor)).toBe('Times New Roman');
    editor.destroy();
  });
});

describe('a font pick changes the face the box shows', () => {
  test('picking a font for Chinese text sets its East Asian face', () => {
    const editor = mount(MIXED);
    select(editor, 0, 2);
    expect(
      editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Georgia' }).ok
    ).toBe(true);
    const fonts = runFonts(editor).map((run) => run.fonts);
    expect(fonts[0]).toMatchObject({ ascii: 'Georgia', hAnsi: 'Georgia', eastAsia: 'Georgia' });
    // The Latin letters outside the selection keep their run's faces.
    expect(fonts.at(-1)).toMatchObject({ ascii: 'Calibri', eastAsia: 'SimSun' });
    select(editor, 0, 2);
    expect(boxFamily(editor)).toBe('Georgia');
    editor.destroy();
  });

  test('picking a font for Latin letters leaves the East Asian face alone', () => {
    const editor = mount(MIXED);
    select(editor, 2, 6);
    editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Georgia' });
    expect(runFonts(editor).at(-1)!.fonts).toMatchObject({
      ascii: 'Georgia',
      hAnsi: 'Georgia',
      eastAsia: 'SimSun',
    });
    select(editor, 0, 2);
    expect(boxFamily(editor)).toBe('SimSun');
    editor.destroy();
  });

  test('picking a font for a right-to-left run sets its complex-script face', () => {
    const editor = mount(RTL);
    select(editor, 0, 4);
    editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Georgia' });
    expect(runFonts(editor)[0]!.fonts).toMatchObject({ cs: 'Georgia', ascii: 'Georgia' });
    expect(boxFamily(editor)).toBe('Georgia');
    editor.destroy();
  });

  test('a pick in an empty paragraph applies to Chinese typed next', () => {
    const editor = mount('<w:p/>');
    select(editor, 0, 0);
    editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Georgia' });
    editor.exec({ type: 'insertText', text: '中文' });
    expect(runFonts(editor)[0]!.fonts).toMatchObject({ ascii: 'Georgia', eastAsia: 'Georgia' });
    editor.destroy();
  });

  test('a pick at a caret in Chinese text applies to the Chinese typed next', () => {
    const editor = mount(MIXED);
    select(editor, 1, 1);
    editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Georgia' });
    editor.exec({ type: 'insertText', text: '字' });
    const typed = runFonts(editor).find((run) => run.fonts?.eastAsia === 'Georgia');
    expect(typed).toBeDefined();
    editor.destroy();
  });
});
