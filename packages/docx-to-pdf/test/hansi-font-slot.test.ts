/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

test('strict export loads and paints a distinct hAnsi face', async () => {
  const fonts = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Arial"/></w:rPr>';
  const source = docx(paragraph('Café über §1 2', fonts));
  const result = await exportPdf(source, { useSystemFonts: false });
  expect(result.diagnostics.filter((entry) => entry.severity !== 'information')).toEqual([]);
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    expect(text).toContain('é');
    expect(text).toContain('ü');
  } finally {
    await pdf.destroy();
  }
});
