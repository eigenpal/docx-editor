/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
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

// A printer that converts the PDF to PostScript registers each CMap by name. When two
// fonts share a CMap name, the later font decodes its text through the first font's
// CMap, and every code past the first font's range prints as a missing glyph.
const bytes = new Uint8Array(
  readFileSync(new URL('../assets/NotoSansArabic-Regular.ttf', import.meta.url))
);
const original = create(Buffer.from(bytes)) as FontkitFont;
const admitted = {
  bytes,
  faceIndex: 0,
  request: { family: 'Noto Sans Arabic', weight: 400, style: 'normal' },
} as unknown as ExportAdmittedFontFace;

async function exportFaces(
  doc: PDFDocument,
  glyphCounts: readonly number[],
  faceIndex = (index: number) => index + 1
): Promise<void> {
  const work = new Work(new AbortController().signal);
  const subsetTags = new Set<string>();
  for (const [index, count] of glyphCounts.entries()) {
    const face = new EmbeddedFace(doc, admitted, faceIndex(index));
    for (let glyph = 1; glyph <= count; glyph++) face.encode(glyph, 'a');
    await face.finish(work, subsetTags);
  }
}

function cmapNames(doc: PDFDocument): string[] {
  return doc.context.enumerateIndirectObjects().flatMap(([, object]) => {
    if (!(object instanceof PDFRawStream)) return [];
    const text = new TextDecoder().decode(decodePDFRawStream(object).decode());
    const name = /\/CMapName \/(\S+) def/.exec(text)?.[1];
    if (name === undefined) return [];
    if (text.includes('/CMapType 1')) {
      expect(object.dict.get(PDFName.of('CMapName'))?.toString()).toBe(`/${name}`);
      expect(object.dict.get(PDFName.of('Type'))?.toString()).toBe('/CMap');
    }
    return [name];
  });
}

test('each embedded face has its own CMap and font names', async () => {
  expect(original.numGlyphs).toBeGreaterThan(40);
  const doc = await PDFDocument.create();
  await exportFaces(doc, [10, 40]);
  const names = cmapNames(doc);
  expect(names).toHaveLength(4);
  expect(new Set(names).size).toBe(4);

  // Font names come from the subset, so separate exports of different text differ and
  // repeated exports of the same text stay byte-stable.
  const again = await PDFDocument.create();
  await exportFaces(again, [10, 40]);
  expect(cmapNames(again)).toEqual(names);
  const other = await PDFDocument.create();
  await exportFaces(other, [12, 40]);
  expect(cmapNames(other)[0]).not.toBe(names[0]);
});

test('faces with byte-identical subsets still get distinct names', async () => {
  const doc = await PDFDocument.create();
  // Same face number and same glyphs give the same digest, so only the used-tag check
  // keeps the names apart.
  await exportFaces(doc, [10, 10, 10], () => 1);
  const names = cmapNames(doc);
  expect(names).toHaveLength(6);
  expect(new Set(names).size).toBe(6);
});
