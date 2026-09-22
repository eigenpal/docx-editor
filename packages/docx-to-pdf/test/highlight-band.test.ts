/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';
import { baselineYPositions } from './glyph-positions.ts';

const FAMILY = 'DejaVu Sans';
// DejaVu Sans: ascender 1901, descender -483, no line gap, over 2048 units per em.
const DESCENT_EM = 483 / 2048;
const bytes = new Uint8Array(
  readFileSync(
    new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
  )
);
const source = createFontSource(bytes, { family: FAMILY, weight: 400, style: 'normal' });
if ('failure' in source) throw new Error(JSON.stringify(source.failure));
const fontSource = source.source;

const SECTION =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/>' +
  '</w:sectPr>';

async function yellowBands(body: string): Promise<{ bottom: number; top: number }[]> {
  const result = await exportPdf(docx(`${body}${SECTION}`), {
    useSystemFonts: false,
    fonts: { sources: [fontSource], defaultFont: { family: FAMILY, sizeHalfPoints: 22 } },
  });
  expect(
    result.diagnostics.filter(
      (entry) => entry.code !== 'incomplete-font' || entry.severity !== 'information'
    )
  ).toEqual([]);
  const parsed = await PDFDocument.load(result.bytes);
  const commands = parsed.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .join('\n');
  return [...commands.matchAll(/1 1 0 rg ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g)].map(
    (m) => ({ bottom: Number(m[2]), top: Number(m[2]) + Number(m[4]) })
  );
}

const run = (text: string, halfPoints: number, extra = '') =>
  `<w:r><w:rPr><w:sz w:val="${halfPoints}"/>${extra}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

test('a highlighted run on a taller line seats its band on the baseline, not the line top', async () => {
  const body = `<w:p>${run('Large ', 36)}${run('small', 22, '<w:highlight w:val="yellow"/>')}</w:p>`;
  const bands = await yellowBands(body);
  expect(bands).toHaveLength(1);
  const result = await exportPdf(docx(`${body}${SECTION}`), {
    useSystemFonts: false,
    fonts: { sources: [fontSource], defaultFont: { family: FAMILY, sizeHalfPoints: 22 } },
  });
  const [baseline] = await baselineYPositions(result.bytes);
  expect(baseline).toBeDefined();
  // The band ends one descent under the baseline of the 11pt run it covers, on the paint
  // grid, and starts that run's own ascent above it: the 18pt run's extra height above
  // stays unfilled.
  expect(bands[0]!.bottom).toBeCloseTo(baseline! - 11 * DESCENT_EM, 0);
  expect(bands[0]!.top - bands[0]!.bottom).toBeCloseTo((11 * (1901 + 483)) / 2048, 0);
  const pageHeight = 792;
  const lineTop = pageHeight - 36;
  expect(bands[0]!.top).toBeLessThan(lineTop - 5);
});

test('a highlighted superscript carries its band up with the raised glyphs', async () => {
  const plain = await yellowBands(
    `<w:p>${run('x', 22)}${run('2', 22, '<w:highlight w:val="yellow"/>')}</w:p>`
  );
  const raised = await yellowBands(
    `<w:p>${run('x', 22)}${run('2', 22, '<w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/>')}</w:p>`
  );
  expect(plain).toHaveLength(1);
  expect(raised).toHaveLength(1);
  expect(raised[0]!.bottom).toBeGreaterThan(plain[0]!.bottom + 2);
  expect(raised[0]!.top - raised[0]!.bottom).toBeLessThan(plain[0]!.top - plain[0]!.bottom);
});
