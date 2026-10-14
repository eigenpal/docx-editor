/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { formatDefaultsDocx } from './fixture.ts';

// A text watermark paints as filled glyph outlines turned about the page centre, behind the
// body text, with its fill opacity. A washed-out picture keeps its pixels and maps them
// through the image's `Decode` array, the same linear transfer the screen applies.

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:w10="urn:schemas-microsoft-com:office:word"';

const WATERMARK =
  '<w:r><w:pict><v:shape id="PowerPlusWaterMarkObject1" type="#_x0000_t136" ' +
  'style="position:absolute;margin-left:0;margin-top:0;width:412pt;height:206pt;rotation:315;' +
  'z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;' +
  'mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" ' +
  'fillcolor="silver" stroked="f"><v:fill opacity=".5"/>' +
  '<v:textpath style="font-family:&quot;Liberation Sans&quot;;font-size:1pt" string="DRAFT"/>' +
  '<w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>';

function watermarkDocx(): Uint8Array {
  const body =
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans"/></w:rPr>' +
    '<w:t>Body text</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rHdr"/>' +
    '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" ' +
    'w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  return formatDefaultsDocx(body, {
    'word/document.xml': `<w:document ${NS}><w:body>${body}</w:body></w:document>`,
    'word/header1.xml': `<w:hdr ${NS}><w:p>${WATERMARK}</w:p></w:hdr>`,
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '</Types>',
    'word/_rels/document.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
      '</Relationships>',
  });
}

async function firstPageCommands(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPage(0).node.Contents();
  const streams = contents && 'asArray' in contents ? contents.asArray() : [contents];
  return streams
    .map((ref) => pdf.context.lookup(ref as never))
    .map((stream) =>
      stream instanceof PDFRawStream
        ? new TextDecoder().decode(decodePDFRawStream(stream).decode())
        : ''
    )
    .join('\n');
}

test('a text watermark paints as turned, translucent outlines behind the body', async () => {
  const result = await exportPdf(watermarkDocx(), { useSystemFonts: false });
  expect(result.diagnostics.filter((d) => d.code === 'drawing')).toEqual([]);
  const commands = await firstPageCommands(result.bytes);
  const art = commands.indexOf('/TextArtAlpha');
  expect(art).toBeGreaterThanOrEqual(0);
  // Turned 315 degrees clockwise: cos 45, with the y axis flipped into PDF space.
  expect(commands).toMatch(
    /0\.707107 0\.707107 0\.707107 -0\.707107 [-\d.]+ [-\d.]+ cm\n\/TextArtAlpha/
  );
  expect(commands).toContain('0.752941 0.752941 0.752941 rg');
  const body = commands.indexOf('BT');
  expect(body).toBeGreaterThan(art);
  const pdf = await PDFDocument.load(result.bytes);
  const states = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('ExtGState'), PDFDict);
  const name = commands.match(/\/(TextArtAlpha\d+) gs/)![1]!;
  expect(states.lookup(PDFName.of(name), PDFDict).get(PDFName.of('ca'))!.toString()).toBe('0.5');
});

test('washout brightness and contrast encode as the image Decode array', async () => {
  const source = new Uint8Array(
    readFileSync(new URL('../../../e2e/fixtures/images-crop.docx', import.meta.url))
  );
  const files = unzipSync(source);
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace(
      '</a:blip>',
      '<a:lum bright="70000" contrast="-70000"/></a:blip>'
    )
  );
  const result = await exportPdf(zipSync(files), { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const images = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  const [key] = images.keys();
  const image = pdf.context.lookup(images.get(key!) as PDFRef) as PDFRawStream;
  const decode = image.dict
    .lookup(PDFName.of('Decode'), PDFArray)
    .asArray()
    .map((value) => Number(value.toString()));
  // out = 0.3 * in + 0.805, per channel: white stays white, black lifts to a light grey.
  expect(decode.length % 2).toBe(0);
  for (let i = 0; i < decode.length; i += 2) {
    expect(decode[i]).toBeCloseTo(0.805, 6);
    expect(decode[i + 1]).toBeCloseTo(1.105, 6);
  }
});
