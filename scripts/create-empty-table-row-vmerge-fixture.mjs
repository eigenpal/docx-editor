/**
 * Create a synthetic DOCX fixture for a table row made only of vertical-merge
 * continuation cells.
 *
 * The generated document uses neutral sample text. It reproduces DOCX tables
 * that can parse into a row where every cell has <w:vMerge/> and no cell would
 * be emitted after ProseMirror row-span collapsing.
 *
 * Run: bun scripts/create-empty-table-row-vmerge-fixture.mjs
 */

import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e/fixtures/empty-table-row-vmerge.docx');
const FIXTURE_DATE = new Date('2026-01-01T00:00:00Z');

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const CORE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Empty Table Row Vertical Merge Synthetic Fixture</dc:title>
  <dc:creator>docx-editor fixture generator</dc:creator>
  <cp:lastModifiedBy>docx-editor fixture generator</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>docx-editor fixture generator</Application>
</Properties>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="0" w:after="120" w:line="276" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:sz w:val="22"/>
    </w:rPr>
  </w:style>
</w:styles>`;

function p(text, options = {}) {
  const before = options.before ?? 0;
  const after = options.after ?? 120;
  const size = options.size ?? 22;
  const bold = options.bold ? '<w:b/>' : '';
  return `<w:p>
    <w:pPr>
      <w:spacing w:before="${before}" w:after="${after}" w:line="276" w:lineRule="auto"/>
      <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${bold}<w:sz w:val="${size}"/></w:rPr>
    </w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${bold}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>
  </w:p>`;
}

function tableCell(text, { vMerge, fill } = {}) {
  const vMergeXml =
    vMerge === 'restart'
      ? '<w:vMerge w:val="restart"/>'
      : vMerge === 'continue'
        ? '<w:vMerge/>'
        : '';
  const shadingXml = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '';
  const paragraph = text ? p(text, { after: 0 }) : '<w:p/>';

  return `<w:tc>
    <w:tcPr>
      <w:tcW w:w="3000" w:type="dxa"/>
      ${vMergeXml}
      ${shadingXml}
    </w:tcPr>
    ${paragraph}
  </w:tc>`;
}

const TABLE_XML = `<w:tbl>
  <w:tblPr>
    <w:tblW w:w="6000" w:type="dxa"/>
    <w:tblBorders>
      <w:top w:val="single" w:sz="8" w:space="0" w:color="666666"/>
      <w:left w:val="single" w:sz="8" w:space="0" w:color="666666"/>
      <w:bottom w:val="single" w:sz="8" w:space="0" w:color="666666"/>
      <w:right w:val="single" w:sz="8" w:space="0" w:color="666666"/>
      <w:insideH w:val="single" w:sz="8" w:space="0" w:color="999999"/>
      <w:insideV w:val="single" w:sz="8" w:space="0" w:color="999999"/>
    </w:tblBorders>
    <w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>
  </w:tblPr>
  <w:tblGrid>
    <w:gridCol w:w="3000"/>
    <w:gridCol w:w="3000"/>
  </w:tblGrid>
  <w:tr>
    ${tableCell('Merge start A', { vMerge: 'restart', fill: 'D9EAF7' })}
    ${tableCell('Merge start B', { vMerge: 'restart', fill: 'D9EAF7' })}
  </w:tr>
  <w:tr>
    ${tableCell('', { vMerge: 'continue' })}
    ${tableCell('', { vMerge: 'continue' })}
  </w:tr>
  <w:tr>
    ${tableCell('Row after merge A')}
    ${tableCell('Row after merge B')}
  </w:tr>
</w:tbl>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${p('Synthetic Vertical Merge Table', { bold: true, size: 32, after: 240 })}
    ${p('Generated fixture with a table row made entirely of vertical-merge continuation cells.')}
    ${TABLE_XML}
    ${p('Closing generated paragraph.')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1296" w:right="1296" w:bottom="1296" w:left="1296" w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const zip = new JSZip();
const zipOptions = { date: FIXTURE_DATE, createFolders: false };
zip.file('[Content_Types].xml', CONTENT_TYPES_XML, zipOptions);
zip.file('_rels/.rels', RELS_XML, zipOptions);
zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML, zipOptions);
zip.file('word/document.xml', DOCUMENT_XML, zipOptions);
zip.file('word/styles.xml', STYLES_XML, zipOptions);
zip.file('docProps/core.xml', CORE_XML, zipOptions);
zip.file('docProps/app.xml', APP_XML, zipOptions);

const buffer = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
});
fs.writeFileSync(OUT, buffer);
console.log(`Created ${OUT}`);
