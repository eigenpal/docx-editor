// Word's Paragraph dialog as one command.
//
// The dialog changes alignment, indents, spacing, line spacing and five flags at once, so
// it writes ONE transaction: pressing OK is one undo step and the page repaints once. A
// command per field would leave the user pressing Ctrl+Z five times to take back one OK.
//
// Every bound the single-purpose commands apply is applied here too — this is a convenience
// over the same writes, not a way around their validation.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const p = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const xmlOf = (editor: DocxEditorInstance) => serializeOoxmlPart(editor.surface!.session.part());

describe('setParagraphFormat writes the whole dialog at once', () => {
  test('every field lands, in one undoable step', () => {
    const editor = mount(p('alpha'));
    editor.surface!.selectAll();

    expect(
      editor.exec({
        type: 'setParagraphFormat',
        alignment: 'justify',
        spaceBeforePt: 12,
        spaceAfterPt: 6,
        lineSpacing: { rule: 'multiple', value: 1.5 },
        indentLeftTwips: 720,
        indentRightTwips: 360,
        indentFirstLineTwips: -360,
        contextualSpacing: true,
        keepNext: true,
        keepLines: false,
        widowControl: true,
        pageBreakBefore: false,
      }).ok
    ).toBe(true);

    const xml = xmlOf(editor);
    expect(xml).toContain('w:jc w:val="both"');
    expect(xml).toContain('w:before="240"');
    expect(xml).toContain('w:after="120"');
    expect(xml).toContain('w:line="360"');
    expect(xml).toContain('w:lineRule="auto"');
    expect(xml).toContain('w:left="720"');
    expect(xml).toContain('w:right="360"');
    // A negative first line is a HANGING indent, and the unused spelling is an explicit 0.
    expect(xml).toContain('w:hanging="360"');
    expect(xml).toContain('w:firstLine="0"');
    expect(xml).toContain('w:contextualSpacing w:val="1"');
    expect(xml).toContain('w:keepNext w:val="1"');
    // Off is an explicit zero, never a dropped element: the flag may come from the style.
    expect(xml).toContain('w:keepLines w:val="0"');
    expect(xml).toContain('w:widowControl w:val="1"');
    expect(xml).toContain('w:pageBreakBefore w:val="0"');

    // ONE undo step for the whole dialog: a single undo takes back every field above.
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    const undone = xmlOf(editor);
    expect(undone).not.toContain('w:jc');
    expect(undone).not.toContain('w:spacing');
    expect(undone).not.toContain('w:ind');
  });

  test('an omitted field is left as authored', () => {
    const editor = mount(
      p('alpha', '<w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/>')
    );
    editor.surface!.selectAll();
    // Only the line spacing is named.
    expect(
      editor.exec({ type: 'setParagraphFormat', lineSpacing: { rule: 'exact', value: 18 } }).ok
    ).toBe(true);
    const xml = xmlOf(editor);
    expect(xml).toContain('w:jc w:val="center"');
    expect(xml).toContain('w:before="240"');
    expect(xml).toContain('w:after="240"');
    expect(xml).toContain('w:lineRule="exact"');
    expect(xml).toContain('w:line="360"');
  });

  test('null removes a setting so the style supplies it again', () => {
    const editor = mount(p('alpha', '<w:spacing w:before="240"/><w:ind w:left="720"/>'));
    editor.surface!.selectAll();
    expect(
      editor.exec({
        type: 'setParagraphFormat',
        spaceBeforePt: null,
        indentLeftTwips: null,
      }).ok
    ).toBe(true);
    const xml = xmlOf(editor);
    expect(xml).not.toContain('w:before=');
    expect(xml).not.toContain('w:left=');
  });

  test('it writes every paragraph the selection touches', () => {
    const editor = mount(p('one') + p('two') + p('three'));
    editor.surface!.selectAll();
    editor.exec({ type: 'setParagraphFormat', alignment: 'right' });
    expect([...xmlOf(editor).matchAll(/w:jc w:val="right"/g)]).toHaveLength(3);
  });

  test('out-of-range values are refused rather than clamped', () => {
    const editor = mount(p('alpha'));
    editor.surface!.selectAll();
    const refused = editor.exec({ type: 'setParagraphFormat', indentLeftTwips: 99_999_999 });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.code).toBe('invalidArgs');
    // Nothing was written, so a refused dialog leaves the document alone.
    expect(xmlOf(editor)).not.toContain('w:ind');

    const badSpacing = editor.exec({ type: 'setParagraphFormat', spaceBeforePt: -5 });
    expect(badSpacing.ok).toBe(false);
    const badLine = editor.exec({
      type: 'setParagraphFormat',
      lineSpacing: { rule: 'multiple', value: 0 },
    });
    expect(badLine.ok).toBe(false);
  });
});

describe('the dialog can read back what it wrote', () => {
  test('the paragraph flags report on, off and mixed', () => {
    const editor = mount(p('alpha') + p('beta'));
    editor.surface!.selectAll();
    editor.exec({ type: 'setParagraphFormat', keepNext: true, widowControl: false });
    let flags = editor.surface!.formatting().paragraphFlags;
    expect(flags.keepNext).toBe(true);
    expect(flags.widowControl).toBe(false);
    expect(flags.contextualSpacing).toBe(false);

    // One paragraph only, so the selection now disagrees.
    const ids = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 0 },
      head: { paragraphId: ids[0]!, offset: 1 },
    });
    editor.exec({ type: 'setParagraphFormat', keepNext: false });
    editor.surface!.selectAll();
    flags = editor.surface!.formatting().paragraphFlags;
    expect(flags.keepNext).toBeNull();
  });

  test('a flag a STYLE sets reads as on, so the checkbox shows it', () => {
    // The read goes through the cascade: a box that only saw direct formatting would show
    // unchecked over a paragraph the page is visibly keeping with the next.
    const editor = mount(p('alpha', '<w:keepNext/>'));
    editor.surface!.selectAll();
    expect(editor.surface!.formatting().paragraphFlags.keepNext).toBe(true);
  });
});
