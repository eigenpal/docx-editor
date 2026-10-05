/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { formatDefaultsDocx } from './fixture.ts';

// Header and footer content is one layer under the main document. A header or footer drawing
// set in front of text covers the header or footer text only: it paints under the body's
// behind-text drawings, the body text and the body's in-front drawings.

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
const EMU = 12700;

/** A filled page-anchored rectangle; a high `relativeHeight` must not lift it over the body. */
function rect(id: number, y: number, fill: string, behind: boolean, relativeHeight: number) {
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    `relativeHeight="${relativeHeight}" behindDoc="${behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${72 * EMU}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${y * EMU}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${300 * EMU}" cy="${170 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:wrapNone/><wp:docPr id="${id}" name="Shape ${id}"/><a:graphic>` +
    '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp>' +
    `<wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${300 * EMU}" cy="${170 * EMU}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` +
    '<a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>' +
    '</wp:anchor></w:drawing></w:r>'
  );
}

const run = (text: string, color: string) =>
  `<w:r><w:rPr><w:color w:val="${color}"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

// Fill colors, as the writer prints them.
const HEADER_BEHIND = '0.2 0.8 0.2 rg';
const HEADER_TEXT = '0 1 0 rg';
const HEADER_FRONT = '1 0.8 0 rg';
const FOOTER_FRONT = '0.8 0.4 0.8 rg';
const BODY_BEHIND = '0.2 0.4 1 rg';
const BODY_TEXT = '1 0 0 rg';
const BODY_FRONT = '0.4 0.2 1 rg';

function layeredDocx(): Uint8Array {
  const header =
    `<w:hdr ${NS}><w:p>${rect(1, 20, '33CC33', true, 900)}${rect(2, 30, 'FFCC00', false, 950)}` +
    `${run('Header line', '00FF00')}</w:p></w:hdr>`;
  const footer = `<w:ftr ${NS}><w:p>${rect(3, 560, 'CC66CC', false, 960)}${run('Footer line', '000000')}</w:p></w:ftr>`;
  const body =
    `<w:p>${rect(4, 100, '3366FF', true, 10)}${rect(5, 260, '6633FF', false, 20)}` +
    `${run('Body text '.repeat(400), 'FF0000')}</w:p>` +
    '<w:sectPr><w:headerReference w:type="default" r:id="rHdr"/>' +
    '<w:footerReference w:type="default" r:id="rFtr"/>' +
    '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" ' +
    'w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  return formatDefaultsDocx(body, {
    'word/document.xml': `<w:document ${NS}><w:body>${body}</w:body></w:document>`,
    'word/header1.xml': header,
    'word/footer1.xml': footer,
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      '</Types>',
    'word/_rels/document.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
      '<Relationship Id="rFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
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

test('header and footer ink paints under every layer of the body', async () => {
  const result = await exportPdf(layeredDocx(), { useSystemFonts: false });
  const commands = await firstPageCommands(result.bytes);
  const at = (fill: string) => {
    const index = commands.indexOf(fill);
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
  };
  // Inside the header, `behindDoc` still orders the drawings against the header text.
  expect(at(HEADER_BEHIND)).toBeLessThan(at(HEADER_TEXT));
  expect(at(HEADER_TEXT)).toBeLessThan(at(HEADER_FRONT));
  // In-front header and footer drawings stay under the body's behind-text drawing.
  expect(at(HEADER_FRONT)).toBeLessThan(at(BODY_BEHIND));
  expect(at(FOOTER_FRONT)).toBeLessThan(at(BODY_BEHIND));
  expect(at(BODY_BEHIND)).toBeLessThan(at(BODY_TEXT));
  expect(at(BODY_TEXT)).toBeLessThan(at(BODY_FRONT));
});

test('a back page border paints under the header layer, a front one over everything', async () => {
  for (const zOrder of ['back', 'front'] as const) {
    const files = layeredDocx();
    const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate');
    const unzipped = unzipSync(files);
    unzipped['word/document.xml'] = strToU8(
      strFromU8(unzipped['word/document.xml']!).replace(
        '<w:pgMar',
        `<w:pgBorders w:offsetFrom="page" w:zOrder="${zOrder}"><w:top w:val="single" w:sz="48" ` +
          'w:space="24" w:color="00FFFF"/></w:pgBorders><w:pgMar'
      )
    );
    const commands = await firstPageCommands(
      (await exportPdf(zipSync(unzipped), { useSystemFonts: false })).bytes
    );
    const border = commands.indexOf('0 1 1 rg');
    expect(border).toBeGreaterThanOrEqual(0);
    if (zOrder === 'back') expect(border).toBeLessThan(commands.indexOf(HEADER_BEHIND));
    else expect(border).toBeGreaterThan(commands.indexOf(BODY_FRONT));
  }
});
