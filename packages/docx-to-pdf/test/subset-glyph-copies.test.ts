/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { create, type FontkitFont } from 'fontkit';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import type { ExportAdmittedFontFace } from '@docx-editor.dev/core/export';
import { Work } from '../src/context.ts';
import { EmbeddedFace } from '../src/fonts.ts';

// A glyph that extracts as two different texts is listed twice in the subset. Noto Sans
// Arabic has short `loca` offsets, which address 131070 bytes of `glyf`; the face's own
// `glyf` is 122 KB, so a copy of every glyph passes the limit. The offsets must not wrap.
const bytes = new Uint8Array(
  readFileSync(new URL('../assets/NotoSansArabic-Regular.ttf', import.meta.url))
);
const original = create(Buffer.from(bytes)) as FontkitFont;

test('glyph copies past the short loca limit keep every outline', async () => {
  const doc = await PDFDocument.create();
  const admitted = {
    bytes,
    faceIndex: 0,
    request: { family: 'Noto Sans Arabic', weight: 400, style: 'normal' },
  } as unknown as ExportAdmittedFontFace;
  const face = new EmbeddedFace(doc, admitted, 1);
  const glyphOfCode = new Map<string, number>();
  for (let glyph = 1; glyph < original.numGlyphs; glyph++)
    for (const text of ['a', 'b']) glyphOfCode.set(face.encode(glyph, text), glyph);
  await face.finish(new Work(new AbortController().signal));

  const streams = doc.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) => (object instanceof PDFRawStream ? [object] : []));
  const fontFile = streams.find((stream) => stream.dict.get(PDFName.of('Length1')));
  const encoding = streams
    .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
    .find((text) => text.includes('/CMapType 1'))!;
  const subset = create(Buffer.from(decodePDFRawStream(fontFile!).decode())) as FontkitFont & {
    loca: { offsets: number[] };
    head: { indexToLocFormat: number };
  };
  expect(subset.head.indexToLocFormat).toBe(1);
  const offsets = subset.loca.offsets;
  for (let i = 1; i < offsets.length; i++)
    expect(offsets[i]!).toBeGreaterThanOrEqual(offsets[i - 1]!);

  const outline = (font: FontkitFont, glyph: number) =>
    JSON.stringify(font.getGlyph(glyph).path.commands);
  let copies = 0;
  for (const [, code, cid] of encoding.matchAll(/<([0-9a-fA-F]{4})> (\d+)/g)) {
    const glyph = glyphOfCode.get(code!.toLowerCase())!;
    expect(outline(subset, Number(cid))).toBe(outline(original, glyph));
    copies += 1;
  }
  expect(copies).toBe(2 * (original.numGlyphs - 1));
});
