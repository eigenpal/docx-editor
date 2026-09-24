/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { flateStream, hex, unicodeHex } from '../src/context.ts';
import { docx, paragraph } from './fixture.ts';

const decoded = (stream: PDFRawStream): number[] => [...inflateSync(stream.getContents())];

// The native stream must decode to the bytes pdf-lib's own `flateStream` would have carried,
// including its low-byte reading of characters above U+00FF, and keep the caller's entries.
test('flateStream decodes to the bytes and dictionary pdf-lib would write', async () => {
  const doc = await PDFDocument.create();
  const text = 'BT /F1 12 Tf <0041> Tj ET éŁ€😀';
  const ours = flateStream(doc.context, text, { Length1: 7 });
  const theirs = doc.context.flateStream(text, { Length1: 7 });
  expect(decoded(ours)).toEqual(decoded(theirs));
  expect(ours.dict.get(PDFName.of('Filter'))).toEqual(PDFName.of('FlateDecode'));
  expect(ours.dict.get(PDFName.of('Length1'))?.toString()).toBe('7');
  const bytes = new Uint8Array([0, 1, 254, 255]);
  expect(decoded(flateStream(doc.context, bytes))).toEqual([0, 1, 254, 255]);
});

test('hex writes four lower-case digits for every UTF-16 unit', () => {
  const slow = (value: number): string => value.toString(16).padStart(4, '0');
  for (const value of [0, 1, 0x1f, 0xff, 0x100, 0xabcd, 0xfffe, 0xffff])
    expect(hex(value)).toBe(slow(value));
  for (const value of [0x10000, 0x10ffff, 1.5, -1]) expect(hex(value)).toBe(slow(value));
  expect(unicodeHex('Aé😀')).toBe('004100e9d83dde00');
});

// Each page names every face its text uses, even when the face was first used on another page.
test('every page names the fonts drawn on it', async () => {
  const body =
    paragraph('First page') +
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    paragraph('Second page') +
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    paragraph('Third page');
  const result = await exportPdf(docx(body), { useSystemFonts: false });
  const pdf = await PDFDocument.load(result.bytes);
  const pages = pdf.getPages();
  expect(pages.length).toBe(3);
  for (const page of pages) {
    const resources = page.node.Resources()!;
    const fonts = resources.lookup(PDFName.of('Font'), PDFDict);
    expect(fonts.keys().length).toBeGreaterThan(0);
  }
});
