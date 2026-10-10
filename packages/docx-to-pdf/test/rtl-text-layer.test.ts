/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

// Arial resolves to Liberation Sans, which has Hebrew; its Arabic falls back to Noto Sans
// Arabic, which draws the dots of BEH, TEH, NOON and YEH as glyphs of their own.
const LINES = [
  { text: 'مرحبا بالعالم الحقيقي', rtl: true },
  { text: 'بسمه تعالی فرم تسویه حساب', rtl: true },
  { text: 'שלום עולם יפה', rtl: true },
  { text: 'Hello world 123', rtl: false },
];
const input = docx(
  LINES.map(
    ({ text, rtl }) =>
      `<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${rtl ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  ).join('')
);

async function pageLines(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    const lines = new Map<number, string>();
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      lines.set(y, (lines.get(y) ?? '') + item.str);
    }
    return [...lines.values()];
  } finally {
    await pdf.destroy();
  }
}

async function contentStreams(bytes: Uint8Array): Promise<string> {
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

test('right-to-left lines extract in logical order, as whole words, without control characters', async () => {
  const result = await exportPdf(input, { useSystemFonts: false });
  const lines = await pageLines(result.bytes);
  for (const { text } of LINES) expect(lines).toContain(text);
  for (const line of lines) expect(line).not.toMatch(/[\u0000-\u0008\u200b\u2060\ufffd]/);
});

test('a right-to-left line has no line ActualText; a left-to-right line keeps it', async () => {
  const stream = await contentStreams((await exportPdf(input, { useSystemFonts: false })).bytes);
  // MuPDF and Poppler reverse a logical ActualText over right-to-left glyphs. Only the
  // left-to-right line carries one, and no glyph needs an empty one.
  const actualTexts = [...stream.matchAll(/\/ActualText <FEFF([0-9A-Fa-f]*)>/g)].map(([, hex]) =>
    String.fromCharCode(...(hex!.match(/.{4}/g) ?? []).map((unit) => parseInt(unit, 16)))
  );
  expect(actualTexts).toEqual(['Hello world 123']);
  expect(stream).not.toContain('/ActualText ()');
  // The separate dot glyphs are placed as outline forms, one `q … cm` per line and a short
  // relative move for each further dot.
  const placements = stream.match(/ Do\b/g)?.length ?? 0;
  const relative = stream.match(/^1 0 0 1 [-\d.]+ [-\d.]+ cm \/\w+ Do$/gm)?.length ?? 0;
  expect(placements).toBeGreaterThan(4);
  expect(relative).toBeGreaterThan(placements / 2);
});

test('each font CID extracts as one text, as MuPDF resolves it', async () => {
  // MuPDF reads ToUnicode per CID after the encoding CMap. BEH, TEH, NOON and YEH share one
  // dotless base glyph in Noto Sans Arabic, so one CID for all of them read them all as one.
  const pdf = await PDFDocument.load((await exportPdf(input, { useSystemFonts: false })).bytes);
  const streams = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    );
  const encodings = streams.filter((s) => s.includes('/CMapType 1'));
  const toUnicodes = streams.filter((s) => s.includes('/CMapType 2'));
  expect(encodings.length).toBeGreaterThan(0);
  expect(encodings.length).toBe(toUnicodes.length);
  // One face per pair, in the order the writer registers them.
  for (const [index, encoding] of encodings.entries()) {
    const cidOf = new Map(
      [...encoding.matchAll(/<([0-9a-fA-F]{4})> (\d+)/g)].map(([, code, cid]) => [code!, cid!])
    );
    const textsOfCid = new Map<string, Set<string>>();
    for (const [, code, text] of toUnicodes[index]!.matchAll(
      /<([0-9a-fA-F]{4})> <([0-9a-fA-F]*)>/g
    )) {
      const cid = cidOf.get(code!)!;
      const texts = textsOfCid.get(cid) ?? new Set();
      texts.add(text!.toLowerCase());
      textsOfCid.set(cid, texts);
    }
    for (const texts of textsOfCid.values()) expect(texts.size).toBe(1);
  }
});
