/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A WMF picture draws as a vector form in the picture's place.
import { expect, test } from 'bun:test';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

/** One WMF record: function number and 16-bit parameter words. */
interface WmfRecord {
  readonly fn: number;
  readonly words: readonly number[];
}

/** A placeable WMF spanning `width` × `height` logical units at 96 units per inch. */
function wmf(width: number, height: number, records: readonly WmfRecord[]): Uint8Array {
  const body: number[] = [];
  const all = [...records, { fn: 0, words: [] }];
  let largest = 3;
  for (const record of all) {
    const size = 3 + record.words.length;
    largest = Math.max(largest, size);
    body.push(size & 0xffff, size >>> 16, record.fn, ...record.words);
  }
  const header = [1, 9, 0x0300, 0, 0, 0, 0, 0, 0];
  const total = header.length + body.length;
  header[3] = total & 0xffff;
  header[4] = total >>> 16;
  header[5] = 1;
  header[6] = largest & 0xffff;
  header[7] = largest >>> 16;
  const bytes = new Uint8Array(22 + total * 2);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x9ac6cdd7, true);
  view.setInt16(6, 0, true);
  view.setInt16(8, 0, true);
  view.setInt16(10, width, true);
  view.setInt16(12, height, true);
  view.setUint16(14, 96, true);
  let checksum = 0;
  for (let at = 0; at < 20; at += 2) checksum ^= view.getUint16(at, true);
  view.setUint16(20, checksum, true);
  [...header, ...body].forEach((word, index) =>
    view.setUint16(22 + index * 2, word & 0xffff, true)
  );
  return bytes;
}

/** COLORREF as two words. */
function colorWords(r: number, g: number, b: number): [number, number] {
  return [r | (g << 8), b];
}

const TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="wmf" ContentType="image/x-wmf"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';

function input(metafile: Uint8Array): Uint8Array {
  const drawing = `<w:drawing
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
    <wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Picture"/>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
    <pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p"/><pic:cNvPicPr/></pic:nvPicPr>
    <pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
    <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
    </a:graphicData></a:graphic></wp:inline></w:drawing>`;
  return docx(`<w:p><w:r>${drawing}</w:r></w:p>`, {
    '[Content_Types].xml': TYPES,
    'word/_rels/document.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.wmf"/></Relationships>',
    'word/media/image1.wmf': metafile,
  });
}

test('a WMF picture paints as a vector form XObject', async () => {
  const metafile = wmf(200, 100, [
    { fn: 0x020b, words: [0, 0] },
    { fn: 0x020c, words: [100, 200] },
    { fn: 0x02fc, words: [0, ...colorWords(0, 0, 255), 0] },
    { fn: 0x012d, words: [0] },
    { fn: 0x0324, words: [3, 0, 0, 200, 0, 100, 100] },
  ]);
  const result = await exportPdf(input(metafile), { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const objects = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  const name = objects.keys().find((key) => key.asString().startsWith('/Fm'));
  expect(name).toBeTruthy();
  const form = pdf.context.lookup(objects.get(name!) as PDFRef) as PDFRawStream;
  expect(form.dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('Form'));
  const content = new TextDecoder().decode(decodePDFRawStream(form).decode());
  // The blue triangle, filled in canvas pixels on the flipped unit square.
  expect(content).toContain('0 0 1 rg');
  expect(content).toMatch(/ m [^\n]* l [^\n]* l [^\n]*h f\*? Q/);
});
