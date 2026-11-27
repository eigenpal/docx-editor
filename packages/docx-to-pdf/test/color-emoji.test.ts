/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { createFontSource } from '@docx-editor.dev/core/editor';
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
    await pdf.loadingTask.destroy();
  }
});

/** DejaVu Sans as the family `Heart Text`: it maps U+2764 to a monochrome heart. */
function heartText() {
  const loaded = createFontSource(
    new Uint8Array(
      readFileSync(
        new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
      )
    ),
    { family: 'Heart Text', weight: 400, style: 'normal' }
  );
  if ('failure' in loaded) throw new Error(JSON.stringify(loaded.failure));
  return loaded.source;
}

test('a document that opens with an emoji sequence keeps its characters as text', async () => {
  // No text face is embedded before the sequence, and the color face has no space to carry
  // the characters, so the run's own face carries them.
  const result = await exportPdf(
    docx(
      `<w:p><w:r><w:rPr><w:rFonts w:ascii="Heart Text" w:hAnsi="Heart Text"/></w:rPr><w:t>\u2764\uFE0F\u200D\u{1F525} x</w:t></w:r></w:p>`
    ),
    { useSystemFonts: false, fonts: { sources: [heartText()] } }
  );
  expect(result.diagnostics.filter((d) => d.code !== 'incomplete-font')).toEqual([]);
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    expect(text).toContain('\u2764\uFE0F\u200D\u{1F525}');
  } finally {
    await pdf.loadingTask.destroy();
  }
});

test('an emoji presentation sequence takes the color face though the run face maps it', async () => {
  // DejaVu Sans maps U+2764 to a monochrome heart. U+FE0F asks for emoji presentation
  // (Unicode Technical Standard #51), so `❤\uFE0F` paints the color face's red layer; the
  // bare `❤` keeps the text glyph.
  const source = heartText();
  const run = (text: string) =>
    `<w:p><w:r><w:rPr><w:rFonts w:ascii="Heart Text" w:hAnsi="Heart Text"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  const layers = async (text: string) => {
    const result = await exportPdf(docx(run(text)), {
      useSystemFonts: false,
      fonts: { sources: [source] },
    });
    const parsed = await PDFDocument.load(result.bytes);
    return parsed.context
      .enumerateIndirectObjects()
      .flatMap(([, object]) =>
        object instanceof PDFRawStream
          ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
          : []
      )
      .join('\n');
  };
  expect(await layers('A\u2764\uFE0FB')).toMatch(
    /0\.866667 0\.180392 0\.266667 rg [\d.\- mlch]+ f/
  );
  expect(await layers('A\u2764B')).not.toMatch(/0\.866667 0\.180392 0\.266667 rg/);
});
