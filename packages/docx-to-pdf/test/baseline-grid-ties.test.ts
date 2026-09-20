/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
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
