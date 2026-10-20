/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';

// Sample the final color at the center of every published border rectangle.
// This catches real occlusion, even when the border exists in the PDF stream.
for (const paragraphFill of [false, true]) {
  test(`shaded cells preserve shared borders (paragraph shading: ${paragraphFill})`, async () => {
    const cell = `<w:tc><w:tcPr><w:shd w:fill="0000FF"/><w:tcMar>${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}</w:tcMar></w:tcPr>${paragraphFill ? '<w:p><w:pPr><w:shd w:fill="00FF00"/></w:pPr><w:r><w:t>Cell</w:t></w:r></w:p>' : paragraph('Cell')}</w:tc>`;
    const input = docx(
      `<w:tbl><w:tblPr><w:tblBorders>${['top', 'bottom', 'left', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="single" w:sz="16" w:color="FF0000"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr>${cell}${cell}</w:tr><w:tr>${cell}${cell}</w:tr></w:tbl>`
    );
    const result = await exportPdf(input, { useSystemFonts: false });
    expect(result.diagnostics).toEqual([]);
    const pdf = await PDFDocument.load(result.bytes);
    const commands = pdf.context
      .enumerateIndirectObjects()
      .flatMap(([, object]) =>
        object instanceof PDFRawStream
          ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
          : []
      )
      .filter((stream) => stream.includes(' Tm '))
      .join('\n');
    const rectangles = [
      ...commands.matchAll(
        /([\d.]+) ([\d.]+) ([\d.]+) rg ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g
      ),
    ].map((match) => ({ color: match.slice(1, 4).join(' '), box: match.slice(4).map(Number) }));
    const borders = rectangles.filter((r) => r.color === '1 0 0');
    expect(borders.length).toBeGreaterThanOrEqual(8);
    for (const border of borders) {
      const [x, y, width, height] = border.box as [number, number, number, number];
      const px = x + width / 2,
        py = y + height / 2;
      const covering = rectangles.filter(
        ({ box: [rx, ry, rw, rh] }) => px > rx! && px < rx! + rw! && py > ry! && py < ry! + rh!
      );
      expect(covering.at(-1)?.color).toBe('1 0 0');
    }
  });
}
