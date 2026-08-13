/**
 * Build the deterministic, repository-owned long-document editing benchmark fixture.
 *
 * All text and review metadata are synthetic. The document deliberately combines roughly
 * 200 pages, tracked revisions, explicit page breaks, and section boundaries so incremental
 * pagination exercises realistic convergence points without depending on external documents.
 *
 * Usage:
 *   bun scripts/create-synthetic-long-edit-fixture.mjs
 *   bun scripts/create-synthetic-long-edit-fixture.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'e2e/fixtures/synthetic-long-edit.docx');
const fixedDate = new Date(Date.UTC(2020, 0, 1));
const paragraphCount = 3_200;
const sectionBreaks = new Set([777, 1_555, 2_333]);
const words = [
  'alpha',
  'bravo',
  'canvas',
  'delta',
  'editor',
  'format',
  'geometry',
  'header',
  'index',
  'layout',
  'margin',
  'notes',
  'office',
  'page',
  'quality',
  'render',
  'section',
  'table',
  'update',
  'verify',
];

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`;

const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`;

const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:trackRevisions/>
  <w:defaultTabStop w:val="720"/>
</w:settings>`;

function sectionProperties() {
  return '<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>';
}

function paragraph(index) {
  const text = Array.from(
    { length: 24 },
    (_, offset) => words[(index * 7 + offset) % words.length]
  );
  const lead = `Synthetic paragraph ${index + 1}. `;
  const middle = `${text.slice(0, 12).join(' ')} `;
  const tail = text.slice(12).join(' ');
  // Offset authored boundaries from the benchmark's 5% and 50% targets: those edits must
  // do real reflow work before reaching a convergence point, not land directly on one.
  const sectionBreak = sectionBreaks.has(index + 1);
  const pageBreak = (index + 5) % 16 === 0 && !sectionBreak;
  const paragraphProperties = sectionBreak ? `<w:pPr>${sectionProperties()}</w:pPr>` : '';
  const reviewed =
    index % 3 === 0
      ? `<w:ins w:id="${index}" w:author="Synthetic Author" w:date="2020-01-01T00:00:00Z"><w:r><w:t xml:space="preserve">${middle}</w:t></w:r></w:ins>`
      : index % 3 === 1
        ? `<w:del w:id="${index}" w:author="Synthetic Reviewer" w:date="2020-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve">${middle}</w:delText></w:r></w:del>`
        : `<w:r><w:t xml:space="preserve">${middle}</w:t></w:r>`;
  const hardBreak = pageBreak ? '<w:r><w:br w:type="page"/></w:r>' : '';
  return `<w:p>${paragraphProperties}<w:r><w:t xml:space="preserve">${lead}</w:t></w:r>${reviewed}<w:r><w:t>${tail}</w:t></w:r>${hardBreak}</w:p>`;
}

function documentXml() {
  const body = Array.from({ length: paragraphCount }, (_, index) => paragraph(index)).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${sectionProperties()}</w:body></w:document>`;
}

async function build() {
  const zip = new JSZip();
  const add = (name, content) => zip.file(name, content, { date: fixedDate, createFolders: false });
  add('[Content_Types].xml', contentTypes);
  add('_rels/.rels', packageRels);
  add('word/_rels/document.xml.rels', documentRels);
  add('word/styles.xml', styles);
  add('word/settings.xml', settings);
  add('word/document.xml', documentXml());
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

const bytes = await build();
if (process.argv.includes('--check')) {
  const committed = readFileSync(out);
  if (Buffer.compare(committed, bytes) !== 0) {
    throw new Error('synthetic long-edit fixture differs from deterministic regeneration');
  }
  console.log(`fixture matches (${bytes.length} bytes)`);
} else {
  writeFileSync(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes)`);
}
