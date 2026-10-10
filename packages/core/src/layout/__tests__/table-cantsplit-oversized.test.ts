// A `w:cantSplit` row that no page can hold. It moves to a fresh page, then splits there
// like an ordinary row: every line is kept, in order, inside the content box.

import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession, layoutSemanticDocument, linesOf } from '../index.ts';
import { TablePaginationError } from '../semantic-table-layout.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PAGE_HEIGHT = 60;
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const lines = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => p(`${prefix}${index}`)).join('');
const row = (content: string, properties = '') =>
  `<w:tr><w:trPr>${properties}</w:trPr><w:tc>${content}</w:tc></w:tr>`;
const table = (rows: string) => `<w:tbl><w:tblPr><w:tblW w:w="1800" w:type="dxa"/>
  <w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar>
  </w:tblPr><w:tblGrid><w:gridCol w:w="1800"/></w:tblGrid>${rows}</w:tbl>`;
const options = {
  geometry: { width: 120, height: PAGE_HEIGHT, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  measurer: {
    measure: (text: string) => text.length * 4,
    lineMetrics: () => ({ height: 10, baseline: 8 }),
  },
};

function source(body: string) {
  const xml = `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function lineTexts(layout: SemanticLayout): string[] {
  return linesOf(layout).map((line) => line.spans.map((span) => span.text).join(''));
}

/** Page number (1-based) of each painted line, keyed by its text. */
function pageOfLines(layout: SemanticLayout): Map<string, number> {
  const pages = new Map<string, number>();
  layout.pages.forEach((page, index) => {
    const walk = (blocks: readonly unknown[]): void => {
      for (const block of blocks as { kind: string }[]) {
        if (block.kind === 'paragraph') {
          for (const line of (block as { lines: { spans: { text: string }[] }[] }).lines)
            pages.set(line.spans.map((span) => span.text).join(''), index + 1);
        } else if (block.kind === 'table') {
          for (const tableRow of (block as TableFragmentRecord).rows)
            for (const cell of tableRow.cells) walk(cell.blocks);
        }
      }
    };
    walk(page.fragments);
  });
  return pages;
}

function tables(layout: SemanticLayout): TableFragmentRecord[] {
  return layout.pages.flatMap((page) =>
    page.fragments.filter((block): block is TableFragmentRecord => block.kind === 'table')
  );
}

function expectInsideContentBox(layout: SemanticLayout): void {
  for (const fragment of tables(layout)) {
    expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(PAGE_HEIGHT + 0.001);
    for (const tableRow of fragment.rows)
      expect(tableRow.box.y + tableRow.box.height).toBeLessThanOrEqual(PAGE_HEIGHT + 0.001);
  }
}

test('an oversized cantSplit row starts on a fresh page and splits there', () => {
  const part = source(
    p('before') + table(row(p('short')) + row(lines('x', 10), '<w:cantSplit/>')) + p('after')
  );
  const original = serializeOoxmlPart(part);
  const layout = layoutSemanticDocument(part, 0, options);
  expect(lineTexts(layout)).toEqual([
    'before',
    'short',
    ...Array.from({ length: 10 }, (_, index) => `x${index}`),
    'after',
  ]);
  const pages = pageOfLines(layout);
  // Page 1 had room for four lines of the row, but the row moved rather than start there.
  expect(pages.get('short')).toBe(1);
  expect(pages.get('x0')).toBe(2);
  expect(pages.get('x5')).toBe(2);
  expect(pages.get('x6')).toBe(3);
  expect(pages.get('x9')).toBe(3);
  expect(pages.get('after')).toBe(3);
  expectInsideContentBox(layout);
  const occurrences = tables(layout).flatMap((fragment) =>
    fragment.rows.filter((tableRow) => tableRow.rowIndex === 1)
  );
  expect(occurrences.map((tableRow) => tableRow.isContinuation === true)).toEqual([false, true]);
  expect(occurrences[0]!.box.y).toBe(0);
  expect(serializeOoxmlPart(part)).toBe(original);
});

test('an oversized cantSplit row already at the page top splits in place', () => {
  const layout = layoutSemanticDocument(
    source(table(row(lines('x', 8), '<w:cantSplit/>'))),
    0,
    options
  );
  expect(layout.pages).toHaveLength(2);
  const pages = pageOfLines(layout);
  expect(pages.get('x5')).toBe(1);
  expect(pages.get('x6')).toBe(2);
  expectInsideContentBox(layout);
});

test('a cantSplit row that fits a page still moves whole', () => {
  const layout = layoutSemanticDocument(
    source(p('before') + p('more') + table(row(lines('x', 5), '<w:cantSplit/>'))),
    0,
    options
  );
  const pages = pageOfLines(layout);
  expect(pages.get('x0')).toBe(2);
  expect(pages.get('x4')).toBe(2);
  expect(tables(layout).flatMap((fragment) => fragment.rows)).toHaveLength(1);
});

test('repeated header rows precede every page of an oversized cantSplit row', () => {
  const layout = layoutSemanticDocument(
    source(
      table(
        row(p('head'), '<w:tblHeader/>') + row(p('short')) + row(lines('x', 12), '<w:cantSplit/>')
      )
    ),
    0,
    options
  );
  const pages = pageOfLines(layout);
  expect(pages.get('short')).toBe(1);
  expect(pages.get('x0')).toBe(2);
  expectInsideContentBox(layout);
  const fragments = tables(layout);
  expect(fragments.length).toBeGreaterThanOrEqual(3);
  for (const fragment of fragments.slice(1)) {
    expect(fragment.rows[0]!.isHeaderRepeat).toBe(true);
    expect(fragment.rows[0]!.box.y).toBe(0);
  }
  const body = lineTexts(layout).filter((text) => text.startsWith('x'));
  expect(body).toEqual(Array.from({ length: 12 }, (_, index) => `x${index}`));
});

test('an oversized cantSplit row does not strand the header rows above it', () => {
  const layout = layoutSemanticDocument(
    source(table(row(p('head'), '<w:tblHeader/>') + row(lines('x', 12), '<w:cantSplit/>'))),
    0,
    options
  );
  const fragments = tables(layout);
  expect(fragments[0]!.rows.map((tableRow) => tableRow.rowIndex)).toEqual([0, 1]);
  expect(pageOfLines(layout).get('x0')).toBe(1);
  for (const fragment of fragments.slice(1)) expect(fragment.rows[0]!.isHeaderRepeat).toBe(true);
  expectInsideContentBox(layout);
});

test('an oversized cantSplit row below a mid-page header row moves to a fresh page', () => {
  const layout = layoutSemanticDocument(
    source(
      p('before') +
        p('more') +
        table(row(p('head'), '<w:tblHeader/>') + row(lines('x', 12), '<w:cantSplit/>'))
    ),
    0,
    options
  );
  expect(pageOfLines(layout).get('x0')).toBe(2);
  // Page 1 keeps the authored header row alone; the row starts below its repeat on page 2.
  const firstPageTables = layout.pages[0]!.fragments.filter(
    (block): block is TableFragmentRecord => block.kind === 'table'
  );
  expect(firstPageTables.flatMap((fragment) => fragment.rows.map((r) => r.rowIndex))).toEqual([0]);
  const fragments = tables(layout);
  for (const fragment of fragments.slice(1)) {
    expect(fragment.rows[0]!.isHeaderRepeat).toBe(true);
    expect(fragment.rows[0]!.box.y).toBe(0);
  }
  expect(lineTexts(layout).filter((text) => text.startsWith('x'))).toHaveLength(12);
  expectInsideContentBox(layout);
});

test('an oversized cantSplit row splits its nested table between nested rows', () => {
  const nested = table(Array.from({ length: 9 }, (_, i) => row(p(`n${i}`))).join(''));
  const layout = layoutSemanticDocument(
    source(p('before') + table(row(nested, '<w:cantSplit/>'))),
    0,
    options
  );
  const pages = pageOfLines(layout);
  expect(pages.get('n0')).toBe(2);
  expect(pages.get('n5')).toBe(2);
  expect(pages.get('n6')).toBe(3);
  expect(lineTexts(layout).filter((text) => text.startsWith('n'))).toHaveLength(9);
  expectInsideContentBox(layout);
});

test('incremental layout returns the same pages for an oversized cantSplit row', () => {
  const part = source(p('before') + table(row(p('short')) + row(lines('x', 10), '<w:cantSplit/>')));
  const layout = layoutSemanticDocument(part, 0, options);
  const session = createLayoutSession();
  for (let revision = 0; revision < 2; revision++)
    expect(layoutSemanticDocument(part, revision, { ...options, session }).pages).toEqual(
      layout.pages
    );
});

test('an exact-height row taller than the page still fails closed', () => {
  const part = source(table(row(p('x'), '<w:trHeight w:val="2000" w:hRule="exact"/>')));
  expect(() => layoutSemanticDocument(part, 0, options)).toThrow(TablePaginationError);
});

test('an oversized cantSplit row with an unsplittable nested row still fails closed', () => {
  const nested = table(row(lines('n', 8)));
  const part = source(table(row(nested, '<w:cantSplit/>')));
  expect(() => layoutSemanticDocument(part, 0, options)).toThrow(TablePaginationError);
});
