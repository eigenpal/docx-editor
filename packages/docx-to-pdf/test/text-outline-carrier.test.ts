/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
// A family with a regular face only, so bold text takes synthetic bold.
const FAMILY = 'Regular Only';
const loaded = createFontSource(
  new Uint8Array(
    readFileSync(
      new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
    )
  ),
  { family: FAMILY, weight: 400, style: 'normal' }
);
if ('failure' in loaded) throw new Error(JSON.stringify(loaded.failure));
const regular = loaded.source;
const fonts = `<w:rFonts w:ascii="${FAMILY}" w:hAnsi="${FAMILY}"/>`;
const outline = `<w14:textOutline xmlns:w14="${W14}" w14:w="12700"><w14:solidFill><w14:srgbClr w14:val="FF0000"/></w14:solidFill></w14:textOutline>`;

/** The text render mode (`Tr`) in effect at each glyph string that a page shows. */
async function renderModes(text: string, runProperties: string): Promise<number[]> {
  return renderModesOf(paragraph(text, `<w:rPr>${fonts}${runProperties}</w:rPr>`));
}

async function renderModesOf(body: string): Promise<number[]> {
  const result = await exportPdf(docx(body), {
    useSystemFonts: false,
    fonts: { sources: [regular] },
  });
  // The family has no bold face by design, so only that information note is expected.
  expect(result.diagnostics.filter((d) => d.code !== 'incomplete-font')).toEqual([]);
  const parsed = await PDFDocument.load(result.bytes);
  const modes: number[] = [];
  for (const [, object] of parsed.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.has(PDFName.of('Length1'))) continue;
    const content = new TextDecoder().decode(decodePDFRawStream(object).decode());
    if (!content.includes('BT')) continue;
    // Each `q` saves the mode and each `Q` restores it (ISO 32000-1 §8.4.2).
    const saved: number[] = [];
    let mode = 0;
    for (const [, operand, operator] of content.matchAll(
      /(?:^|\s)(?:(\d+) )?(Tr|Tj|TJ|q|Q)(?=\s|$)/g
    )) {
      if (operator === 'Tr') mode = Number(operand);
      else if (operator === 'q') saved.push(mode);
      else if (operator === 'Q') mode = saved.pop() ?? 0;
      else modes.push(mode);
    }
  }
  return modes;
}

test('a text outline strokes the glyphs after an emoji carrier', async () => {
  // The letter, the emoji's invisible carrier (mode 3), and the letter after it.
  expect(await renderModes('a✅a', outline)).toEqual([2, 3, 2]);
});

test('plain and synthetic bold text keep their render modes around an emoji carrier', async () => {
  expect(await renderModes('a✅a', '')).toEqual([0, 3, 0]);
  expect(await renderModes('a✅a', '<w:b/>')).toEqual([2, 3, 2]);
});

/**
 * The `q`/`Q` pairs that enclose a text object inside an `ActualText` span. `Q` restores the
 * text position from before the span, and Poppler places the span's text at `EMC` from it.
 */
async function textInsideRestoredState(body: string): Promise<number> {
  const result = await exportPdf(docx(body), {
    useSystemFonts: false,
    fonts: { sources: [regular] },
  });
  const parsed = await PDFDocument.load(result.bytes);
  let found = 0;
  for (const [, object] of parsed.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.has(PDFName.of('Length1'))) continue;
    const content = new TextDecoder().decode(decodePDFRawStream(object).decode());
    let inSpan = false;
    const saved: { text: boolean }[] = [];
    for (const [operator] of content.matchAll(/(?<=^|\s)(?:BDC|EMC|BT|ET|q|Q)(?=\s|$)/g)) {
      if (operator === 'BDC') inSpan = true;
      else if (operator === 'EMC') inSpan = false;
      else if (operator === 'q') saved.push({ text: false });
      else if (operator === 'ET') for (const level of saved) level.text = true;
      else if (operator === 'Q' && saved.pop()?.text && inSpan) found++;
    }
  }
  return found;
}

test('an outlined span keeps its text position for extraction', async () => {
  const words = (rPr: string) =>
    `<w:p><w:r><w:rPr>${fonts}${rPr}</w:rPr><w:t xml:space="preserve">Done ✅ check outline</w:t></w:r></w:p>`;
  expect(await textInsideRestoredState(words(outline))).toBe(0);
});

test('the run after an outlined run is filled only', async () => {
  const run = (text: string, rPr: string) =>
    `<w:r><w:rPr>${fonts}${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  expect(await renderModesOf(`<w:p>${run('Outlined ', outline)}${run('plain', '')}</w:p>`)).toEqual(
    [2, 0]
  );
});
