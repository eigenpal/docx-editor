/**
 * Generates a single DOCX showcasing every content-control UI (#622):
 * rich text, table-wrapping, checkbox, dropdown, date, a repeating section with
 * items, plus locked and data-bound controls (whose widgets are suppressed).
 *
 *   bun run scripts/make-showcase-fixture.mjs e2e/fixtures/block-sdt-showcase.docx
 */

import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = (t, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}` +
  `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
const pRaw = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const sdt = (pr, content) => `<w:sdt><w:sdtPr>${pr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
const item = (id, text) =>
  sdt(`<w:id w:val="${id}"/><w15:repeatingSectionItem/>`, p(text));

const body =
  p('Content controls — full showcase', 'Heading1') +

  p('1. Rich text', 'Heading2') +
  sdt(`<w:alias w:val="Intro"/><w:tag w:val="intro"/><w:id w:val="101"/><w:richText/>`,
    p('Click and type — this is a rich-text control.')) +

  p('2. Checkbox', 'Heading2') +
  sdt(`<w:alias w:val="Agree"/><w:tag w:val="agree"/><w:id w:val="102"/>` +
      `<w14:checkbox><w14:checked w14:val="0"/>` +
      `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
      `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>`, pRaw('☐')) +

  p('3. Dropdown', 'Heading2') +
  sdt(`<w:alias w:val="Status"/><w:tag w:val="status"/><w:id w:val="103"/>` +
      `<w:dropDownList w:lastValue="1">` +
      `<w:listItem w:displayText="Draft" w:value="1"/>` +
      `<w:listItem w:displayText="Final" w:value="2"/>` +
      `<w:listItem w:displayText="Archived" w:value="3"/></w:dropDownList>`, p('Draft')) +

  p('4. Date', 'Heading2') +
  sdt(`<w:alias w:val="Effective"/><w:tag w:val="effective"/><w:id w:val="104"/>` +
      `<w:date w:fullDate="2020-01-01T00:00:00Z"><w:dateFormat w:val="MMMM d, yyyy"/>` +
      `<w:lid w:val="en-US"/></w:date>`, p('January 1, 2020')) +

  p('5. Repeating section (＋ to add a row, ✕ to remove)', 'Heading2') +
  sdt(`<w:alias w:val="Rows"/><w:tag w:val="rows"/><w:id w:val="105"/><w15:repeatingSection/>`,
    item('106', 'Row one') + item('107', 'Row two')) +

  p('6. Locked (no widget)', 'Heading2') +
  sdt(`<w:alias w:val="LockedChoice"/><w:tag w:val="lockedchoice"/><w:id w:val="108"/>` +
      `<w:lock w:val="sdtContentLocked"/>` +
      `<w:dropDownList w:lastValue="1"><w:listItem w:displayText="A" w:value="1"/>` +
      `<w:listItem w:displayText="B" w:value="2"/></w:dropDownList>`, p('A')) +

  p('7. Data-bound (no widget)', 'Heading2') +
  sdt(`<w:alias w:val="BoundCheck"/><w:tag w:val="boundcheck"/><w:id w:val="109"/>` +
      `<w:dataBinding w:xpath="/root/agree" w:storeItemID="{AAAA0000-0000-0000-0000-000000000001}"/>` +
      `<w14:checkbox><w14:checked w14:val="0"/>` +
      `<w14:checkedState w14:val="2612"/><w14:uncheckedState w14:val="2610"/></w14:checkbox>`, pRaw('☐')) +

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
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>` +
  `</w:styles>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', contentTypes);
zip.file('_rels/.rels', rootRels);
zip.file('word/document.xml', documentXml);
zip.file('word/_rels/document.xml.rels', docRels);
zip.file('word/styles.xml', stylesXml);

const outPath = process.argv[2] ?? 'block-sdt-showcase.docx';
const buf = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
writeFileSync(outPath, buf);
console.log(`wrote ${outPath} (${buf.length} bytes) — full content-control showcase`);
