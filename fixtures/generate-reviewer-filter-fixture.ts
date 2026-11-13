/** Build the focused reviewer-filter browser fixture. */

import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';

const directory = path.dirname(new URL(import.meta.url).pathname);
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'http://schemas.openxmlformats.org/package/2006/relationships';

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body><w:p>
  <w:r><w:t xml:space="preserve">Base </w:t></w:r>
  <w:commentRangeStart w:id="1"/><w:r><w:t>ALICE_COMMENT</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>
  <w:ins w:id="2" w:author="Alice Reviewer"><w:r><w:t>ALICE_INSERT</w:t></w:r></w:ins>
  <w:del w:id="3" w:author="Alice Reviewer"><w:r><w:delText>ALICE_DELETE</w:delText></w:r></w:del>
  <w:commentRangeStart w:id="4"/><w:r><w:t>BOB_COMMENT</w:t></w:r><w:commentRangeEnd w:id="4"/><w:r><w:commentReference w:id="4"/></w:r>
  <w:ins w:id="5" w:author="Bob Editor"><w:r><w:t>BOB_INSERT</w:t></w:r></w:ins>
  <w:del w:id="6" w:author="Bob Editor"><w:r><w:delText>BOB_DELETE</w:delText></w:r></w:del>
</w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="${W}">
  <w:comment w:id="1" w:author="Alice Reviewer"><w:p><w:r><w:t>Alice note</w:t></w:r></w:p></w:comment>
  <w:comment w:id="4" w:author="Bob Editor"><w:p><w:r><w:t>Bob note</w:t></w:r></w:p></w:comment>
</w:comments>`;

const zip = new JSZip();
zip.file(
  '[Content_Types].xml',
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`
);
zip.file(
  '_rels/.rels',
  `<Relationships xmlns="${P}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
);
zip.file(
  'word/_rels/document.xml.rels',
  `<Relationships xmlns="${P}"><Relationship Id="rIdComments" Type="${R}/comments" Target="comments.xml"/></Relationships>`
);
zip.file('word/document.xml', documentXml);
zip.file('word/comments.xml', commentsXml);

const bytes = await zip.generateAsync({ type: 'nodebuffer' });
fs.writeFileSync(path.join(directory, 'reviewer-filter.docx'), bytes);
