import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';
import { widenAutofitColumns } from '../table-autofit-widths.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const DXA_9000 = { type: 'dxa', value: 450 } as const;
const AUTO = { type: 'auto', value: 0 } as const;
const round = (widths: readonly number[]) => widths.map((width) => Math.round(width * 10) / 10);

describe('widenAutofitColumns', () => {
  // Minimums 25.7 / 301.4 / 31.9 pt: a URL in the middle column, one short word beside it.
  const minimums = [25.7, 301.4, 31.9];

  test('returns columns that already hold their content unchanged', () => {
    const widths = [250, 125, 75];
    expect(widenAutofitColumns(widths, [20, 100, 30], DXA_9000, 451.3)).toBe(widths);
  });

  test('takes the extra width from the other columns in proportion to their slack', () => {
    expect(round(widenAutofitColumns([250, 125, 75], minimums, DXA_9000, 451.3))).toEqual([
      102, 301.4, 46.6,
    ]);
    // A shorter unbroken word takes proportionally less.
    expect(
      round(widenAutofitColumns([250, 125, 75], [25.7, 158.6, 31.9], DXA_9000, 451.3))
    ).toEqual([221.8, 158.6, 69.6]);
  });

  test('a table without an absolute width first grows into the text column', () => {
    const widths = widenAutofitColumns([250, 125, 75], minimums, AUTO, 462.1);
    expect(round(widths)).toEqual([112.2, 301.4, 48.5]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(462.1, 6);
  });

  test('grows past the stated table width once the other columns reach their minimums', () => {
    expect(
      round(widenAutofitColumns([100, 50, 50], minimums, { type: 'dxa', value: 200 }, 451.3))
    ).toEqual(minimums);
  });

  test('scales every minimum down when together they exceed the text column', () => {
    const widths = widenAutofitColumns([150, 150, 150], [301.4, 301.4, 34], DXA_9000, 451.3);
    expect(round(widths)).toEqual([213.6, 213.6, 24.1]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(451.3, 6);
  });
});

describe('autofit layout', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const table = (layout: string, middle: string, extraCell = '') =>
    `<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/>${layout}<w:tblCellMar><w:left w:w="0" w:type="dxa"/>` +
    '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/>${extraCell}</w:tcPr><w:p>${middle}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
    '</w:tr></w:tbl>';
  const columns = (body: string) => {
    const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!read.ok) throw new Error(read.reason);
    const result = layoutSemanticDocument(read.part, 1, {
      measurer: createFixedMeasurer(6, 12),
      styleCascade: elevenPointDefaults(),
      geometry: { width: 300, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    });
    const fragment = result.pages[0]!.fragments.find(
      (candidate): candidate is TableFragmentRecord => candidate.kind === 'table'
    )!;
    const row = fragment.rows[0]!;
    return {
      widths: row.cells.map((cell) => Math.round(cell.box.width * 100) / 100),
      lines: row.cells.map(
        (cell) =>
          cell.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : [])).length
      ),
    };
  };

  test('widens a column to keep a 10-letter word whole', () => {
    // A 60 pt word in a 30 pt column. The others give the 30 pt in proportion to their
    // slack above their 12 pt minimums: 48 and 18 pt.
    const { widths, lines } = columns(table('', run('ABCDEFGHIJ')));
    expect(widths).toEqual([38.18, 60, 21.82]);
    expect(lines).toEqual([1, 1, 1]);
  });

  test('a field result and a hyphenated word count the same way', () => {
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://e/" </w:instrText></w:r>' +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('ABCDEFGHIJ')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    expect(columns(table('', field)).widths).toEqual([38.18, 60, 21.82]);
    // The hyphen is a break opportunity: the widest piece is `ABCDEFG-` (48 pt).
    expect(columns(table('', run('ABCDEFG-HIJ'))).widths[1]).toBe(48);
  });

  test('spaces split words, so ordinary text keeps the authored widths', () => {
    expect(columns(table('', run('AB CD EF GH IJ'))).widths).toEqual([60, 30, 30]);
  });

  test('a fixed layout and vertical text keep the authored widths', () => {
    expect(columns(table('<w:tblLayout w:type="fixed"/>', run('ABCDEFGHIJ'))).widths).toEqual([
      60, 30, 30,
    ]);
    expect(columns(table('', run('ABCDEFGHIJ'), '<w:textDirection w:val="btLr"/>')).widths).toEqual(
      [60, 30, 30]
    );
  });
});
