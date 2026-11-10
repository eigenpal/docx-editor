import { strToU8, zipSync } from 'fflate';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
export function commentEditFixture(withRevision = false) {
  return Array.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${R}"><Relationship Id="rId1" Type="${office}officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${R}"><Relationship Id="c" Type="${office}comments" Target="comments.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:commentRangeStart w:id="1"/><w:r><w:t>Review this paragraph.</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p><w:p><w:commentRangeStart w:id="2"/><w:r><w:t>Another author's paragraph.</w:t></w:r><w:commentRangeEnd w:id="2"/><w:r><w:commentReference w:id="2"/></w:r></w:p></w:body></w:document>`
      ),
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}"><w:comment w:id="1" w:author="Demo Reviewer"><w:p>${withRevision ? '<w:ins w:id="3" w:author="Demo Reviewer"><w:r><w:t>Original comment.</w:t></w:r></w:ins>' : '<w:r><w:t>Original comment.</w:t></w:r>'}</w:p></w:comment><w:comment w:id="2" w:author="Another Reviewer"><w:p><w:r><w:t>Other comment.</w:t></w:r></w:p></w:comment></w:comments>`
      ),
    })
  );
}
