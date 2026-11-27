// How carried merged text paints in each fragment of a vertical merge (`w:vMerge`,
// `CT_VMerge`, ECMA-376 Part 1, 17.4.84) over `hRule="exact"` rows (`w:trHeight`,
// `CT_Height`, 17.4.80; `ST_HeightRule`, 17.18.37) that breaks across pages:
//
// - `w:vAlign` (`CT_VerticalJc`, 17.4.83) places the text in the fragment where its first
//   line is placed. A fragment that continues text from an earlier page fills from the top.
// - The closing rule of a fragment cut by a page break (`w:insideH`, 17.4.22; `CT_Border`,
//   17.3.4) is drawn at one height across the merged cells and the cells beside them.
//
// The page body is 170pt and lines are 14pt (`table-row-keep-fixtures.ts`). Rows are exact
// 6pt, 50pt and 20pt. Column 0 merges rows 0-1 with three lines, column 1 is plain, and
// column 2 merges rows 0-2 with one line.

import { expect, test } from 'bun:test';
import { cell, lay, load, para } from './table-row-keep-fixtures.ts';
import type {
  BlockFragmentRecord,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
} from '../semantic-records.ts';

const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';
const exact = (twips: number) => `<w:trPr><w:trHeight w:val="${twips}" w:hRule="exact"/></w:trPr>`;
const lines = (name: string, count: number) =>
  Array.from({ length: count }, (_unused, index) => para(`${name}${index}`)).join('');
/** Single rules on every edge, with the table's bottom edge in `bottom` style. */
const rules = (bottom = 'single') =>
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map(
      (side) =>
        `<w:${side} w:val="${side === 'bottom' ? bottom : 'single'}" w:sz="4" w:space="0" w:color="000000"/>`
    )
    .join('') +
  '</w:tblBorders>';

