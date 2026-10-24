/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
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

const edge = (side: string, val: string) =>
  `<w:${side} w:val="${val}" w:sz="24" w:space="24" w:color="FF0000"/>`;
const pageBorder = (val: string) =>
  docx(
    paragraph('Body') +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>' +
      `<w:pgBorders w:offsetFrom="page">${['top', 'left', 'bottom', 'right'].map((s) => edge(s, val)).join('')}</w:pgBorders>` +
      '</w:sectPr>'
  );
const redFills = (stream: string) => [...stream.matchAll(/1 0 0 rg [\d.\s-]+ re f/g)].length;
const redDashes = (stream: string) => [...stream.matchAll(/1 0 0 RG [\d.]+ w \[/g)].length;

test('compound page borders paint filled bands, not dashes', async () => {
  for (const val of ['thinThickThinSmallGap', 'thickThinMediumGap']) {
    const stream = await commands(
      (await exportPdf(pageBorder(val), { fidelityPolicy: 'best-effort', useSystemFonts: false }))
        .bytes
    );
    expect(redDashes(stream)).toBe(0);
    // Two strokes on each of the four edges.
    expect(redFills(stream)).toBe(8);
  }
});

test('a triple page border paints three strokes on each edge', async () => {
  const stream = await commands(
    (
      await exportPdf(pageBorder('triple'), {
        fidelityPolicy: 'best-effort',
        useSystemFonts: false,
      })
    ).bytes
  );
  expect(redDashes(stream)).toBe(0);
  expect(redFills(stream)).toBe(12);
});

test('line styles without a dash pattern paint solid, and dashed styles keep dashes', async () => {
  const solid = await commands(
    (await exportPdf(pageBorder('inset'), { fidelityPolicy: 'best-effort', useSystemFonts: false }))
      .bytes
  );
  expect(redDashes(solid)).toBe(0);
  expect(redFills(solid)).toBe(4);
  const dashed = await commands(
    (
      await exportPdf(pageBorder('dashed'), {
        fidelityPolicy: 'best-effort',
        useSystemFonts: false,
      })
    ).bytes
  );
  expect(redDashes(dashed)).toBe(4);
});

test('a triple page border exports under the default strict policy', async () => {
  const result = await exportPdf(pageBorder('triple'), { useSystemFonts: false });
  expect(result.diagnostics.filter((d) => d.code === 'page-border-style')).toEqual([]);
});
