// A styles part with no `w:default` paragraph style: the editor treats the paragraph style named
// "Normal" as the default. The toolbar reports it for unstyled text, a new paragraph stays
// unstyled, and saving writes neither a `w:pStyle` nor a changed styles part.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="a"><w:name w:val="Normal"/>' +
  '<w:rPr><w:sz w:val="32"/></w:rPr></w:style>' +
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
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/styles.xml': strToU8(STYLES),
  });
}

describe('the default paragraph style named "Normal" in the editor', () => {
  test('the toolbar reports it, a split keeps it, and saving changes no styles', async () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docx('<w:p><w:r><w:t>headtail</w:t></w:r></w:p>'),
    });
    if (!editor.surface) throw new Error('surface failed to mount');
    const paragraphId = editor.getParagraphs()[0]!.blockId;
    const caret = { paragraphId, offset: 4 };
    editor.exec({ type: 'setSelection', range: { anchor: caret, head: caret } });
    expect(editor.snapshot().formatting?.styleId).toBe('a');
    expect(editor.snapshot().formatting?.fontSizePt).toBe(16);

    expect(editor.exec({ type: 'splitParagraph' }).ok).toBe(true);
    expect(editor.getParagraphs()).toHaveLength(2);
    expect(editor.snapshot().formatting?.styleId).toBe('a');
    expect(editor.snapshot().formatting?.fontSizePt).toBe(16);

    const files = unzipSync(new Uint8Array(await editor.save()));
    const main = strFromU8(files['word/document.xml']!);
    expect(main).toContain('head');
    expect(main).toContain('tail');
    expect(main).not.toContain('w:pStyle');
    const styles = strFromU8(files['word/styles.xml']!);
    expect(styles).not.toContain('w:default');
    expect(styles).toContain('<w:name w:val="Normal"/>');
  });
});
