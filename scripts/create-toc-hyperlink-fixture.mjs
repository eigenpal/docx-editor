/**
 * Build a minimal DOCX fixture exercising tab + non-text content preservation
 * inside a `<w:hyperlink>`. The body has one TOC-style paragraph:
 *
 *   <w:p pStyle="TOC1">
 *     <w:hyperlink anchor="_Toc1">
 *       <w:r><w:t>1</w:t></w:r>
 *       <w:r><w:tab/></w:r>           <-- dropped on `main`
 *       <w:r><w:t>Introduction</w:t></w:r>
 *       <w:r><w:tab/></w:r>           <-- dropped on `main`
 *       <w:r><w:t>5</w:t></w:r>
 *     </w:hyperlink>
 *   </w:p>
 *
 * TOC1 paragraph style defines a right-aligned dot-leader tab at 9628 twips,
 * matching how Word emits a real Table of Contents.
 */

import JSZip from 'jszip';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e/fixtures/toc-hyperlink-tabs.docx');

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}>
  <w:style w:type="paragraph" w:styleId="TOC1">
    <w:name w:val="toc 1"/>
    <w:pPr>
      <w:tabs>
        <w:tab w:val="left" w:pos="567"/>
        <w:tab w:val="right" w:leader="dot" w:pos="9628"/>
      </w:tabs>
    </w:pPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr>
      <w:color w:val="0000FF"/>
      <w:u w:val="single"/>
    </w:rPr>
  </w:style>
</w:styles>`;

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}>
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="TOC1"/></w:pPr>
      <w:hyperlink w:anchor="_Toc1">
        <w:r>
          <w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>
          <w:t>1</w:t>
        </w:r>
        <w:r><w:tab/></w:r>
        <w:r>
          <w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>
          <w:t>Introduction</w:t>
        </w:r>
        <w:r><w:tab/></w:r>
        <w:r><w:t>5</w:t></w:r>
      </w:hyperlink>
    </w:p>
    <w:sectPr>
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
