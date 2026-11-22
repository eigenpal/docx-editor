import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import { caretAt } from '../semantic-interaction.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { tableAnchorAt } from '../semantic-cell-selection.ts';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';

// A vertical merge whose rows cross a page break keeps every row at its own height. The
// span's rows stay beside the head row as space allows, and the merged text continues beside
// the rows on the next page. These rows can split, unlike the `w:cantSplit` and exact rows in
// `table-vmerge-fragment-carry.test.ts`.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const geometry = { width: 612, height: 720, margin: { top: 40, bottom: 40, left: 40, right: 40 } };
const measurer = {
  measure: (text: string) => [...text].length * 5,
  lineMetrics: () => ({ height: 12, baseline: 10 }),
};
const LINE = 12;
const p = (text: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

interface Fixture {
  /** Rows in the table; the merge covers `spanRows` of them from the first row. */
  readonly rows: number;
  readonly spanRows?: number;
  /** One-line merged paragraphs. */
  readonly merged: number;
  /** Height of the paragraph above the table, in points. */
  readonly leadPt: number;
  readonly vAlign?: 'center' | 'bottom';
  /** Lines in the unmerged cell of this row, which then splits at the page break. */
  readonly tallRow?: { readonly index: number; readonly lines: number };
  /** `w:trHeight hRule="atLeast"` of every row, in twips. */
  readonly rowTwips?: number;
}

function fixture({ rows, spanRows = rows, merged, leadPt, vAlign, tallRow, rowTwips }: Fixture) {
  const mergedText = Array.from({ length: merged }, (_, index) =>
    p(`MERGED-${String(index + 1).padStart(2, '0')}`)
  ).join('');
  const align = vAlign ? `<w:vAlign w:val="${vAlign}"/>` : '';
  const body = Array.from({ length: rows }, (_, index) => {
    const inSpan = index < spanRows;
    const mergeProps = inSpan ? `<w:vMerge${index === 0 ? ' w:val="restart"' : ''}/>${align}` : '';
    const first = !inSpan ? p('') : index === 0 ? mergedText : p('');
    const label = `ROW-${String(index + 1).padStart(2, '0')}`;
    const second =
      tallRow?.index === index
        ? Array.from({ length: tallRow.lines }, (_, line) => p(`${label}-LINE-${line}`)).join('')
        : p(label);
    const rowProps = rowTwips
      ? `<w:trPr><w:trHeight w:val="${rowTwips}" w:hRule="atLeast"/></w:trPr>`
      : '';
    return (
      `<w:tr>${rowProps}<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/>${mergeProps}</w:tcPr>${first}</w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${second}</w:tc></w:tr>`
    );
  }).join('');
  const lead =
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${leadPt * 20}" w:lineRule="exact"/></w:pPr>` +
    '<w:r><w:t>Lead</w:t></w:r></w:p>';
  const xml =
    `<w:document xmlns:w="${W}"><w:body>${lead}<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/>` +
    '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar>' +
    '<w:tblBorders><w:top w:val="nil"/><w:bottom w:val="nil"/><w:insideH w:val="nil"/></w:tblBorders></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>${body}</w:tbl>` +
    `${p('AFTER')}</w:body></w:document>`;
  const loaded = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part;
}

const layoutOf = (input: Fixture) =>
  layoutSemanticDocument(fixture(input), 0, { geometry, measurer });

function tablesByPage(layout: SemanticLayout): TableFragmentRecord[][] {
  return layout.pages.map((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
}

function cellParagraphs(layout: SemanticLayout) {
  const found: { page: number; row: TableRowFragmentRecord; block: ParagraphFragmentRecord }[] = [];
  for (const [index, tables] of tablesByPage(layout).entries())
    for (const table of tables)
      for (const row of table.rows)
        for (const cell of row.cells)
          for (const block of cell.blocks)
            if (block.kind === 'paragraph') found.push({ page: index + 1, row, block });
  return found;
}

const textOf = (block: ParagraphFragmentRecord) =>
  block.lines.map((line) => line.spans.map((span) => span.text).join('')).join('');

/** Page of each `ROW-nn` label, in row order. */
function rowPages(layout: SemanticLayout): number[] {
  return cellParagraphs(layout)
    .filter(({ block }) => /^ROW-\d\d$/.test(textOf(block)))
    .map(({ page }) => page);
}

function mergedPages(layout: SemanticLayout): number[] {
  return cellParagraphs(layout)
    .filter(({ block }) => textOf(block).startsWith('MERGED-'))
    .map(({ page }) => page);
}

const count = (values: readonly number[], value: number) =>
  values.filter((item) => item === value).length;

describe('vertical merge across a page break with rows that can split', () => {
  test('keeps the span rows beside the head and continues the merged text', () => {
    // 640pt of body: the lead leaves 190pt, so 15 one-line rows fit on page 1.
    const layout = layoutOf({ rows: 30, merged: 20, leadPt: 450 });
    const rows = rowPages(layout);
    expect(rows).toHaveLength(30);
    expect(count(rows, 1)).toBe(15);
    const merged = mergedPages(layout);
    expect(merged).toHaveLength(20);
    expect(count(merged, 1)).toBe(15);
    expect(count(merged, 2)).toBe(5);
    // Every row keeps its own one-line height: the head row does not take the merged height.
    const firstPage = tablesByPage(layout)[0]![0]!;
    for (const row of firstPage.rows) expect(row.box.height).toBeCloseTo(LINE, 3);
  });

  test('grows only the last row by the merged text the rows cannot hold', () => {
    const layout = layoutOf({ rows: 20, merged: 26, leadPt: 450 });
    expect(mergedPages(layout)).toHaveLength(26);
    const rows = tablesByPage(layout)
      .flat()
      .flatMap((table) => table.rows)
      .filter((row) => row.box.height > 0);
    for (const row of rows.slice(0, -1)) expect(row.box.height).toBeCloseTo(LINE, 3);
    expect(rows.at(-1)!.box.height).toBeCloseTo(LINE * 7, 3);
  });

  test('keeps the second row of a two-row merge on the page when both rows fit', () => {
    const layout = layoutOf({ rows: 2, merged: 10, leadPt: 580 });
    expect(rowPages(layout)).toEqual([1, 1]);
    const merged = mergedPages(layout);
    expect(merged).toHaveLength(10);
    expect(count(merged, 1)).toBe(5);
  });

  test('leaves a two-row merge whose second row cannot start on this page to the head row', () => {
    const layout = layoutOf({ rows: 2, merged: 10, leadPt: 620 });
    expect(rowPages(layout)).toEqual([1, 2]);
    expect(mergedPages(layout)).toHaveLength(10);
  });

  test('splits a span row by its own text at the page break', () => {
    const layout = layoutOf({ rows: 12, merged: 6, leadPt: 540, tallRow: { index: 5, lines: 8 } });
    const own = cellParagraphs(layout).filter(({ block }) =>
      textOf(block).startsWith('ROW-06-LINE-')
    );
    expect(own.map(({ page }) => page)).toEqual([1, 1, 1, 2, 2, 2, 2, 2]);
    expect(mergedPages(layout)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(rowPages(layout).slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
  });

  test('aligns the merged text in the head fragment and starts its continuation at the top', () => {
    // 13pt rows: fourteen rows (182pt) fit page 1 and hold fifteen 12pt lines with 2pt left.
    const layout = layoutOf({
      rows: 30,
      merged: 24,
      leadPt: 450,
      vAlign: 'bottom',
      rowTwips: 260,
    });
    const merged = cellParagraphs(layout).filter(({ block }) =>
      textOf(block).startsWith('MERGED-')
    );
    expect(
      count(
        merged.map(({ page }) => page),
        1
      )
    ).toBe(15);
    const [first, second] = tablesByPage(layout).map((tables) => tables[0]!);
    expect(merged[0]!.block.box.y - first!.rows[0]!.box.y).toBeCloseTo(2, 3);
    const continued = merged.find(({ page }) => page === 2)!;
    expect(continued.block.box.y).toBeCloseTo(second!.rows[0]!.box.y, 3);
  });

  test('starts merged text at the top after a head row that splits by its own text', () => {
    const layout = layoutOf({
      rows: 30,
      merged: 30,
      leadPt: 540,
      vAlign: 'bottom',
      tallRow: { index: 0, lines: 12 },
    });
    const merged = cellParagraphs(layout).filter(({ block }) =>
      textOf(block).startsWith('MERGED-')
    );
    expect(merged).toHaveLength(30);
    const continued = merged.find(({ page }) => page === 2)!;
    expect(continued.block.box.y).toBeCloseTo(tablesByPage(layout)[1]![0]!.rows[0]!.box.y, 3);
  });

  test('continues merged text after a span row that splits by its own text', () => {
    // Row 6 places three of its eight lines on page 1 and five on page 2.
    const layout = layoutOf({ rows: 12, merged: 30, leadPt: 540, tallRow: { index: 5, lines: 8 } });
    const merged = cellParagraphs(layout).filter(({ block }) =>
      textOf(block).startsWith('MERGED-')
    );
    expect(merged).toHaveLength(30);
    const onPage2 = merged.filter(({ page }) => page === 2);
    const textBottom = onPage2.at(-1)!.block.box.y + LINE;
    // The last row ends where the merged text ends: it grows by no more than the text needs.
    const last = tablesByPage(layout)[1]![0]!.rows.at(-1)!;
    expect(last.box.y + last.box.height).toBeCloseTo(textBottom, 3);
  });

  test('carries merged text past a span row taller than the rest of the page', () => {
    const layout = layoutOf({ rows: 8, merged: 50, leadPt: 540, tallRow: { index: 2, lines: 50 } });
    expect(mergedPages(layout)).toHaveLength(50);
    expect(
      cellParagraphs(layout).filter(({ block }) => textOf(block).startsWith('ROW-03-LINE-'))
    ).toHaveLength(50);
  });

  test('centers merged text that ends in the head fragment', () => {
    const layout = layoutOf({ rows: 30, merged: 5, leadPt: 450, vAlign: 'center' });
    const merged = cellParagraphs(layout).filter(({ block }) =>
      textOf(block).startsWith('MERGED-')
    );
    expect(merged.map(({ page }) => page)).toEqual([1, 1, 1, 1, 1]);
    const head = tablesByPage(layout)[0]![0]!;
    const top = head.rows[0]!.box.y;
    const bottom = head.rows.at(-1)!.box.y + head.rows.at(-1)!.box.height;
    // Fifteen rows on page 1 hold five lines: five lines of room above and below the text.
    expect(merged[0]!.block.box.y - top).toBeCloseTo((bottom - top - 5 * LINE) / 2, 3);
  });

  test('addresses continued merged text to the authored head cell', () => {
    const layout = layoutOf({ rows: 30, merged: 20, leadPt: 450 });
    const merged = cellParagraphs(layout).filter(({ block }) =>
      textOf(block).startsWith('MERGED-')
    );
    const head = merged[0]!;
    const tail = merged.at(-1)!;
    expect(tail.page).toBe(2);
    const headAnchor = tableAnchorAt(layout, head.block.paragraphId);
    expect(tableAnchorAt(layout, tail.block.paragraphId)).toMatchObject({
      rowId: headAnchor!.rowId,
      cellId: headAnchor!.cellId,
    });
  });

  test('places a caret in continued merged text on the page that shows it', () => {
    const layout = layoutOf({ rows: 30, merged: 20, leadPt: 450 });
    for (const { page, block } of cellParagraphs(layout).filter(({ block }) =>
      textOf(block).startsWith('MERGED-')
    ))
      expect(caretAt(layout, { paragraphId: block.paragraphId, offset: 0 })?.pageIndex).toBe(
        page - 1
      );
  });

  for (const target of ['MERGED-01', 'MERGED-20', 'ROW-20'])
    test(`an incremental pass after typing in ${target} matches a clean pass`, () => {
      const part = fixture({ rows: 30, merged: 20, leadPt: 450 });
      const cache = createParagraphLayoutCache<readonly PendingLine[]>();
      const session = createLayoutSession();
      const before = layoutSemanticDocument(part, 0, { geometry, measurer, cache, session });
      const paragraph = cellParagraphs(before).find(({ block }) => textOf(block) === target)!;
      const edited = applyTreeOp(part, {
        op: 'insertText',
        paragraphId: paragraph.block.paragraphId,
        offset: 0,
        text: 'typed text that wraps onto several lines in the cell ',
      });
      if (!edited.ok) throw new Error(edited.reason);
      const incremental = layoutSemanticDocument(edited.part, 1, {
        geometry,
        measurer,
        cache,
        session,
      });
      const clean = layoutSemanticDocument(edited.part, 1, { geometry, measurer });
      expect(JSON.parse(JSON.stringify(incremental))).toEqual(JSON.parse(JSON.stringify(clean)));
    });

  test('lays out the same pages on a repeated pass', () => {
    const input = { rows: 30, merged: 20, leadPt: 450 };
    expect(layoutOf(input)).toEqual(layoutOf(input));
  });

  test('keeps the plain layout when the whole span fits the page', () => {
    const layout = layoutOf({ rows: 10, merged: 6, leadPt: 100 });
    expect(rowPages(layout)).toEqual(Array.from({ length: 10 }, () => 1));
    expect(
      tablesByPage(layout)
        .flat()
        .flatMap((table) => table.rows)
        .some((row) => row.isContinuation === true)
    ).toBe(false);
  });
});
