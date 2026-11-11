// Table-level shading (`w:tblPr/w:shd`) shows only in the cell-spacing gaps. Measured on
// reference renderings in compatibility modes 14 and 15: an unshaded cell of a shaded table
// shows what lies behind the table, with or without spacing; the gaps take the table's fill,
// the closing gap below the last row and at each page break included; a cell's own fill
// paints over it; and a row's `w:tblPrEx` fill replaces the table's around that row.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { tableSpacingShadingRegions } from '../table-spacing-shading.ts';
import type { TableFragmentRecord, TableRowFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const shd = (fill: string) => `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;
const NIL = '<w:shd w:val="nil"/>';
const SPACING = '<w:tblCellSpacing w:w="100" w:type="dxa"/>';
const STYLES =
  `<w:style w:type="table" w:styleId="Green"><w:name w:val="Green"/>` +
  `<w:tblPr>${shd('C6EFCE')}</w:tblPr></w:style>`;

function read(name: string, xml: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const cell = (text: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${tcPr}</w:tcPr>` +
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

function layoutTable(options: {
  readonly tblPr?: string;
  readonly style?: string;
  readonly rows?: readonly string[];
  readonly pageHeight?: number;
}): TableFragmentRecord[] {
  const rows = options.rows ?? [`<w:tr>${cell('a')}${cell('b')}</w:tr>`];
  const style = options.style ? `<w:tblStyle w:val="${options.style}"/>` : '';
  const document = read(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>${style}` +
      `<w:tblW w:w="4000" w:type="dxa"/>${options.tblPr ?? ''}</w:tblPr><w:tblGrid>` +
      `<w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows.join('')}</w:tbl>` +
      `<w:p/></w:body></w:document>`
  );
  const layout = layoutSemanticDocument(document, 0, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: buildStyleCascadeTable(
      read('/word/styles.xml', `<w:styles xmlns:w="${W}">${STYLES}</w:styles>`).root
    ),
    geometry: {
      width: 400,
      height: options.pageHeight ?? 400,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  });
  return layout.pages.flatMap((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
}

const fills = (rows: readonly TableRowFragmentRecord[]) =>
  rows.map((row) => row.spacingShading?.fill);

test('without cell spacing the table fill shows nowhere; a cell keeps its own', () => {
  const [table] = layoutTable({
    tblPr: shd('D9E2F3'),
    rows: [`<w:tr>${cell('table')}${cell('own', shd('FFE699'))}</w:tr>`],
  });
  expect(table!.rows[0]!.cells.map((c) => c.shading)).toEqual([undefined, 'FFE699']);
  expect(fills(table!.rows)).toEqual([undefined]);
  expect(tableSpacingShadingRegions(table!)).toEqual([]);
});

test('with cell spacing every row shows the table fill in its gaps, cells excluded', () => {
  const [table] = layoutTable({
    tblPr: SPACING + shd('D9E2F3'),
    rows: [
      `<w:tr>${cell('a')}${cell('b', shd('FFE699'))}</w:tr>`,
      `<w:tr>${cell('c')}${cell('d')}</w:tr>`,
    ],
  });
  expect(table!.rows[0]!.cells.map((c) => c.shading)).toEqual([undefined, 'FFE699']);
  expect(fills(table!.rows)).toEqual(['D9E2F3', 'D9E2F3']);
  // 100 twips of spacing is a 10pt gap; the table closes it below the last row, inside its box.
  const lastRow = table!.rows[1]!.box;
  expect(table!.box.y + table!.box.height).toBeCloseTo(lastRow.y + lastRow.height + 10, 6);
  const regions = tableSpacingShadingRegions(table!);
  expect(regions).toHaveLength(2);
  const [first, last] = regions;
  expect(first!.box).toEqual(table!.rows[0]!.box);
  expect(first!.holes).toEqual(table!.rows[0]!.cells.map((c) => c.box));
  expect(last!.box.height).toBeCloseTo(table!.rows[1]!.box.height + 10, 6);
});

test('the cascade: style, then the table, then the row exception', () => {
  const cases: readonly [string, string, readonly (string | undefined)[]][] = [
    ['style alone', SPACING, ['C6EFCE']],
    ['the table over the style', SPACING + shd('D9E2F3'), ['D9E2F3']],
    ['nil leaves the style', SPACING + NIL, ['C6EFCE']],
    ['auto clears the style', SPACING + shd('auto'), [undefined]],
  ];
  for (const [label, tblPr, expected] of cases) {
    const [table] = layoutTable({ tblPr, style: 'Green' });
    expect([label, ...fills(table!.rows)]).toEqual([label, ...expected]);
  }
  const exception = (inner: string) =>
    `<w:tr><w:tblPrEx>${inner}</w:tblPrEx>${cell('r')}${cell('r')}</w:tr>`;
  const [table] = layoutTable({
    tblPr: SPACING + shd('D9E2F3'),
    rows: [
      `<w:tr>${cell('r')}${cell('r')}</w:tr>`,
      exception(shd('FF9999')),
      exception(NIL),
      exception(shd('auto')),
    ],
  });
  expect(fills(table!.rows)).toEqual(['D9E2F3', 'FF9999', 'D9E2F3', undefined]);
});

test('a file-supplied fill that is not hex never reaches a row', () => {
  const [table] = layoutTable({
    tblPr: SPACING + '<w:shd w:val="clear" w:fill="red;background:url(x)"/>',
  });
  expect(fills(table!.rows)).toEqual([undefined]);
});

test('a cell merged down stays a hole in the rows it crosses', () => {
  const [table] = layoutTable({
    tblPr: SPACING + shd('D9E2F3'),
    rows: [
      `<w:tr>${cell('m', '<w:vMerge w:val="restart"/>')}${cell('b')}</w:tr>`,
      `<w:tr>${cell('', '<w:vMerge/>')}${cell('d')}</w:tr>`,
    ],
  });
  const head = table!.rows[0]!.cells[0]!.box;
  const [, second] = tableSpacingShadingRegions(table!);
  const band = second!.box;
  // The head cell's part inside the second band, and the second row's own unmerged cell.
  expect(second!.holes).toContainEqual({
    x: head.x,
    y: band.y,
    width: head.width,
    height: head.y + head.height - band.y,
  });
  expect(second!.holes).toContainEqual(table!.rows[1]!.cells[1]!.box);
  expect(second!.holes).toHaveLength(2);
});

test('a row split across pages closes the gap only below its last part', () => {
  const tall = Array.from({ length: 12 }, (_, i) => `<w:p><w:r><w:t>line ${i}</w:t></w:r></w:p>`);
  const fragments = layoutTable({
    tblPr: SPACING + shd('D9E2F3'),
    rows: [
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${tall.join('')}</w:tc>${cell('b')}</w:tr>`,
    ],
    pageHeight: 100,
  });
  expect(fragments.length).toBeGreaterThan(1);
  const heights = fragments.map((fragment) => {
    const [region] = tableSpacingShadingRegions(fragment);
    return region!.box.height - fragment.rows[0]!.box.height;
  });
  expect(heights.slice(0, -1).every((extra) => extra === 0)).toBe(true);
  expect(heights.at(-1)).toBeCloseTo(10, 6);
});

