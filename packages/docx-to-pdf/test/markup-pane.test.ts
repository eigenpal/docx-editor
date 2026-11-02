/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { commentsInOrder, placeOnSheet } from '../src/markup-pane.ts';
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

test('comments on the same text follow the order of their reference marks', async () => {
  // Both ranges cover the same characters; the second comment's mark comes first.
  const input = docx(
    '<w:p><w:commentRangeStart w:id="0"/><w:commentRangeStart w:id="1"/><w:r><w:t>Shared</w:t></w:r><w:commentRangeEnd w:id="1"/><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="1"/></w:r><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    comments(
      '<w:comment w:id="0" w:author="Reviewer" w:initials="RV"><w:p><w:r><w:t>First</w:t></w:r></w:p></w:comment>' +
        '<w:comment w:id="1" w:author="Second Person" w:initials="SP"><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:comment>'
    )
  );
  expect(await balloonLabels(input)).toEqual(['Commented [SP1]: Second', 'Commented [RV2]: First']);
});

test('ranges that end together but start apart follow the order of their reference marks', async () => {
  const input = docx(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve">Long shared </w:t></w:r><w:commentRangeStart w:id="1"/><w:r><w:t>text</w:t></w:r><w:commentRangeEnd w:id="1"/><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="1"/></w:r><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    comments(
      '<w:comment w:id="0" w:author="Reviewer" w:initials="RV"><w:p><w:r><w:t>Wide</w:t></w:r></w:p></w:comment>' +
        '<w:comment w:id="1" w:author="Second Person" w:initials="SP"><w:p><w:r><w:t>Narrow</w:t></w:r></w:p></w:comment>'
    )
  );
  expect(await balloonLabels(input)).toEqual(['Commented [SP1]: Narrow', 'Commented [RV2]: Wide']);
});

/** A layout with only the comment fields that ordering reads. */
function orderedTexts(
  artifacts: readonly {
    readonly text: string;
    readonly referenceOrder?: number;
    readonly parentId?: string;
    readonly end?: readonly [x: number, width: number];
  }[]
): string[] {
  const reviewArtifacts = artifacts.map(({ text, referenceOrder, parentId, end }) => ({
    kind: 'comment',
    id: text,
    text,
    ...(referenceOrder === undefined ? {} : { referenceOrder }),
    ...(parentId === undefined ? {} : { parentId }),
    occurrences: end
      ? [
          {
            rootStory: 'body',
            pageIndex: 0,
            geometry: { pageStack: [{ x: end[0], y: 100, width: end[1], height: 12 }] },
          },
        ]
      : [],
  }));
  const layout = { reviewArtifacts } as unknown as Parameters<typeof commentsInOrder>[0];
  return commentsInOrder(layout).map((comment) => comment.text);
}

test('a reply with no range or mark stays after its parent among tied comments', () => {
  // Listed parent, reply, other; all end together and the other comment's mark comes first.
  expect(
    orderedTexts([
      { text: 'Parent', referenceOrder: 1, end: [72, 30] },
      { text: 'Reply', parentId: 'Parent' },
      { text: 'Other', referenceOrder: 0, end: [72, 30] },
    ])
  ).toEqual(['Other', 'Parent', 'Reply']);
});

test('ranges that end at the same place tie despite float noise in their boxes', () => {
  // 0.1 + 0.2 is 0.30000000000000004, a hair past 0.3, but its mark comes first.
  expect(
    orderedTexts([
      { text: 'Narrow', referenceOrder: 1, end: [0, 0.3] },
      { text: 'Wide', referenceOrder: 0, end: [0.1, 0.2] },
    ])
  ).toEqual(['Wide', 'Narrow']);
});

test('a range that ends before a later page part is numbered where it ends', () => {
  // A split table row: the commented middle cell runs onto page 2, the range ends on page 1.
  const occurrence = (pageIndex: number, y: number) => ({
    rootStory: 'body',
    pageIndex,
    geometry: { pageStack: [{ x: 72, y, width: 100, height: 12 }] },
  });
  const reviewArtifacts = [
    { kind: 'comment', id: 'Later', text: 'Later', occurrences: [occurrence(0, 700)] },
    {
      kind: 'comment',
      id: 'Split',
      text: 'Split',
      occurrences: [occurrence(0, 500), occurrence(1, 100), occurrence(0, 600)],
    },
  ];
  const layout = { reviewArtifacts } as unknown as Parameters<typeof commentsInOrder>[0];
  expect(commentsInOrder(layout).map((comment) => comment.text)).toEqual(['Split', 'Later']);
});
