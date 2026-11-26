// Two vertical merges that start in the same row and end in different rows (`w:vMerge`,
// `CT_VMerge`, ECMA-376 Part 1, 17.4.84). The shorter merge used to size its own head row.
// Over `hRule="exact"` rows (`w:trHeight`, `CT_Height`, 17.4.80; `ST_HeightRule`, 17.18.37)
// that row cannot grow, and the head was clipped at it. Court forms put a label in such a
// merge, under a head row 2 to 6pt tall.
//
// Each row of these tables is exact unless a test says otherwise. Column 0 merges rows 0-1,
// column 1 is plain, and column 2 merges rows 0-2. Text is 8pt with the fixed measurer.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string, before = 0) =>
  `<w:p><w:pPr><w:spacing w:before="${before}" w:after="0"/><w:rPr><w:sz w:val="16"/></w:rPr></w:pPr>` +
  `<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const tc = (body: string, merge = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${merge}</w:tcPr>${body}</w:tc>`;
const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';
const tr = (height: string, cells: readonly string[]) =>
  `<w:tr><w:trPr>${height}</w:trPr>${cells.join('')}</w:tr>`;
const exact = (twips: number) => `<w:trHeight w:hRule="exact" w:val="${twips}"/>`;

function tableXml(
  short: string,
  { headTwips = 113, middle = exact(1000), shortEndsWithLong = false } = {}
): string {
  const rows = [
    tr(exact(headTwips), [tc(short, RESTART), tc(p('Middle 0')), tc(p('Long merge'), RESTART)]),
    tr(middle, [tc('<w:p/>', CONTINUE), tc(p('Middle 1')), tc('<w:p/>', CONTINUE)]),
    tr(exact(400), [
      shortEndsWithLong ? tc('<w:p/>', CONTINUE) : tc(p('Plain 2')),
      tc(p('Middle 2')),
      tc('<w:p/>', CONTINUE),
    ]),
  ];
  return (
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `${rows.join('')}</w:tbl>`
  );
}

function table(short: string, options?: Parameters<typeof tableXml>[1]): TableFragmentRecord {
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${tableXml(short, options)}${p('After')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer: createFixedMeasurer() });
  return layout.pages[0]!.fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
}

const linesOf = (table: TableFragmentRecord) => {
  const head = table.rows[0]!.cells[0]!;
  return head.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : []));
};
const threeLines = p('First line') + p('Second line') + p('Third line');

test('a shorter merge beside a longer one places every line in its fixed rows', () => {
  const result = table(threeLines);
  expect(result.rows[0]!.cells[0]!.rowSpan).toBe(2);
  expect(linesOf(result)).toHaveLength(3);
});

test('a head with space before its first line places every line', () => {
  const result = table(p('First line', 120) + p('Second line'));
  expect(linesOf(result)).toHaveLength(2);
});

test('the shorter merge places the same lines as one that ends with the longer merge', () => {
  expect(linesOf(table(threeLines)).map((line) => line.box.y)).toEqual(
    linesOf(table(threeLines, { shortEndsWithLong: true })).map((line) => line.box.y)
  );
});

test('every row keeps its fixed height', () => {
  const heights = table(threeLines).rows.map((row) => row.box.height);
  expect(heights[0]).toBeCloseTo(5.65, 6);
  expect(heights[1]).toBeCloseTo(50, 6);
  expect(heights[2]).toBeCloseTo(20, 6);
});

test('text taller than the fixed rows is clipped at their bottom', () => {
  const many = Array.from({ length: 8 }, (_unused, index) => p(`Line ${index + 1}`)).join('');
  const result = table(many, { middle: exact(400) });
  const head = result.rows[0]!.cells[0]!;
  const lines = linesOf(result);
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.length).toBeLessThan(8);
  for (const line of lines) expect(line.box.y).toBeLessThan(head.box.y + head.box.height);
});

