/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';
import { glyphPositions } from './glyph-positions.ts';

// One `Tm` per run, not per glyph. An absolute text matrix costs about 40 bytes a character;
// a `TJ` adjustment costs about 10 and places the glyph just as exactly, because the viewer
// advances by the width this PDF declares and the number carries only the remainder.
test('a run of text emits one text matrix and one TJ array, not one per glyph', async () => {
  const text = 'Efficiency matters for long documents';
  const result = await exportPdf(docx(paragraph(text)), { useSystemFonts: false });
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const list = await (await pdf.getPage(1)).getOperatorList();
    const matrices = list.fnArray.filter((fn: number) => fn === OPS.setTextMatrix).length;
    const shows = list.fnArray.filter((fn: number) => fn === OPS.showText).length;
    // One matrix for the run, and the glyphs travel together in one show.
    expect(matrices).toBeLessThan(text.length / 4);
    expect(shows).toBeLessThan(text.length / 4);
    expect(shows).toBeGreaterThan(0);
  } finally {
    await pdf.destroy();
  }
});

// The saving must not cost accuracy: a viewer that advances by the declared widths and
// applies the adjustments still walks every glyph left to right, one after another.
test('batched glyphs keep their positions', async () => {
  const text = 'Positions must not drift along a line';
  const result = await exportPdf(docx(paragraph(text)), { useSystemFonts: false });
  const xs = await glyphPositions(result.bytes);
  expect(xs).toHaveLength(text.length);
  for (let i = 1; i < xs.length; i += 1) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
});

// A `TJ` adjustment is a multiple of the em, so a very small size across a very wide gap can
// exceed the writer's number range. The batch must break there and open a new matrix instead of
// writing a number the file cannot carry. Half-point text across a 20-inch tab does it: about
// 2,800 em, past the 1,000-em ceiling.
test('an adjustment past the writer range breaks the batch instead of failing the export', async () => {
  const body =
    '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="30000"/></w:tabs></w:pPr>' +
    '<w:r><w:rPr><w:sz w:val="1"/></w:rPr><w:t>A</w:t></w:r>' +
    '<w:r><w:rPr><w:sz w:val="1"/></w:rPr><w:tab/><w:t>B</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="31680" w:h="15840"/>' +
    '<w:pgMar w:top="720" w:right="360" w:bottom="720" w:left="360" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const result = await exportPdf(docx(body), { useSystemFonts: false });
  const xs = await glyphPositions(result.bytes);
  expect(xs).toHaveLength(2);
  // 'B' lands at the tab stop, a long way from 'A': the positions survived the break.
  expect(xs[1]! - xs[0]!).toBeGreaterThan(1000);
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const list = await (await pdf.getPage(1)).getOperatorList();
    const matrices = list.fnArray.filter((fn: number) => fn === OPS.setTextMatrix).length;
    expect(matrices).toBeGreaterThanOrEqual(2);
  } finally {
    await pdf.destroy();
  }
});
