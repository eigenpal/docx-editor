/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

// The ascent is rounded to a whole device unit BEFORE the line advance accumulates.
//
// Calibri 11pt ascends 11 * 1950 / 2048 = 10.4736pt, which is 43.64 units of the 0.24pt
// grid, and the reference lays out from 44. Accumulating the exact 10.4736 and rounding only
// at the end puts the paragraph's third line on 472 units where the reference puts it on
// 473. The saved Word render of `footnote-overlap-regression.docx` shows 82.56, 97.92,
// 113.52, 128.88 for these four lines; the unsnapped model gives 113.28 for the third.
const GRID = 0.24;
const MARGIN = 72; // w:top="1440"
const ASCENT_SNAPPED = Math.round(((11 * 1950) / 2048 / GRID) * 1) * GRID; // 10.56
const ADVANCE = ((11 * 2500) / 2048) * 1.15; // w:line="276" w:lineRule="auto"

test('the ascent snaps to a device unit before the line advance accumulates', async () => {
  const runs = Array.from(
    { length: 4 },
    (_, i) => `<w:r>${i ? '<w:br/>' : ''}<w:t xml:space="preserve">L${i}</w:t></w:r>`
  ).join('');
  const input = docx(
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/>' +
      `<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:pPr>${runs}</w:p>` +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"' +
      ' w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
    {
      'word/styles.xml':
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:docDefaults><w:rPrDefault><w:rPr>' +
        '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>' +
        '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    }
  );
  const result = await exportPdf(input, { useSystemFonts: false });
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const height = page.view[3]!;
    const content = await page.getTextContent();
    const tops = content.items
      .filter((item): item is Extract<typeof item, { str: string }> => 'str' in item)
      .filter((item) => /^L\d$/.test(item.str))
      .map((item) => Number((height - item.transform[5]!).toFixed(4)))
      .sort((a, b) => a - b);
    const expected = Array.from({ length: 4 }, (_, i) =>
      Number((Math.ceil((MARGIN + ASCENT_SNAPPED + i * ADVANCE) / GRID - 0.5) * GRID).toFixed(4))
    );
    // What Word wrote for this shape, and what the unsnapped model gets wrong.
    expect(expected).toEqual([82.56, 97.92, 113.52, 128.88]);
    expect(tops).toEqual(expected);
  } finally {
    await pdf.destroy();
  }
});
