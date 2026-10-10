/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

test('an emoji paints its palette layers in color and stays extractable as text', async () => {
  const result = await exportPdf(docx(paragraph('Done ✅ ❤️')), {
    useSystemFonts: false,
  });
  expect(result.diagnostics).toEqual([]);
  const parsed = await PDFDocument.load(result.bytes);
  const stream = parsed.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .filter((s) => s.includes(' Tm '))
    .join('\n');
  // The layers are filled in place: the check mark's green (119, 178, 85) and the heart's
  // red (221, 46, 68) from Twemoji's palette. The characters ride an invisible carrier glyph
  // of the text face, which pdf.js reads back below.
  expect(stream).toContain('3 Tr');
  expect(stream).toMatch(/0\.466667 0\.698039 0\.333333 rg [\d.\- mlch]+ f/);
  expect(stream).toMatch(/0\.866667 0\.180392 0\.266667 rg [\d.\- mlch]+ f/);
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    expect(text).toContain('Done');
    expect(text).toContain('✅');
    expect(text).toContain('❤');
  } finally {
    await pdf.destroy();
  }
});
