/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { cellDiagonalCommands } from '../src/table-cell-diagonals.ts';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';
test('diagonal PDF shares endpoints and balances cell clipping state', () => {
  const cell: any = {
    box: { x: 10, y: 20, width: 80, height: 30 },
    borders: {
      diagonals: [
        {
          direction: 'tr2bl',
          x1: 0,
          y1: 30,
          x2: 80,
          y2: 0,
          widthPt: 1,
          color: '123456',
          cssStyle: 'dotted',
          clipWidth: 80,
          clipHeight: 30,
        },
      ],
    },
  };
  const c = cellDiagonalCommands(cell, 5, 7, 200);
  expect(c[0]).toContain(' W n 0 J');
  expect(c[1]).toContain('15 143 m 95 173 l S');
  expect(c[1]).toContain('[1 2] 0 d');
  expect(c.at(-1)).toBe('Q');
  expect(cellDiagonalCommands({ box: cell.box } as any, 0, 0, 200)).toEqual([]);
});

test('diagonal table exports a complete PDF without changing source bytes', async () => {
  const input = docx(
    '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcBorders><w:tl2br w:val="single" w:sz="4"/><w:tr2bl w:val="dashed" w:sz="4"/></w:tcBorders></w:tcPr><w:p/></w:tc></w:tr></w:tbl>'
  );
  const before = input.slice();
  const result = await exportPdf(input, { useSystemFonts: false });
  expect(input).toEqual(before);
  expect(result.pageCount).toBe(1);
  const pdf = await PDFDocument.load(result.bytes);
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getSize().width).toBeGreaterThan(0);
  const contents = pdf.getPage(0).node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((reference) => pdf.context.lookup(reference))
      : [contents];
  const program = streams
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
    .join('\n');
  const slopes = [...program.matchAll(/(-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l S/g)]
    .map((match) => (Number(match[3]) - Number(match[1])) * (Number(match[4]) - Number(match[2])))
    .filter((slope) => slope !== 0);
  expect(slopes).toHaveLength(2);
  expect(slopes.some((slope) => slope < 0)).toBe(true);
  expect(slopes.some((slope) => slope > 0)).toBe(true);
  expect(program.match(/ W n 0 J/g)).toHaveLength(1);
});
