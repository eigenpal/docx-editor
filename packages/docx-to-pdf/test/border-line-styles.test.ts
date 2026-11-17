/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The patterned and multi-stroke `ST_Border` line styles (ECMA-376 §17.18.2) in the PDF.
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

async function commands(bytes: Uint8Array): Promise<string> {
  const parsed = await PDFDocument.load(bytes);
  return parsed.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .join('\n');
}

const options = { fidelityPolicy: 'best-effort', useSystemFonts: false } as const;

function cellWithTop(val: string, sz: number, color: string): Uint8Array {
  return docx(
    '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr>' +
      '<w:tcW w:w="4000" w:type="dxa"/><w:tcBorders>' +
      `<w:top w:val="${val}" w:sz="${sz}" w:space="0" w:color="${color}"/>` +
      `</w:tcBorders></w:tcPr>${paragraph('x')}</w:tc></w:tr></w:tbl>`
  );
}

/** Fill colours of the filled rectangles in `stream`, as PDF `rg` operands. */
const fills = (stream: string) =>
  [...stream.matchAll(/([\d.]+ [\d.]+ [\d.]+) rg [\d.\s-]+ re f\b/g)].map((match) => match[1]);
const rgb = (hex: string) =>
  [0, 2, 4]
    .map((index) => {
      const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
      return Number(value.toFixed(6)).toString();
    })
    .join(' ');
const bordered = (pBdr: string) =>
  docx(`<w:p><w:pPr><w:pBdr>${pBdr}</w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`);

test('a three-dimensional table edge paints three toned strokes', async () => {
  const stream = await commands(
    (await exportPdf(cellWithTop('threeDEngrave', 48, '33CCCC'), options)).bytes
  );
  const painted = fills(stream);
  // Engrave from the outside in: dark, middle, light (the edge colour itself).
  expect(painted).toContain(rgb('114444'));
  expect(painted).toContain(rgb('33CCCC'));
});

test('a dashDotStroked table edge paints a clipped hatch, not a solid rule', async () => {
  const stream = await commands(
    (await exportPdf(cellWithTop('dashDotStroked', 24, 'FF0000'), options)).bytes
  );
  expect(stream).toMatch(/re W n 1 0 0 RG 0\.24 w 0 J [\d.\s-]+m [\d.\s-]+l/);
  expect(fills(stream)).not.toContain('1 0 0');
});

test('dashed table and paragraph edges use the measured dash lengths', async () => {
  const table = await commands(
    (await exportPdf(cellWithTop('dotDash', 8, 'FF0000'), options)).bytes
  );
  // 7, 3, 3 and 3 widths of a 1pt rule.
  expect(table).toMatch(/1 0 0 RG 1 w 0 J \[7 3 3 3\] [\d.]+ d/);
  const para = await commands(
    (
      await exportPdf(
        bordered('<w:top w:val="dashed" w:sz="16" w:space="1" w:color="FF0000"/>'),
        options
      )
    ).bytes
  );
  expect(para).toMatch(/1 0 0 RG 2 w 0 J \[8 8\] [\d.]+ d/);
});

test('a thin-thick paragraph rule paints its authored strokes', async () => {
  const stream = await commands(
    (
      await exportPdf(
        bordered('<w:top w:val="thinThickLargeGap" w:sz="24" w:space="1" w:color="FF0000"/>'),
        options
      )
    ).bytes
  );
  // A 1.5pt and a 0.75pt stroke (on the 0.24pt paint grid), not two thirds of the band.
  const heights = [...stream.matchAll(/1 0 0 rg [\d.-]+ [\d.-]+ [\d.]+ ([\d.]+) re f/g)].map(
    (match) => Number(match[1])
  );
  expect(heights).toEqual([1.44, 0.72]);
});
