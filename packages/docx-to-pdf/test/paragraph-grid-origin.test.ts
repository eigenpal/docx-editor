/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';
import { glyphPositions } from './glyph-positions.ts';

const GRID = 0.24;
// 1276 twips is 63.8pt, which is not a whole device unit. The reference rounds the
// paragraph's left edge to the grid before it advances any glyph.
const SECTION =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1276" w:bottom="1440" w:left="1276" w:header="720" w:footer="720" w:gutter="0"/>' +
  '</w:sectPr>';
const onGrid = (value: number): boolean => Math.abs(value / GRID - Math.round(value / GRID)) < 1e-6;

test('a left-aligned paragraph starts on the device grid', async () => {
  const result = await exportPdf(
    docx(`<w:p><w:r><w:t xml:space="preserve">Origin</w:t></w:r></w:p>${SECTION}`),
    { useSystemFonts: false }
  );
  expect(result.diagnostics).toEqual([]);
  const xs = await glyphPositions(result.bytes);
  expect(xs.length).toBeGreaterThan(0);
  expect(onGrid(xs[0]!)).toBe(true);
});

test('a centered paragraph is not itself rounded onto the grid', async () => {
  const centered =
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Centered</w:t></w:r></w:p>';
  const left = '<w:p><w:r><w:t xml:space="preserve">Centered</w:t></w:r></w:p>';
  const run = async (body: string): Promise<number> => {
    const result = await exportPdf(docx(`${body}${SECTION}`), { useSystemFonts: false });
    expect(result.diagnostics).toEqual([]);
    const xs = await glyphPositions(result.bytes);
    expect(xs.length).toBeGreaterThan(0);
    return xs[0]!;
  };
  const centeredX = await run(centered);
  const leftX = await run(left);
  // The edge is rounded once, so the left-aligned start lands on the grid and the centered
  // start, measured from that same rounded edge, does not.
  expect(onGrid(leftX)).toBe(true);
  expect(onGrid(centeredX)).toBe(false);
  expect(centeredX).toBeGreaterThan(leftX);
});
