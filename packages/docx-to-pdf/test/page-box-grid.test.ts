/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

const section = (w: number, h: number): string =>
  `<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"/>` +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
  '</w:sectPr>';

async function pageSize(body: string): Promise<[number, number]> {
  const result = await exportPdf(docx(body), { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const page = pdf.getPage(0);
  return [Number(page.getWidth().toFixed(4)), Number(page.getHeight().toFixed(4))];
}

// A4 is 11906 x 16838 twips, which is 595.30 x 841.90pt. The reference writes 595.20 x
// 841.92, the nearest whole device units (2480 and 3508).
test('an A4 page box rounds onto the device grid', async () => {
  expect(await pageSize(`${paragraph('A4')}${section(11906, 16838)}`)).toEqual([595.2, 841.92]);
});

// Letter is 612 x 792pt, already 2550 and 3300 units, so nothing moves.
test('a Letter page box is already on the grid and does not move', async () => {
  expect(await pageSize(`${paragraph('Letter')}${section(12240, 15840)}`)).toEqual([612, 792]);
});
