// Vertical merges of different lengths from one head row (`w:vMerge`, `CT_VMerge`, ECMA-376
// Part 1, 17.4.84) over rows that can grow: `w:trHeight` (`CT_Height`, 17.4.80) with `hRule`
// `atLeast` or `auto`, or no `w:trHeight` (`ST_HeightRule`, 17.18.37).
//
// The head row keeps the height of its own cells. The shortest merge grows its own last row
// to hold its lines, and each longer merge only adds what the rows above its last row do not
// give it. An `exact` last row does not grow, and the lines below it are clipped.
//
// Text is 8pt with the fixed measurer. The last column holds one plain line in every row.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import type { TableFragmentRecord, TableRowFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:rPr><w:sz w:val="16"/></w:rPr></w:pPr>` +
  `<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const lines = (count: number, name: string) =>
  Array.from({ length: count }, (_unused, index) => p(`${name} ${index}`)).join('');
const tc = (body: string, merge = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${merge}</w:tcPr>${body}</w:tc>`;
const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';
const exact = (twips: number) => `<w:trHeight w:hRule="exact" w:val="${twips}"/>`;
const atLeast = (twips: number) => `<w:trHeight w:val="${twips}"/>`;

interface Merge {
  readonly column: number;
  readonly headRow: number;
  readonly rows: number;
  readonly lines: number;
}

/** One table: `merges` by column, every other cell one plain line. */
function tableXml(heights: readonly string[], merges: readonly Merge[]): string {
  const columns = Math.max(-1, ...merges.map((merge) => merge.column)) + 2;
  const rows = heights.map((height, rowIndex) => {
    const cells = Array.from({ length: columns }, (_unused, column) => {
      const merge = merges.find((entry) => entry.column === column);
      if (merge?.headRow === rowIndex) return tc(lines(merge.lines, `C${column}`), RESTART);
      if (merge && rowIndex > merge.headRow && rowIndex < merge.headRow + merge.rows) {
        return tc('<w:p/>', CONTINUE);
      }
      return tc(p(`R${rowIndex}`));
    });
    return `<w:tr><w:trPr>${height}</w:trPr>${cells.join('')}</w:tr>`;
  });
  const grid = Array.from({ length: columns }, () => '<w:gridCol w:w="2000"/>').join('');
  return (
    `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>` +
    `${rows.join('')}</w:tbl>`
  );
}

function layoutTable(xml: string): TableFragmentRecord {
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${xml}${p('After')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer: createFixedMeasurer() });
  return layout.pages[0]!.fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
}

const heightsOf = (table: TableFragmentRecord) => table.rows.map((row) => row.box.height);
const linesIn = (row: TableRowFragmentRecord, column: number) =>
  row.cells
    .find((cell) => cell.gridColumn === column)!
    .blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : []));
/** Bottom of the last line of the merge headed in `column` of `row`. */
const contentBottom = (row: TableRowFragmentRecord, column: number) => {
  const placed = linesIn(row, column);
  const last = placed[placed.length - 1]!;
  return last.box.y + last.box.height;
};
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

const SHORT_LONG = (shortLines: number, longLines = 1): Merge[] => [
  { column: 0, headRow: 0, rows: 2, lines: shortLines },
  { column: 1, headRow: 0, rows: 3, lines: longLines },
];

// The height of a row that holds one plain 8pt line in each cell.
const PLAIN_ROW = heightsOf(layoutTable(tableXml([''], [])))[0]!;

test('rows without a height: the head row keeps its own line and the next row grows', () => {
  const table = layoutTable(tableXml(['', '', ''], SHORT_LONG(8)));
  const [head, middle, last] = heightsOf(table);
  expect(head).toBeCloseTo(PLAIN_ROW, 6);
  expect(last).toBeCloseTo(PLAIN_ROW, 6);
  expect(linesIn(table.rows[0]!, 0)).toHaveLength(8);
  // Rows 0-1 end exactly where the eight lines end.
  expect(table.rows[0]!.box.y + head! + middle!).toBeCloseTo(contentBottom(table.rows[0]!, 0), 6);
});

test('an atLeast row shorter than the lines grows to hold them', () => {
  const table = layoutTable(tableXml([exact(113), atLeast(200), exact(400)], SHORT_LONG(3)));
  const [head, middle, last] = heightsOf(table);
  expect(head).toBeCloseTo(5.65, 6);
  expect(last).toBeCloseTo(20, 6);
  expect(linesIn(table.rows[0]!, 0)).toHaveLength(3);
  // Row 1 grows past its 10pt minimum and its own line, to where the three lines end.
  expect(middle).toBeCloseTo(contentBottom(table.rows[0]!, 0) - table.rows[0]!.box.y - head!, 6);
  expect(middle).toBeGreaterThan(Math.max(10, PLAIN_ROW) + 1);
});

test('an exact last row does not grow, and the atLeast row above it does not grow instead', () => {
  const table = layoutTable(
    tableXml(
      [exact(113), atLeast(200), exact(400), exact(400)],
      [
        { column: 0, headRow: 0, rows: 3, lines: 6 },
        { column: 1, headRow: 0, rows: 4, lines: 1 },
      ]
    )
  );
  const heights = heightsOf(table);
  // Row 1 is as tall as its one plain line, which is taller than its 10pt minimum.
  [5.65, PLAIN_ROW, 20, 20].forEach((height, index) =>
    expect(heights[index]).toBeCloseTo(height, 6)
  );
  // Rows 0-2 show the lines that start above their bottom, and the rest are clipped.
  const placed = linesIn(table.rows[0]!, 0);
  const spanBottom = table.rows[0]!.box.y + sum(heights.slice(0, 3));
  expect(placed.map((line) => line.box.y < spanBottom)).toEqual([true, true, true, true]);
});

