/**
 * Create a synthetic DOCX fixture for a cell that merges vertically over several rows.
 *
 * Two tables, both two columns wide with the right column merged over every row:
 *
 * - `SHORT` — the merged content is taller than the FIRST row's `w:trHeight` minimum but
 *   shorter than the rows it covers together. The span is as tall as the minimums add up
 *   to, and each row keeps its own height.
 * - `TALL` — the merged content is taller than every row of the span put together. The
 *   surplus grows the LAST row of the span, which is where Word puts it.
 *
 * The first row's minimum is deliberately SHORTER than the merged content: that is the
 * configuration the defect needs to show. A fixture whose merged content fits the first
 * row cannot see the difference between sizing the row and sizing the span.
 *
 * The generated document uses neutral sample text.
 *
 * Run: bun scripts/create-vmerge-row-span-fixture.mjs
 */

import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e/fixtures/vmerge-row-span.docx');
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
  <dc:title>Vertical Merge Row Span Synthetic Fixture</dc:title>
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
      <w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:sz w:val="22"/>
    </w:rPr>
  </w:style>
</w:styles>`;

/** One single-spaced line, no paragraph spacing: the height arithmetic stays checkable. */
function p(text) {
  return `<w:p>
    <w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
    <w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>
  </w:p>`;
}

function labelCell(text, fill) {
  return `<w:tc>
    <w:tcPr>
      <w:tcW w:w="4050" w:type="dxa"/>
      <w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>
    </w:tcPr>
    ${p(text)}
  </w:tc>`;
}

function mergedCell(paragraphs) {
  const vMerge = paragraphs === null ? '<w:vMerge/>' : '<w:vMerge w:val="restart"/>';
  const body = paragraphs === null ? '<w:p/>' : paragraphs.map(p).join('');
  return `<w:tc>
    <w:tcPr><w:tcW w:w="6740" w:type="dxa"/>${vMerge}</w:tcPr>
    ${body}
  </w:tc>`;
}

/**
 * @param {{ heightsTwips: number[], fills: string[], mergedLines: number, label: string }} spec
 */
function table(spec) {
  const rows = spec.heightsTwips.map((height, index) => {
    const merged =
      index === 0
        ? mergedCell(
            Array.from(
              { length: spec.mergedLines },
              (_, line) => `${spec.label} merged line ${line + 1}`
            )
          )
        : mergedCell(null);
    return `<w:tr>
      <w:trPr><w:trHeight w:val="${height}"/></w:trPr>
      ${labelCell(`${spec.label} row ${index + 1}`, spec.fills[index])}
      ${merged}
    </w:tr>`;
  });
  return `<w:tbl>
    <w:tblPr>
      <w:tblW w:w="10790" w:type="dxa"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="8" w:space="0" w:color="666666"/>
        <w:left w:val="single" w:sz="8" w:space="0" w:color="666666"/>
        <w:bottom w:val="single" w:sz="8" w:space="0" w:color="666666"/>
        <w:right w:val="single" w:sz="8" w:space="0" w:color="666666"/>
        <w:insideH w:val="single" w:sz="8" w:space="0" w:color="999999"/>
        <w:insideV w:val="single" w:sz="8" w:space="0" w:color="999999"/>
      </w:tblBorders>
      <w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>
    </w:tblPr>
    <w:tblGrid><w:gridCol w:w="4050"/><w:gridCol w:w="6740"/></w:tblGrid>
    ${rows.join('')}
  </w:tbl>`;
}

// SHORT: minimums add up to 60 + 120 + 80 = 260pt; the merged content is five lines, so it
// clears the first row's 60pt and stays well inside the span.
const SHORT_TABLE = table({
  heightsTwips: [1200, 2400, 1600],
  fills: ['355D7E', '7BA79D', 'B4C7DC'],
  mergedLines: 5,
  label: 'Short',
});

// TALL: minimums add up to 36 * 3 = 108pt and the merged content is twelve lines, so the
// span has a surplus for the last row to take.
const TALL_TABLE = table({
  heightsTwips: [720, 720, 720],
  fills: ['355D7E', '7BA79D', 'B4C7DC'],
  mergedLines: 12,
  label: 'Tall',
});

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${SHORT_TABLE}
    ${p('Between the two tables.')}
    ${TALL_TABLE}
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
