/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const RUN = '<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/></w:rPr>';

test('a line that breaks at an optional hyphen paints and extracts a hyphen', async () => {
  // About 100pt of measure: ten 7.2pt characters and a hyphen fit, twenty characters do not.
  const source = docx(
    '<w:p><w:pPr><w:ind w:right="7360"/></w:pPr>' +
      `${RUN}<w:t>aaaaaaaaaa</w:t></w:r>${RUN}<w:softHyphen/></w:r>${RUN}<w:t>bbbbbbbbbb</w:t></w:r></w:p>`
  );
  const result = await exportPdf(source, { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    const lines = new Map<number, string>();
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      lines.set(y, (lines.get(y) ?? '') + item.str);
    }
    expect([...lines.values()].map((line) => line.trim())).toEqual(['aaaaaaaaaa-', 'bbbbbbbbbb']);
  } finally {
    await pdf.destroy();
  }
});
