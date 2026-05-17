/**
 * Build a minimal DOCX fixture exercising SDT content preservation in
 * paged render. The header contains:
 *
 *   - A `<w:sdt>` wrapping a plain `<w:r><w:t>SDT-PLAIN</w:t></w:r>`
 *     (renders correctly even on `main` since the SDT branch already
 *     handled text).
 *   - A `<w:sdt>` wrapping a `<w:fldSimple>` with cached display text
 *     "SDT-FIELD" (vanishes on `main` because the parser filtered the
 *     simpleField out of InlineSdt.content; renders after the fix).
 *
 * Body has a single paragraph so the document fits on page 1.
 */

import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e/fixtures/sdt-header-content.docx');

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
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}/>`;

const HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${W_NS}>
  <w:p>
    <w:sdt>
      <w:sdtPr><w:alias w:val="plain-control"/></w:sdtPr>
      <w:sdtContent>
        <w:r><w:t>SDT-PLAIN</w:t></w:r>
      </w:sdtContent>
    </w:sdt>
  </w:p>
  <w:p>
    <w:sdt>
      <w:sdtPr><w:alias w:val="title-control"/></w:sdtPr>
      <w:sdtContent>
        <w:fldSimple w:instr="TITLE \\* MERGEFORMAT">
          <w:r><w:t>SDT-FIELD</w:t></w:r>
        </w:fldSimple>
      </w:sdtContent>
    </w:sdt>
  </w:p>
</w:hdr>`;

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}>
  <w:body>
    <w:p><w:r><w:t>Body content</w:t></w:r></w:p>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId8"/>
      <w:type w:val="nextPage"/>
      <w:pgSz w:w="12240" w:h="15840" w:orient="portrait"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:num="1" w:sep="0" w:space="720" w:equalWidth="1"/>
    </w:sectPr>
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
