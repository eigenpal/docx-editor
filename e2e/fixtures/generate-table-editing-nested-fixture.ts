/**
 * Representative nested-table fixture for Task 12 browser acceptance.
 *
 * Run: bun e2e/fixtures/generate-table-editing-nested-fixture.ts
 */

import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(FIXTURES_DIR, 'table-editing-nested.docx');
const ZIP_DATE = new Date('2026-08-04T12:00:00Z');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

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
<w:styles xmlns:w="${W}">
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
  <dc:title>Table editing nested acceptance fixture</dc:title>
  <dc:creator>docx-editor fixture generator</dc:creator>
  <cp:lastModifiedBy>docx-editor fixture generator</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-08-04T12:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-04T12:00:00Z</dcterms:modified>
</cp:coreProperties>`;

function p(text: string, options: { bold?: boolean; after?: number } = {}): string {
  const bold = options.bold ? '<w:b/>' : '';
  const after = options.after ?? 120;
  return `<w:p>
    <w:pPr><w:spacing w:after="${after}" w:line="276" w:lineRule="auto"/></w:pPr>
    <w:r><w:rPr>${bold}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>
  </w:p>`;
}

function tc(content: string, width = 3600): string {
  return `<w:tc>
    <w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>
    ${content}
  </w:tc>`;
}

const INNER_TABLE =
  '<w:tbl>' +
  '<w:tblPr><w:tblLayout w:type="fixed"/><w:tblW w:w="3600" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>' +
  `<w:tr>${tc(p('INNER-NW', { after: 0 }), 1800)}${tc(p('INNER-NE', { after: 0 }), 1800)}</w:tr>` +
  `<w:tr>${tc(p('INNER-SW', { after: 0 }), 1800)}${tc(p('INNER-SE', { after: 0 }), 1800)}</w:tr>` +
  '</w:tbl>';

const OUTER_TABLE =
  '<w:tbl>' +
  '<w:tblPr><w:tblInd w:w="720" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="2400"/></w:tblGrid>' +
  `<w:tr>${tc(INNER_TABLE + p('OUTER-NEST-PAD', { after: 0 }), 3600)}${tc(p('OUTER-TR', { after: 0 }), 2400)}</w:tr>` +
  `<w:tr>${tc(p('OUTER-BL', { after: 0 }), 3600)}${tc(p('OUTER-BR', { after: 0 }), 2400)}</w:tr>` +
  '</w:tbl>';

const MERGED_TABLE =
  '<w:tbl>' +
  '<w:tblPr><w:tblLayout w:type="fixed"/><w:tblW w:w="4800" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
  `<w:tr>${tc(p('MERGED-ONLY', { after: 0 }), 2400)}` +
  `<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="4800" w:type="dxa"/></w:tcPr>${p('MERGED-SPAN', { after: 0 })}</w:tc></w:tr>` +
  '</w:tbl>';

const SCROLL_FILLER = Array.from({ length: 18 }, (_, index) =>
  p(`Scroll filler paragraph ${index + 1} — keeps the nested table off the first viewport for zoom and scroll acceptance.`)
).join('');

const TALL_INNER_ROWS = Array.from({ length: 8 }, (_, index) =>
  `<w:tr>${tc(p(`TALL-${index + 1}-A`, { after: 0 }), 1800)}${tc(p(`TALL-${index + 1}-B`, { after: 0 }), 1800)}</w:tr>`
).join('');

const TALL_NESTED_TABLE =
  '<w:tbl>' +
  '<w:tblPr><w:tblLayout w:type="fixed"/><w:tblW w:w="3600" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>' +
  TALL_INNER_ROWS +
  '</w:tbl>';

const CONTINUATION_OUTER =
  '<w:tbl>' +
  '<w:tblPr><w:tblLayout w:type="fixed"/><w:tblW w:w="3600" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="3600"/></w:tblGrid>' +
  `<w:tr>${tc(TALL_NESTED_TABLE, 3600)}</w:tr>` +
  '</w:tbl>';

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}">
  <w:body>
    ${p('Table editing nested acceptance fixture', { bold: true, after: 240 })}
    ${p('Target the innermost nested table for resize, structure, borders, fill, undo, and save/reopen.')}
    ${SCROLL_FILLER}
    ${p('Nested editing target', { bold: true, after: 180 })}
    ${OUTER_TABLE}
    ${p('Merged-table refusal target', { bold: true, after: 180 })}
    ${MERGED_TABLE}
    ${p('Continuation-page nested host', { bold: true, after: 180 })}
    ${CONTINUATION_OUTER}
    ${p('Closing filler after tables.')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1296" w:right="1296" w:bottom="1296" w:left="1296" w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:space="720"/>
    </w:sectPr>
  </w:body>
</w:document>`;

export async function createTableEditingNestedFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  const opts = { date: ZIP_DATE, createFolders: false };
  zip.file('[Content_Types].xml', contentTypesXml, opts);
  zip.file('_rels/.rels', relsXml, opts);
  zip.file('word/_rels/document.xml.rels', documentRelsXml, opts);
  zip.file('word/document.xml', documentXml, opts);
  zip.file('word/styles.xml', stylesXml, opts);
  zip.file('docProps/core.xml', coreXml, opts);
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

if (import.meta.main) {
  const bytes = await createTableEditingNestedFixture();
  fs.writeFileSync(OUT, bytes);
  console.log(`Created ${OUT}`);
}
