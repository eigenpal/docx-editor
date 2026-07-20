/**
 * Generates a DOCX with the three interactive content-control widget types
 * (checkbox, dropdown, date) for e2e testing the UI widgets (#622 phase 3).
 *
 *   bun run scripts/make-widget-fixture.mjs e2e/fixtures/block-sdt-widgets.docx
 */

import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
const pRaw = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const sdt = (sdtPr, content) =>
  `<w:sdt><w:sdtPr>${sdtPr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

const body =
  p('Content-control widgets test') +
  // Checkbox (unchecked initially: ☐ = 2610)
  sdt(
    `<w:alias w:val="Agree"/><w:tag w:val="agree"/><w:id w:val="201"/>` +
      `<w14:checkbox><w14:checked w14:val="0"/>` +
      `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
      `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>`,
    pRaw('☐')
  ) +
  // Dropdown (current: Draft)
  sdt(
    `<w:alias w:val="Status"/><w:tag w:val="status"/><w:id w:val="202"/>` +
      `<w:dropDownList w:lastValue="1">` +
      `<w:listItem w:displayText="Draft" w:value="1"/>` +
      `<w:listItem w:displayText="Final" w:value="2"/>` +
      `<w:listItem w:displayText="Archived" w:value="3"/></w:dropDownList>`,
    p('Draft')
  ) +
  // Date
  sdt(
    `<w:alias w:val="Effective"/><w:tag w:val="effective"/><w:id w:val="203"/>` +
      `<w:date w:fullDate="2020-01-01T00:00:00Z"><w:dateFormat w:val="MMMM d, yyyy"/>` +
      `<w:lid w:val="en-US"/></w:date>`,
    p('January 1, 2020')
  ) +
  // Content-locked dropdown — must NOT render an editable trigger.
  sdt(
    `<w:alias w:val="LockedChoice"/><w:tag w:val="lockedchoice"/><w:id w:val="204"/>` +
      `<w:lock w:val="sdtContentLocked"/>` +
      `<w:dropDownList w:lastValue="1"><w:listItem w:displayText="A" w:value="1"/>` +
      `<w:listItem w:displayText="B" w:value="2"/></w:dropDownList>`,
    p('A')
  ) +
  // Data-bound checkbox — must NOT render an editable trigger (store drives it).
  sdt(
    `<w:alias w:val="BoundCheck"/><w:tag w:val="boundcheck"/><w:id w:val="205"/>` +
      `<w:dataBinding w:xpath="/root/agree" w:storeItemID="{AAAA0000-0000-0000-0000-000000000001}"/>` +
      `<w14:checkbox><w14:checked w14:val="0"/>` +
      `<w14:checkedState w14:val="2612"/><w14:uncheckedState w14:val="2610"/></w14:checkbox>`,
    pRaw('☐')
  ) +
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

const outPath = process.argv[2] ?? 'block-sdt-widgets.docx';
const buf = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
writeFileSync(outPath, buf);
console.log(`wrote ${outPath} (${buf.length} bytes) — checkbox + dropdown + date`);
