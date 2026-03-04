import { describe, expect, test } from 'bun:test';
import JSZip from 'jszip';
import { DocxXmlEditor, editDocxXml } from './rawXmlEditor';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

async function createFixtureDocx(): Promise<ArrayBuffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}">
  <w:body>
    <w:p><w:r><w:t>Original</w:t></w:r></w:p>
  </w:body>
</w:document>`
  );

  zip.file(
    'word/settings.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W_NS}"/>`
  );

  zip.file('word/media/image1.bin', new Uint8Array([1, 2, 3, 4]));

  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('DocxXmlEditor', () => {
  test('lists package parts and filters xml parts', async () => {
    const fixture = await createFixtureDocx();
    const editor = await DocxXmlEditor.open(fixture);

    const allParts = editor.listParts();
    const xmlParts = editor.listParts({ xmlOnly: true });

    expect(allParts.length).toBeGreaterThan(xmlParts.length);
    expect(xmlParts.some((p) => p.path === 'word/document.xml')).toBe(true);
    expect(allParts.some((p) => p.path === 'word/media/image1.bin' && p.isMedia)).toBe(true);
  });

  test('reads and writes xml part directly', async () => {
    const fixture = await createFixtureDocx();
    const editor = await DocxXmlEditor.open(fixture);

    const original = await editor.getXml('word/document.xml');
    expect(original).toContain('Original');

    editor.setXml('word/document.xml', original.replace('Original', 'Updated'));
    const output = await editor.toBuffer();

    const updatedEditor = await DocxXmlEditor.open(output);
    const updated = await updatedEditor.getXml('word/document.xml');

    expect(updated).toContain('Updated');
    expect(updatedEditor.getModifiedParts().length).toBe(0);
    expect(editor.getModifiedParts()).toContain('word/document.xml');
  });

  test('supports one-shot edit helper', async () => {
    const fixture = await createFixtureDocx();

    const output = await editDocxXml(fixture, async (xml) => {
      const doc = await xml.getXml('word/document.xml');
      xml.setXml('word/document.xml', doc.replace('Original', 'HelperEdit'));
    });

    const reopened = await DocxXmlEditor.open(output);
    const doc = await reopened.getXml('word/document.xml');

    expect(doc).toContain('HelperEdit');
  });
});
