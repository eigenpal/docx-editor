/**
 * Build the deterministic tracked-and-numbered benchmark fixture.
 *
 * The plain long-edit fixture exercises pagination breadth but none of the paths that
 * dominate real review documents: every clause here is a NUMBERED list paragraph (full
 * style-cascade and list-counter work per layout), roughly half carry a dense
 * mid-sentence tracked replacement (a w:del + w:ins pair, two alternating authors), and
 * clauses are long enough that ~620 of them paginate to roughly 200 pages. All text and
 * review metadata are synthetic.
 *
 * `--huge` writes the stress variant instead: ~4,250 clauses (~1,000 browser
 * pages) with a tracked replacement on every 4th clause (~1,060 tracked
 * changes). It is deliberately NOT committed — the bytes are deterministic, so
 * whoever needs it (the browser benchmark, a local session) regenerates it.
 *
 * Usage:
 *   bun scripts/create-synthetic-tracked-fixture.mjs
 *   bun scripts/create-synthetic-tracked-fixture.mjs --check
 *   bun scripts/create-synthetic-tracked-fixture.mjs --huge
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const huge = process.argv.includes('--huge');
const out = resolve(
  root,
  huge ? 'e2e/fixtures/synthetic-huge-tracked.docx' : 'e2e/fixtures/synthetic-tracked-numbered.docx'
);
const fixedDate = new Date(Date.UTC(2020, 0, 1));
const clauseCount = huge ? 4_250 : 620;
const trackedEvery = huge ? 4 : 2;
const headingEvery = 15;

const words = [
  'availability',
  'baseline',
  'charges',
  'delivery',
  'engine',
  'failure',
  'grading',
  'holdback',
  'interval',
  'journal',
  'kickoff',
  'ledger',
  'measure',
  'notice',
  'output',
  'period',
  'quarter',
  'report',
  'schedule',
  'target',
  'uptime',
  'variance',
  'window',
  'yield',
];

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
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
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120"/><w:jc w:val="both"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="ClauseHeading">
    <w:name w:val="Clause Heading"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/><w:jc w:val="left"/></w:pPr>
    <w:rPr><w:b/><w:i/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="NumberedClause">
    <w:name w:val="Numbered Clause"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
  </w:style>
</w:styles>`;

const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="720"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:trackRevisions/>
  <w:defaultTabStop w:val="720"/>
</w:settings>`;

const sectionProperties =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>';

const authors = ['Synthetic Reviewer A', 'Synthetic Reviewer B'];

function sentence(index, length, offset) {
  return Array.from(
    { length },
    (_, position) => words[(index * 11 + offset + position * 3) % words.length]
  ).join(' ');
}

function clause(index) {
  if (index % headingEvery === 0) {
    const label = sentence(index, 5, 2);
    return `<w:p><w:pPr><w:pStyle w:val="ClauseHeading"/></w:pPr><w:r><w:t xml:space="preserve">Schedule ${Math.floor(index / headingEvery) + 1} — ${label}</w:t></w:r></w:p>`;
  }
  const lead = `The Supplier shall ensure that ${sentence(index, 52, 0)} `;
  const tail = ` measured monthly during supported hours, excluding planned maintenance for ${sentence(index, 64, 7)}, reported in accordance with paragraph ${((index * 3) % 40) + 1} of this Schedule.`;
  const tracked = index % trackedEvery === 0;
  const middle = tracked
    ? `<w:del w:id="${index * 2}" w:author="${authors[index % authors.length]}" w:date="2020-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve">shall not exceed ${(index % 6) + 1} in any calendar month</w:delText></w:r></w:del>` +
      `<w:ins w:id="${index * 2 + 1}" w:author="${authors[index % authors.length]}" w:date="2020-01-01T00:00:00Z"><w:r><w:t xml:space="preserve">shall not exceed ${(index % 4) + 1} in any calendar month</w:t></w:r></w:ins>`
    : `<w:r><w:t xml:space="preserve">shall not exceed ${(index % 6) + 1} in any calendar month</w:t></w:r>`;
  return `<w:p><w:pPr><w:pStyle w:val="NumberedClause"/></w:pPr><w:r><w:t xml:space="preserve">${lead}</w:t></w:r>${middle}<w:r><w:t xml:space="preserve">${tail}</w:t></w:r></w:p>`;
}

function documentXml() {
  const body = Array.from({ length: clauseCount }, (_, index) => clause(index)).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${sectionProperties}</w:body></w:document>`;
}

async function build() {
  const zip = new JSZip();
  const add = (name, content) => zip.file(name, content, { date: fixedDate, createFolders: false });
  add('[Content_Types].xml', contentTypes);
  add('_rels/.rels', packageRels);
  add('word/_rels/document.xml.rels', documentRels);
  add('word/styles.xml', styles);
  add('word/numbering.xml', numbering);
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
    throw new Error('synthetic tracked-numbered fixture differs from deterministic regeneration');
  }
  console.log(`fixture matches (${bytes.length} bytes)`);
} else {
  writeFileSync(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes)`);
}
