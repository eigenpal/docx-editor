/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

async function contentStreams(body: string): Promise<string> {
  const result = await exportPdf(docx(body), { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  return pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .join('\n');
}

const table = (tblPr: string) =>
  `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/>${tblPr}` +
  `<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>` +
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph('a')}</w:tc>` +
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${paragraph('b')}</w:tc>` +
  `</w:tr></w:tbl>${paragraph('')}`;

// 217 226 243 over 255.
const FILL = '0.85098 0.886275 0.952941 rg';

test('a spaced table fills its gaps with one even-odd path that leaves the cells out', async () => {
  const streams = await contentStreams(table('<w:tblCellSpacing w:w="100" w:type="dxa"/>'));
  const rect = '([\\d.]+) ([\\d.]+) ([\\d.]+) ([\\d.]+) re';
  // The band, then one hole per cell, filled even-odd.
  const match = new RegExp(`${FILL} ${rect} ${rect} ${rect} f\\*`).exec(streams);
  expect(match).not.toBeNull();
  const [band, ...cells] = [1, 5, 9].map((at) => match!.slice(at, at + 4).map(Number));
  for (const [x, y, width, height] of cells as [number, number, number, number][]) {
    const [bx, by, bw, bh] = band as [number, number, number, number];
    expect(x).toBeGreaterThan(bx);
    expect(y).toBeGreaterThan(by);
    expect(x + width).toBeLessThan(bx + bw);
    expect(y + height).toBeLessThan(by + bh);
  }
});

test('a table without spacing paints no table fill', async () => {
  const streams = await contentStreams(table(''));
  expect(streams.includes(FILL)).toBe(false);
});
