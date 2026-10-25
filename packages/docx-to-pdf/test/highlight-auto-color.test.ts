/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Automatic text colour follows the fill behind the text: a named highlight paints in place of
// the run's shading, so dark run shading under a light highlight keeps the text black.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const FAMILY = 'DejaVu Sans';
const bytes = new Uint8Array(
  readFileSync(
    new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
  )
);
const source = createFontSource(bytes, { family: FAMILY, weight: 400, style: 'normal' });
if ('failure' in source) throw new Error(JSON.stringify(source.failure));
const fontSource = source.source;

/** The fill colours the page content sets, in order. */
async function fills(runProperties: string, paragraphProperties = ''): Promise<string[]> {
  const body =
    `<w:p><w:pPr>${paragraphProperties}</w:pPr>` +
    `<w:r><w:rPr>${runProperties}</w:rPr><w:t>Text</w:t></w:r></w:p>`;
  const result = await exportPdf(docx(body), {
    useSystemFonts: false,
    fonts: { sources: [fontSource], defaultFont: { family: FAMILY, sizeHalfPoints: 22 } },
  });
  const parsed = await PDFDocument.load(result.bytes);
  const commands = parsed.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .join('\n');
  return [...commands.matchAll(/([\d.]+ [\d.]+ [\d.]+) rg/g)].map((match) => match[1]!);
}

const DARK_RUN = '<w:shd w:val="clear" w:color="auto" w:fill="000000"/>';
const YELLOW = '<w:highlight w:val="yellow"/>';

test('dark run shading alone turns automatic text white', async () => {
  expect(await fills(DARK_RUN)).toContain('1 1 1');
});

test('a named highlight over dark run shading keeps automatic text black', async () => {
  const colours = await fills(`${YELLOW}${DARK_RUN}`);
  expect(colours).toContain('1 1 0');
  expect(colours).not.toContain('1 1 1');
});

test('a named highlight leaves dark paragraph shading in charge', async () => {
  expect(await fills(YELLOW, DARK_RUN)).toContain('1 1 1');
});
