// Regenerates e2e/fixtures/embedded-font.docx — a minimal DOCX that embeds a
// font under a distinctive family name ("Embedded Demo Sans") that is NOT
// installed on any system. The only way the text renders correctly, or the
// name appears in the picker, is if the editor de-obfuscates and loads the
// embedded `.odttf`. The embedded bytes are Roboto (Apache-2.0).
//
//   node e2e/fixtures/build-embedded-font-fixture.mjs <path-to-font.ttf>
//
// Default font path: /tmp/test-roboto.ttf (see PR notes for how it's fetched).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';

const FONT_PATH = process.argv[2] ?? '/tmp/test-roboto.ttf';
const FAMILY = 'Embedded Demo Sans';
const GUID = '{001B70DC-AA60-4AD5-90EC-18A0948E1EAE}';

// ECMA-376 §2.8.1: XOR the first 32 bytes with the 16 GUID bytes in REVERSED
// order (bytes 0-15, then 16-31). Symmetric, so this both obfuscates and not.
function obfuscate(bytes, guid) {
  const hex = guid.replace(/[^0-9a-fA-F]/g, '');
  const key = [];
  for (let i = 0; i < 16; i++) key.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  key.reverse();
  const out = Uint8Array.from(bytes);
  for (let i = 0; i < Math.min(32, out.length); i++) out[i] ^= key[i % 16];
  return out;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
</Types>`;

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:rPr><w:rFonts w:ascii="${FAMILY}" w:hAnsi="${FAMILY}"/><w:sz w:val="44"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="${FAMILY}" w:hAnsi="${FAMILY}"/><w:sz w:val="44"/></w:rPr><w:t>Embedded font: the quick brown fox jumps over the lazy dog.</w:t></w:r></w:p>
    <w:p><w:r><w:t>This paragraph uses the document default font.</w:t></w:r></w:p>
  </w:body>
</w:document>`;

const FONT_TABLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
         xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:font w:name="${FAMILY}">
    <w:family w:val="swiss"/>
    <w:pitch w:val="variable"/>
    <w:embedRegular r:id="rId1" w:fontKey="${GUID}" w:subsetted="false"/>
  </w:font>
</w:fonts>`;

const FONT_TABLE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font1.odttf"/>
</Relationships>`;

const fontBytes = readFileSync(FONT_PATH);
const obfuscated = obfuscate(fontBytes, GUID);

const zip = new JSZip();
zip.file('[Content_Types].xml', CONTENT_TYPES);
zip.file('_rels/.rels', PACKAGE_RELS);
zip.file('word/document.xml', DOCUMENT_XML);
zip.file('word/fontTable.xml', FONT_TABLE_XML);
zip.file('word/_rels/fontTable.xml.rels', FONT_TABLE_RELS);
zip.file('word/fonts/font1.odttf', obfuscated);

const out = await zip.generateAsync({ type: 'nodebuffer' });
const dest = join(dirname(fileURLToPath(import.meta.url)), 'embedded-font.docx');
writeFileSync(dest, out);
console.log(`Wrote ${dest} (${out.length} bytes), embedding "${FAMILY}" from ${FONT_PATH}`);
