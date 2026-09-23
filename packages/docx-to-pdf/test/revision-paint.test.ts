/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

async function commands(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .filter((stream) => stream.includes(' Tm '))
    .join('\n');
}

for (const formatting of [
  '',
  '<w:rPr><w:color w:val="112233"/><w:u w:val="double"/><w:strike/></w:rPr>',
]) {
  test(`clean revision views paint like the equivalent plain text (authored formatting: ${!!formatting})`, async () => {
    const run = (text: string, deleted = false) =>
      `<w:r>${formatting}<w:${deleted ? 'delText' : 't'}>${text}</w:${deleted ? 'delText' : 't'}></w:r>`;
    const input = docx(
      `<w:p><w:del w:id="1" w:author="Reviewer">${run('Old', true)}</w:del><w:ins w:id="2" w:author="Reviewer">${run('New')}</w:ins></w:p>`
    );
    for (const [displayMode, visibleText] of [
      ['proposed', 'New'],
      ['original', 'Old'],
    ] as const) {
      const tracked = await exportPdf(input, { displayMode, useSystemFonts: false });
      const plain = await exportPdf(docx(`<w:p>${run(visibleText)}</w:p>`), {
        useSystemFonts: false,
      });
      expect(tracked.diagnostics).toEqual([]);
      expect(await commands(tracked.bytes)).toBe(await commands(plain.bytes));
    }
    const marked = await exportPdf(input, { displayMode: 'all-markup', useSystemFonts: false });
    const stream = await commands(marked.bytes);
    expect(stream).toContain('0 0.501961 0 rg');
    expect(stream).toContain('0.752941 0 0 rg');
  });
}
