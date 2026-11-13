import { writeFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ins = (id: number, author: string, text: string) =>
  `<w:p><w:ins w:id="${id}" w:author="${author}"><w:r><w:t>${text}</w:t></w:r></w:ins></w:p>`;
const body =
  ins(1, 'Ada', 'Ada first') +
  ins(1, 'Grace', 'Grace hidden') +
  '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
  ins(3, 'Ada', 'Ada offscreen') +
  '<w:tbl><w:tblPr><w:ins w:id="20" w:author="Grace"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>Unsupported table change</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
writeFileSync(
  new URL('./bulk-review.docx', import.meta.url),
  zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  })
);
