/**
 * Generates a DOCX with a real w15:repeatingSection containing two
 * w15:repeatingSectionItem instances — for testing add/remove (#622 phase 3).
 *
 *   bun run scripts/make-repeating-fixture.mjs e2e/fixtures/block-sdt-repeating.docx
 */

import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;

/** A repeating-section item (w15:repeatingSectionItem) wrapping a paragraph. */
const item = (id, text) =>
  `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w15:repeatingSectionItem/></w:sdtPr>` +
  `<w:sdtContent>${p(text)}</w:sdtContent></w:sdt>`;

const body =
  p('Repeating section test') +
  `<w:sdt><w:sdtPr><w:alias w:val="Rows"/><w:tag w:val="rows"/><w:id w:val="301"/>` +
  `<w15:repeatingSection/></w:sdtPr><w:sdtContent>` +
  item('302', 'Row one') +
  item('303', 'Row two') +
  `</w:sdtContent></w:sdt>` +
  p('End.');

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

const contentTypes =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;

const rootRels =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', contentTypes);
zip.file('_rels/.rels', rootRels);
zip.file('word/document.xml', documentXml);

const outPath = process.argv[2] ?? 'block-sdt-repeating.docx';
const buf = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
writeFileSync(outPath, buf);
console.log(`wrote ${outPath} (${buf.length} bytes) — repeating section with 2 items`);