test('a row band covers its own cells only, not columns skipped by gridBefore', () => {
  const [table] = layoutTable({
    tblPr: SPACING + shd('D9E2F3'),
    rows: [
      `<w:tr>${cell('a')}${cell('b')}</w:tr>`,
      `<w:tr><w:trPr><w:gridBefore w:val="1"/><w:wBefore w:w="2000" w:type="dxa"/></w:trPr>${cell('c')}</w:tr>`,
    ],
  });
  const [full, short] = tableSpacingShadingRegions(table!);
  expect(full!.box).toEqual(table!.rows[0]!.box);
  const own = table!.rows[1]!.cells[0]!.box;
  // The band starts one gap before the row's only cell and ends at the table edge.
  expect(short!.box.x).toBeCloseTo(own.x - 10, 6);
  expect(short!.box.x + short!.box.width).toBeCloseTo(
    table!.rows[1]!.box.x + table!.rows[1]!.box.width,
    6
  );
});

test('the closing gap never paints past the room below the last row', () => {
  const [first] = layoutTable({ tblPr: SPACING + shd('D9E2F3') });
  const rowBottom = first!.rows[0]!.box.y + first!.rows[0]!.box.height;
  // A page that ends 4pt below the row leaves 4pt of the 10pt closing gap.
  const [table] = layoutTable({ tblPr: SPACING + shd('D9E2F3'), pageHeight: rowBottom + 4 });
  const [region] = tableSpacingShadingRegions(table!);
  expect(region!.box.y + region!.box.height).toBeCloseTo(rowBottom + 4, 6);
});

