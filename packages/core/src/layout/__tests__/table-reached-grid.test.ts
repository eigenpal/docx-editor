import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const GRID = [1684, 1868, 1747, 4781];
const TEXT =
  'Text long enough to wrap across the whole text column of this page at least once more.';
const cell = (width: string, text = TEXT) =>
  `<w:tc><w:tcPr>${width}</w:tcPr><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
const dxa = (twips: number) => `<w:tcW w:w="${twips}" w:type="dxa"/>`;

/** Cell boxes `[x, width]` of each row of one centered automatic-width table, in points. */
function rows(
  trs: string,
  options: { grid?: number[]; tblPr?: string; mode?: number } = {}
): number[][][] {
  const grid = (options.grid ?? GRID).map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
      `<w:jc w:val="center"/>${options.tblPr ?? ''}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl>` +
      '<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    compatibilityMode: options.mode ?? 15,
  });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  return table.rows.map((row) =>
    row.cells.map((c) => [Math.round(c.box.x * 10) / 10, Math.round(c.box.width * 10) / 10])
  );
}

// The text column is 432pt wide. Measured in a mode-15 reference render of the same tables.
test('grid columns no cell reaches take no width', () => {
  // A cell wider than the text column fills it.
  expect(rows(`<w:tr>${cell(dxa(10080))}</w:tr>`)).toEqual([[[0, 432]]]);
  // A narrower cell keeps its own width and is centered as a one-column table would be.
  expect(rows(`<w:tr>${cell(dxa(3000))}</w:tr>`)).toEqual([[[141, 150]]]);
  expect(rows(`<w:tr>${cell(dxa(3000))}</w:tr>`, { grid: [1684] })).toEqual([[[141, 150]]]);
  // A cell with no width of its own is sized by its text, up to the text column.
  expect(rows(`<w:tr>${cell('')}</w:tr>`)).toEqual([[[0, 432]]]);
});

test('columns that only a row end skip reaches take no width either', () => {
  const after = '<w:trPr><w:gridAfter w:val="3"/><w:wAfter w:w="8396" w:type="dxa"/></w:trPr>';
  expect(rows(`<w:tr>${after}${cell(dxa(3000))}</w:tr>`)).toEqual([[[141, 150]]]);
});

test('a fixed table drops unreached grid columns too', () => {
  const fixed = '<w:tblLayout w:type="fixed"/>';
  expect(rows(`<w:tr>${cell(dxa(3000))}</w:tr>`, { tblPr: fixed })).toEqual([[[141, 150]]]);
});

test('columns another row reaches stay, and the short row ends early', () => {
  const full = GRID.map((w) => cell(dxa(w), 'c')).join('');
  const [short, long] = rows(`<w:tr>${cell(dxa(10080))}</w:tr><w:tr>${full}</w:tr>`);
  expect(long).toHaveLength(4);
  expect(short).toHaveLength(1);
  expect(short![0]).toEqual(long![0]!);
});

test('legacy modes keep the authored grid', () => {
  const [[only]] = rows(`<w:tr>${cell(dxa(3000))}</w:tr>`, { mode: 14 });
  expect(only![1]).toBeLessThan(150);
});
