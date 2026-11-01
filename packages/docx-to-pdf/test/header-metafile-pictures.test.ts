/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Metafile pictures in a header export without a host converter: an EMF logo draws on every
// page, a WMF picture watermark draws washed out behind the text, and a metafile that does not
// replay in full is reported, with its cause, instead of leaving its place silently empty.
import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const NS =
  `xmlns:w="${W}" xmlns:r="${R}" xmlns:v="urn:schemas-microsoft-com:vml" ` +
  'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

/** An EMF of `width` × `height` device pixels holding one filled rectangle in `rgb`. */
function emf(width: number, height: number, rgb: readonly [number, number, number]): Uint8Array {
  const records: number[][] = [];
  const colorref = rgb[0] | (rgb[1] << 8) | (rgb[2] << 16);
  // EMR_CREATEBRUSHINDIRECT: handle 1, solid brush.
  records.push([39, 24, 1, 0, colorref, 0]);
  // EMR_SELECTOBJECT, EMR_RECTANGLE, EMR_EOF.
  records.push([37, 12, 1]);
  records.push([43, 24, 0, 0, width, height]);
  records.push([14, 20, 0, 16, 20]);
  const headerSize = 88;
  const total = headerSize + records.reduce((sum, record) => sum + record[1]!, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const header = [
    1,
    headerSize,
    0,
    0,
    width,
    height,
    0,
    0,
    width * 26,
    height * 26,
    0x464d4520,
    0x10000,
    total,
    records.length + 1,
  ];
  header.forEach((value, index) => view.setInt32(index * 4, value, true));
  view.setUint16(56, 2, true);
  // Device 1000 × 1000 px over 260 × 260 mm.
  [0, 0, 0, 1000, 1000, 260, 260].forEach((value, index) =>
    view.setInt32(60 + index * 4, value, true)
  );
  let at = headerSize;
  for (const record of records)
    for (const value of record) {
      view.setInt32(at, value, true);
      at += 4;
    }
  return bytes;
}

/**
 * A placeable WMF of `width` × `height` units at 96 per inch: one filled rectangle in `rgb`,
 * then `extra` brush selections.
 */
function wmf(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
  extra = 0
): Uint8Array {
  const records = [
    { fn: 0x020b, words: [0, 0] },
    { fn: 0x020c, words: [height, width] },
    { fn: 0x02fc, words: [0, rgb[0] | (rgb[1] << 8), rgb[2], 0] },
    { fn: 0x012d, words: [0] },
    { fn: 0x041b, words: [height, width, 0, 0] },
    ...Array.from({ length: extra }, () => ({ fn: 0x012d, words: [0] })),
    { fn: 0, words: [] },
  ];
  const body: number[] = [];
  let largest = 3;
  for (const record of records) {
    const size = 3 + record.words.length;
    largest = Math.max(largest, size);
    body.push(size & 0xffff, size >>> 16, record.fn, ...record.words);
  }
  const header = [1, 9, 0x0300, 0, 0, 1, largest, 0, 0];
  const total = header.length + body.length;
  header[3] = total & 0xffff;
  header[4] = total >>> 16;
  const bytes = new Uint8Array(22 + total * 2);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x9ac6cdd7, true);
  view.setInt16(10, width, true);
  view.setInt16(12, height, true);
  view.setUint16(14, 96, true);
  let checksum = 0;
  for (let offset = 0; offset < 20; offset += 2) checksum ^= view.getUint16(offset, true);
  view.setUint16(20, checksum, true);
  [...header, ...body].forEach((word, index) =>
    view.setUint16(22 + index * 2, word & 0xffff, true)
  );
  return bytes;
}

const LOGO = `<w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="Logo"/>
  <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo"/><pic:cNvPicPr/></pic:nvPicPr>
  <pic:blipFill><a:blip r:embed="rLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
  <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>
  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
  </a:graphicData></a:graphic></wp:inline></w:drawing>`;

