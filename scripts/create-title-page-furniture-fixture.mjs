/**
 * Build a DOCX fixture for per-page header/footer variant resolution.
 *
 * The section sets `w:titlePg` and declares a DEFAULT header and a FIRST-page footer, so the
 * two variants disagree about which pages carry furniture:
 *
 *   - page 1 resolves to the first-page variants. There is no first-page header reference, so
 *     page 1 has no header at all and its body starts at `w:pgMar/@w:top`.
 *   - page 2 resolves to the default variants. There is no default footer reference, so page 2
 *     has no footer, and its body starts below the default header.
 *
 * The header also carries a `PAGE \# 0#` field whose cached result (`07`) is a page number the
 * document no longer has, so painting the cache instead of the computed value is visible.
 *
 * Synthetic throughout: placeholder text only.
 */

import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e/fixtures/title-page-furniture.docx');

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}/>`;

/** Default header: three lines, one of them a `PAGE` field with a stale cached result. */
const HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${W_NS}>
  <w:p><w:r><w:t>Header line one</w:t></w:r></w:p>
  <w:p><w:r><w:t>Header line two</w:t></w:r></w:p>
  <w:p>
    <w:r><w:t xml:space="preserve">Pg. </w:t></w:r>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> PAGE \\# 0# </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:t>07</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:hdr>`;

/** First-page footer: two lines, so its height differs from the header's. */
const FOOTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W_NS}>
  <w:p><w:r><w:t>Footer line one</w:t></w:r></w:p>
  <w:p><w:r><w:t>Footer line two</w:t></w:r></w:p>
</w:ftr>`;

const SECT_PR = `<w:sectPr>
      <w:headerReference w:type="default" r:id="rId7"/>
      <w:footerReference w:type="first" r:id="rId8"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1080" w:right="720" w:bottom="2880" w:left="720" w:header="1080" w:footer="720" w:gutter="0"/>
      <w:cols w:space="708"/>
      <w:titlePg/>
    </w:sectPr>`;

/** Enough body to run past the first page and onto a second. */
const BODY_PARAGRAPHS = Array.from(
  { length: 60 },
  (_unused, index) => `<w:p><w:r><w:t>Body paragraph ${index + 1}</w:t></w:r></w:p>`
).join('\n    ');

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}>
  <w:body>
    ${BODY_PARAGRAPHS}
    ${SECT_PR}
  </w:body>
</w:document>`;

async function main() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/_rels/document.xml.rels', DOC_RELS);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/document.xml', DOCUMENT);
  zip.file('word/header1.xml', HEADER);
  zip.file('word/footer1.xml', FOOTER);

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  fs.writeFileSync(OUT, out);
  console.log('Wrote', path.relative(ROOT, OUT), '(', out.length, 'bytes)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
