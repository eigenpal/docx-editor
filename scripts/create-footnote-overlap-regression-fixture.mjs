/**
 * Create a synthetic DOCX fixture for split-paragraph footnote reservation.
 *
 * The generated document contains only neutral filler text and generated source
 * labels. Its paragraph lengths and footnote density create a page with a large
 * footnote area below a split body paragraph, reproducing the overlap without
 * storing any customer/user document content.
 *
 * Run: bun scripts/create-footnote-overlap-regression-fixture.mjs
 */

import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e/fixtures/footnote-overlap-regression.docx');
const FIXTURE_DATE = new Date('2026-01-01T00:00:00Z');

// [text chars, style, spacing before twips, spacing after twips, footnote refs]
const PARAGRAPH_SHAPE = [
  [26, 'N', 0, 120, 0],
  [19, 'N', 40, 120, 0],
  [39, 'N', 160, 120, 0],
  [80, 'N', 80, 80, 0],
  [31, 'N', 0, 200, 0],
  [108, 'N', 0, 200, 0],
  [29, 'N', 160, 120, 0],
  [18, 'N', 0, 40, 0],
  [31, 'N', 0, 40, 1],
  [59, 'N', 0, 40, 1],
  [32, 'N', 0, 40, 1],
  [51, 'N', 0, 40, 1],
  [38, 'N', 0, 40, 1],
  [68, 'N', 0, 40, 1],
  [80, 'N', 80, 80, 0],
  [16, 'N', 160, 120, 0],
  [60, 'B', 0, 40, 1],
  [86, 'B', 0, 40, 1],
  [60, 'B', 0, 40, 1],
  [57, 'B', 0, 40, 1],
  [80, 'N', 80, 80, 0],
  [15, 'N', 160, 120, 0],
  [614, 'N', 80, 160, 0],
  [33, 'N', 160, 120, 0],
  [378, 'N', 80, 160, 0],
  [80, 'N', 80, 80, 0],
  [22, 'N', 160, 120, 0],
  [75, 'N', 0, 200, 0],
  [83, 'N', 240, 40, 0],
  [85, 'N', 0, 160, 0],
  [80, 'N', 80, 80, 0],
  [0, 'N', 0, 200, 0],
  [38, 'N', 0, 120, 0],
  [26, 'N', 40, 120, 0],
  [80, 'N', 80, 80, 0],
  [25, 'N', 200, 120, 0],
  [200, 'N', 80, 120, 0],
  [29, 'N', 200, 120, 0],
  [140, 'N', 80, 120, 1],
  [41, 'N', 200, 120, 0],
  [200, 'N', 80, 120, 10],
  [24, 'N', 200, 120, 0],
  [46, 'N', 120, 120, 0],
  [1880, 'N', 80, 120, 13],
  [35, 'N', 120, 120, 0],
  [502, 'N', 80, 120, 4],
  [37, 'N', 120, 120, 0],
  [1602, 'N', 80, 120, 9],
  [52, 'N', 120, 120, 0],
  [1252, 'N', 80, 120, 5],
  [35, 'N', 120, 120, 0],
  [386, 'N', 80, 120, 5],
  [59, 'N', 120, 120, 0],
  [770, 'N', 80, 120, 5],
  [36, 'N', 120, 120, 0],
  [506, 'N', 80, 120, 3],
  [23, 'N', 200, 120, 0],
  [1147, 'N', 80, 120, 0],
  [80, 'N', 80, 80, 0],
  [15, 'N', 200, 120, 0],
  [221, 'N', 80, 120, 0],
  [92, 'N', 200, 200, 0],
  [83, 'N', 240, 40, 0],
  [123, 'N', 0, 160, 0],
  [80, 'N', 80, 80, 0],
  [0, 'N', 0, 200, 0],
  [10, 'N', 0, 120, 0],
  [80, 'N', 80, 80, 0],
  [35, 'N', 160, 120, 0],
  [24, 'B', 0, 40, 1],
  [31, 'B', 0, 40, 1],
  [61, 'B', 0, 40, 1],
  [34, 'B', 0, 40, 1],
  [61, 'B', 0, 40, 1],
  [50, 'B', 0, 40, 1],
  [69, 'B', 0, 40, 1],
  [111, 'B', 0, 40, 1],
  [57, 'N', 160, 120, 0],
  [141, 'N', 80, 120, 0],
  [80, 'B', 0, 40, 0],
  [272, 'B', 0, 40, 2],
  [154, 'B', 0, 40, 0],
  [116, 'B', 0, 40, 0],
  [114, 'B', 0, 40, 0],
  [80, 'N', 80, 80, 0],
  [60, 'N', 160, 120, 0],
  [134, 'B', 0, 60, 0],
  [142, 'B', 0, 60, 0],
  [165, 'B', 0, 60, 0],
  [149, 'B', 0, 60, 0],
];

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
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
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
</Relationships>`;

const CORE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Footnote Overlap Regression Synthetic Fixture</dc:title>
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
  <w:docDefaults>
    <w:pPrDefault><w:pPr><w:spacing w:after="200" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="200" w:line="276" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet">
    <w:name w:val="List Bullet"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="40"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="FootnoteText">
    <w:name w:val="footnote text"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="FootnoteReference">
    <w:name w:val="footnote reference"/>
    <w:rPr><w:vertAlign w:val="superscript"/><w:sz w:val="16"/></w:rPr>
  </w:style>
</w:styles>`;

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textOfLength(length, index) {
  if (length <= 0) return '';
  const seed = `Synthetic paragraph ${String(index).padStart(2, '0')} uses neutral placeholder language about layout measurement and generated source markers. `;
  return seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
}

