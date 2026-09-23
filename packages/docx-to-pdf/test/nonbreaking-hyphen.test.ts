/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

test('authored nonbreaking hyphens survive strict PDF export and hidden runs stay hidden', async () => {
  const source = docx(
    '<w:p><w:r><w:t>No</w:t><w:noBreakHyphen/><w:t>Break</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden</w:t><w:noBreakHyphen/></w:r></w:p>'
  );
  const before = source.slice();
  const result = await exportPdf(source);
  expect(source).toEqual(before);
  expect(result.diagnostics).toEqual([]);
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    expect(text).toContain('No\u2011Break');
    expect(text).not.toContain('Hidden');
  } finally {
    await pdf.destroy();
  }
});
