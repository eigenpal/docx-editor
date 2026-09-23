/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

const source = new Uint8Array(
  readFileSync(new URL('../../../examples/vite/public/sample.docx', import.meta.url))
);
test('the real editor demo exports strictly with notes, equations, checkboxes and international text', async () => {
  const original = source.slice();
  const result = await exportPdf(source, { useSystemFonts: false });
  expect(source).toEqual(original);
  expect(result.diagnostics).toEqual([]);
  expect(result.pageCount).toBe(27);
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''));
    }
    const text = pages.join(' ').normalize('NFC');
    for (const required of [
      'Georgia',
      'Verdana',
      'SMALL CAPS',
      '☐',
      '☑',
      '☒',
      '日本語のテスト文書',
      '这是一个测试文档',
      '테스트',
      'مستند',
      'Quadratic formula',
      'Standard footnote',
      'END OF COMPREHENSIVE',
    ])
      expect(text).toContain(required);
    const equations = await (await pdf.getPage(18)).getTextContent();
    const math = equations.items.map((item) => ('str' in item ? item.str : '')).join('');
    expect(math).toContain('√');
    expect(math).toContain('∑');
    expect(math).not.toContain('\uFFFC');
    expect(
      (await (await pdf.getPage(11)).getAnnotations()).filter((a) => a.subtype === 'Highlight')
        .length
    ).toBeGreaterThan(0);
  } finally {
    await pdf.destroy();
  }
});

test('synthetic small caps retain source Unicode and fit their layout width', async () => {
  const result = await exportPdf(
    docx(
      paragraph('Small Straße CAPS', '<w:rPr><w:rFonts w:ascii="Arial"/><w:smallCaps/></w:rPr>')
    ),
    { useSystemFonts: false }
  );
  expect(result.diagnostics).toEqual([]);
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    expect(text.replace(/ /g, '')).toBe('SmallStraßeCAPS');
    const sizes = content.items.flatMap((item) => ('transform' in item ? [item.transform[3]] : []));
    expect(Math.min(...sizes)).toBeLessThan(Math.max(...sizes));
  } finally {
    await pdf.destroy();
  }
});
