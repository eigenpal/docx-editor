/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A header picture watermark authored as VML: a picture frame shape whose template omits its
// formulas, centered on the margin box behind the text. Every page that shows the header
// draws the picture before its body text, at the same box.
import { describe, expect, test } from 'bun:test';
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

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:w10="urn:schemas-microsoft-com:office:word"';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);
// US Letter with 72 pt margins: the margin box centre is (306, 396).
const PAGE_HEIGHT = 792;

function header(width: number, height: number, imageData: string): string {
  return (
    `<w:hdr ${NS}><w:p><w:r><w:pict>` +
    '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" ' +
    'path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/>' +
    '<v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/>' +
    '<o:lock v:ext="edit" aspectratio="t"/></v:shapetype>' +
    '<v:shape id="WordPictureWatermark1" type="#_x0000_t75" ' +
    `style="position:absolute;margin-left:0;margin-top:0;width:${width}pt;height:${height}pt;` +
    'z-index:-251658240;mso-position-horizontal:center;mso-position-horizontal-relative:margin;' +
    'mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f">' +
    `<v:imagedata r:id="rImg" o:title="wm"${imageData}/>` +
    '<w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r></w:p></w:hdr>'
  );
}

function watermarkDocx(width: number, height: number, imageData = ''): Uint8Array {
  const body =
    '<w:p><w:r><w:t>Body text</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>' +
    '<w:p><w:r><w:t>Body text</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rHdr"/>' +
    '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" ' +
    'w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  return formatDefaultsDocx(body, {
    'word/document.xml': `<w:document ${NS}><w:body>${body}</w:body></w:document>`,
    'word/header1.xml': header(width, height, imageData),
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '</Types>',
    'word/_rels/document.xml.rels': `<Relationships xmlns="${RELS}"><Relationship Id="rHdr" Type="${R}/header" Target="header1.xml"/></Relationships>`,
    'word/_rels/header1.xml.rels': `<Relationships xmlns="${RELS}"><Relationship Id="rImg" Type="${R}/image" Target="media/wm.png"/></Relationships>`,
    'word/media/wm.png': PNG,
  });
}

async function pageCommands(pdf: PDFDocument, index: number): Promise<string> {
  const contents = pdf.getPage(index).node.Contents();
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

const NUMBER = '(-?[\\d.]+)';
const DRAW = new RegExp(
  `${NUMBER} 0 0 ${NUMBER} ${NUMBER} ${NUMBER} cm /(Im\\d+) Do`.replaceAll(' ', '\\s+')
);

describe('an authored header picture watermark exports', () => {
  test.each([
    [200, 100],
    [612, 792],
  ])('a %d by %d pt picture centered on the margin box on every page', async (width, height) => {
    const result = await exportPdf(watermarkDocx(width, height), { useSystemFonts: false });
    expect(result.diagnostics.map((d) => d.code)).not.toContain('core-legacy-drawing');
    expect(result.diagnostics).toEqual([]);
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBe(2);
    for (let index = 0; index < 2; index += 1) {
      const commands = await pageCommands(pdf, index);
      const draw = commands.match(DRAW);
      expect(draw).not.toBeNull();
      const [w, h, x, y] = draw!.slice(1, 5).map(Number) as [number, number, number, number];
      expect(w).toBeCloseTo(width, 1);
      expect(h).toBeCloseTo(height, 1);
      expect(x + w / 2).toBeCloseTo(306, 1);
      // PDF space runs up from the sheet bottom.
      expect(PAGE_HEIGHT - (y + h / 2)).toBeCloseTo(396, 1);
      // Behind the text: the picture draws before the body.
      expect(draw!.index!).toBeLessThan(commands.indexOf('BT'));
    }
  });

  test('gain and black level wash the picture out through its Decode array', async () => {
    const result = await exportPdf(watermarkDocx(200, 100, ' gain="19661f" blacklevel="22938f"'), {
      useSystemFonts: false,
    });
    expect(result.diagnostics).toEqual([]);
    const pdf = await PDFDocument.load(result.bytes);
    const draw = (await pageCommands(pdf, 0)).match(DRAW)!;
    const images = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    const image = pdf.context.lookup(images.get(PDFName.of(draw[5]!)) as PDFRef) as PDFRawStream;
    const decode = image.dict
      .lookup(PDFName.of('Decode'), PDFArray)
      .asArray()
      .map((value) => Number(value.toString()));
    // A washed-out picture lifts black towards white and keeps white white.
    expect(decode.length % 2).toBe(0);
    for (let i = 0; i < decode.length; i += 2) {
      expect(decode[i]!).toBeGreaterThan(0.5);
      expect(decode[i + 1]!).toBeGreaterThanOrEqual(1);
    }
  });
});