test('each longer merge adds only what the rows above its last row do not give it', () => {
  const table = layoutTable(
    tableXml(
      ['', '', '', ''],
      [
        { column: 0, headRow: 0, rows: 2, lines: 3 },
        { column: 1, headRow: 0, rows: 3, lines: 6 },
        { column: 2, headRow: 0, rows: 4, lines: 1 },
      ]
    )
  );
  const heights = heightsOf(table);
  const top = table.rows[0]!.box.y;
  expect(heights[0]).toBeCloseTo(PLAIN_ROW, 6);
  expect(top + sum(heights.slice(0, 2))).toBeCloseTo(contentBottom(table.rows[0]!, 0), 6);
  expect(top + sum(heights.slice(0, 3))).toBeCloseTo(contentBottom(table.rows[0]!, 1), 6);
  expect(heights[3]).toBeCloseTo(PLAIN_ROW, 6);
});

test('merges of two lengths from a head row inside a longer merge follow the same rule', () => {
  const table = layoutTable(
    tableXml(
      ['', '', '', ''],
      [
        { column: 0, headRow: 0, rows: 4, lines: 1 },
        { column: 1, headRow: 1, rows: 2, lines: 4 },
        { column: 2, headRow: 1, rows: 3, lines: 1 },
      ]
    )
  );
  const heights = heightsOf(table);
  expect(heights[1]).toBeCloseTo(PLAIN_ROW, 6);
  expect(table.rows[1]!.box.y + heights[1]! + heights[2]!).toBeCloseTo(
    contentBottom(table.rows[1]!, 1),
    6
  );
  expect(heights[3]).toBeCloseTo(PLAIN_ROW, 6);
});

// Header and footer tables and nested tables place every row in one pass, through other paths.
test('a footer table sizes its rows the same way as a body table', () => {
  const xml = tableXml(['', '', ''], SHORT_LONG(4));
  const source = readOoxmlPart(`<w:ftr xmlns:w="${W}">${xml}<w:p/></w:ftr>`, {
    name: '/word/footer1.xml',
    contentType: 'app/xml',
  });
  if (!source.ok) throw new Error(source.reason);
  const story = layoutHeaderFooterStory(source.part, 470, createFixedMeasurer(), 'test');
  const footer = story.fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
  expect(heightsOf(footer)[0]).toBeCloseTo(PLAIN_ROW, 6);
  heightsOf(layoutTable(xml)).forEach((height, index) =>
    expect(heightsOf(footer)[index]).toBeCloseTo(height, 6)
  );
});

test('a nested table sizes its rows the same way as a body table', () => {
  const inner = tableXml(['', '', ''], SHORT_LONG(4));
  const outer =
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="7000"/></w:tblGrid>' +
    `<w:tr><w:tc><w:tcPr><w:tcW w:w="7000" w:type="dxa"/></w:tcPr>${inner}<w:p/></w:tc></w:tr></w:tbl>`;
  const nested = layoutTable(outer).rows[0]!.cells[0]!.blocks.find(
    (block): block is TableFragmentRecord => block.kind === 'table'
  )!;
  const flat = heightsOf(layoutTable(inner));
  expect(heightsOf(nested)).toHaveLength(3);
  expect(heightsOf(nested)[0]).toBeCloseTo(PLAIN_ROW, 6);
  heightsOf(nested).forEach((height, index) => expect(height).toBeCloseTo(flat[index]!, 6));
});

// The longer merge covers a row taller than the page, so its decision does not fit and it is
// declined. Its head sizes its own row, and the shorter merge is decided alone beside it.
// This path already worked before merges of different lengths were decided together; the
// test keeps it working.
test('a shorter merge is still sized when the longer merge from its row is declined', () => {
  const xml = tableXml(['', '', ''], SHORT_LONG(6)).replace(p('R2'), lines(120, 'Tall'));
  const table = layoutTable(xml);
  const [head, middle] = heightsOf(table);
  expect(head).toBeCloseTo(PLAIN_ROW, 6);
  expect(linesIn(table.rows[0]!, 0)).toHaveLength(6);
  expect(table.rows[0]!.box.y + head! + middle!).toBeCloseTo(contentBottom(table.rows[0]!, 0), 6);
});

// Repeated `w:tblHeader` rows are planned once for each place the group is laid out.
test('repeated header rows size merges of two lengths the same on every page', () => {
  const header = tableXml(['', '', ''], SHORT_LONG(4)).replace(
    /<w:trPr><\/w:trPr>/g,
    '<w:trPr><w:tblHeader/></w:trPr>'
  );
  const body = Array.from(
    { length: 120 },
    (_unused, index) => `<w:tr>${tc(p(`B${index}`))}${tc(p('x'))}${tc(p('y'))}</w:tr>`
  ).join('');
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${header.replace('</w:tbl>', `${body}</w:tbl>`)}${p('After')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer: createFixedMeasurer() });
  const tables = layout.pages.flatMap((page) =>
    page.fragments.filter((f): f is TableFragmentRecord => f.kind === 'table')
  );
  expect(tables.length).toBeGreaterThan(1);
  const expected = heightsOf(layoutTable(tableXml(['', '', ''], SHORT_LONG(4))));
  expect(expected[0]).toBeCloseTo(PLAIN_ROW, 6);
  for (const fragment of tables) {
    expect(linesIn(fragment.rows[0]!, 0)).toHaveLength(4);
    expected.forEach((height, index) =>
      expect(fragment.rows[index]!.box.height).toBeCloseTo(height, 6)
    );
  }
});
