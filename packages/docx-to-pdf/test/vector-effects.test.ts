/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Gradient fills paint as clipped shadings and outer shadows as offset translucent copies.
import { expect, test } from 'bun:test';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

function input(paint: string) {
  return docx(`<w:p><w:r><w:drawing
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Shape"/>
    <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm>
    <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${paint}</wps:spPr></wps:wsp>
    </a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
}

async function commandsOf(paint: string) {
  const result = await exportPdf(input(paint), { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const commands = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, value]) =>
      value instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(value).decode())]
        : []
    )
    .filter((text) => text.includes('ShapeAlpha'))
    .join('\n');
  return { pdf, commands };
}

test('a linear gradient fills inside the shape clip with an axial shading', async () => {
  const { pdf, commands } = await commandsOf(
    '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>' +
      '<a:gs pos="50000"><a:srgbClr val="00FF00"/></a:gs>' +
      '<a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst>' +
      '<a:lin ang="0" scaled="0"/></a:gradFill>'
  );
  expect(commands).toMatch(/W\* n [^\n]* cm \/ShapeShade\d+ sh Q/);
  const shadings = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Shading'), PDFDict);
  const [name] = shadings.keys();
  const shading = shadings.lookup(name!, PDFDict);
  expect(shading.get(PDFName.of('ShadingType'))!.toString()).toBe('2');
  // Three stops stitch two exponential segments.
  const fn = shading.lookup(PDFName.of('Function'), PDFDict);
  expect(fn.get(PDFName.of('FunctionType'))!.toString()).toBe('3');
});

test('an outer shadow paints offset translucent copies before the shape', async () => {
  const { commands } = await commandsOf(
    '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>' +
      '<a:effectLst><a:outerShdw blurRad="38100" dist="25400" dir="5400000">' +
      '<a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst>'
  );
  const shadow = commands.indexOf('/ShapeShadow');
  expect(shadow).toBeGreaterThan(-1);
  // The shadow block closes before the shape's own fill.
  const shadowEnd = commands.indexOf('\nQ', shadow);
  expect(commands.indexOf('\nf*', shadowEnd)).toBeGreaterThan(shadowEnd);
  // Downward offset of 2 pt, in the user space of the shape (y grows downward there).
  expect(commands).toContain('1 0 0 1 0 2 cm');
});

test('a dashed outline sets a dash pattern scaled by the line width', async () => {
  const { commands } = await commandsOf(
    '<a:ln w="25400"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill>' +
      '<a:prstDash val="sysDash"/></a:ln>'
  );
  // A 2 pt line: three widths of dash, one of gap.
  expect(commands).toContain('[6 2] 0 d');
});

test('a pattern fill paints with a tiling pattern of one-point cells', async () => {
  const { pdf, commands } = await commandsOf(
    '<a:pattFill prst="dnDiag"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>' +
      '<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>'
  );
  expect(commands).toMatch(/\/Pattern cs \/ShapePattern\d+ scn/);
  const patterns = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('Pattern'), PDFDict);
  const [name] = patterns.keys();
  const pattern = pdf.context.lookup(patterns.get(name!) as never) as PDFRawStream;
  expect(pattern.dict.get(PDFName.of('XStep'))?.toString()).toBe('8');
  const tile = new TextDecoder().decode(decodePDFRawStream(pattern).decode());
  // The top-left cell of a downward diagonal sits in the top row of pattern space.
  expect(tile).toContain('1 0 0 rg');
  expect(tile).toContain('0 7 1 1 re');
});