function tableXml(rows: readonly string[], tblPr = ''): string {
  return (
    `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/>${tblPr}</w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `${rows.join('')}</w:tbl>`
  );
}

/** The three-row table. `vAlign` applies to both merges. */
function mergeTable(vAlign = '', tblPr = ''): string {
  const tcPr = (merge: string) => merge + (vAlign ? `<w:vAlign w:val="${vAlign}"/>` : '');
  return tableXml(
    [
      `<w:tr>${exact(120)}${cell(lines('H', 3), tcPr(RESTART))}${cell(para('M0'))}${cell(para('L'), tcPr(RESTART))}</w:tr>`,
      `<w:tr>${exact(1000)}${cell('<w:p/>', tcPr(CONTINUE))}${cell(para('M1'))}${cell('<w:p/>', tcPr(CONTINUE))}</w:tr>`,
      `<w:tr>${exact(400)}${cell(para('K2'))}${cell(para('M2'))}${cell('<w:p/>', tcPr(CONTINUE))}</w:tr>`,
    ],
    tblPr
  );
}

const tableOn = (layout: SemanticLayout, page: number) =>
  layout.pages[page]!.fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
const textOf = (block: BlockFragmentRecord): string =>
  block.kind === 'paragraph'
    ? block.lines.map((line) => line.spans.map((span) => span.text).join('')).join('')
    : '';
/** The painted cell on `page` whose first block starts with `text`. */
function cellWith(layout: SemanticLayout, page: number, text: string): TableCellFragmentRecord {
  for (const row of tableOn(layout, page).rows)
    for (const placed of row.cells)
      if (placed.blocks.length > 0 && textOf(placed.blocks[0]!).startsWith(text)) return placed;
  throw new Error(`no cell with ${text} on page ${page}`);
}
const textsOn = (layout: SemanticLayout, page: number): string[] =>
  tableOn(layout, page).rows.flatMap((row) =>
    row.cells.flatMap((placed) => placed.blocks.map(textOf))
  );
const textTop = (placed: TableCellFragmentRecord) => placed.blocks[0]!.box.y;
const textBottom = (placed: TableCellFragmentRecord) =>
  Math.max(...placed.blocks.map((block) => block.box.y + block.box.height));
const cellBottom = (placed: TableCellFragmentRecord) => placed.box.y + placed.box.height;

test('merged text that moves wholly to the next page keeps its vertical alignment', () => {
  // Nine lines put the 6pt head row at the page end: no merged line fits beside it, so the
  // text of both merges starts in their parts on the next page.
  const bottom = lay(load(para('P', 9) + mergeTable('bottom') + para('After')));
  for (const text of ['H0', 'L']) {
    const placed = cellWith(bottom, 1, text);
    expect({ text, end: textBottom(placed) }).toEqual({
      text,
      end: expect.closeTo(cellBottom(placed), 3),
    });
    expect(textTop(placed)).toBeGreaterThan(placed.box.y + 1);
  }

  const center = lay(load(para('P', 9) + mergeTable('center') + para('After')));
  for (const text of ['H0', 'L']) {
    const placed = cellWith(center, 1, text);
    const above = textTop(placed) - placed.box.y;
    const below = cellBottom(placed) - textBottom(placed);
    expect({ text, above }).toEqual({ text, above: expect.closeTo(below, 3) });
  }

  // Without `w:vAlign` the same text fills from the top.
  const top = lay(load(para('P', 9) + mergeTable() + para('After')));
  for (const text of ['H0', 'L']) {
    const placed = cellWith(top, 1, text);
    expect(textTop(placed)).toBeCloseTo(placed.box.y, 3);
  }
});

test('merged text continued from an earlier page fills from the top', () => {
  // Six lines over rows of 6pt, 50pt and 50pt. Rows 0 and 1 fit the first page and hold four
  // lines. The last two lines continue in row 2 on the next page, from its top.
  const layout = lay(
    load(
      para('P', 7) +
        tableXml([
          `<w:tr>${exact(120)}${cell(lines('F', 6), RESTART + '<w:vAlign w:val="bottom"/>')}${cell(para('M0'))}${cell(para('N0'))}</w:tr>`,
          `<w:tr>${exact(1000)}${cell('<w:p/>', CONTINUE)}${cell(para('M1'))}${cell(para('N1'))}</w:tr>`,
          `<w:tr>${exact(1000)}${cell('<w:p/>', CONTINUE)}${cell(para('M2'))}${cell(para('N2'))}</w:tr>`,
        ]) +
        para('After')
    )
  );
  const placed = cellWith(layout, 1, 'F4');
  expect(textTop(placed)).toBeCloseTo(placed.box.y, 3);
  expect(textBottom(placed)).toBeLessThan(cellBottom(placed) - 1);
});

// Seven lines leave rows 0 and 1 on the first page; nine lines leave only the head row. The
// column 2 merge continues on the next page, and its fragment on the first page ends with the
// other cells. Whatever the style of the table's bottom edge, every cell closes the fragment
// with the same rule at the same height.
for (const [preamble, bottom] of [
  [7, 'single'],
  [9, 'single'],
  [7, 'double'],
] as const)
  test(`a merge cut by a page break closes at the height of the cells beside it (${preamble} lines, ${bottom} table bottom)`, () => {
    const layout = lay(load(para('P', preamble) + mergeTable('', rules(bottom)) + para('After')));
    const table = tableOn(layout, 0);
    const closing: number[][] = [];
    for (const row of table.rows)
      for (const placed of row.cells) {
        if (placed.vMergeContinue || placed.paintInert) continue;
        if (Math.abs(cellBottom(placed) - (table.box.y + table.box.height)) > 0.001) continue;
        closing.push(
          (placed.borders?.strokes ?? [])
            .filter((stroke) => stroke.side === 'bottom')
            .map((stroke) => placed.box.y + stroke.y)
        );
      }
    expect(closing.length).toBe(3);
    expect(closing[0]!.length).toBeGreaterThan(0);
    for (const ys of closing) expect(ys).toEqual(closing[0]!.map((y) => expect.closeTo(y, 6)));
  });

test('merged text keeps its alignment where it starts, also when it goes on to the next page', () => {
  // Eleven lines leave only the 6pt head row on the first page. Rows 1 and 2 are 150pt each,
  // one per page. Fifteen lines start beside row 1 and go on beside row 2. Ten lines fit the
  // second page, aligned to its bottom. The rest continues from the top of the third page.
  const layout = lay(
    load(
      para('P', 11) +
        tableXml([
          `<w:tr>${exact(120)}${cell(lines('F', 15), RESTART + '<w:vAlign w:val="bottom"/>')}${cell(para('M0'))}${cell(para('N0'))}</w:tr>`,
          `<w:tr>${exact(3000)}${cell('<w:p/>', CONTINUE)}${cell(para('M1'))}${cell(para('N1'))}</w:tr>`,
          `<w:tr>${exact(3000)}${cell('<w:p/>', CONTINUE)}${cell(para('M2'))}${cell(para('N2'))}</w:tr>`,
        ]) +
        para('After')
    )
  );
  const second = cellWith(layout, 1, 'F0');
  expect(textBottom(second)).toBeCloseTo(cellBottom(second), 3);
  expect(textTop(second)).toBeGreaterThan(second.box.y + 1);
  const third = cellWith(layout, 2, 'F');
  expect(textTop(third)).toBeCloseTo(third.box.y, 3);
});

test('merged text that starts beside a split row aligns against its lowest line', () => {
  // Eleven lines leave only the 6pt head row on the first page. The second page holds the
  // 99.5pt row 1 and the start of row 2, which splits after five of its ten lines. The merged
  // text starts on that page and goes on to the next one, aligned to the bottom of the row
  // part that the split leaves: its lowest line, not the page bottom.
  const layout = lay(
    load(
      para('P', 11) +
        tableXml([
          `<w:tr>${exact(120)}${cell(lines('F', 20), RESTART + '<w:vAlign w:val="bottom"/>')}${cell(para('M0'))}</w:tr>`,
          `<w:tr>${exact(1990)}${cell('<w:p/>', CONTINUE)}${cell(para('M1'))}</w:tr>`,
          `<w:tr>${cell('<w:p/>', CONTINUE)}${cell(lines('N', 10))}</w:tr>`,
        ]).replace('<w:gridCol w:w="3000"/></w:tblGrid>', '</w:tblGrid>') +
        para('After')
    )
  );
  const merged = cellWith(layout, 1, 'F0');
  const split = cellWith(layout, 1, 'N0');
  expect(textBottom(merged)).toBeCloseTo(textBottom(split), 3);
  expect(textBottom(split)).toBeLessThan(cellBottom(split) - 0.1);
});

test('a merge that starts beside a split row aligns although another merge started earlier', () => {
  // Two merges cover the same rows. Column 0 has 4pt lines, and its first line fits beside the
  // 6pt head row on the first page. Column 1 starts on the second page, beside the split row.
  const small = (name: string, count: number) =>
    Array.from(
      { length: count },
      (_unused, index) =>
        `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="80" w:lineRule="exact"/></w:pPr><w:r><w:t>${name}${index}</w:t></w:r></w:p>`
    ).join('');
  const bottom = '<w:vAlign w:val="bottom"/>';
  const layout = lay(
    load(
      para('P', 11) +
        tableXml([
          `<w:tr>${exact(120)}${cell(small('A', 60), RESTART + bottom)}${cell(lines('F', 20), RESTART + bottom)}${cell(para('M0'))}</w:tr>`,
          `<w:tr>${exact(1990)}${cell('<w:p/>', CONTINUE + bottom)}${cell('<w:p/>', CONTINUE + bottom)}${cell(para('M1'))}</w:tr>`,
          `<w:tr>${cell('<w:p/>', CONTINUE + bottom)}${cell('<w:p/>', CONTINUE + bottom)}${cell(lines('N', 10))}</w:tr>`,
        ]) +
        para('After')
    )
  );
  expect(textsOn(layout, 0)).toContain('A0');
  const merged = cellWith(layout, 1, 'F0');
  const split = cellWith(layout, 1, 'N0');
  expect(textBottom(merged)).toBeCloseTo(textBottom(split), 3);
});