const WATERMARK =
  '<w:pict><v:shape id="WordPictureWatermark1" type="#_x0000_t75" ' +
  'style="position:absolute;margin-left:0;margin-top:0;width:200pt;height:100pt;z-index:-251658240;' +
  'mso-position-horizontal:center;mso-position-horizontal-relative:margin;' +
  'mso-position-vertical:center;mso-position-vertical-relative:margin">' +
  '<v:imagedata r:id="rMark" o:title="wm" gain="19661f" blacklevel="22938f"/></v:shape></w:pict>';

function input(logo: Uint8Array, mark: Uint8Array): Uint8Array {
  const page = '<w:p><w:r><w:t>Body text</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>';
  const body =
    page +
    '<w:p><w:r><w:t>Body text</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rHdr"/>' +
    '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" ' +
    'w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="emf" ContentType="image/x-emf"/>' +
        '<Default Extension="wmf" ContentType="image/x-wmf"/>' +
        `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
        `<Override PartName="/word/header1.xml" ContentType="${WML}.header+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rHdr" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/_rels/header1.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rLogo" Type="${R}/image" Target="media/logo.emf"/>` +
        `<Relationship Id="rMark" Type="${R}/image" Target="media/mark.wmf"/></Relationships>`
    ),
    'word/document.xml': strToU8(`<w:document ${NS}><w:body>${body}</w:body></w:document>`),
    'word/header1.xml': strToU8(
      `<w:hdr ${NS}><w:p><w:r>${LOGO}</w:r><w:r>${WATERMARK}</w:r></w:p></w:hdr>`
    ),
    'word/media/logo.emf': logo,
    'word/media/mark.wmf': mark,
  });
}

/** Each page's form XObjects: their content streams, keyed by resource name. */
async function pageForms(bytes: Uint8Array): Promise<string[][]> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const objects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!objects) return [];
    return objects
      .keys()
      .map((key) => pdf.context.lookup(objects.get(key) as PDFRef))
      .filter(
        (object): object is PDFRawStream =>
          object instanceof PDFRawStream &&
          object.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')
      )
      .map((form) => new TextDecoder().decode(decodePDFRawStream(form).decode()));
  });
}

test('an EMF header logo and a washed-out WMF watermark draw on every page', async () => {
  const result = await exportPdf(input(emf(96, 48, [0, 0, 255]), wmf(200, 100, [255, 0, 0])), {
    useSystemFonts: false,
  });
  expect(result.diagnostics).toEqual([]);
  const pages = await pageForms(result.bytes);
  expect(pages).toHaveLength(2);
  for (const forms of pages) {
    const all = forms.join('\n');
    // The logo keeps its colour.
    expect(all).toContain('0 0 1 rg');
    // The watermark's red is washed out: 0.3 * c + 0.805, clamped.
    expect(all).toMatch(/\b1 0\.805\d* 0\.805\d* rg/);
    expect(all).not.toContain('1 0 0 rg');
  }
});

test('a header metafile that does not replay is refused, not dropped', async () => {
  const broken = new Uint8Array(emf(96, 48, [0, 0, 255]));
  // A record size past the end of the file.
  new DataView(broken.buffer).setInt32(92, 0x7fffffff, true);
  const document = input(broken, wmf(200, 100, [255, 0, 0]));
  await expect(exportPdf(document, { useSystemFonts: false })).rejects.toMatchObject({
    code: 'fidelityUnsupported',
  });
  const result = await exportPdf(document, {
    useSystemFonts: false,
    fidelityPolicy: 'best-effort',
  });
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
  expect(codes).toContain('metafile-record');
  expect(codes).not.toContain('metafile-limit');
});

test('a header metafile past the record limit reports the resource bound', async () => {
  // More records than the replay reads.
  const long = wmf(200, 100, [255, 0, 0], 200_000);
  const result = await exportPdf(input(emf(96, 48, [0, 0, 255]), long), {
    useSystemFonts: false,
    fidelityPolicy: 'best-effort',
  });
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
  expect(codes).toContain('metafile-limit');
  expect(codes).not.toContain('metafile-record');
});
