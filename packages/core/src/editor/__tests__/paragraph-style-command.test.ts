// The style picker's engine lane: `setParagraphStyle` writes `w:pStyle`, refuses a
// styleId the document does not define, and the `styles.style` slot reports live
// through the same value-probe gate as the other pickers.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { commandForSlotValue, toolbarCommandState } from '../toolbar-commands.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
  '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/></w:style>' +
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

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

describe('setParagraphStyle', () => {
  test('the styles.style slot is live and a pick writes w:pStyle', () => {
    const editor = mount(p('alpha') + p('beta'));

    // The document's styles are loaded and typed.
    expect(editor.getDocumentStyles()).toEqual([
      { styleId: 'Normal', name: 'Normal', type: 'paragraph' },
      { styleId: 'Heading1', name: 'heading 1', type: 'paragraph' },
      { styleId: 'Emphasis', name: 'Emphasis', type: 'character' },
    ]);

    const state = toolbarCommandState(editor, 'styles.style');
    expect(state.enabled).toBe(true);

    const command = commandForSlotValue('styles.style', 'Heading1');
    expect(command).toEqual({ type: 'setParagraphStyle', styleId: 'Heading1' });
    expect(editor.can(command!).ok).toBe(true);
    expect(editor.exec(command!).ok).toBe(true);
    expect(editor.snapshot().formatting?.styleId).toBe('Heading1');
  });

  test('a multi-paragraph selection styles every paragraph it touches', () => {
    const editor = mount(p('alpha') + p('beta'));
    const ids = editor.surface!.session.paragraphIds();
    editor.surface!.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 0 },
      head: { paragraphId: ids[1]!, offset: 4 },
    });
    editor.exec({ type: 'setParagraphStyle', styleId: 'Heading1' });
    // Agreement across the selection — the same read the picker displays.
    expect(editor.snapshot().formatting?.styleId).toBe('Heading1');
  });

  test('a document with no paragraph styles disables the picker, honestly', () => {
    // Same docx but without the styles part: no pick could be honoured, so the probe
    // must say so — an enabled trigger over an empty listbox is a dead control.
    const container = document.createElement('div');
    document.body.append(container);
    const bare = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${p('alpha')}</w:body></w:document>`
      ),
    });
    const editor = createDocxEditor({ container, document: bare });
    const state = toolbarCommandState(editor, 'styles.style');
    expect(state.enabled).toBe(false);
    expect(state.disabledReason).toContain('no paragraph styles');
    editor.destroy();
  });

  test('an unknown or non-paragraph styleId is refused with a reason', () => {
    const editor = mount(p('alpha'));
    const unknown = editor.exec({ type: 'setParagraphStyle', styleId: 'NoSuchStyle' });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toContain('NoSuchStyle');
    // A character style is defined but not applicable to a paragraph.
    expect(editor.exec({ type: 'setParagraphStyle', styleId: 'Emphasis' }).ok).toBe(false);
    // Malformed ids are refused by the shape gate before exec.
    expect(editor.can({ type: 'setParagraphStyle', styleId: '' }).ok).toBe(false);
  });
});