test('a cell overlapping one merged down from above never turns back into fill', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const cellAt = (id: string, b: ReturnType<typeof box>) =>
    ({
      id,
      box: b,
      gridColumn: 0,
      gridSpan: 1,
      vMergeContinue: false,
      rowSpan: 1,
      blocks: [],
    }) as never;
  const shaded = { fill: 'D9E2F3', gapPt: 10 };
  const rows = [
    // A defective layout: the merged cell of the first row reaches into a cell of the second.
    {
      ...{ id: 'r0', rowIndex: 0, isHeaderRow: false, isHeaderRepeat: false },
      spacingShading: shaded,
      box: box(0, 0, 100, 30),
      cells: [cellAt('m', box(10, 10, 50, 60))],
    },
    {
      ...{ id: 'r1', rowIndex: 1, isHeaderRow: false, isHeaderRepeat: false },
      spacingShading: shaded,
      box: box(0, 30, 100, 40),
      cells: [cellAt('b', box(40, 40, 50, 20))],
    },
  ] as TableRowFragmentRecord[];
  const [, second] = tableSpacingShadingRegions({ rows, box: box(0, 0, 100, 70) });
  // The second band starts one gap before its own cell, so the merged hole is cut there.
  expect(second!.holes).toEqual([box(30, 30, 30, 40)]);
});

test('a positioned spaced table holds its closing gap, so its last band fills it', () => {
  const position =
    '<w:tblpPr w:vertAnchor="page" w:horzAnchor="page" w:tblpX="1440" w:tblpY="2880"/>';
  const [table] = layoutTable({ tblPr: position + SPACING + shd('D9E2F3') });
  const last = table!.rows.at(-1)!.box;
  expect(table!.box.y + table!.box.height).toBeCloseTo(last.y + last.height + 10, 6);
  const [region] = tableSpacingShadingRegions(table!);
  expect(region!.box.y + region!.box.height).toBeCloseTo(last.y + last.height + 10, 6);
});

test('a table broken between rows closes each page with the gap, as the page holds it', () => {
  const rows = Array.from(
    { length: 12 },
    (_, i) => `<w:tr>${cell(`r${i}`)}${cell(`r${i}`)}</w:tr>`
  );
  const fragments = layoutTable({ tblPr: SPACING + shd('D9E2F3'), rows, pageHeight: 150 });
  expect(fragments.length).toBeGreaterThan(1);
  for (const fragment of fragments) {
    const last = fragment.rows.at(-1)!.box;
    const extra = fragment.box.y + fragment.box.height - (last.y + last.height);
    // The full 10pt gap, or what is left of the page below the last row.
    expect(extra).toBeCloseTo(Math.min(10, 150 - (last.y + last.height)), 6);
    const band = tableSpacingShadingRegions(fragment).at(-1)!;
    expect(band.box.y + band.box.height).toBeCloseTo(fragment.box.y + fragment.box.height, 6);
  }
});
