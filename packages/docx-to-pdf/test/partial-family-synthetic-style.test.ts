/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A face that a partly served family lacks draws as a synthesized style of the served face.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../core/src/layout/__tests__/fixtures/fonts/${name}`, import.meta.url))
  );
function fontSource(family: string, weight: number, file: string) {
  const created = createFontSource(fixture(file), { family, weight, style: 'normal' });
  if ('failure' in created) throw new Error(JSON.stringify(created.failure));
  return created.source;
}
const upright = (from: string, to: string, weight: number) => ({
  from: { family: from, weight, style: 'normal' as const },
  to: { family: to, weight, style: 'normal' as const },
});
// The host serves Brand Light in regular and bold, and Brand Book in regular only.
const fonts = {
  sources: [
    fontSource('Stand In', 400, 'DejaVuSans.ttf'),
    fontSource('Stand In', 700, 'DejaVuSans-Bold.ttf'),
    fontSource('Book Stand In', 400, 'DejaVuSans.ttf'),
  ],
  substitutions: [
    upright('Brand Light', 'Stand In', 400),
    upright('Brand Light', 'Stand In', 700),
    upright('Brand Book', 'Book Stand In', 400),
  ],
};

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

async function extracted(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    return content.items.map((item) => ('str' in item ? item.str : '')).join('');
  } finally {
    await pdf.loadingTask.destroy();
  }
}

const run = (family: string, rPr: string, text: string) =>
  docx(
    `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/>${rPr}</w:rPr><w:t>${text}</w:t></w:r></w:p>`
  );

test('an italic that the host does not serve draws as a slanted served face', async () => {
  const result = await exportPdf(run('Brand Light', '<w:i/>', 'Slanted text'), {
    useSystemFonts: false,
    fidelityPolicy: 'best-effort',
    fonts,
  });
  expect(result.diagnostics.map(({ code }) => code)).not.toContain('unshaped-text');
  const stream = await contentStreams(result.bytes);
  expect(stream).toMatch(/1 0 0\.339844 1 [\d.]+ [\d.]+ Tm/);
  expect(stream).not.toContain('2 Tr');
  expect(await extracted(result.bytes)).toBe('Slanted text');
});

test('a bold that the host does not serve draws as a stroked served face', async () => {
  const result = await exportPdf(run('Brand Book', '<w:b/>', 'Heavy text'), {
    useSystemFonts: false,
    fidelityPolicy: 'best-effort',
    fonts,
  });
  expect(result.diagnostics.map(({ code }) => code)).not.toContain('unshaped-text');
  const stream = await contentStreams(result.bytes);
  expect(stream).toContain('2 Tr');
  expect(stream).not.toMatch(/ 0\.339844 /);
  expect(await extracted(result.bytes)).toBe('Heavy text');
});
