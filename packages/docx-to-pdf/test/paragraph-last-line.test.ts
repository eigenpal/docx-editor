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
const paragraph = (words: number): string =>
  `<w:p><w:r><w:rPr><w:sz w:val="${HALF_POINTS}"/></w:rPr>` +
  `<w:t xml:space="preserve">${WORD.repeat(words).trim()}</w:t></w:r></w:p>`;

// A line that ENDS its paragraph rounds its ascent; every other line lets the baseline fall
// between a gridded natural box and a gridded descent. The two differ by one device unit for
// this face, so the SAME line moves when text after it turns it into an ordinary line.
//
// Controls rendered by Word put a paragraph's last line one unit below the box rule at every
// length from one line to six. See `VALIDATION.md`.
test('the line that ends a paragraph rounds its ascent', async () => {
  const short = await baselines(paragraph(48));
  const long = await baselines(paragraph(96));
  expect(short.length).toBeGreaterThanOrEqual(3);
  expect(long.length).toBeGreaterThan(short.length);
  // Every line before the last is laid out identically in both documents.
  for (let i = 0; i < short.length - 1; i += 1) expect(long[i]).toBeCloseTo(short[i]!, 6);
  // The last line of the short paragraph is that same line, and it sits ONE unit lower.
  const last = short.length - 1;
  expect(Math.round((short[last]! - long[last]!) / GRID)).toBe(1);
});
