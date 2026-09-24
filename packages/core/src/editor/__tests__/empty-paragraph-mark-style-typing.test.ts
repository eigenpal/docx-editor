// Typing into an empty paragraph whose mark names a character style.
//
// The toolbar reports the mark's face at the caret of an empty paragraph, character style
// included. The first character typed there must come out in that face, or the empty line,
// the toolbar and the text disagree the moment the user types. Anonymous probes: the typed
// text is 24pt bold under a 24pt bold mark style, 16pt bold when the mark also states a 16pt
// size directly, regular when the style's bold toggles off a bold paragraph style, and the
// neighbouring run's face when the paragraph already has text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
  '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/>' +
  '<w:rPr><w:sz w:val="24"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="Big"><w:name w:val="Big"/>' +
  '<w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="BoldPara"><w:name w:val="Bold Para"/>' +
  '<w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>' +
  '</w:styles>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const mark = (rPr: string, pPr = '') => `<w:pPr>${pPr}<w:rPr>${rPr}</w:rPr></w:pPr>`;
const BIG = '<w:rStyle w:val="Big"/>';
const AFTER = '<w:p><w:r><w:t>after</w:t></w:r></w:p>';

function withEditor(
  source: string | Uint8Array,
  run: (editor: DocxEditorInstance) => void | Promise<void>
): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: typeof source === 'string' ? docx(source) : source,
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return Promise.resolve(run(editor)).finally(() => {
    editor.destroy();
    container.remove();
  });
}

function caretAt(editor: DocxEditorInstance, paragraph: number, offset: number): void {
  const id = editor.surface!.session.paragraphIds()[paragraph]!;
  editor.surface!.setSelection({
    anchor: { paragraphId: id, offset },
    head: { paragraphId: id, offset },
  });
}

/** The toolbar's size and bold at the current caret. */
function face(editor: DocxEditorInstance): [number | undefined, boolean | undefined] {
  const formatting = editor.getSelectionFormatting();
  const halfPoints = formatting?.fontSizeHalfPoints;
  return [halfPoints == null ? undefined : halfPoints / 2, formatting?.bold ?? undefined];
}

/** The first paragraph's runs, as the `w:rPr` children each run authors. */
function firstParagraphRuns(editor: DocxEditorInstance): string[][] {
  const root = editor.surface!.session.part().root;
  const body = root.kind === 'textValue' ? null : root.children[0];
  const paragraph = body && body.kind !== 'textValue' ? body.children[0] : null;
  if (!paragraph || paragraph.kind === 'textValue') return [];
  return paragraph.children
    .filter((child) => child.kind === 'run')
    .map((run) => {
      if (run.kind === 'textValue') return [];
      const rPr = run.children.find((child) => child.kind === 'runProperties');
      if (!rPr || rPr.kind === 'textValue') return [];
      return rPr.children.flatMap((child: OoxmlNode) => {
        if (child.kind === 'textValue') return [];
        const val = child.attributes.find((entry) => entry.localName === 'val')?.value;
        return [val === undefined ? child.localName : `${child.localName}=${val}`];
      });
    });
}

describe('typing into an empty paragraph whose mark names a character style', () => {
  test('the typed text takes the face the toolbar showed; undo and redo keep it', () =>
    withEditor(`<w:p>${mark(BIG)}</w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      expect(face(editor)).toEqual([24, true]);
      editor.surface!.type('x');
      expect(firstParagraphRuns(editor)).toEqual([['rStyle=Big']]);
      expect(face(editor)).toEqual([24, true]);
      expect(editor.exec({ type: 'undo' })).toEqual({ ok: true, changed: true });
      expect(firstParagraphRuns(editor)).toEqual([]);
      caretAt(editor, 0, 0);
      expect(face(editor)).toEqual([24, true]);
      expect(editor.exec({ type: 'redo' })).toEqual({ ok: true, changed: true });
      expect(firstParagraphRuns(editor)).toEqual([['rStyle=Big']]);
    }));

  test('the style survives save and reopen', () =>
    withEditor(`<w:p>${mark(BIG)}</w:p>${AFTER}`, async (editor) => {
      caretAt(editor, 0, 0);
      editor.surface!.type('x');
      const saved = new Uint8Array(await editor.save());
      await withEditor(saved, (reopened) => {
        expect(firstParagraphRuns(reopened)).toEqual([['rStyle=Big']]);
        caretAt(reopened, 0, 1);
        expect(face(reopened)).toEqual([24, true]);
      });
    }));

  test('a direct size on the mark still overrides the style', () =>
    withEditor(`<w:p>${mark(`${BIG}<w:sz w:val="32"/>`)}</w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      expect(face(editor)).toEqual([16, true]);
      editor.surface!.type('x');
      expect(firstParagraphRuns(editor)).toEqual([['rStyle=Big', 'sz=32']]);
      expect(face(editor)).toEqual([16, true]);
    }));

  test('the style bold toggles off a bold paragraph style, before and after typing', () =>
    withEditor(`<w:p>${mark(BIG, '<w:pStyle w:val="BoldPara"/>')}</w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      expect(face(editor)).toEqual([24, false]);
      editor.surface!.type('x');
      expect(face(editor)).toEqual([24, false]);
    }));

  test('an empty run does not lend the typed text its own formatting', () =>
    withEditor(`<w:p>${mark(BIG)}<w:r><w:rPr><w:i/></w:rPr></w:r></w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      expect(face(editor)).toEqual([24, true]);
      editor.surface!.type('x');
      expect(firstParagraphRuns(editor)).toEqual([['i'], ['rStyle=Big']]);
      expect(face(editor)).toEqual([24, true]);
      expect(editor.getSelectionFormatting()?.italic).toBe(false);
    }));

  test('the insertText command takes the style too', () =>
    withEditor(`<w:p>${mark(BIG)}</w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 0);
      expect(editor.exec({ type: 'insertText', text: 'x' })).toEqual({ ok: true, changed: true });
      expect(firstParagraphRuns(editor)).toEqual([['rStyle=Big']]);
    }));

  test('beside existing text, typing takes that text face and not the mark', () =>
    withEditor(`<w:p>${mark(BIG)}<w:r><w:t>Text</w:t></w:r></w:p>${AFTER}`, (editor) => {
      caretAt(editor, 0, 4);
      expect(face(editor)).toEqual([12, false]);
      editor.surface!.type('x');
      expect(firstParagraphRuns(editor)).toEqual([[]]);
      expect(face(editor)).toEqual([12, false]);
    }));
});
