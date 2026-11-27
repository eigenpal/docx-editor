// Rows that merge restarts, continuations (`w:vMerge`, `CT_VMerge`, ECMA-376 Part 1, 17.4.84),
// and waiting `btLr` cells (`w:textDirection`, `CT_TextDirection`, 17.4.72) hold take the
// end-of-cell paragraph of their FIRST cell. A `restart` cell that no row continues counts as
// a head there. With a waiting `btLr` cell, an `atLeast` row height (`w:trHeight`,
// `CT_Height`, 17.4.80; `ST_HeightRule`, 17.18.37) alone sizes the row. A first cell with
// `w:hideMark` (17.4.21) gives one default line.
//
// Each table has an opening row, the row under test, and a closing row. The cells have no
// margins. No styles part, so the default line is the 10pt default run style. The fixed
// measurer gives an 8pt line 10.18pt, a 10pt line 12.73pt, a 12pt line 15.27pt, and a 20pt
// line 25.45pt.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../index.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';
import { readTableStructure } from '../semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer();
const line = (sizePt: number) => (14 * sizePt) / 11;

/** An empty end paragraph with a mark of `size` half-points and spacing in twips. */
const mark = (size = 16, before = 0, after = 0) =>
  `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}"/>` +
  `<w:rPr><w:sz w:val="${size}"/></w:rPr></w:pPr></w:p>`;
/** One line of text at `size` half-points over a mark of `markSize`. */
const text = (value: string, size = 16, markSize = size) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:rPr><w:sz w:val="${markSize}"/></w:rPr>` +
  `</w:pPr><w:r><w:rPr><w:sz w:val="${size}"/></w:rPr><w:t>${value}</w:t></w:r></w:p>`;
const HIDE = '<w:hideMark/>';
const BTLR = '<w:textDirection w:val="btLr"/>';
const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';
const LOW = '<w:trHeight w:val="100"/>';

interface Cell {
  readonly body: string;
  /** `w:tcPr` children after `w:tcW`, in schema order. */
  readonly properties?: string;
  /** The cell above it in the opening row. */
  readonly above?: string;
  /** The cell below it in the closing row. */
  readonly below?: string;
}

const tc = (body: string, properties = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${properties}</w:tcPr>${body}</w:tc>`;
const tr = (height: string, cells: readonly string[]) =>
  `<w:tr><w:trPr>${height}</w:trPr>${cells.join('')}</w:tr>`;

