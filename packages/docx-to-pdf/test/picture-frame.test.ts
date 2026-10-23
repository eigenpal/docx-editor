/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A picture's frame: its shadow before the image, its outline after it.
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { formatDefaultsDocx as docx } from './fixture.ts';

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);

function input(spPrTail: string): Uint8Array {
  const drawing = `<w:drawing
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
    xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Picture"/>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
    <pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="p"/><pic:cNvPicPr/></pic:nvPicPr>
    <pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
    <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${spPrTail}</pic:spPr></pic:pic>
    </a:graphicData></a:graphic></wp:inline></w:drawing>`;
  return docx(`<w:p><w:r>${drawing}</w:r></w:p>`, {
    'word/_rels/document.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
    'word/media/image1.png': PNG_1X1,
  });
}

async function commandsOf(bytes: Uint8Array): Promise<string> {
  const result = await exportPdf(bytes, { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  return pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, value]) =>
      value instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(value).decode())]
        : []
    )
    .filter((text) => text.includes(' Do'))
    .join('\n');
}

test('soft edges and a reflection paint through soft masks', async () => {
  const commands = await commandsOf(
    input(
      '<a:effectLst><a:softEdge rad="76200"/>' +
        '<a:reflection stA="50000" endPos="40000" dir="5400000" sy="-100000" algn="bl"/>' +
        '</a:effectLst>'
    )
  );
  const draws = commands.match(/\/PictureMask\d+ gs[^\n]*?\/Im\d+ Do/g) ?? [];
  // The picture through its soft edge, then its mirror image through the fade.
  expect(draws).toHaveLength(2);
  expect(draws[1]).toMatch(/ -\d+(\.\d+)? [\d.-]+ [\d.-]+ cm/);
});

test('a picture paints its shadow before the image and its outline after it', async () => {
  const commands = await commandsOf(
    input(
      '<a:ln w="25400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>' +
        '<a:effectLst><a:outerShdw blurRad="0" dist="25400" dir="2700000" algn="tl">' +
        '<a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr></a:outerShdw></a:effectLst>'
    )
  );
  const shadow = commands.indexOf('/ShapeShadow');
  const image = commands.search(/\/Im\d+ Do/);
  const outline = commands.indexOf('1 0 0 RG');
  expect(shadow).toBeGreaterThan(-1);
  expect(image).toBeGreaterThan(shadow);
  expect(outline).toBeGreaterThan(image);
  // A round join for a picture outline that names none.
  expect(commands.slice(outline - 200, outline)).toContain('1 j');
});
