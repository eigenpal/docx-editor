/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const GRID = 0.24;
const FAMILY = 'DejaVu Sans';
const source = createFontSource(
  new Uint8Array(
    readFileSync(
      new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
    )
  ),
  { family: FAMILY, weight: 400, style: 'normal' }
);
if ('failure' in source) throw new Error(JSON.stringify(source.failure));
const fontSource = source.source;

const SECTION =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="813" w:right="1134" w:bottom="1134" w:left="1134"' +
  ' w:header="0" w:footer="720" w:gutter="0"/></w:sectPr>';

async function baselines(body: string): Promise<number[]> {
  const result = await exportPdf(docx(`${body}${SECTION}`), {
    useSystemFonts: false,
    fonts: { sources: [fontSource], defaultFont: { family: FAMILY, sizeHalfPoints: 24 } },
  });
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const height = page.view[3]!;
    const seen = new Set<number>();
    for (const item of (await page.getTextContent()).items) {
      if (!('str' in item) || !item.str.trim()) continue;
      seen.add(Number((height - item.transform[5]!).toFixed(4)));
    }
    return [...seen].sort((a, b) => a - b);
  } finally {
    await pdf.destroy();
  }
}

// 11pt is a size where this face's two rules disagree: the box rule gives 42 device units
// and the rounded ascent gives 43, so the branch is observable rather than coincident.
const HALF_POINTS = 22;
const WORD = 'ttttt ';
const paragraph = (words: number, after: number): string =>
  `<w:p><w:pPr><w:spacing w:after="${after}"/></w:pPr>` +
  `<w:r><w:rPr><w:sz w:val="${HALF_POINTS}"/></w:rPr>` +
  `<w:t xml:space="preserve">${WORD.repeat(words).trim()}</w:t></w:r></w:p>`;

/** How far the last line of a paragraph moves when text after it makes it an ordinary line. */
async function lastLineShiftInUnits(after: number): Promise<number> {
  const short = await baselines(paragraph(48, after));
  const long = await baselines(paragraph(96, after));
  expect(short.length).toBeGreaterThanOrEqual(3);
  expect(long.length).toBeGreaterThan(short.length);
  // Every line before the last is laid out identically in both documents.
  for (let i = 0; i < short.length - 1; i += 1) expect(long[i]).toBeCloseTo(short[i]!, 6);
  const last = short.length - 1;
  return Math.round((short[last]! - long[last]!) / GRID);
}

// A line that ends a paragraph WITH after-spacing rounds its ascent; every other line lets the
// baseline fall between a gridded natural box and a gridded descent. The two differ by one
// device unit for this face, so the SAME line moves when text after it makes it ordinary.
//
// Controls rendered by Word place such a last line one unit lower at every paragraph length
// from one line to six.
test('the line that ends a spaced paragraph rounds its ascent', async () => {
  expect(await lastLineShiftInUnits(120)).toBe(1);
});

// The spacing is what decides it, not the paragraph end. Two Word renders identical but for
// `w:after` place the same line, at the same position, a unit apart. Without this case a rule
// keyed on the paragraph end alone passes, and it moves every header line in the corpus.
test('a paragraph with no after-spacing keeps the box rule on its last line', async () => {
  expect(await lastLineShiftInUnits(0)).toBe(0);
});
