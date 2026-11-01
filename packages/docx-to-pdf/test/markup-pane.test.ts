/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { placeOnSheet } from '../src/markup-pane.ts';
import { patternFillOperator } from '../src/vector-pattern.ts';
import { docx } from './fixture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const comments = (body: string) => ({
  'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="comments" Type="${R}/comments" Target="comments.xml"/></Relationships>`,
  'word/comments.xml': `<w:comments xmlns:w="${W}">${body}</w:comments>`,
});
const note =
  '<w:comment w:id="0" w:author="Reviewer" w:initials="RV"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:comment>';
const commented =
  '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Commented text</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>';

async function textItems(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const items = (await page.getTextContent()).items.flatMap((i) => ('str' in i ? [i] : []));
    return { items, annotations: await page.getAnnotations() };
  } finally {
    await pdf.destroy();
  }
}

test('a comment with no place in the body keeps the page size and a visible note', async () => {
  const input = docx('<w:p><w:r><w:t>Body text</w:t></w:r></w:p>', comments(note));
  const marked = await textItems((await exportPdf(input, { useSystemFonts: false })).bytes);
  const plain = await textItems(
    (await exportPdf(input, { useSystemFonts: false, comments: false })).bytes
  );
  expect(marked.items.map((i) => i.transform)).toEqual(plain.items.map((i) => i.transform));
  expect(marked.items.map((i) => i.str).join('')).not.toContain('Commented [');
  expect(marked.annotations).toHaveLength(1);
  expect(marked.annotations[0]!.subtype).toBe('Text');
});

test('a page with room for the pane beside it is not enlarged', async () => {
  // A 1190pt page whose text area ends at 900pt: the pane fits without shrinking the page.
  const section =
    '<w:sectPr><w:pgSz w:w="23800" w:h="16840"/><w:pgMar w:top="1440" w:right="5800" w:bottom="1440" w:left="1440"/></w:sectPr>';
  const input = docx(commented + section, comments(note));
  const marked = await textItems((await exportPdf(input, { useSystemFonts: false })).bytes);
  const plain = await textItems(
    (await exportPdf(input, { useSystemFonts: false, comments: false })).bytes
  );
  const body = (items: typeof marked.items) =>
    items.find((i) => i.str.startsWith('Commented') && !i.str.includes('['))!;
  expect(body(marked.items).transform[0]).toBeCloseTo(body(plain.items).transform[0], 3);
  expect(body(marked.items).transform[3]).toBeCloseTo(body(plain.items).transform[3], 3);
});

test('pattern fills shrink and move with the page they fill', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  patternFillOperator(doc, page, {
    background: { hex: 'FFFFFF', alpha: 1 },
    foreground: { hex: '000000', alpha: 1 },
    rows: [0xff, 0, 0, 0, 0, 0, 0, 0],
  } as unknown as Parameters<typeof patternFillOperator>[2]);
  placeOnSheet(page, { scale: 0.75, left: 0.96, top: 99, paneLeft: 500 }, new Set());
  const patterns = page.node.Resources()!.lookup(PDFName.of('Pattern'), PDFDict);
  const [[, ref]] = patterns.entries();
  const stream = doc.context.lookup(ref) as unknown as { dict: PDFDict };
  const matrix = stream.dict.lookup(PDFName.of('Matrix'), PDFArray);
  const values = matrix.asArray().map((value) => (value as PDFNumber).asNumber());
  expect(values).toEqual([0.75, 0, 0, 0.75, 0.96, 792 - 99 - 0.75 * 792]);
});

const balloonLabels = async (input: Uint8Array) =>
  (await textItems((await exportPdf(input, { useSystemFonts: false })).bytes)).items
    .map((item) => item.str)
    .join('')
    .match(/Commented \[[^\]]*\]: [A-Z][a-z]+/g);

test('balloons number comments in the order their ranges end, with declared initials only', async () => {
  // The outer range starts first but ends last; the second comment declares no initials.
  const input = docx(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Outer </w:t></w:r><w:commentRangeStart w:id="1"/><w:r><w:t>inner</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r><w:r><w:t> text</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    comments(
      '<w:comment w:id="0" w:author="Reviewer" w:initials="RV"><w:p><w:r><w:t>Outer</w:t></w:r></w:p></w:comment>' +
        '<w:comment w:id="1" w:author="Second Person" w:initials=""><w:p><w:r><w:t>Inner</w:t></w:r></w:p></w:comment>'
    )
  );
  expect(await balloonLabels(input)).toEqual(['Commented [1]: Inner', 'Commented [RV2]: Outer']);
});

test('a comment on a point, with no range, still gets its balloon', async () => {
  const input = docx(
    '<w:p><w:r><w:t>Before</w:t></w:r><w:commentRangeStart w:id="0"/><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:r><w:t> after</w:t></w:r></w:p>',
    comments(note)
  );
  expect(await balloonLabels(input)).toEqual(['Commented [RV1]: Note']);
});
