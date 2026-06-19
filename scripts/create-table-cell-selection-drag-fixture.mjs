/**
 * Create a synthetic DOCX fixture for drag-selecting partial text inside a
 * table cell. Content is generic sample text only.
 *
 * Run: bun scripts/create-table-cell-selection-drag-fixture.mjs
 */

import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e/fixtures/table-cell-selection-drag.docx');
const ZIP_DATE = new Date('2026-01-01T00:00:00Z');

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>
  </w:style>
</w:styles>`;

const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Table Cell Selection Drag Synthetic Fixture</dc:title>
  <dc:creator>docx-editor fixture generator</dc:creator>
  <cp:lastModifiedBy>docx-editor fixture generator</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;

function p(text, options = {}) {
  const bold = options.bold ? '<w:b/>' : '';
  const size = options.size ?? 22;
  return `<w:p>
    <w:pPr><w:spacing w:after="${options.after ?? 120}" w:line="276" w:lineRule="auto"/></w:pPr>
    <w:r><w:rPr>${bold}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>
  </w:p>`;
}

function tc(text) {
  return `<w:tc>
    <w:tcPr><w:tcW w:w="4320" w:type="dxa"/></w:tcPr>
    ${p(text, { after: 0 })}
  </w:tc>`;
}

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${p('Synthetic Table Selection Fixture', { bold: true, size: 32, after: 240 })}
    ${p('Use this generated document to verify precise drag selection inside table cells.')}
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="8640" w:type="dxa"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="8" w:space="0" w:color="666666"/>
          <w:left w:val="single" w:sz="8" w:space="0" w:color="666666"/>
          <w:bottom w:val="single" w:sz="8" w:space="0" w:color="666666"/>
          <w:right w:val="single" w:sz="8" w:space="0" w:color="666666"/>
          <w:insideH w:val="single" w:sz="8" w:space="0" w:color="999999"/>
          <w:insideV w:val="single" w:sz="8" w:space="0" w:color="999999"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tblGrid><w:gridCol w:w="4320"/><w:gridCol w:w="4320"/></w:tblGrid>
      <w:tr>
        ${tc('Quarterly planning notes stay editable within this table cell.')}
        ${tc('Review status and owner notes in this neighboring cell.')}
      </w:tr>
      <w:tr>
        ${tc('Follow-up items remain separate from the first row.')}
        ${tc('Archive-ready sample text with no private details.')}
      </w:tr>
    </w:tbl>
    ${p('Closing generated paragraph.')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1296" w:right="1296" w:bottom="1296" w:left="1296" w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:space="720"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const zip = new JSZip();
const opts = { date: ZIP_DATE, createFolders: false };
zip.file('[Content_Types].xml', contentTypesXml, opts);
zip.file('_rels/.rels', relsXml, opts);
zip.file('word/_rels/document.xml.rels', documentRelsXml, opts);
zip.file('word/document.xml', documentXml, opts);
zip.file('word/styles.xml', stylesXml, opts);
zip.file('docProps/core.xml', coreXml, opts);

const buffer = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
});
fs.writeFileSync(OUT, buffer);
console.log(`Created ${OUT}`);
