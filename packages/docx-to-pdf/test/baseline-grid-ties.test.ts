/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { snapToGrid } from '../src/text.ts';
import { docx } from './fixture.ts';

// An exact half-unit on the 0.24pt device grid rounds toward the page TOP.
//
// Ties are not rare: any exact line spacing that is an odd multiple of 0.12pt hits one on
// every other line. Here `w:top="2880"` puts the story origin at 144pt — 600 units exactly —
// and 15pt lines advance 62.5 units, so every other baseline lands on an exact .5.
// A captured control of this shape shows the reference taking the LOWER unit for all six of
// them; `Math.round` took the upper one every time, 0.24pt low on the page.
// See `.cache/pdf/claude-linerule/`.
const GRID = 0.24;
const LINES = 12;

test('an exact half-unit baseline rounds toward the page top', async () => {
  const runs = Array.from(
    { length: LINES },
    (_, i) => `<w:r>${i ? '<w:br/>' : ''}<w:t xml:space="preserve">T${i}</w:t></w:r>`
  ).join('');
  const input = docx(
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="exact"/></w:pPr>${runs}</w:p>` +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="2880" w:right="1440" w:bottom="1440" w:left="1440"' +
      ' w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
  );
  const result = await exportPdf(input, { useSystemFonts: false });
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const height = page.view[3]!;
    const content = await page.getTextContent();
    const tops = content.items
      .filter((item): item is Extract<typeof item, { str: string }> => 'str' in item)
      .filter((item) => /^T\d+$/.test(item.str))
      .map((item) => Number((height - item.transform[5]!).toFixed(4)))
      .sort((a, b) => a - b);
    expect(tops).toHaveLength(LINES);
    // Every painted baseline sits on the grid, and the ties took the lower unit.
    for (const top of tops)
      expect(Math.abs(top / GRID - Math.round(top / GRID))).toBeLessThan(1e-6);
    const expected = Array.from({ length: LINES }, (_, i) =>
      Number((Math.ceil((144 + 12 + i * 15) / GRID - 0.5) * GRID).toFixed(4))
    );
    expect(tops).toEqual(expected);
    // Half of them ARE ties, or the fixture stopped exercising the rule.
    const ties = expected.filter(
      (_, i) => Math.abs((((144 + 12 + i * 15) / GRID) % 1) - 0.5) < 1e-9
    );
    expect(ties).toHaveLength(6);
  } finally {
    await pdf.destroy();
  }
});

// The same rule, on a tie the layout reaches by accumulation rather than by arithmetic.
//
// A position arrives here as a sum of points that are exact in decimal and not in binary. In
// `issue-483-firstline-marker.docx` the thirty-sixth body baseline is mathematically 2149.5
// units, and the sum delivers 2149.5000000000014. `ceil(x - 1/2)` then takes 2150 instead of
// 2149 and paints that whole line 0.24pt low, which is most of that page's measured error.
// The drift is a part in 1e15, so nothing but a tie can see it.
test('a tie reached by accumulation resolves like an exact one', () => {
  const drifted = 515.88000000000033651 / GRID;
  expect(drifted).toBeGreaterThan(2149.5);
  expect(Math.ceil(drifted - 0.5)).toBe(2150);
  expect(Math.ceil(snapToGrid(drifted) - 0.5)).toBe(2149);
});

// Snapping must not move a value that is genuinely between two units, or every ordinary
// baseline would shift. Only a whole or half unit within a part in 1e9 is pulled back.
test('snapping leaves a position that is not near a tie alone', () => {
  for (const units of [2099.1916666666679, 2158.8083333333352, 0.3, -7.77, 1812.4]) {
    expect(snapToGrid(units)).toBe(units);
  }
  expect(snapToGrid(902.4999999999999)).toBe(902.5);
  expect(snapToGrid(340.00000000000006)).toBe(340);
});

// And the same rule end to end, on ties the layout REACHES rather than computes.
//
// `w:line="201"` advances 10.05pt. Twelve of those from a 72pt margin is mathematically a
// half unit, and the sum delivers 836.4999999999999; twenty is 1171.5000000000005. Drift in
// both directions, five times on one page. The expectation below stays in twips, where a twip
// is exactly 5/24 of a device unit, so the test cannot drift the way the code did.
const DRIFT_LINE_TWIPS = 201;
const DRIFT_TOP_TWIPS = 1440;
const DRIFT_LINES = 46;

test('ties reached by accumulation resolve like exact ones', async () => {
  const runs = Array.from(
    { length: DRIFT_LINES },
    (_, i) => `<w:r>${i ? '<w:br/>' : ''}<w:t xml:space="preserve">L${i}</w:t></w:r>`
  ).join('');
  const input = docx(
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${DRIFT_LINE_TWIPS}"` +
      ` w:lineRule="exact"/></w:pPr>${runs}</w:p>` +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      `<w:pgMar w:top="${DRIFT_TOP_TWIPS}" w:right="1440" w:bottom="1440" w:left="1440"` +
      ' w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
  );
  const result = await exportPdf(input, { useSystemFonts: false });
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const height = page.view[3]!;
    const content = await page.getTextContent();
    const tops = content.items
      .filter((item): item is Extract<typeof item, { str: string }> => 'str' in item)
      .filter((item) => /^L\d+$/.test(item.str))
      .map((item) => Number((height - item.transform[5]!).toFixed(4)))
      .sort((a, b) => a - b);
    expect(tops).toHaveLength(DRIFT_LINES);
    // Each line adds the SAME whole number of units for its in-line baseline, so subtracting
    // the tie rule applied to its own rule position must leave one shared offset.
    const offsets = tops.map((top, i) => {
      const twips = DRIFT_TOP_TWIPS + i * DRIFT_LINE_TWIPS;
      return Math.round(top / GRID) - Math.ceil((5 * twips - 12) / 24);
    });
    expect(new Set(offsets)).toHaveLength(1);
    // The fixture has to keep landing on ties, or it stops testing anything.
    const ties = offsets.filter(
      (_, i) => ((5 * (DRIFT_TOP_TWIPS + i * DRIFT_LINE_TWIPS)) / 24) % 1 === 0.5
    );
    expect(ties.length).toBeGreaterThanOrEqual(5);
  } finally {
    await pdf.destroy();
  }
});