function textRun(text) {
  return `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function referenceRun(id) {
  return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
}

let nextFootnoteId = 1;

function paragraphFromShape([length, style, before, after, referenceCount], index) {
  const text = textOfLength(length, index + 1);
  const runs = [];

  if (referenceCount === 0) {
    if (text) runs.push(textRun(text));
  } else {
    const stride = Math.max(1, Math.floor(text.length / referenceCount));
    let cursor = 0;
    for (let i = 0; i < referenceCount; i++) {
      const next = i === referenceCount - 1 ? text.length : Math.min(text.length, cursor + stride);
      if (next > cursor) runs.push(textRun(text.slice(cursor, next)));
      runs.push(referenceRun(nextFootnoteId++));
      cursor = next;
    }
  }

  const bulletPr =
    style === 'B' ? '<w:pStyle w:val="ListBullet"/><w:ind w:left="720" w:hanging="360"/>' : '';

  return `<w:p>
    <w:pPr>
      ${bulletPr}
      <w:spacing w:before="${before}" w:after="${after}" w:line="276" w:lineRule="auto"/>
      <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>
    </w:pPr>
    ${runs.join('')}
  </w:p>`;
}

const bodyParagraphs = PARAGRAPH_SHAPE.map(paragraphFromShape).join('\n');

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyParagraphs}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const footnoteCount = PARAGRAPH_SHAPE.reduce((sum, shape) => sum + shape[4], 0);
const footnotes = Array.from({ length: footnoteCount }, (_, index) => {
  const id = index + 1;
  const text = ` generated-source-${String(id).padStart(2, '0')}.txt #${(0xf1000 + id).toString(16)} (synthetic pages: ${(id % 4) + 1})`;
  return `<w:footnote w:id="${id}">
    <w:p>
      <w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>
      <w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>
      <w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>
    </w:p>
  </w:footnote>`;
}).join('\n');

const FOOTNOTES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:footnote w:type="separator" w:id="-1">
    <w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p>
  </w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0">
    <w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p>
  </w:footnote>
  ${footnotes}
</w:footnotes>`;

const zip = new JSZip();
const zipOptions = { date: FIXTURE_DATE, createFolders: false };
zip.file('[Content_Types].xml', CONTENT_TYPES_XML, zipOptions);
zip.file('_rels/.rels', RELS_XML, zipOptions);
zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML, zipOptions);
zip.file('word/document.xml', DOCUMENT_XML, zipOptions);
zip.file('word/styles.xml', STYLES_XML, zipOptions);
zip.file('word/footnotes.xml', FOOTNOTES_XML, zipOptions);
zip.file('docProps/core.xml', CORE_XML, zipOptions);
zip.file('docProps/app.xml', APP_XML, zipOptions);

const buffer = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
});
fs.writeFileSync(OUT, buffer);
console.log(`Created ${OUT}`);
