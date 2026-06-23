/**
 * Generate e2e/fixtures/header-vml-emf.docx — a generated fixture for the
 * "first-page header with a VML→EMF letterhead image" code path.
 *
 * Structure mirrors what Word emits for an OLE picture in a header:
 *   word/header1.xml         <w:hdr><w:p><w:r><w:object><v:shape><v:imagedata r:id="rId1"/>
 *   word/_rels/header1.xml.rels  rId1 → media/image1.emf
 *   word/media/image1.emf    minimal EMF header wrapping a small PNG bitmap
 *   document.xml             titlePg + headerReference type="first" rId6
 *
 * The EMF is intentionally minimal: a valid-looking EMR_HEADER record
 * followed by the PNG bytes followed by an EMR_EOF record. It is NOT a
 * fully spec-compliant metafile — it only needs to (a) carry the .emf
 * extension so the parser tags it `image/x-emf`, and (b) contain a
 * complete PNG stream so `extractMetafileRaster` can recover it. The
 * original bytes round-trip via `verbatimXml`, so Word never has to
 * read this EMF.
 */
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// 1. Build a tiny PNG (96×80 solid teal) without external assets.
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function makePng(w, h, [r, g, b]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolor
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// 2. Wrap the PNG in a minimal EMF: EMR_HEADER + PNG payload + EMR_EOF.
// ---------------------------------------------------------------------------
function wrapAsEmf(png) {
  const header = Buffer.alloc(88);
  header.writeUInt32LE(1, 0); // EMR_HEADER
  header.writeUInt32LE(88, 4); // record size
  // rclBounds / rclFrame left as zeros; signature " EMF"
  header.writeUInt32LE(0x464d4520, 40); // ' EMF'
  header.writeUInt32LE(0x00010000, 44); // version
  // bytes/records filled in below
  const eof = Buffer.alloc(20);
  eof.writeUInt32LE(14, 0); // EMR_EOF
  eof.writeUInt32LE(20, 4);
  eof.writeUInt32LE(0, 8); // nPalEntries
  eof.writeUInt32LE(16, 12); // offPalEntries
  eof.writeUInt32LE(20, 16); // size again
  const total = header.length + png.length + eof.length;
  header.writeUInt32LE(total, 48); // file size
  header.writeUInt32LE(2, 52); // record count (header + eof; PNG is opaque payload)
  return Buffer.concat([header, png, eof]);
}

const png = makePng(96, 80, [0x18, 0x80, 0x60]);
const emf = wrapAsEmf(png);

// ---------------------------------------------------------------------------
// 3. OOXML parts.
// ---------------------------------------------------------------------------
const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" ' +
  'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:w10="urn:schemas-microsoft-com:office:word"';

const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:object w:dxaOrig="1440" w:dyaOrig="1440"><v:shape id="_x0000_s1026" type="#_x0000_t75" style="width:72pt;height:60pt"><v:imagedata r:id="rId1" o:title="fixture-logo"/></v:shape><o:OLEObject Type="Embed" ProgID="Word.Picture.8" ShapeID="_x0000_s1026" DrawAspect="Content" ObjectID="_1000000001" r:id="rId2"/></w:object></w:r><w:r><w:t xml:space="preserve">FIXTURE LETTERHEAD</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:smartTag w:uri="urn:schemas-microsoft-com:office:smarttags" w:element="City"><w:r><w:t>SMARTTAG-CITY</w:t></w:r></w:smartTag><w:r><w:t xml:space="preserve">, STATE</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p></w:hdr>`;

const headerRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.emf"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/></Relationships>`;

const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Fixture footer</w:t></w:r></w:p></w:ftr>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Body line one</w:t></w:r></w:p><w:p><w:r><w:t>Body line two with some longer content so the page has visible flow below the header.</w:t></w:r></w:p><w:sectPr><w:footerReference w:type="default" r:id="rId5"/><w:headerReference w:type="first" r:id="rId6"/><w:titlePg/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/></w:style></w:styles>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="emf" ContentType="image/x-emf"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;

const pkgRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

// ---------------------------------------------------------------------------
// 4. Assemble the package.
// ---------------------------------------------------------------------------
const zip = new JSZip();
zip.file('[Content_Types].xml', contentTypes);
zip.file('_rels/.rels', pkgRels);
zip.file('word/document.xml', documentXml);
zip.file('word/_rels/document.xml.rels', documentRels);
zip.file('word/styles.xml', stylesXml);
zip.file('word/header1.xml', headerXml);
zip.file('word/_rels/header1.xml.rels', headerRels);
zip.file('word/footer1.xml', footerXml);
zip.file('word/media/image1.emf', emf);
zip.file('word/embeddings/oleObject1.bin', Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));

const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync('e2e/fixtures/header-vml-emf.docx', out);
console.log(`wrote e2e/fixtures/header-vml-emf.docx (${out.length} bytes, EMF ${emf.length}b wrapping PNG ${png.length}b)`);
