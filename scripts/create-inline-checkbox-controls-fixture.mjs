/**
 * Generates a DOCX with inline Word checkbox content controls (`w14:checkbox`).
 *
 *   bun scripts/create-inline-checkbox-controls-fixture.mjs e2e/fixtures/inline-checkbox-controls.docx
 */

import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const run = (text, options = {}) => {
  const preserve =
    text.startsWith(' ') || text.endsWith(' ') || text.includes('  ') ? ' xml:space="preserve"' : '';
  const rPr = options.bold
    ? '<w:rPr><w:b/></w:rPr>'
    : options.symbol
      ? '<w:rPr><w:rFonts w:ascii="MS Gothic" w:hAnsi="MS Gothic" w:eastAsia="MS Gothic"/></w:rPr>'
      : '';
  return `<w:r>${rPr}<w:t${preserve}>${esc(text)}</w:t></w:r>`;
};

const paragraph = (...content) => `<w:p>${content.join('')}</w:p>`;
const title = (text) => paragraph(`<w:pPr><w:pStyle w:val="Title"/></w:pPr>`, run(text));
const heading = (text) => paragraph(`<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>`, run(text));

const checkbox = ({
  tag,
  alias,
  id,
  checked,
  locked = false,
  bound = false,
  checkedValue = '2612',
  uncheckedValue = '2610',
}) => {
  const tagXml = tag ? `<w:tag w:val="${esc(tag)}"/>` : '';
  const aliasXml = alias ? `<w:alias w:val="${esc(alias)}"/>` : '';
  const lockXml = locked ? '<w:lock w:val="sdtContentLocked"/>' : '';
  const bindingXml = bound
    ? '<w:dataBinding w:xpath="/root/checkbox" w:storeItemID="{AAAA0000-0000-0000-0000-000000000002}"/>'
    : '';
  const glyph = String.fromCodePoint(parseInt(checked ? checkedValue : uncheckedValue, 16));
  const sdtPr =
    `${aliasXml}${tagXml}<w:id w:val="${id}"/>${lockXml}${bindingXml}` +
    `<w14:checkbox><w14:checked w14:val="${checked ? '1' : '0'}"/>` +
    `<w14:checkedState w14:val="${checkedValue}" w14:font="MS Gothic"/>` +
    `<w14:uncheckedState w14:val="${uncheckedValue}" w14:font="MS Gothic"/></w14:checkbox>`;
  return `<w:sdt><w:sdtPr>${sdtPr}</w:sdtPr><w:sdtContent>${run(glyph, {
    symbol: true,
  })}</w:sdtContent></w:sdt>`;
};

const body =
  title('Inline checkbox content controls') +
  paragraph(run('A synthetic fixture for Word-style inline checkboxes.')) +
  heading('Checklist options') +
  paragraph(
    checkbox({ tag: 'option-alpha', alias: 'Option alpha', id: 301, checked: false }),
    run(' Option alpha is selected for the document.')
  ) +
  paragraph(
    checkbox({ tag: 'option-bravo', alias: 'Option bravo', id: 302, checked: true }),
    run(' Option bravo is selected for the document.')
  ) +
  paragraph(
    checkbox({ alias: 'Untagged checkbox', id: 303, checked: false }),
    run(' Untagged control still toggles by document position.')
  ) +
  heading('Passive controls') +
  paragraph(
    checkbox({
      tag: 'locked-checkbox',
      alias: 'Locked checkbox',
      id: 304,
      checked: false,
      locked: true,
    }),
    run(' Locked checkbox renders but is not editable.')
  ) +
  paragraph(
    checkbox({ tag: 'bound-checkbox', alias: 'Bound checkbox', id: 305, checked: false, bound: true }),
    run(' Data-bound checkbox renders but is not editable.')
  ) +
  paragraph(run('[ X ] Plain text fallback is intentionally not interactive.'));

const stylesXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="${W}">` +
  `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>` +
  `<w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>` +
  `<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>` +
  `<w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>` +
  `</w:styles>`;

const documentXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:mc="${MC}" mc:Ignorable="w14">` +
  `<w:body>${body}` +
  `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
  `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>` +
  `</w:sectPr></w:body></w:document>`;

const contentTypes =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `</Types>`;

const rootRels =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const documentRels =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', contentTypes);
zip.file('_rels/.rels', rootRels);
zip.file('word/_rels/document.xml.rels', documentRels);
zip.file('word/document.xml', documentXml);
zip.file('word/styles.xml', stylesXml);

const outPath = process.argv[2] ?? 'e2e/fixtures/inline-checkbox-controls.docx';
const buf = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
writeFileSync(outPath, buf);
console.log(`wrote ${outPath} (${buf.length} bytes)`);