function table(cells: readonly Cell[], height = LOW): string {
  const grid = cells.map(() => '<w:gridCol w:w="2000"/>').join('');
  return (
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar>' +
    ['top', 'left', 'bottom', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('') +
    `</w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>` +
    tr(
      '',
      cells.map((cell) => cell.above ?? tc(text('Top')))
    ) +
    tr(
      height,
      cells.map((cell) => tc(cell.body, cell.properties))
    ) +
    tr(
      '',
      cells.map((cell) => cell.below ?? tc(text('After')))
    ) +
    '</w:tbl>'
  );
}

/** A head whose merge the closing row continues. */
const head = (body: string, properties = ''): Cell => ({
  body,
  properties: RESTART + properties,
  below: tc(mark(), CONTINUE),
});
/** A `restart` cell that no row continues. */
const lone = (body: string, properties = ''): Cell => ({ body, properties: RESTART + properties });
/** A continuation of the opening row's cell. */
const continued = (body: string, properties = ''): Cell => ({
  body,
  properties: CONTINUE + properties,
  above: tc(text('Top'), RESTART),
});
const plain = (body: string, properties = ''): Cell => ({ body, properties });

function documentOf(body: string): OoxmlPart {
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p/>${body}<w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  return source.part;
}

function middleRow(source: string): number {
  const layout = layoutSemanticDocument(documentOf(source), 0, { measurer });
  const fragment = layout.pages[0]!.fragments.find(
    (f): f is TableFragmentRecord => f.kind === 'table'
  )!;
  const rows = fragment.rows;
  expect(rows).toHaveLength(3);
  expect(rows[2]!.box.y).toBeCloseTo(rows[1]!.box.y + rows[1]!.box.height, 6);
  return rows[1]!.box.height;
}

test('a hidden head beside a hidden lone restart gives one default line', () => {
  expect(middleRow(table([head(mark(40), HIDE), lone(mark(40), HIDE)]))).toBeCloseTo(line(10), 6);
  expect(middleRow(table([lone(mark(40), HIDE), head(mark(40), HIDE)]))).toBeCloseTo(line(10), 6);
  expect(middleRow(table([lone(mark(40), HIDE), lone(mark(40), HIDE)]))).toBeCloseTo(line(10), 6);
  expect(
    middleRow(table([head(mark(40), HIDE), lone(mark(40), HIDE)], '<w:trHeight w:val="200"/>'))
  ).toBeCloseTo(line(10), 6);
  expect(middleRow(table([head(mark(40), HIDE), lone(mark(40), HIDE)], ''))).toBeCloseTo(
    line(10),
    6
  );
});

test('an ordinary hidden cell beside a hidden head leaves the row to its minimum', () => {
  expect(middleRow(table([head(mark(40), HIDE), plain(mark(40), HIDE)]))).toBeCloseTo(5, 6);
  expect(middleRow(table([plain(mark(40), HIDE), head(mark(40), HIDE)]))).toBeCloseTo(5, 6);
});

test('a lone restart beside an ordinary cell leaves the row to its content', () => {
  expect(middleRow(table([lone(text('s')), plain(text('t'))]))).toBeCloseTo(line(8), 6);
  expect(middleRow(table([plain(text('s')), lone(text('t'))]))).toBeCloseTo(line(8), 6);
  expect(middleRow(table([lone(text('s', 8), HIDE), plain(text('t', 8))], ''))).toBeCloseTo(
    line(4),
    6
  );
});

test("a lone restart's text raises the row above the first-cell floor, never below it", () => {
  const short = text('s');
  const tall = text('Tall', 48);
  expect(middleRow(table([head(mark(40), HIDE), lone(short, HIDE)]))).toBeCloseTo(line(10), 6);
  expect(middleRow(table([lone(short, HIDE), lone(mark(40), HIDE)]))).toBeCloseTo(line(10), 6);
  expect(middleRow(table([head(mark(40), HIDE), lone(tall, HIDE)]))).toBeCloseTo(line(24), 6);
  // An ordinary cell's text sizes the row as usual.
  expect(middleRow(table([head(mark(40), HIDE), plain(short, HIDE)]))).toBeCloseTo(line(8), 6);
});

test("a first lone restart's mark line counts under its text, as a head's does", () => {
  expect(middleRow(table([lone(text('s', 16, 40)), lone(text('t'))]))).toBeCloseTo(line(20), 6);
  expect(middleRow(table([plain(text('s', 16, 40)), plain(text('t'))]))).toBeCloseTo(line(8), 6);
  // A head gives no spacing before; the text's own paragraph box still does.
  expect(middleRow(table([lone(mark(16, 120)), lone(mark())], ''))).toBeCloseTo(6 + line(8), 6);
  expect(middleRow(table([lone(mark(16, 0, 120)), lone(mark())], ''))).toBeCloseTo(line(8) + 6, 6);
});

test('a first btLr cell gives its whole end paragraph box', () => {
  const vertical = (body: string): Cell => plain(body, BTLR);
  const before = mark(16, 120);
  expect(middleRow(table([vertical(before), head(text('a'))], ''))).toBeCloseTo(6 + line(8), 6);
  expect(middleRow(table([vertical(mark(24)), head(text('a'))], ''))).toBeCloseTo(line(12), 6);
  const verticalHead: Cell = {
    body: before,
    properties: RESTART + BTLR,
    below: tc(mark(), CONTINUE + BTLR),
  };
  expect(middleRow(table([verticalHead, head(text('a'))], ''))).toBeCloseTo(6 + line(8), 6);
  // With a waiting btLr cell, the minimum alone sizes the row.
  expect(middleRow(table([vertical(before), head(text('a'))]))).toBeCloseTo(5, 6);
});

test('a row of continuations and a waiting btLr cell takes its first cell', () => {
  const vertical = (body: string, properties = ''): Cell => plain(body, BTLR + properties);
  expect(middleRow(table([vertical(text('v')), continued(mark(24))], ''))).toBeCloseTo(line(8), 6);
  expect(middleRow(table([vertical(mark(24)), continued(mark())], ''))).toBeCloseTo(line(12), 6);
  expect(middleRow(table([continued(mark()), vertical(mark(24))], ''))).toBeCloseTo(line(8), 6);
  expect(middleRow(table([vertical(mark(16, 120)), continued(mark())], ''))).toBeCloseTo(
    6 + line(8),
    6
  );
  expect(middleRow(table([vertical(mark(40), HIDE), continued(mark())], ''))).toBeCloseTo(
    line(10),
    6
  );
  // An atLeast height: the minimum alone, whichever cell comes first.
  expect(middleRow(table([vertical(text('v')), continued(mark(24))]))).toBeCloseTo(5, 6);
  expect(middleRow(table([continued(mark()), vertical(mark(24))]))).toBeCloseTo(5, 6);
});

// An invalid `w:tc` with no paragraph has no end paragraph to read, so the row keeps the
// largest box of its cells (not measured).
test('a row of continuations with an empty cell keeps the largest box', () => {
  const empty: Cell = { body: '', properties: CONTINUE, above: tc(text('Top'), RESTART) };
  const source = table([continued(mark()), continued(mark(24)), empty], '');
  const structure = readTableStructure(
    documentOf(source).root.children[0]!.children.find((node) => node.kind === 'table')! as never,
    600,
    0
  )!;
  expect(structure.rows[1]!.cells[2]!.blocks).toHaveLength(0);
  expect(middleRow(source)).toBeCloseTo(line(12), 6);
});

// The floor belongs to the row's first fragment. A remainder on the next page is sized by
// the content that continues there, as an ordinary row's is.
test('a split row of lone restarts keeps the floor off its remainder', () => {
  const remainders = (first: Cell, second: Cell) =>
    layoutSemanticDocument(documentOf(table([first, second], '')), 0, { measurer })
      .pages.flatMap((page) => page.fragments)
      .filter((f): f is TableFragmentRecord => f.kind === 'table')
      .flatMap((fragment) => fragment.rows.filter((row) => row.isContinuation))
      .map((row) => row.box.height);
  // One or two lines continue on the next page, below the first cell's 20pt mark line.
  for (const lines of [62, 63]) {
    const long = Array.from({ length: lines }, (_, index) => text(`L${index}`)).join('');
    const split = remainders(lone(text('s', 16, 40)), lone(long));
    expect(split).toHaveLength(1);
    expect(split[0]!).toBeLessThan(line(20));
    expect(split).toEqual(remainders(plain(text('s', 16, 40)), plain(long)));
  }
});
