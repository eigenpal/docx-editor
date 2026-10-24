/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { formatDefaultsDocx } from './fixture.ts';

// WordArt on a text path paints as the vector components the text art layout draws: the
// extruded walls in shades of the extrusion colour, then the front face with its gradient.

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';

const ART =
  '<w:r><w:pict><v:shapetype id="_x0000_t138" coordsize="21600,21600" o:spt="138" ' +
  'adj="10800" path="m0@0l10800,,21600@0m,21600r10800,l21600,21600e"><v:formulas>' +
  '<v:f eqn="val #0"/><v:f eqn="prod #0 1 2"/><v:f eqn="sum @1 10800 0"/>' +
  '<v:f eqn="sum 21600 0 @1"/></v:formulas><v:path textpathok="t"/>' +
  '<v:textpath on="t" fitshape="t"/></v:shapetype>' +
  '<v:shape id="art" type="#_x0000_t138" style="width:300pt;height:50pt" fillcolor="#ffc">' +
  '<v:fill color2="#f99" focus="100%" type="gradient"/>' +
  '<o:extrusion v:ext="view" backdepth="18pt" color="#06c" on="t" viewpoint="-34.72222mm"/>' +
  '<v:textpath style="font-family:&quot;Liberation Sans&quot;" trim="t" string="TITLE"/>' +
  '</v:shape></w:pict></w:r>';

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

test('extruded WordArt on a text path paints lit walls under a gradient front face', async () => {
  const body = `<w:p>${ART}</w:p>`;
  const result = await exportPdf(
    formatDefaultsDocx(body, {
      'word/document.xml': `<w:document ${NS}><w:body>${body}</w:body></w:document>`,
    }),
    { useSystemFonts: false }
  );
  expect(result.diagnostics.filter((d) => d.code === 'drawing')).toEqual([]);
  const commands = await firstPageCommands(result.bytes);
  // Walls fill by the nonzero rule in shades of blue; the front face fills with a shading.
  expect(commands).toMatch(/0 0\.\d+ 0\.\d+ rg/);
  expect(commands).toMatch(/\nB\n/);
  expect(commands).toMatch(/\/ShapeShade\d+ sh/);
  expect(commands.lastIndexOf(' sh')).toBeGreaterThan(commands.indexOf('\nB\n'));
});
