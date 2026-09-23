/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';
import { baselineYPositions } from './glyph-positions.ts';

const GRID = 0.24;
const FAMILY = 'DejaVu Sans';
const bytes = new Uint8Array(
  readFileSync(
    new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
  )
);
const source = createFontSource(bytes, { family: FAMILY, weight: 400, style: 'normal' });
if ('failure' in source) throw new Error(JSON.stringify(source.failure));
const fontSource = source.source;

const SECTION =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/>' +
  '</w:sectPr>';

async function firstBaselineFromTop(body: string): Promise<number> {
  const result = await exportPdf(docx(`${body}${SECTION}`), {
    useSystemFonts: false,
    fonts: { sources: [fontSource], defaultFont: { family: FAMILY, sizeHalfPoints: 24 } },
  });
  expect(
    result.diagnostics.filter(
      (entry) => entry.code !== 'incomplete-font' || entry.severity !== 'information'
    )
  ).toEqual([]);
  const height = (await PDFDocument.load(result.bytes)).getPage(0).getHeight();
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    const item = content.items.find((i): i is Extract<typeof i, { str: string }> => 'str' in i)!;
    return Number((height - item.transform[5]!).toFixed(4));
  } finally {
    await pdf.destroy();
  }
}

// The reference grids the natural font box and the font's own descent, then lets the baseline
// fall between them, so a painted baseline is always a whole number of device units below the
// page top when the block starts on the grid.
test('a single-spaced first baseline lands on a whole device unit', async () => {
  const top = await firstBaselineFromTop(paragraph('Natural box'));
  expect(Math.abs(top / GRID - Math.round(top / GRID))).toBeLessThan(1e-6);
});

// A line-spacing multiple grows the box below the baseline. Measuring the descent off that box
// would move the baseline a unit, so the natural descent has to come from the font instead.
test('a line-spacing multiple does not move the baseline off the grid', async () => {
  const spaced =
    '<w:p><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr>' +
    '<w:r><w:t xml:space="preserve">Multiple</w:t></w:r></w:p>';
  const top = await firstBaselineFromTop(spaced);
  expect(Math.abs(top / GRID - Math.round(top / GRID))).toBeLessThan(1e-6);
});

// A line takes its ascent from its tallest run. Deriving the descent from the painted run's own
// size instead of that shared ascent gave a short run on a mixed-size line a baseline a device
// unit away from its neighbours, which a reader sees as one word sitting low.
test('every run on one line shares a baseline whatever size it is drawn at', async () => {
  const mixed =
    '<w:p><w:r><w:rPr><w:sz w:val="36"/></w:rPr><w:t xml:space="preserve">Big </w:t></w:r>' +
    '<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">and small </w:t></w:r>' +
    '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>and smaller</w:t></w:r></w:p>';
  const result = await exportPdf(docx(`${mixed}${SECTION}`), {
    useSystemFonts: false,
    fonts: { sources: [fontSource], defaultFont: { family: FAMILY, sizeHalfPoints: 24 } },
  });
  expect(
    result.diagnostics.filter(
      (entry) => entry.code !== 'incomplete-font' || entry.severity !== 'information'
    )
  ).toEqual([]);
  const baselines = await baselineYPositions(result.bytes);
  expect(baselines.length).toBeGreaterThan(1);
  expect(new Set(baselines.map((y) => y.toFixed(4))).size).toBe(1);
});
