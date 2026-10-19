// `can` answers a formatting command over a content lock before the write, and agrees with it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { ContentLockPolicy } from '../../store/package/ooxml-edit.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** A free paragraph, then a paragraph inside a `contentLocked` block control. */
const BODY =
  '<w:p><w:r><w:t>free text</w:t></w:r></w:p>' +
  '<w:sdt><w:sdtPr><w:tag w:val="block"/><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>locked text</w:t></w:r></w:p>' +
  '</w:sdtContent></w:sdt>';

function mount(contentLockPolicy?: ContentLockPolicy): DocxEditorInstance {
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${BODY}</w:body></w:document>`
    ),
  });
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    ...(contentLockPolicy ? { contentLockPolicy } : {}),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const at = (editor: DocxEditorInstance, index: number, offset: number) => ({
  paragraphId: editor.surface!.session.paragraphIds()[index]!,
  offset,
});

test('a range that ends at the start of a locked paragraph formats the free text', () => {
  const editor = mount();
  editor.surface!.setSelection({ anchor: at(editor, 0, 0), head: at(editor, 1, 0) });
  expect(editor.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
  expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
  editor.destroy();
});

test('a range into the locked paragraph is refused before the write', () => {
  const editor = mount();
  editor.surface!.setSelection({ anchor: at(editor, 0, 0), head: at(editor, 1, 3) });
  expect(editor.can({ type: 'toggleMark', mark: 'bold' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  editor.destroy();
});

test('the eraser at a caret in a locked paragraph is refused before the write', () => {
  const editor = mount();
  const caret = at(editor, 1, 2);
  editor.surface!.setSelection({ anchor: caret, head: caret });
  expect(editor.can({ type: 'clearFormatting' })).toMatchObject({ ok: false, code: 'locked' });
  // A run format at the same caret only arms the next characters typed.
  expect(editor.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
  editor.destroy();
});

test('the formatting policy lets run formats through, but not the paragraph eraser', () => {
  const editor = mount({ allowFormattingInLockedContent: true });
  editor.surface!.setSelection({ anchor: at(editor, 1, 0), head: at(editor, 1, 6) });
  expect(editor.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
  expect(editor.can({ type: 'clearFormatting' })).toMatchObject({ ok: false, code: 'locked' });
  editor.destroy();
});
