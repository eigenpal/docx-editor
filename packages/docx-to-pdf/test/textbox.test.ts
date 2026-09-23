/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

const FAMILY = 'DejaVu Sans';
const bytes = new Uint8Array(
  readFileSync(
    new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
  )
);
const source = createFontSource(bytes, { family: FAMILY, weight: 400, style: 'normal' });
if ('failure' in source) throw new Error(JSON.stringify(source.failure));
const fontSource = source.source;

const NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
  ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
  ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

/** A page-anchored 2in x 0.5in text box at (1in, 1in) carrying `content`. */
function textbox(content: string, behind: boolean, shape = ''): string {
  return (
    `<w:drawing ${NS}><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0"` +
    ` relativeHeight="1" behindDoc="${behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1828800" cy="457200"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="1" name="TB"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm>' +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${shape}</wps:spPr>` +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/>' +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>'
  );
}

async function exported(body: string) {
  const result = await exportPdf(docx(body), {
    useSystemFonts: false,
    fonts: { sources: [fontSource], defaultFont: { family: FAMILY, sizeHalfPoints: 22 } },
  });
  const parsed = await PDFDocument.load(result.bytes);
  const stream = parsed.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .filter((s) => s.includes(' Tm '))
    .join('\n');
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    return {
      result,
      stream,
      text: content.items.map((item) => ('str' in item ? item.str : '')).join(''),
    };
  } finally {
    await pdf.destroy();
  }
}

test('a textbox paints its fill, then its clipped text, at its place in the drawing order', async () => {
  const fill = '<a:solidFill><a:srgbClr val="2F1D79"/></a:solidFill>';
  const { result, stream, text } = await exported(
    `<w:p><w:r>${textbox(paragraph('Boxed'), false, fill)}</w:r></w:p>${paragraph('Body')}`
  );
  expect(
    result.diagnostics.filter(
      (entry) => entry.code !== 'incomplete-font' || entry.severity !== 'information'
    )
  ).toEqual([]);
  expect(text).toContain('Boxed');
  expect(text).toContain('Body');
  // 2F1D79 as `rg`, filled over the 144pt x 36pt extent at (72pt, 72pt).
  const fillAt = stream.indexOf('0.184314 0.113725 0.47451 rg');
  expect(fillAt).toBeGreaterThan(-1);
  expect(stream.slice(fillAt, fillAt + 80)).toMatch(/ 72 684 144 36 re f/);
  // The text is clipped to the content box and follows the fill; being in front of the
  // body text, both come after the body's own glyphs in the stream.
  const clipAt = stream.indexOf('W n', fillAt);
  expect(clipAt).toBeGreaterThan(fillAt);
  const bodyGlyphsAt = stream.indexOf(' Tm ');
  expect(bodyGlyphsAt).toBeGreaterThan(-1);
  expect(bodyGlyphsAt).toBeLessThan(fillAt);
  expect(stream.indexOf(' Tm ', clipAt)).toBeGreaterThan(clipAt);
});

test('a behind-text textbox paints before the body text', async () => {
  const { result, stream, text } = await exported(
    `<w:p><w:r>${textbox(paragraph('Under'), true)}</w:r></w:p>${paragraph('Body')}`
  );
  expect(
    result.diagnostics.filter(
      (entry) => entry.code !== 'incomplete-font' || entry.severity !== 'information'
    )
  ).toEqual([]);
  expect(text).toContain('Under');
  // Behind-text content precedes everything else on the page, so the first glyph run in the
  // page stream is the textbox's, and a body glyph run follows.
  const first = stream.indexOf(' Tm ');
  expect(stream.indexOf(' Tm ', first + 1)).toBeGreaterThan(first);
  const underAt = stream.indexOf('W n');
  expect(underAt).toBeGreaterThan(-1);
  expect(underAt).toBeLessThan(first);
});
