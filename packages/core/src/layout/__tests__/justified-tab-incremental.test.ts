// A justified paragraph (`w:jc w:val="both"`, CT_Jc, ECMA-376 §17.3.1.13) with a tab
// (`w:tab`, CT_Empty, §17.3.3.32), edited in a live session.
//
// The text before the tab keeps its natural spacing and the text after it stretches from the
// tab stop. An edit on either side must leave the incremental layout equal to the layout of
// the same bytes opened again, the caret must follow the laid-out text, and undo must give
// the first layout back.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../../editor/docx-editor.ts';
import { caretAt } from '../semantic-interaction.ts';
import { linesOf } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const TAIL =
  'cascading riverbank lanterns flickered alongside wandering shepherds gathering marigolds ' +
  'underneath towering sandstone battlements overlooking tranquil meadowlands yesterday';
const BODY =
  '<w:p><w:pPr><w:jc w:val="both"/></w:pPr>' +
  '<w:r><w:t xml:space="preserve">Ab cd</w:t></w:r><w:r><w:tab/></w:r>' +
  `<w:r><w:t xml:space="preserve">${TAIL}</w:t></w:r></w:p>` +
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const open: DocxEditorInstance[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
});

function mount(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: bytes });
  open.push(editor);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

/** Every span of the document as `[text, x, width]`, rounded to a thousandth of a point. */
const placed = (editor: DocxEditorInstance) =>
  linesOf(editor.surface!.layout()).flatMap((line) =>
    line.spans.map(
      (span) =>
        [span.text, Math.round(span.box.x * 1000), Math.round(span.box.width * 1000)] as const
    )
  );
const firstLine = (editor: DocxEditorInstance) => linesOf(editor.surface!.layout())[0]!;
const spanOf = (editor: DocxEditorInstance, text: string) =>
  firstLine(editor).spans.find((span) => span.text.trim() === text)!;

function typeAt(editor: DocxEditorInstance, offset: number, text: string): void {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  const position = { paragraphId, offset };
  surface.setSelection({ anchor: position, head: position });
  surface.type(text);
}

describe('a justified line with a tab in a live session', () => {
  test('the text before the tab keeps its spacing and the text after it fills the line', () => {
    const editor = mount(docx(BODY));
    const line = firstLine(editor);
    const first = spanOf(editor, 'Ab');
    const second = spanOf(editor, 'cd');
    // One natural space separates the two words before the tab.
    expect(second.box.x).toBeCloseTo(first.box.x + first.box.width, 4);
    const tab = line.spans.find((span) => span.text === '\t')!;
    expect(tab.box.x + tab.box.width).toBeCloseTo(36, 4);
    // The last word of the line ends at the 468pt measure.
    const last = line.spans.filter((span) => span.text.trim() !== '').at(-1)!;
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    const end = caretAt(editor.surface!.layout(), {
      paragraphId,
      offset: last.range.start + last.text.trimEnd().length,
    })!;
    expect(linesOf(editor.surface!.layout()).length).toBeGreaterThan(1);
    expect(end.lineId).toBe(line.id);
    expect(end.x - line.box.x).toBeCloseTo(468, 1);
  });

  for (const [name, offset] of [
    ['before the tab', 2],
    ['after the tab', 8],
  ] as const) {
    test(`typing ${name} equals the same bytes opened again, and undo restores it`, async () => {
      const editor = mount(docx(BODY));
      const original = placed(editor);
      typeAt(editor, offset, 'xy');
      const incremental = placed(editor);
      expect(incremental).not.toEqual(original);
      const reopened = mount(new Uint8Array(await editor.save()));
      expect(incremental).toEqual(placed(reopened));
      // The caret after the typed text sits on the laid-out glyphs.
      const surface = editor.surface!;
      const paragraphId = surface.session.paragraphIds()[0]!;
      const line = firstLine(editor);
      const span = line.spans.find(
        (candidate) => candidate.range.start <= offset + 2 && offset + 2 <= candidate.range.end
      )!;
      const caret = caretAt(surface.layout(), { paragraphId, offset: offset + 2 })!;
      expect(caret.x).toBeGreaterThanOrEqual(line.box.x + span.box.x - 0.001);
      expect(caret.x).toBeLessThanOrEqual(line.box.x + span.box.x + span.box.width + 0.001);
      surface.undo();
      expect(placed(editor)).toEqual(original);
    });
  }
});
