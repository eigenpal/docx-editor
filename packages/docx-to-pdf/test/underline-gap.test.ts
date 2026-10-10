/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument, linesOf, createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { underlineGap } from '../src/underline-gap.ts';

function line() {
  const opened = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>one two three four five six seven eight</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="3000" w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!opened.ok) throw new Error(opened.reason);
  return linesOf(
    layoutSemanticDocument(opened.part, 1, { measurer: createFixedMeasurer(6, 14) })
  )[0]!;
}

test('single underlines cover published justification without moving text', () => {
  const record = line();
  const span = record.spans[0]!,
    next = record.spans[1]!;
  const before = JSON.stringify(record);
  const gap = next.box.x - span.box.x - span.box.width;
  expect(gap).toBeGreaterThan(0.25);
  expect(underlineGap({ line: record, span })).toBeCloseTo(gap, 6);
  expect(JSON.stringify(record)).toBe(before);
});

test('underline joins stop at color changes, tabs, and float passages', () => {
  const record = line(),
    span = record.spans[0]!,
    next = record.spans[1]!;
  for (const replacement of [
    { ...next, style: { ...next.style, underline: { variant: 'single', color: 'FF0000' } } },
    { ...next, text: '\t' },
    { ...next, wrapAdvanceBefore: 12 },
    { ...next, style: { ...next.style, underline: null } },
    { ...next, style: { ...next.style, baselineShiftPt: 3 } },
  ])
    expect(underlineGap({ line: { ...record, spans: [span, replacement] }, span })).toBe(0);
});

test('exported PDF joins justified underline rectangles at the next text origin', async () => {
  const { exportPdf } = await import('../src/index.ts');
  const { docx } = await import('./fixture.ts');
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  const source = docx(
    '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>one two three four five six seven eight nine ten</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="3000" w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>'
  );
  const result = await exportPdf(source, { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const commands = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, obj]) =>
      obj instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(obj).decode())]
        : []
    )
    .filter((s) => s.includes(' Tm '))
    .join('\n');
  const rects = [...commands.matchAll(/rg ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g)].map(
    (m) => m.slice(1).map(Number)
  );
  expect(rects.length).toBeGreaterThan(2);
  const [first, second] = rects;
  expect(first![1]).toBeCloseTo(second![1]!, 5);
  expect(first![0]! + first![2]!).toBeCloseTo(second![0]!, 5);
});
