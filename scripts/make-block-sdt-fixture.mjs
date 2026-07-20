/**
 * Generates a DOCX that exercises block-level Structured Document Tags
 * (content controls) extensively — for manually testing #622 phases 1 & 2.
 *
 *   bun run scripts/make-block-sdt-fixture.mjs [outPath]
 *
 * The document.xml is hand-authored so every block-SDT shape is covered with
 * precise control over the w:sdtPr (including unmodeled features that must
 * survive lossless passthrough). Each control is labeled with visible text so
 * a human can see, in Word and in the editor, exactly what should round-trip.
 */

import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ── helpers to keep the OOXML readable ──────────────────────────────────────
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A paragraph; `opts.style` applies a heading style, `opts.bold` bolds runs. */
function p(text, opts = {}) {
  const rPr = opts.bold ? '<w:rPr><w:b/></w:rPr>' : '';
  const pPr = opts.style ? `<w:pPr><w:pStyle w:val="${opts.style}"/></w:pPr>` : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

/** A 2x2 table with the given cell texts (row-major). */
function table(cells) {
  const cell = (t) =>
    `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>${p(t)}</w:tc>`;
  const row = (a, b) => `<w:tr>${cell(a)}${cell(b)}</w:tr>`;
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/><w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:color="auto"/>` +
    `<w:left w:val="single" w:sz="4" w:color="auto"/>` +
    `<w:bottom w:val="single" w:sz="4" w:color="auto"/>` +
    `<w:right w:val="single" w:sz="4" w:color="auto"/>` +
    `<w:insideH w:val="single" w:sz="4" w:color="auto"/>` +
    `<w:insideV w:val="single" w:sz="4" w:color="auto"/>` +
    `</w:tblBorders></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid>` +
    row(cells[0], cells[1]) +
    row(cells[2], cells[3]) +
    `</w:tbl>`
  );
}

/** A block-level SDT. `sdtPrInner` is the raw inner XML of w:sdtPr. */
function blockSdt(sdtPrInner, contentXml, endPrInner = '') {
  const endPr = endPrInner ? `<w:sdtEndPr>${endPrInner}</w:sdtEndPr>` : '';
  return (
    `<w:sdt><w:sdtPr>${sdtPrInner}</w:sdtPr>${endPr}` +
    `<w:sdtContent>${contentXml}</w:sdtContent></w:sdt>`
  );
}

// ── the body: one control per scenario, each self-describing ────────────────
const body = [
  p('Block SDT test document (#622)', { style: 'Heading1' }),
  p('Each boxed region below is a block-level content control. Edit inside it, then Save and reopen in Word — the control, its tag/alias, and any unmodeled properties must survive.'),

  // 1. Rich-text control over a single paragraph
  p('1. Rich-text control wrapping one paragraph', { style: 'Heading2', bold: true }),
  blockSdt(
    `<w:alias w:val="Intro"/><w:tag w:val="intro"/><w:id w:val="101"/><w:richText/>`,
    p('CONTROL #1 (tag=intro, alias=Intro): edit this line; it should stay inside the box.')
  ),

  // 2. Control wrapping a table
  p('2. Control wrapping a table', { style: 'Heading2', bold: true }),
  blockSdt(
    `<w:alias w:val="Grid"/><w:tag w:val="grid"/><w:id w:val="102"/><w:richText/>`,
    table(['CONTROL #2 A1', 'B1', 'A2', 'B2'])
  ),

  // 3. Control wrapping MULTIPLE blocks (2 paragraphs + a table)
  p('3. Control wrapping multiple blocks', { style: 'Heading2', bold: true }),
  blockSdt(
    `<w:alias w:val="Multi"/><w:tag w:val="multi"/><w:id w:val="103"/><w:richText/>`,
    p('CONTROL #3 paragraph one.') + p('CONTROL #3 paragraph two.') + table(['m-A1', 'm-B1', 'm-A2', 'm-B2'])
  ),

  // 4. NESTED controls (control inside a control)
  p('4. Nested controls', { style: 'Heading2', bold: true }),
  blockSdt(
    `<w:alias w:val="Outer"/><w:tag w:val="outer"/><w:id w:val="104"/><w:richText/>`,
    p('CONTROL #4 OUTER, before the inner control.') +
      blockSdt(
        `<w:alias w:val="Inner"/><w:tag w:val="inner"/><w:id w:val="105"/><w:richText/>`,
        p('CONTROL #4 INNER (nested): both boxes must survive.')
      ) +
      p('CONTROL #4 OUTER, after the inner control.')
  ),

  // 5. Locked control (sdtContentLocked) — lock must round-trip
  p('5. Locked control (sdtContentLocked)', { style: 'Heading2', bold: true }),
  blockSdt(
    `<w:alias w:val="Locked"/><w:tag w:val="locked"/><w:id w:val="106"/>` +
      `<w:lock w:val="sdtContentLocked"/><w:richText/>`,
    p('CONTROL #5 (lock=sdtContentLocked): the lock attribute must survive a round-trip.')
  ),

  // 6. UNMODELED feature passthrough: w:dataBinding (Phase 1 lossless guarantee)
  p('6. Data binding (unmodeled — must survive verbatim)', { style: 'Heading2', bold: true }),
  blockSdt(
    `<w:alias w:val="Bound"/><w:tag w:val="bound"/><w:id w:val="107"/>` +
      `<w:dataBinding w:prefixMappings="xmlns:ns0='http://example.com/cust'" ` +
      `w:xpath="/ns0:root[1]/ns0:field[1]" w:storeItemID="{1B2C3D4E-0000-0000-0000-000000000001}"/>` +
      `<w:text/>`,
    p('CONTROL #6 (has w:dataBinding): the dataBinding element must come back byte-for-byte after save.')
  ),

  // 7. UNMODELED w15:repeatingSection — w15 namespace passthrough + ns declared
  p('7. Repeating section (w15 — unmodeled)', { style: 'Heading2', bold: true }),
  blockSdt(
    `<w:alias w:val="Repeat"/><w:tag w:val="repeat"/><w:id w:val="108"/><w15:repeatingSection/>`,
    p('CONTROL #7 (w15:repeatingSection): the w15 element must survive and its namespace stay declared.')
  ),

  // 8. Dropdown content control with list items + lastValue
  p('8. Dropdown content control', { style: 'Heading2', bold: true }),
  blockSdt(
    `<w:alias w:val="Choice"/><w:tag w:val="choice"/><w:id w:val="109"/>` +
      `<w:dropDownList w:lastValue="2">` +
      `<w:listItem w:displayText="Draft" w:value="1"/>` +
      `<w:listItem w:displayText="Final" w:value="2"/>` +
      `<w:listItem w:displayText="Archived" w:value="3"/>` +
      `</w:dropDownList>`,
    p('CONTROL #8 (dropDownList, lastValue=2): the three list items and lastValue must round-trip.')
  ),

  // 9. Control with sdtEndPr
  p('9. Control with sdtEndPr', { style: 'Heading2', bold: true }),
  blockSdt(
    `<w:alias w:val="EndPr"/><w:tag w:val="endpr"/><w:id w:val="110"/><w:richText/>`,
    p('CONTROL #9 (has w:sdtEndPr): the end-properties element must survive in the right position.'),
    `<w:rPr><w:b/></w:rPr>`
  ),

  // 10. Control as the VERY LAST block — caret-trap regression
  //     (phase 2 must append a trailing paragraph so you can click after it)
  p('10. Control at the end of the document', { style: 'Heading2', bold: true }),
  blockSdt(
    `<w:alias w:val="Last"/><w:tag w:val="last"/><w:id w:val="111"/><w:richText/>`,
    p('CONTROL #10 is the final block. In the editor you must be able to place the caret AFTER this box and type — that is the caret-trap fix.')
  ),
].join('');

const documentXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<w:document xmlns:w="${W}" ` +
  `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ` +
  `xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" ` +
  `mc:Ignorable="w14 w15" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
  `<w:body>${body}` +
  `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
  `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>` +
  `</w:sectPr></w:body></w:document>`;

// ── minimal but valid OPC package parts ─────────────────────────────────────
const contentTypes =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `</Types>`;

const rootRels =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const docRels =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

const stylesXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<w:styles xmlns:w="${W}">` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>` +
  `</w:styles>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', contentTypes);
zip.file('_rels/.rels', rootRels);
zip.file('word/document.xml', documentXml);
zip.file('word/_rels/document.xml.rels', docRels);
zip.file('word/styles.xml', stylesXml);

const outPath = process.argv[2] ?? 'block-sdt-test.docx';
const buf = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
writeFileSync(outPath, buf);
console.log(`wrote ${outPath} (${buf.length} bytes) — 10 block-SDT scenarios`);
