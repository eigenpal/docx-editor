import { describe, expect, test } from 'bun:test';
import JSZip from 'jszip';
import { DocxXmlEditor } from './rawXmlEditor';
import { applyRealDocChanges } from './realDocumentChangeStrategy';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

async function createFixtureDocx(): Promise<ArrayBuffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
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
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdHdr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`
  );

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}">
  <w:body>
    <w:p><w:r><w:t>Alpha</w:t></w:r></w:p>
    <w:p><w:r><w:t>Alpha</w:t></w:r></w:p>
    <w:p><w:r><w:t>Omega</w:t></w:r></w:p>
  </w:body>
</w:document>`
  );

  zip.file(
    'word/header1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W_NS}">
  <w:p><w:r><w:t>Header</w:t></w:r></w:p>
</w:hdr>`
  );

  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('applyRealDocChanges', () => {
  test('applies first replacement and reports counts', async () => {
    const input = await createFixtureDocx();

    const result = await applyRealDocChanges(input, [
      {
        type: 'replace-xml-text',
        path: 'word/document.xml',
        find: '<w:t>Alpha</w:t>',
        replace: '<w:t>Beta</w:t>',
        occurrence: 'first',
        expectedReplacements: 1,
      },
    ]);

    const editor = await DocxXmlEditor.open(result.buffer);
    const xml = await editor.getXml('word/document.xml');

    expect(xml).toContain('<w:t>Beta</w:t>');
    expect((xml.match(/<w:t>Alpha<\/w:t>/g) || []).length).toBe(1);
    expect(result.report[0]?.replacements).toBe(1);
  });

  test('applies all replacements when requested', async () => {
    const input = await createFixtureDocx();

    const result = await applyRealDocChanges(input, [
      {
        type: 'replace-xml-text',
        path: 'word/document.xml',
        find: '<w:t>Alpha</w:t>',
        replace: '<w:t>Gamma</w:t>',
        occurrence: 'all',
        expectedReplacements: 2,
      },
    ]);

    const editor = await DocxXmlEditor.open(result.buffer);
    const xml = await editor.getXml('word/document.xml');

    expect((xml.match(/<w:t>Gamma<\/w:t>/g) || []).length).toBe(2);
    expect(xml).not.toContain('<w:t>Alpha</w:t>');
    expect(result.modifiedParts).toContain('word/document.xml');
  });

  test('supports mixed operation plans', async () => {
    const input = await createFixtureDocx();

    const result = await applyRealDocChanges(input, [
      {
        type: 'replace-xml-text',
        path: 'word/header1.xml',
        find: '<w:t>Header</w:t>',
        replace: '<w:t>Updated Header</w:t>',
      },
      {
        type: 'set-text',
        path: 'custom/item1.xml',
        text: '<x:custom xmlns:x="urn:test">value</x:custom>',
      },
      {
        type: 'remove-part',
        path: 'custom/item1.xml',
      },
    ]);

    const editor = await DocxXmlEditor.open(result.buffer);
    const header = await editor.getXml('word/header1.xml');

    expect(header).toContain('Updated Header');
    expect(editor.hasPart('custom/item1.xml')).toBe(false);
    expect(result.report.length).toBe(3);
  });

  test('fails strict mode when expected count mismatches', async () => {
    const input = await createFixtureDocx();

    await expect(
      applyRealDocChanges(input, [
        {
          type: 'replace-xml-text',
          path: 'word/document.xml',
          find: '<w:t>Alpha</w:t>',
          replace: '<w:t>Zeta</w:t>',
          occurrence: 'all',
          expectedReplacements: 1,
        },
      ])
    ).rejects.toThrow('expected 1 replacements');
  });

  test('non-strict mode allows missing parts', async () => {
    const input = await createFixtureDocx();

    const result = await applyRealDocChanges(
      input,
      [
        {
          type: 'replace-xml-text',
          path: 'word/missing.xml',
          find: 'A',
          replace: 'B',
        },
      ],
      { strict: false }
    );

    expect(result.report[0]?.replacements).toBe(0);
    expect(result.modifiedParts.length).toBe(0);
  });

  test('upserts relationship and content-type override', async () => {
    const input = await createFixtureDocx();

    const result = await applyRealDocChanges(input, [
      {
        type: 'upsert-relationship',
        ownerPartPath: 'word/document.xml',
        id: 'rIdHdr2',
        relationshipType:
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
        target: 'header2.xml',
      },
      {
        type: 'ensure-content-type-override',
        partName: '/word/header2.xml',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
      },
    ]);

    const editor = await DocxXmlEditor.open(result.buffer);
    const rels = await editor.getXml('word/_rels/document.xml.rels');
    const contentTypes = await editor.getXml('[Content_Types].xml');

    expect(rels).toContain('Id="rIdHdr2"');
    expect(rels).toContain('Target="header2.xml"');
    expect(contentTypes).toContain('PartName="/word/header2.xml"');
  });

  test('creates missing relationships part and supports removal ops', async () => {
    const input = await createFixtureDocx();

    const result = await applyRealDocChanges(input, [
      {
        type: 'upsert-relationship',
        ownerPartPath: 'word/header2.xml',
        id: 'rIdImg1',
        relationshipType:
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
        target: 'media/image1.png',
      },
      {
        type: 'remove-relationship',
        ownerPartPath: 'word/document.xml',
        id: 'rIdHdr1',
      },
      {
        type: 'remove-content-type-override',
        partName: '/word/header1.xml',
      },
      {
        type: 'remove-content-type-default',
        extension: 'png',
      },
    ]);

    const editor = await DocxXmlEditor.open(result.buffer);
    const headerRels = await editor.getXml('word/_rels/header2.xml.rels');
    const docRels = await editor.getXml('word/_rels/document.xml.rels');
    const contentTypes = await editor.getXml('[Content_Types].xml');

    expect(headerRels).toContain('Id="rIdImg1"');
    expect(docRels).not.toContain('Id="rIdHdr1"');
    expect(contentTypes).not.toContain('PartName="/word/header1.xml"');
    expect(contentTypes).not.toContain('Extension="png"');
    expect(result.modifiedParts).toContain('word/_rels/header2.xml.rels');
    expect(result.modifiedParts).toContain('[Content_Types].xml');
  });
});
