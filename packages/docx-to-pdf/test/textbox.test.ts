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

test('an inline textbox paints its fill and text on the line instead of a placeholder', async () => {
  const fill = '<a:solidFill><a:srgbClr val="2F1D79"/></a:solidFill>';
  const inline =
    `<w:drawing ${NS}><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    '<wp:extent cx="1828800" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="1" name="TB"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm>' +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</wps:spPr>` +
    `<wps:txbx><w:txbxContent>${paragraph('Inline')}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/>' +
    '</wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>';
  const { result, stream, text } = await exported(
    `<w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r><w:r>${inline}</w:r></w:p>`
  );
  expect(result.diagnostics.filter((entry) => entry.code === 'drawing')).toEqual([]);
  expect(text).toContain('Before');
  expect(text).toContain('Inline');
  // The fill covers the 144pt x 36pt extent, and the story's glyphs follow it.
  const fillAt = stream.indexOf('0.184314 0.113725 0.47451 rg');
  expect(fillAt).toBeGreaterThan(-1);
  expect(stream.slice(fillAt, fillAt + 80)).toMatch(/ 144 36 re f/);
  expect(stream.indexOf(' Tm ', fillAt)).toBeGreaterThan(fillAt);
});

const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';

/** A text box member at `x` EMU across a 0.5in-high group, `cx` EMU wide, zero insets. */
function member(x: number, cx: number, content: string, xfrm = ''): string {
  return (
    `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm${xfrm}><a:off x="${x}" y="0"/>` +
    `<a:ext cx="${cx}" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</wps:spPr><wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/></wps:wsp>'
  );
}

/** A 2in x 0.5in group at (1in, 1in) holding `members`. */
function groupDrawing(members: string): string {
  return (
    `<w:drawing ${NS} xmlns:wpg="${WPG}"><wp:anchor distT="0" distB="0" distL="0" distR="0"` +
    ' simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1828800" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    `<wp:docPr id="1" name="G"/><a:graphic><a:graphicData uri="${WPG}"><wpg:wgp>` +
    '<wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="1828800" cy="457200"/></a:xfrm></wpg:grpSpPr>' +
    `${members}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>`
  );
}

test('a group exports the text of its text box member inside the group', async () => {
  // The member starts 0.5in in and is 1.5in wide.
  const { result, stream, text } = await exported(
    `<w:p><w:r>${groupDrawing(member(457200, 1371600, paragraph('Grouped')))}</w:r></w:p>${paragraph('Body')}`
  );
  expect(result.diagnostics.filter((entry) => entry.code === 'drawing')).toEqual([]);
  expect(text).toContain('Grouped');
  // Clipped to the group's 144pt x 36pt bounds at (72pt, 72pt) on the 792pt page, then to
  // the member's 108pt content box at 108pt.
  const clipAt = stream.indexOf('72 684 144 36 re W n');
  expect(clipAt).toBeGreaterThan(-1);
  const memberAt = stream.indexOf('108 684 108 36 re W n', clipAt);
  expect(memberAt).toBeGreaterThan(clipAt);
  expect(stream.indexOf(' Tm ', memberAt)).toBeGreaterThan(memberAt);
});

test('each group member clips its own text, so a long word stays out of its neighbor', async () => {
  // Two 1in members side by side; the first holds a word far wider than 1in.
  const { stream, text } = await exported(
    `<w:p><w:r>${groupDrawing(
      member(0, 914400, paragraph('Overlongunbreakablewordthatoverflows')) +
        member(914400, 914400, paragraph('Right'))
    )}</w:r></w:p>`
  );
  expect(text).toContain('Right');
  const first = stream.indexOf('72 684 72 36 re W n');
  const second = stream.indexOf('144 684 72 36 re W n');
  expect(first).toBeGreaterThan(-1);
  expect(second).toBeGreaterThan(first);
  // The first member's glyphs sit inside its own clip, which closes before the second opens.
  const firstGlyphs = stream.indexOf(' Tm ', first);
  expect(firstGlyphs).toBeGreaterThan(first);
  expect(firstGlyphs).toBeLessThan(second);
  expect(stream.lastIndexOf('Q', second)).toBeGreaterThan(firstGlyphs);
});

test('a rotated group member turns its text about the member center', async () => {
  const { stream, text } = await exported(
    `<w:p><w:r>${groupDrawing(member(457200, 914400, paragraph('Turned'), ' rot="5400000"'))}</w:r></w:p>`
  );
  expect(text).toContain('Turned');
  // A quarter turn clockwise about the member center (144pt, 702pt in PDF space).
  expect(stream).toContain('0 -1 1 0 -558 846 cm');
});
