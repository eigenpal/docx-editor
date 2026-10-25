/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

const NUMBERING = `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="357" w:hanging="357"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
const parts = {
  'word/_rels/document.xml.rels':
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
  'word/numbering.xml': NUMBERING,
};
const numbered = (bidi = '') =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>${bidi}</w:pPr></w:p>`;
const plain = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

async function items(input: Uint8Array) {
  const result = await exportPdf(input, { useSystemFonts: false });
  const pdf = await getDocument({ data: result.bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    return content.items.flatMap((item) =>
      'str' in item && item.str.trim()
        ? [{ text: item.str.trim(), x: item.transform[4] as number }]
        : []
    );
  } finally {
    await pdf.destroy();
  }
}

test('an empty numbered paragraph still draws its number', async () => {
  const texts = (await items(docx(numbered() + numbered() + plain('after'), parts))).map(
    (item) => item.text
  );
  expect(texts).toEqual(['1.', '2.', 'after']);
});

// A narrow right-to-left numbering column whose cells a vertical merge continues, as forms
// number their questions: the hanging indent is wider than the cell.
const cell = (content: string, vMerge: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="300" w:type="dxa"/>${vMerge}</w:tcPr>${content}</w:tc>`;
const textCell = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const row = (cells: string) => `<w:tr>${cells}</w:tr>`;
const question = (text: string) =>
  row(cell(numbered('<w:bidi/>'), '<w:vMerge w:val="restart"/>') + textCell(text)) +
  row(cell(numbered('<w:bidi/>'), '<w:vMerge/>') + textCell(`${text} answer`));
// `w:bidiVisual`: the first cell, the numbering column, is the right-hand one.
const table = `<w:tbl><w:tblPr><w:bidiVisual/><w:tblBorders><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="300"/><w:gridCol w:w="4000"/></w:tblGrid>${question('first')}${question('second')}</w:tbl>`;

test('merged-away numbered cells do not advance the count, and the number stays in its cell', async () => {
  const found = await items(docx(table + plain(''), parts));
  // A right-to-left marker draws as pieces: the period, then the number.
  const numbers = found.filter((item) => /^\d+$/.test(item.text));
  expect(numbers.map((item) => item.text)).toEqual(['1', '2']);
  // The numbering column is the right-hand one, so its numbers stand right of every answer.
  const rightmostText = Math.max(
    ...found.filter((item) => /\p{L}/u.test(item.text)).map((item) => item.x)
  );
  for (const number of numbers) expect(number.x).toBeGreaterThan(rightmostText);
});
