/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';
import { glyphPositions } from './glyph-positions.ts';

const FAMILY = 'DejaVu Sans';
const bytes = new Uint8Array(
  readFileSync(
    new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
  )
);
const source = createFontSource(bytes, { family: FAMILY, weight: 400, style: 'normal' });
if ('failure' in source) throw new Error(JSON.stringify(source.failure));

/**
 * The x a viewer computes for glyph i is the sum of the advances before it. Summing advances
 * already rounded to the fixed-point grid biases every instance of a character the same way,
 * and the error grows with the glyph count rather than cancelling. This pins the result of
 * summing before rounding: the pen step the positions describe is NOT a whole number of
 * fixed-point units.
 */
test('a long run steps by the unrounded advance, not a quantised one', async () => {
  const count = 60;
  const result = await exportPdf(
    docx(paragraph('o'.repeat(count), '<w:rPr><w:sz w:val="22"/></w:rPr>')),
    {
      useSystemFonts: false,
      fonts: { sources: [source.source], defaultFont: { family: FAMILY, sizeHalfPoints: 22 } },
    }
  );
  expect(result.diagnostics).toEqual([]);
  const xs = await glyphPositions(result.bytes);
  expect(xs).toHaveLength(count);

  const step = (xs[count - 1]! - xs[0]!) / (count - 1);
  // The positions are one arithmetic progression: nothing else is going on in this run.
  for (const [index, x] of xs.entries()) expect(x).toBeCloseTo(xs[0]! + index * step, 4);
  // DejaVu's 'o' advances 1253 units of a 2048 em, which at 11pt is 6.72998046875pt, just
  // under the 6.730 the fixed-point grid rounds it to. Stepping by the rounded value instead
  // would put the last of these 60 glyphs 0.00115pt further right.
  expect(step).toBeCloseTo((1253 * 11) / 2048, 7);
  expect(Math.abs(step * 1000 - Math.round(step * 1000))).toBeGreaterThan(1e-3);
});
