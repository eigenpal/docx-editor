import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

const bytes = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rId5" Type="${R}/hyperlink" Target="https://example.com/" TargetMode="External"/>` +
      '</Relationships>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      '<w:p><w:r><w:t>Open </w:t></w:r>' +
      '<w:hyperlink r:id="rId5"><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t>Example</w:t></w:r></w:hyperlink>' +
      '</w:p></w:body></w:document>'
  ),
});

writeFileSync(resolve(import.meta.dirname, '../../../e2e/fixtures/hyperlink-demo.docx'), bytes);
