/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx, paragraph } from './fixture.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
async function read(bytes: Uint8Array) {
  return getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
}

test('native comment ranges and comments flag preserve text and pages', async () => {
  const input = docx(
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Commented text</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>',
    {
      'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="comments" Type="${R}/comments" Target="comments.xml"/></Relationships>`,
      'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>Please check café.</w:t></w:r></w:p></w:comment></w:comments>`,
    }
  );
  const withComments = await exportPdf(input),
    without = await exportPdf(input, { comments: false });
  const a = await read(withComments.bytes),
    b = await read(without.bytes);
  try {
    const annotations = await (await a.getPage(1)).getAnnotations();
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.subtype).toBe('Highlight');
    expect(annotations[0]!.contentsObj.str).toBe('Please check café.');
    expect(annotations[0]!.titleObj.str).toBe('Reviewer');
    expect(await (await b.getPage(1)).getAnnotations()).toHaveLength(0);
    const contentA = await (await a.getPage(1)).getTextContent(),
      contentB = await (await b.getPage(1)).getTextContent();
    const comparable = (items: typeof contentA.items) =>
      items.map((i) => ('str' in i ? { str: i.str, transform: i.transform, width: i.width } : i));
    expect(comparable(contentA.items)).toEqual(comparable(contentB.items));
  } finally {
    await a.destroy();
    await b.destroy();
  }
});

test('proposed, original, and markup views never mutate the DOCX', async () => {
  const input = docx(
    '<w:p><w:del w:id="0" w:author="Author"><w:r><w:delText>Old</w:delText></w:r></w:del><w:ins w:id="1" w:author="Author"><w:r><w:t>New</w:t></w:r></w:ins></w:p>'
  );
  const before = input.slice();
  for (const [mode, expected] of [
    ['proposed', 'New'],
    ['original', 'Old'],
    ['all-markup', 'OldNew'],
  ] as const) {
    const result = await exportPdf(input, { displayMode: mode });
    const pdf = await read(result.bytes);
    try {
      const contents = await (await pdf.getPage(1)).getTextContent();
      expect(
        contents.items
          .map((i) => ('str' in i ? i.str : ''))
          .join('')
          .replace(/ /g, '')
      ).toBe(expected);
    } finally {
      await pdf.destroy();
    }
  }
  expect(input).toEqual(before);
});

test('table shading, compound borders and cell text export strictly', async () => {
  const table = `<w:tbl><w:tblPr><w:tblBorders>${['top', 'bottom', 'left', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="double" w:sz="12" w:color="000080"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:shd w:fill="DDEEFF"/></w:tcPr>${paragraph('Cell A')}</w:tc><w:tc>${paragraph('Cell B')}</w:tc></w:tr></w:tbl>`;
  const result = await exportPdf(docx(table));
  expect(result.diagnostics).toEqual([]);
  const pdf = await read(result.bytes);
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    expect(content.items.map((i) => ('str' in i ? i.str : '')).join('')).toContain('Cell A');
  } finally {
    await pdf.destroy();
  }
});

test('CFF font subsets extract text', async () => {
  const result = await exportPdf(
    docx(
      paragraph(
        'Century Gothic text',
        '<w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/></w:rPr>'
      )
    )
  );
  expect(result.diagnostics).toEqual([]);
  const pdf = await read(result.bytes);
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    expect(content.items.map((i) => ('str' in i ? i.str : '')).join('')).toBe(
      'Century Gothic text'
    );
  } finally {
    await pdf.destroy();
  }
});
