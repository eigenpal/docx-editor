/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

function input(attributes = 'w:val="single" w:sz="4" w:space="0" w:color="FF0000"') {
  const border = `<w:bdr ${attributes}/>`;
  return docx(
    `<w:p><w:r><w:rPr>${border}</w:rPr><w:t>one</w:t></w:r><w:r><w:rPr>${border}<w:b/><w:highlight w:val="yellow"/></w:rPr><w:t>two</w:t></w:r><w:r><w:t>plain</w:t></w:r></w:p>`
  );
}

test('PDF paints one grouped character border after both runs and their highlights', async () => {
  const result = await exportPdf(input(), { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const parsed = await PDFDocument.load(result.bytes);
  const commands = parsed.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(object).decode())]
        : []
    )
    .filter((stream) => stream.includes(' Tm '))
    .join('\n');
  const red = [...commands.matchAll(/1 0 0 rg ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g)];
  expect(red).toHaveLength(4);
  expect(Number(red[0]![3])).toBeGreaterThan(25);
  // An authored 0.5pt border paints 0.48: the reference takes a rule's thickness down
  // to its 0.24pt device grid.
  expect(Number(red[0]![4])).toBe(0.48);
  expect(red[0]!.index).toBeGreaterThan(commands.lastIndexOf('1 1 0 rg'));
  expect(red[0]!.index).toBeGreaterThan(commands.lastIndexOf(' Tm '));
});

test('unsupported border variants remain explicit strict-export failures', async () => {
  await expect(exportPdf(input('w:val="wave" w:sz="4"'))).rejects.toMatchObject({
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'run-border-style' })]),
  });
});