// A middle row with an `atLeast` height taller than the head's lines does not grow, and the
// head still flows through it. `table-vmerge-same-head-row-growable.test.ts` covers growth.
test('a shorter merge over an atLeast row places every line in its rows', () => {
  const result = table(threeLines, { middle: '<w:trHeight w:val="1000"/>' });
  const heights = result.rows.map((row) => row.box.height);
  expect(heights[0]).toBeCloseTo(5.65, 6);
  expect(heights[1]).toBeCloseTo(50, 6);
  expect(heights[2]).toBeCloseTo(20, 6);
  expect(linesOf(result)).toHaveLength(3);
});

// A footer places every row of its table in one pass, through a different path.
test('a footer table places every line of the shorter merge', () => {
  const source = readOoxmlPart(`<w:ftr xmlns:w="${W}">${tableXml(threeLines)}<w:p/></w:ftr>`, {
    name: '/word/footer1.xml',
    contentType: 'app/xml',
  });
  if (!source.ok) throw new Error(source.reason);
  const story = layoutHeaderFooterStory(source.part, 470, createFixedMeasurer(), 'test');
  const footerTable = story.fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
  expect(linesOf(footerTable)).toHaveLength(3);
});

function customTable(rows: readonly string[]): TableFragmentRecord {
  const xml =
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `${rows.join('')}</w:tbl>`;
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${xml}${p('After')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer: createFixedMeasurer() });
  return layout.pages[0]!.fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
}
const cellLines = (table: TableFragmentRecord, column: number) =>
  table.rows[0]!.cells[column]!.blocks.flatMap((block) =>
    block.kind === 'paragraph' ? block.lines : []
  );

test('three merges of different lengths from one head row each place every line', () => {
  const result = customTable([
    tr(exact(113), [tc(threeLines, RESTART), tc(threeLines, RESTART), tc(threeLines, RESTART)]),
    tr(exact(300), [tc('<w:p/>', CONTINUE), tc('<w:p/>', CONTINUE), tc('<w:p/>', CONTINUE)]),
    tr(exact(300), [tc(p('Plain 2')), tc('<w:p/>', CONTINUE), tc('<w:p/>', CONTINUE)]),
    tr(exact(300), [tc(p('Plain 3')), tc(p('Plain 3')), tc('<w:p/>', CONTINUE)]),
  ]);
  for (const column of [0, 1, 2]) expect(cellLines(result, column)).toHaveLength(3);
  const heights = result.rows.map((row) => row.box.height);
  [5.65, 15, 15, 15].forEach((height, index) => expect(heights[index]).toBeCloseTo(height, 6));
});

// The longer merge ends in a row without a fixed height, so it still hands its surplus to that
// row. The shorter merge covers only fixed rows and joins the plan beside it.
test('a shorter fixed merge beside a longer merge with a growable last row', () => {
  const tall = Array.from({ length: 10 }, (_unused, index) => p(`Long ${index}`)).join('');
  const result = customTable([
    tr(exact(113), [tc(threeLines, RESTART), tc(p('Middle 0')), tc(tall, RESTART)]),
    tr(exact(600), [tc('<w:p/>', CONTINUE), tc(p('Middle 1')), tc('<w:p/>', CONTINUE)]),
    tr('', [tc(p('Plain 2')), tc(p('Middle 2')), tc('<w:p/>', CONTINUE)]),
  ]);
  expect(cellLines(result, 0)).toHaveLength(3);
  expect(cellLines(result, 2)).toHaveLength(10);
  const [head, middle, last] = result.rows.map((row) => row.box.height);
  expect(head).toBeCloseTo(5.65, 6);
  expect(middle).toBeCloseTo(30, 6);
  // The longer merge's ten lines need more than the two fixed rows, so the last row grows.
  expect(head! + middle! + last!).toBeGreaterThanOrEqual(
    cellLines(result, 2).reduce((sum, line) => sum + line.box.height, 0) - 0.01
  );
});
