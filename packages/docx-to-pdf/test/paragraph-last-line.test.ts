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
  return baselinesWith(body, {});
}

async function baselinesWith(body: string, extras: Record<string, string>): Promise<number[]> {
  const result = await exportPdf(docx(`${body}${SECTION}`, extras), {
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

// The rule keys on the after-spacing Core APPLIED, which `w:contextualSpacing` collapses to
// zero between paragraphs of one style, not on what was authored. A Word render of two
// same-style paragraphs with `w:after="120"` and contextual spacing, then a third of another
// style, places the first paragraph's last line by the box rule and the second's by the
// rounded ascent — all nine baselines exact. So a collapsed last line stays put.
async function shiftWithFollower(
  styles: string,
  first: (words: number) => string,
  follower: string
): Promise<number> {
  const stylesPart = { 'word/styles.xml': styles };
  const short = await baselinesWith(`${first(48)}${follower}`, stylesPart);
  const long = await baselinesWith(`${first(96)}${follower}`, stylesPart);
  const last = 2; // the first paragraph's third line, its last in the short document
  for (let i = 0; i < last; i += 1) expect(long[i]).toBeCloseTo(short[i]!, 6);
  return Math.round((short[last]! - long[last]!) / GRID);
}

const CONTEXTUAL_STYLES =
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body"/>' +
  '<w:pPr><w:spacing w:after="120"/><w:contextualSpacing/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Plain"><w:name w:val="Plain"/>' +
  '<w:pPr><w:spacing w:after="120"/></w:pPr></w:style></w:styles>';

const styled = (style: string) => (words: number) =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>` +
  `<w:r><w:rPr><w:sz w:val="${HALF_POINTS}"/></w:rPr>` +
  `<w:t xml:space="preserve">${WORD.repeat(words).trim()}</w:t></w:r></w:p>`;

test('after-spacing collapsed by contextual spacing keeps the box rule on the last line', async () => {
  // Same style follows: the 120 after collapses to zero, and the last line does not move.
  expect(await shiftWithFollower(CONTEXTUAL_STYLES, styled('Body'), styled('Body')(48))).toBe(0);
});

test('after-spacing that survives the collapse still rounds the ascent', async () => {
  // A different style follows: the after applies, and the last line takes the ascent rule.
  expect(await shiftWithFollower(CONTEXTUAL_STYLES, styled('Body'), styled('Plain')(48))).toBe(1);
});
