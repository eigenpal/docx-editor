// The borders of a table with cell spacing: the outer borders draw one frame around the
// table, and every cell draws a whole box from the inside borders. Expected numbers are the
// measured placement for 5pt spacing (`s`), 3pt outer rules (`bw`) and 1.5pt inside rules
// (`cb`): outer cells `2s + 1.5bw - cb` in from the left edge and `2s + 0.5bw - cb` from the
// right, `2s + 2bw - cb` below the top and above the bottom, and cell boxes `2s` apart.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { spacedTableFrameBorders } from '../table-spacing-frame.ts';
import { tableSpacingShadingRegions } from '../table-spacing-shading.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SPACING = '<w:tblCellSpacing w:w="100" w:type="dxa"/>';
const edge = (side: string, size: number, color: string) =>
  `<w:${side} w:val="single" w:sz="${size}" w:color="${color}"/>`;
const OUTER = ['top', 'left', 'bottom', 'right'].map((side) => edge(side, 24, 'C00000')).join('');
const INSIDE = edge('insideH', 12, '0070C0') + edge('insideV', 12, '0070C0');

const cell = (text: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>${tcPr}</w:tcPr>` +
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const row = (...texts: string[]) => `<w:tr>${texts.map((text) => cell(text)).join('')}</w:tr>`;

function layoutTable(tblPr: string, rows = [row('a', 'b'), row('c', 'd')], pageHeight = 400) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="4800" w:type="dxa"/>` +
      `${tblPr}</w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
      `${rows.join('')}</w:tbl><w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  const layout = layoutSemanticDocument(result.part, 0, {
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 400, height: pageHeight, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  return layout.pages.flatMap((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
}

/** A cell box as `[x, y, width]`, rounded; heights follow the measured line. */
const box = (fragment: TableFragmentRecord, rowIndex: number, cellIndex: number) => {
  const { x, y, width } = fragment.rows[rowIndex]!.cells[cellIndex]!.box;
  return [x, y, width].map((value) => Math.round(value * 100) / 100);
};
const heightOf = (fragment: TableFragmentRecord, rowIndex = 0) =>
  fragment.rows[rowIndex]!.cells[0]!.box.height;

test('without outer borders the cells keep the plain spacing insets and no frame is drawn', () => {
  const [table] = layoutTable(SPACING);
  expect(box(table!, 0, 0)).toEqual([10, 10, 105]);
  expect(box(table!, 0, 1)).toEqual([125, 10, 105]);
  expect(spacedTableFrameBorders(table!)).toBeUndefined();
});

test('outer borders frame the table and move the outer cells in', () => {
  const [table] = layoutTable(SPACING + `<w:tblBorders>${OUTER}</w:tblBorders>`);
  // 2s + 1.5bw from the left, 2s + 0.5bw from the right, 2s + 2bw from the top.
  const h = heightOf(table!);
  expect(box(table!, 0, 0)).toEqual([14.5, 16, 102]);
  expect(box(table!, 0, 1)).toEqual([126.5, 16, 102]);
  expect(table!.rows[1]!.cells[0]!.box.y).toBeCloseTo(16 + h + 10, 6);
  // 2s + 2bw below the last row, the bottom rule included.
  expect(table!.box.height).toBeCloseTo(16 + h + 10 + h + 16, 6);
  const strokes = spacedTableFrameBorders(table!)!.strokes!;
  const side = (name: string) => strokes.find((stroke) => stroke.side === name)!;
  expect([side('left').x, side('left').width]).toEqual([0, 3]);
  // The right rule runs outward from the table's right edge.
  expect([side('right').x, side('right').width]).toEqual([240, 3]);
  expect([side('top').y, side('top').height]).toEqual([0, 3]);
  expect(side('bottom').y).toBeCloseTo(table!.box.height - 3, 6);
  // No cell takes an outer border.
  expect(table!.rows.flatMap((r) => r.cells.flatMap((c) => c.borders?.strokes ?? []))).toEqual([]);
});

test('inside borders box every cell whole, and their width comes out of the edge gaps', () => {
  const [table] = layoutTable(SPACING + `<w:tblBorders>${OUTER}${INSIDE}</w:tblBorders>`);
  // 2s + 1.5bw - cb from the left, 2s + 2bw - cb from the top; a row grows by 2cb.
  const [plain] = layoutTable(SPACING + `<w:tblBorders>${OUTER}</w:tblBorders>`);
  const h = heightOf(table!);
  expect(h).toBeCloseTo(heightOf(plain!) + 3, 6);
  expect(box(table!, 0, 0)).toEqual([13, 14.5, 103.5]);
  expect(box(table!, 0, 1)).toEqual([126.5, 14.5, 103.5]);
  expect(table!.rows[1]!.cells[0]!.box.y).toBeCloseTo(14.5 + h + 10, 6);
  expect(table!.box.height).toBeCloseTo(14.5 + h + 10 + h + 14.5, 6);
  const strokes = table!.rows[0]!.cells[0]!.borders!.strokes!;
  expect(strokes.map((stroke) => [stroke.side, stroke.color])).toEqual([
    ['top', '0070C0'],
    ['left', '0070C0'],
    ['bottom', '0070C0'],
    ['right', '0070C0'],
  ]);
  // A separated cell's right rule lies inside its own box.
  expect(strokes.find((stroke) => stroke.side === 'right')!.x).toBeCloseTo(102, 6);
});

test("a cell's own borders replace the inside borders on its box", () => {
  const own = `<w:tcBorders>${edge('top', 24, '00B050')}${edge('left', 24, '00B050')}</w:tcBorders>`;
  const rows = [`<w:tr>${cell('a', own)}${cell('b')}</w:tr>`, row('c', 'd')];
  const [table] = layoutTable(SPACING + `<w:tblBorders>${INSIDE}</w:tblBorders>`, rows);
  const strokes = table!.rows[0]!.cells[0]!.borders!.strokes!;
  const colors = Object.fromEntries(strokes.map((stroke) => [stroke.side, stroke.color]));
  expect(colors).toEqual({ top: '00B050', left: '00B050', bottom: '0070C0', right: '0070C0' });
});

test('the gap fill of a framed table reaches the frame on every edge row', () => {
  const shd = '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>';
  const [table] = layoutTable(SPACING + shd + `<w:tblBorders>${OUTER}</w:tblBorders>`);
  const regions = tableSpacingShadingRegions(table!);
  for (const region of regions) {
    expect(region.box.x).toBeCloseTo(table!.box.x, 6);
    expect(region.box.width).toBeCloseTo(table!.box.width, 6);
  }
  expect(regions[0]!.box.y).toBeCloseTo(table!.box.y, 6);
  const last = regions.at(-1)!.box;
  expect(last.y + last.height).toBeCloseTo(table!.box.y + table!.box.height, 6);
});

test('a framed table broken across pages draws its frame around each fragment', () => {
  const rows = Array.from({ length: 12 }, (_, index) => row(`r${index}`, `r${index}`));
  const fragments = layoutTable(SPACING + `<w:tblBorders>${OUTER}</w:tblBorders>`, rows, 150);
  expect(fragments.length).toBeGreaterThan(1);
  for (const fragment of fragments) {
    const strokes = spacedTableFrameBorders(fragment)!.strokes!;
    expect(new Set(strokes.map((stroke) => stroke.side))).toEqual(
      new Set(['top', 'left', 'bottom', 'right'])
    );
    // Every row stays inside its fragment, clear of the bottom rule.
    const last = fragment.rows.at(-1)!.cells[0]!.box;
    expect(last.y + last.height).toBeLessThanOrEqual(fragment.box.y + fragment.box.height - 3);
  }
  // Only the table's first row opens below the top rule's double width. At the break the
  // rows sit `s + bw` from the frame on either side.
  expect(fragments[0]!.rows[0]!.cells[0]!.box.y - fragments[0]!.box.y).toBeCloseTo(16, 6);
  expect(fragments[1]!.rows[0]!.cells[0]!.box.y - fragments[1]!.box.y).toBeCloseTo(8, 6);
  const first = fragments[0]!;
  const end = first.rows.at(-1)!.cells[0]!.box;
  expect(first.box.y + first.box.height - (end.y + end.height)).toBeCloseTo(8, 6);
});

test('without a frame a page break leaves the spacing alone between the rows and the edge', () => {
  const rows = Array.from({ length: 12 }, (_, index) => row(`r${index}`, `r${index}`));
  const fragments = layoutTable(SPACING, rows, 150);
  expect(fragments[1]!.rows[0]!.cells[0]!.box.y - fragments[1]!.box.y).toBeCloseTo(5, 6);
});

test('a row that would end the page moves on when its closing gap and frame do not fit', () => {
  const framed = SPACING + `<w:tblBorders>${OUTER}</w:tblBorders>`;
  const rows = [row('a', 'b'), row('c', 'd'), row('e', 'f')];
  const [whole] = layoutTable(framed, rows);
  const cellBottom = (index: number) => {
    const { y, height } = whole!.rows[index]!.cells[0]!.box;
    return y + height;
  };
  const rowsPerFragment = (pageHeight: number) =>
    layoutTable(framed, rows, pageHeight).map((fragment) => fragment.rows.length);
  // The last row closes with `2s + 2bw`.
  expect(whole!.box.height).toBeCloseTo(cellBottom(2) + 16, 6);
  expect(rowsPerFragment(cellBottom(2) + 16.01)[0]).toBe(3);
  expect(rowsPerFragment(cellBottom(2) + 15.9)[0]).toBe(2);
  // A row that ends a page closes with `s + bw`.
  expect(rowsPerFragment(cellBottom(1) + 8.01)[0]).toBe(2);
  expect(rowsPerFragment(cellBottom(1) + 7.9)[0]).toBe(1);
});

test('an exact-height row opens the gap and the frame inside its height', () => {
  const exact = (...texts: string[]) =>
    '<w:tr><w:trPr><w:trHeight w:val="400" w:hRule="exact"/></w:trPr>' +
    `${texts.map((text) => cell(text)).join('')}</w:tr>`;
  const [first] = layoutTable(SPACING + `<w:tblBorders>${OUTER}</w:tblBorders>`, [
    exact('x', 'y'),
    row('c', 'd'),
  ]);
  expect(first!.rows[0]!.box.height).toBeCloseTo(20, 6);
  expect(box(first!, 0, 0)).toEqual([14.5, 16, 102]);
  expect(first!.rows[0]!.cells[0]!.box.height).toBeCloseTo(4, 6);
  expect(first!.rows[1]!.cells[0]!.box.y).toBeCloseTo(30, 6);
  // Below the first row the height counts from the middle of the gap above the cells.
  const [middle] = layoutTable(SPACING, [row('a', 'b'), exact('x', 'y'), row('e', 'f')]);
  const exactRow = middle!.rows[1]!;
  expect(exactRow.box.height).toBeCloseTo(25, 6);
  expect(exactRow.cells[0]!.box.y - exactRow.box.y).toBeCloseTo(10, 6);
  expect(exactRow.cells[0]!.box.height).toBeCloseTo(15, 6);
});

test("a row exception's side borders draw beside that row and move its cells in", () => {
  const sides = edge('left', 24, '00B050') + edge('right', 24, '00B050');
  const exception =
    `<w:tr><w:tblPrEx><w:tblBorders>${sides}</w:tblBorders></w:tblPrEx>` +
    `${cell('c')}${cell('d')}</w:tr>`;
  const [table] = layoutTable(SPACING, [row('a', 'b'), exception, row('e', 'f')]);
  expect(box(table!, 0, 0)).toEqual([10, 10, 105]);
  const target = table!.rows[1]!.cells;
  expect([target[0]!.box.x, target[0]!.box.width]).toEqual([13, 102]);
  expect(target[1]!.box.x + target[1]!.box.width).toBeCloseTo(227, 6);
  const strokes = spacedTableFrameBorders(table!)!.strokes!;
  const { y, height } = target[0]!.box;
  // Centred on the table's edges, from `s` above the row's cells to `s` below.
  expect(strokes.map((stroke) => [stroke.side, stroke.x, stroke.width])).toEqual([
    ['left', -1.5, 3],
    ['right', 238.5, 3],
  ]);
  for (const stroke of strokes) {
    expect(stroke.y).toBeCloseTo(y - 5, 6);
    expect(stroke.height).toBeCloseTo(height + 10, 6);
  }
});
