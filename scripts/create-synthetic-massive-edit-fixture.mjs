/**
 * Build the deterministic 500+ page editing benchmark fixtures.
 *
 * Reproduces the shape of a very large real-world document: thousands of body
 * paragraphs, repeated multi-page tables with `w:tblHeader` rows, and (in the
 * multi-section variant) a `w:sectPr` boundary at the end of every unit, the way a
 * long document assembled by repeated pasting carries one section per pasted copy.
 * All text is synthetic.
 *
 * Two fixtures, same content:
 *   synthetic-massive-multisection.docx   — one section break per unit (~105 sections)
 *   synthetic-massive-singlesection.docx  — the same body under a single trailing sectPr
 *
 * The files are large, so they are generated on demand (not committed); the
 * benchmark and its gates regenerate them when missing. Output is byte-deterministic.
 *
 * Usage:
 *   bun scripts/create-synthetic-massive-edit-fixture.mjs [outDir]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, process.argv[2] ?? 'e2e/fixtures/generated');
const fixedDate = new Date(Date.UTC(2020, 0, 1));

export const UNITS = 105;
const PARAGRAPHS_PER_UNIT = 78;
const TABLE_ROWS = 12;
const TABLE_COLUMNS = 3;

const words = [
  'anchor',
  'billing',
  'clause',
  'draft',
  'estimate',
  'filing',
  'grant',
  'holding',
  'invoice',
  'journal',
  'keynote',
  'ledger',
  'minutes',
  'notice',
  'order',
  'policy',
  'quarter',
  'record',
  'summary',
  'term',
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
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>`;

const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:defaultTabStop w:val="720"/>
</w:settings>`;

function sectionProperties() {
  return '<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>';
}

function paragraph(unit, index, styleId, { pageBreakBefore = false } = {}) {
  const seed = unit * 131 + index * 7;
  const text = Array.from({ length: 22 }, (_, offset) => words[(seed + offset) % words.length]);
  const lead = `Unit ${unit + 1} paragraph ${index + 1}. `;
  const props = [
    styleId ? `<w:pStyle w:val="${styleId}"/>` : '',
    pageBreakBefore ? '<w:pageBreakBefore/>' : '',
  ].join('');
  const pPr = props ? `<w:pPr>${props}</w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${lead}</w:t></w:r><w:r><w:t xml:space="preserve">${text.join(' ')}</w:t></w:r></w:p>`;
}

function table(unit) {
  const cellWidth = Math.floor(9360 / TABLE_COLUMNS);
  const rows = Array.from({ length: TABLE_ROWS }, (_, rowIndex) => {
    const header = rowIndex === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
    const cells = Array.from({ length: TABLE_COLUMNS }, (_, columnIndex) => {
      const label =
        rowIndex === 0
          ? `Column ${columnIndex + 1}`
          : `Row ${rowIndex} cell ${columnIndex + 1} of unit ${unit + 1}: ${words[(unit + rowIndex * 3 + columnIndex) % words.length]} ${words[(unit * 5 + rowIndex + columnIndex) % words.length]}`;
      return `<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">${label}</w:t></w:r></w:p></w:tc>`;
    }).join('');
    return `<w:tr>${header}${cells}</w:tr>`;
  }).join('');
  const grid = Array.from(
    { length: TABLE_COLUMNS },
    () => `<w:gridCol w:w="${cellWidth}"/>`
  ).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
}

function unitBlocks(unit, { sectionBreak, chapterBreak }) {
  // Chapter-style page break on each unit heading (single-section variant): the authored
  // sync point a real long document has, where an incremental pass can reconverge.
  const blocks = [
    paragraph(unit, 0, 'Heading1', { pageBreakBefore: chapterBreak && unit > 0 }),
  ];
  for (let index = 1; index < PARAGRAPHS_PER_UNIT; index += 1) {
    if (index === Math.floor(PARAGRAPHS_PER_UNIT / 2)) blocks.push(table(unit));
    blocks.push(paragraph(unit, index, null));
  }
  if (sectionBreak) {
    blocks.push(`<w:p><w:pPr>${sectionProperties()}</w:pPr></w:p>`);
  }
  return blocks.join('');
}

function documentXml(multiSection) {
  const body = Array.from({ length: UNITS }, (_, unit) =>
    // The final unit's section properties come from the trailing body-level sectPr.
    unitBlocks(unit, {
      sectionBreak: multiSection && unit < UNITS - 1,
      chapterBreak: !multiSection,
    })
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${sectionProperties()}</w:body></w:document>`;
}

async function build(multiSection) {
  const zip = new JSZip();
  const add = (name, content) => zip.file(name, content, { date: fixedDate, createFolders: false });
  add('[Content_Types].xml', contentTypes);
  add('_rels/.rels', packageRels);
  add('word/_rels/document.xml.rels', documentRels);
  add('word/styles.xml', styles);
  add('word/settings.xml', settings);
  add('word/document.xml', documentXml(multiSection));
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

mkdirSync(outDir, { recursive: true });
for (const [name, multiSection] of [
  ['synthetic-massive-multisection.docx', true],
  ['synthetic-massive-singlesection.docx', false],
]) {
  const target = resolve(outDir, name);
  const bytes = await build(multiSection);
  if (existsSync(target) && process.argv.includes('--if-missing')) {
    console.log(`kept ${target}`);
    continue;
  }
  writeFileSync(target, bytes);
  console.log(`wrote ${target} (${bytes.length} bytes)`);
}
