// Build the underline-variant demo fixture (D8 run properties, tasks 6.1/6.2).
//
// A hand-authored DOCX carrying one paragraph per ST_Underline variant plus a coloured
// underline, so the browser checkpoint can show that an authored `w:u` projects with its
// own variant instead of a flat single underline. Regenerate with:
//   node scripts/make-underline-fixture.mjs

import { writeFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const VARIANTS = [
  ['single', undefined],
  ['double', undefined],
  ['thick', undefined],
  ['dotted', undefined],
  ['dash', undefined],
  ['dotDash', undefined],
  ['wave', undefined],
  ['wavyDouble', undefined],
  ['single', 'FF0000'],
  ['wave', '0070C0'],
];

const paragraphs = VARIANTS.map(([val, color]) => {
  const u = `<w:u w:val="${val}"${color ? ` w:color="${color}"` : ''}/>`;
  const label = `${val}${color ? ` (colour ${color})` : ''}`;
  return (
    '<w:p>' +
    `<w:r><w:t xml:space="preserve">underline </w:t></w:r>` +
    `<w:r><w:rPr>${u}</w:rPr><w:t xml:space="preserve">${label}</w:t></w:r>` +
    '</w:p>'
  );
}).join('');

const documentXml =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:document xmlns:w="${W}"><w:body>` +
  '<w:p><w:r><w:t>Edit any line: the authored underline variant must survive.</w:t></w:r></w:p>' +
  paragraphs +
  '</w:body></w:document>';

const bytes = zipSync({
  '[Content_Types].xml': strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
  ),
  'word/document.xml': strToU8(documentXml),
});

const out = new URL('../examples/vite/public/underline-variants.docx', import.meta.url);
writeFileSync(out, bytes);
console.log(`wrote ${out.pathname} (${bytes.length} bytes, ${VARIANTS.length} variants)`);
