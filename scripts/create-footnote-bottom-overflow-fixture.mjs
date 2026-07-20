/**
 * Create a synthetic DOCX fixture for bottom-of-page footnote rendering.
 *
 * The generated document uses neutral sample text and long citation-like
 * footnotes to exercise pages where the footnote area is tall enough that
 * reservation and painting must agree exactly.
 *
 * Run: bun scripts/create-footnote-bottom-overflow-fixture.mjs
 */

import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e/fixtures/footnote-bottom-overflow.docx');
const FIXTURE_DATE = new Date('2026-01-01T00:00:00Z');

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
  <dc:title>Footnote Bottom Overflow Synthetic Fixture</dc:title>
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
  <w:style w:type="paragraph" w:styleId="FootnoteText">
    <w:name w:val="footnote text"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:sz w:val="16"/>
    </w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="FootnoteReference">
    <w:name w:val="footnote reference"/>
    <w:rPr>
      <w:vertAlign w:val="superscript"/>
      <w:sz w:val="16"/>
    </w:rPr>
  </w:style>
</w:styles>`;

function p(text, options = {}) {
  const before = options.before ?? 0;
  const after = options.after ?? 120;
  const size = options.size ?? 22;
  const bold = options.bold ? '<w:b/>' : '';
  const align = options.align ? `<w:jc w:val="${options.align}"/>` : '';
  return `<w:p>
    <w:pPr>
      <w:spacing w:before="${before}" w:after="${after}" w:line="276" w:lineRule="auto"/>
      ${align}
      <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${bold}<w:sz w:val="${size}"/></w:rPr>
    </w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${bold}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>
  </w:p>`;
}

function referenceRun(id) {
  return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
}

function referenceParagraph(start, end, label) {
  const refs = [];
  for (let id = start; id <= end; id++) {
    refs.push(referenceRun(id), '<w:r><w:t xml:space="preserve"> </w:t></w:r>');
  }

  return `<w:p>
    <w:pPr>
      <w:spacing w:before="0" w:after="120" w:line="276" w:lineRule="auto"/>
      <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>
    </w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${label}: </w:t></w:r>
    ${refs.join('')}
  </w:p>`;
}

const filler = [
  'This generated memorandum uses neutral sample facts to exercise footnote layout near the page bottom.',
  'Each paragraph is intentionally compact so the reference cluster can land close to the available text boundary.',
  'The editor must reserve enough space for the note area, then paint that note area at the same measured height.',
  'A second pagination pass can move references to another page, so the final reservation must follow the final mapping.',
  'The sample content repeats similar lengths to create predictable page pressure without relying on private documents.',
  'Reviewers can load this fixture directly and compare the bottom notes against a normal word processor.',
  'No names, matters, agencies, places, or source documents from a user file are included in this fixture.',
  'The next paragraph starts a dense run of synthetic citations with long but harmless file-like labels.',
];

const footnoteTexts = Array.from({ length: 19 }, (_, index) => {
  const id = index + 1;
  const group = id < 10 ? 'alpha' : id < 15 ? 'bravo' : 'charlie';
  return ` sample-${group}-source-${String(id).padStart(2, '0')}.csv #${(0xabc000 + id).toString(16)} (generated pages: ${id}, ${id + 1}) with additional neutral words that wrap in the footnote area and make the reservation height observable.`;
});

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${p('Synthetic Footnote Layout Fixture', { bold: true, size: 32, after: 240, align: 'center' })}
    ${filler.map((text) => p(text)).join('\n')}
    ${referenceParagraph(1, 8, 'Initial sample references')}
    ${p('A short follow-up paragraph keeps the later reference cluster close to the page boundary so remapping can be observed.')}
    ${referenceParagraph(9, 19, 'Bottom sample references')}
    ${p('Closing generated note. The visible footnotes should remain entirely inside the page and above the bottom edge.', { before: 120 })}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1296" w:right="1296" w:bottom="1296" w:left="1296" w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const footnotes = footnoteTexts
  .map(
    (text, index) => `<w:footnote w:id="${index + 1}">
  <w:p>
    <w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>
    <w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>
    <w:r><w:t xml:space="preserve">${text}</w:t></w:r>
  </w:p>
</w:footnote>`
  )
  .join('\n');

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
