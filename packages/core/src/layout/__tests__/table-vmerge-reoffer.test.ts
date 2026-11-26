// A head row of vertical merges (`w:vMerge`, `CT_VMerge`, ECMA-376 Part 1, 17.4.84) that moves
// to the next page decides its merges again there. `w:pageBreakBefore` (`CT_OnOff`, 17.3.1.23)
// in the head row moves the row after its merges were first offered at the bottom of a page.
//
// At that first offer the longer merge does not fit and the shorter one does. On the next page
// the longer merge fits, so it is sized with the shorter one: the head row keeps the height of
// its own cells (`w:trHeight`, `CT_Height`, 17.4.80; `ST_HeightRule`, 17.18.37), and the last
// row of the longer merge grows to hold its lines.
//
// The page body is 170pt and lines are 14pt (`table-row-keep-fixtures.ts`).

import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { cell, lay, load, para } from './table-row-keep-fixtures.ts';
import type { OoxmlPart, TreeDocOp } from '../../store/index.ts';
import type { TableFragmentRecord, TableRowFragmentRecord } from '../semantic-records.ts';

const LINE = 14;
const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';
const GRID =
  '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>';

/**
 * Row 0 is one plain line. Row 1 heads a merge of rows 1-2 (one line, column 0) and a merge of
 * rows 1-3 (`longLines` lines, column 1). Column 2 of row 3 holds `lastRowLines` lines.
 *
 * `move` is what moves row 1 to the next page: `w:pageBreakBefore` in its first paragraph, or
 * `w:keepNext` (`CT_OnOff`, 17.3.1.15) in every paragraph of rows 1-2, which keeps rows 1-3
 * on one page.
 */
function tableXml(
  headRowPr: string,
  longLines: number,
  lastRowLines = 1,
  move: 'pageBreakBefore' | 'keepNext' = 'pageBreakBefore'
): string {
  const row = (trPr: string, cells: string) => `<w:tr><w:trPr>${trPr}</w:trPr>${cells}</w:tr>`;
  const keep = move === 'keepNext';
  const kept = keep ? '<w:p><w:pPr><w:keepNext/></w:pPr></w:p>' : '<w:p/>';
  return (
    `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>${GRID}` +
    row('', cell(para('A')) + cell(para('B')) + cell(para('C'))) +
    row(
      headRowPr,
      cell(para('S', 1, { pageBreakBefore: !keep, keep }), RESTART) +
        cell(para('L', longLines, { keep }), RESTART) +
        cell(para('D', 1, { keep }))
    ) +
    row('', cell(kept, CONTINUE) + cell(kept, CONTINUE) + cell(para('E', 1, { keep }))) +
    row('', cell(para('F')) + cell('<w:p/>', CONTINUE) + cell(para('G', lastRowLines))) +
    '</w:tbl>'
  );
}

const EXACT_HEAD = '<w:trHeight w:val="280" w:hRule="exact"/>';

/** The table fragments of the layout, page by page. */
const tablesOf = (part: OoxmlPart) =>
  lay(part).pages.map((page) =>
    page.fragments.filter((f): f is TableFragmentRecord => f.kind === 'table')
  );
const linesIn = (row: TableRowFragmentRecord, column: number) =>
  row.cells
    .find((entry) => entry.gridColumn === column)!
    .blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : []));

// Seven preamble lines put row 1 at 112pt, with 58pt left on the page.
const PREAMBLE = para('P', 7);

// The longer merge needs 70pt. The exact head row is 14pt, so the shorter merge needs 28pt.
test('a longer merge declined at a page bottom is sized on the next page, over an exact head row', () => {
  const pages = tablesOf(load(PREAMBLE + tableXml(EXACT_HEAD, 5)));
  expect(pages[0]!.map((table) => table.rows.length)).toEqual([1]);
  const moved = pages[1]![0]!;
  expect(moved.rows.map((row) => row.box.height)).toEqual([LINE, LINE, 3 * LINE]);
  expect(linesIn(moved.rows[0]!, 1)).toHaveLength(5);
  // The five lines end where the last row of the longer merge ends.
  const last = linesIn(moved.rows[0]!, 1)[4]!;
  const bottom = moved.rows[2]!.box.y + moved.rows[2]!.box.height;
  expect(last.box.y + last.box.height).toBeCloseTo(bottom, 6);
});

// The longer merge needs 112pt for the six lines of row 3. The shorter merge needs 42pt, with
// the two lines of the longer head still in row 1.
test('a longer merge declined at a page bottom is sized on the next page, over rows without a height', () => {
  const pages = tablesOf(load(PREAMBLE + tableXml('', 2, 6)));
  expect(pages[0]!.map((table) => table.rows.length)).toEqual([1]);
  const moved = pages[1]![0]!;
  // The head row keeps its own line, and the two lines of the longer head fit beside rows 1-3.
  expect(moved.rows.map((row) => row.box.height)).toEqual([LINE, LINE, 6 * LINE]);
  expect(linesIn(moved.rows[0]!, 1)).toHaveLength(2);
});

test('a head row that keep-with-next moves to the next page sizes its merges there', () => {
  const pages = tablesOf(load(PREAMBLE + tableXml(EXACT_HEAD, 5, 1, 'keepNext')));
  expect(pages[0]!.map((table) => table.rows.length)).toEqual([1]);
  const moved = pages[1]![0]!;
  expect(moved.rows.map((row) => row.box.height)).toEqual([LINE, LINE, 3 * LINE]);
  expect(linesIn(moved.rows[0]!, 1)).toHaveLength(5);
});

test('a head row that starts on a page sizes its merges as one that moved there', () => {
  // With no preamble the head row is offered once, on the page it starts.
  const first = tablesOf(load(tableXml(EXACT_HEAD, 5)))[1]![0]!;
  const moved = tablesOf(load(PREAMBLE + tableXml(EXACT_HEAD, 5)))[1]![0]!;
  expect(moved.rows.map((row) => row.box.height)).toEqual(first.rows.map((row) => row.box.height));
});

test('a longer merge that does not fit the next page either stays declined', () => {
  // Fourteen lines need 196pt, more than the 170pt body.
  const moved = tablesOf(load(PREAMBLE + tableXml(EXACT_HEAD, 14)))[1]![0]!;
  // The head sizes its own exact row, which shows one line, and the shorter merge is sized.
  expect(moved.rows[0]!.box.height).toBe(LINE);
  expect(linesIn(moved.rows[0]!, 1)).toHaveLength(1);
  expect(moved.rows[1]!.box.height).toBe(LINE);
});

const apply = (part: OoxmlPart, op: TreeDocOp) => {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
};

test.each([
  ['an exact head row', EXACT_HEAD],
  ['rows without a height', ''],
])('incremental relayout across the page break equals a fresh layout, over %s', (_n, trPr) => {
  let part = load(para('P', 3) + tableXml(trPr, 5));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, 15, { session, cache });
  const leading = () =>
    part.root.children
      .find((node) => node.kind === 'body')!
      .children.find((node) => node.kind === 'paragraph')!.id;
  // Push the table down one line at a time, past the place where the longer merge is declined.
  for (let i = 0; i < 9; i++) {
    part = apply(part, { op: 'insertText', paragraphId: leading(), offset: 0, text: 'Q' });
    part = apply(part, { op: 'splitParagraph', paragraphId: leading(), offset: 1 });
    const incremental = lay(part, 15, { session, cache });
    expect({ i, pages: JSON.stringify(incremental.pages) }).toEqual({
      i,
      pages: JSON.stringify(lay(part).pages),
    });
  }
});
