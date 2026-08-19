import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_EXTENDED_REL =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

const bytes = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
      '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.ms-word.commentsExtended+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:commentRangeStart w:id="7"/>` +
      '<w:r><w:t>hello</w:t></w:r><w:commentRangeEnd w:id="7"/>' +
      '<w:r><w:commentReference w:id="7"/></w:r></w:p></w:body></w:document>'
  ),
  'word/comments.xml': strToU8(
    `<w:comments xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
      '<w:comment w:id="7" w:author="Ada" w14:paraId="A0000001"><w:p><w:r><w:t>Check this.</w:t></w:r></w:p></w:comment>' +
      '</w:comments>'
  ),
  'word/commentsExtended.xml': strToU8(
    `<w15:commentsEx xmlns:w15="${W15}"><w15:commentEx w15:paraId="A0000001" w15:done="0"/></w15:commentsEx>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/>` +
      `<Relationship Id="rIdCE" Type="${COMMENTS_EXTENDED_REL}" Target="commentsExtended.xml"/>` +
      '</Relationships>'
  ),
});

writeFileSync(resolve(import.meta.dirname, '../../../e2e/fixtures/review-nav-demo.docx'), bytes);
