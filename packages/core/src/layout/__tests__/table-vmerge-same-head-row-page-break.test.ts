// Vertical merges (`w:vMerge`, `CT_VMerge`, ECMA-376 Part 1, 17.4.84) over `hRule="exact"`
// rows (`w:trHeight`, `CT_Height`, 17.4.80; `ST_HeightRule`, 17.18.37) in a table that
// breaks across pages. An exact row clips its own cell content, but merged text belongs to
// the merged cell. The text shows in the part of the merge on the first page, and what does
// not fit there continues in the part on the next page.
//
// The page body is 170pt and lines are 14pt (`table-row-keep-fixtures.ts`). Rows are exact
// 6pt, 50pt and 20pt. Column 0 merges rows 0-1 with three lines, column 1 is plain, and
// column 2 merges rows 0-2 with one line.

import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { cell, lay, load, para } from './table-row-keep-fixtures.ts';
import type { OoxmlPart, TreeDocOp } from '../../store/index.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';
const exact = (twips: number, extra = '') =>
  `<w:trPr>${extra}<w:trHeight w:val="${twips}" w:hRule="exact"/></w:trPr>`;
const shortHead = para('H0') + para('H1') + para('H2');
const HEAD_LINES = ['H01', 'H11', 'H21'];

function tableXml({
  longMerge = true,
  rowExtra = '',
  header = '',
}: { longMerge?: boolean; rowExtra?: string; header?: string } = {}): string {
  const long = (body: string, merge: string) => (longMerge ? cell(body, merge) : cell(body));
  return (
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    header +
    `<w:tr>${exact(120, rowExtra)}${cell(shortHead, RESTART)}${cell(para('M0'))}${long(para('L'), RESTART)}</w:tr>` +
    `<w:tr>${exact(1000, rowExtra)}${cell('<w:p/>', CONTINUE)}${cell(para('M1'))}${long(longMerge ? '<w:p/>' : para('N1'), CONTINUE)}</w:tr>` +
    `<w:tr>${exact(400, rowExtra)}${cell(para('K2'))}${cell(para('M2'))}${long(longMerge ? '<w:p/>' : para('N2'), CONTINUE)}</w:tr>` +
    '</w:tbl>'
  );
}

const tablesOn = (layout: SemanticLayout, page: number) =>
  layout.pages[page]!.fragments.filter((f): f is TableFragmentRecord => f.kind === 'table');
/** Every run text the tables on one page paint, in record order. */
const textsOn = (layout: SemanticLayout, page: number): string[] =>
  [...JSON.stringify(tablesOn(layout, page)).matchAll(/"text":"([^"]*)"/g)].map((m) => m[1]!);
const textsOfAll = (layout: SemanticLayout) =>
  layout.pages.flatMap((_page, index) => textsOn(layout, index));

test('a break below the second row keeps every merged line on the first page', () => {
  // Seven lines put the head row at 98pt: rows 0 and 1 fit, row 2 starts the next page.
  const layout = lay(load(para('P', 7) + tableXml() + para('After')));
  expect(textsOn(layout, 0)).toEqual(expect.arrayContaining([...HEAD_LINES, 'L1', 'M11']));
  expect(textsOn(layout, 1)).toEqual(expect.arrayContaining(['K21', 'M21']));
  expect(textsOn(layout, 1)).not.toContain('L1');
});

test('a break below the head row moves the merged text to the next page', () => {
  // Nine lines put the head row at 126pt: only the head row fits the first page.
  const layout = lay(load(para('P', 9) + tableXml() + para('After')));
  const first = textsOn(layout, 0);
  expect(first).toContain('M01');
  for (const text of [...HEAD_LINES, 'L1']) expect(first).not.toContain(text);
  expect(textsOn(layout, 1)).toEqual(expect.arrayContaining([...HEAD_LINES, 'L1', 'M11', 'K21']));
  // The exact head row keeps its height on the first page.
  expect(tablesOn(layout, 0)[0]!.rows[0]!.box.height).toBeCloseTo(6, 6);
});

test('a single two-row merge over exact rows continues on the next page', () => {
  const layout = lay(load(para('P', 9) + tableXml({ longMerge: false }) + para('After')));
  for (const text of HEAD_LINES) expect(textsOn(layout, 0)).not.toContain(text);
  expect(textsOn(layout, 1)).toEqual(expect.arrayContaining(HEAD_LINES));
});

test('rows that cannot split carry the merged text the same way', () => {
  const layout = lay(load(para('P', 9) + tableXml({ rowExtra: '<w:cantSplit/>' }) + para('After')));
  expect(textsOn(layout, 1)).toEqual(expect.arrayContaining([...HEAD_LINES, 'L1']));
});

test('the merged text continues below a repeated header row', () => {
  const header =
    '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
    `${cell(para('R'))}${cell(para('R'))}${cell(para('R'))}</w:tr>`;
  const layout = lay(load(para('P', 8) + tableXml({ header }) + para('After')));
  const next = textsOn(layout, 1);
  expect(next.indexOf('R1')).toBeLessThan(next.indexOf('H01'));
  expect(next).toEqual(expect.arrayContaining([...HEAD_LINES, 'L1']));
});

test('every merged line paints once wherever the page break falls', () => {
  for (let lines = 1; lines <= 12; lines++) {
    const texts = textsOfAll(lay(load(para('P', lines) + tableXml() + para('After'))));
    for (const text of [...HEAD_LINES, 'L1']) {
      expect({ lines, text, count: texts.filter((t) => t === text).length }).toEqual({
        lines,
        text,
        count: 1,
      });
    }
  }
});

const customTable = (rows: readonly string[]) =>
  '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  `${rows.join('')}</w:tbl>`;
const lines = (name: string, count: number) =>
  Array.from({ length: count }, (_unused, index) => para(`${name}${index}`)).join('');

test('a line that the break leaves past the last fixed row paints clipped', () => {
  // Four lines need 56pt, as much as the two rows. The 6pt head row on the first page holds
  // none of them, so the fourth line starts inside the 50pt row and is cut at its bottom.
  const layout = lay(
    load(
      para('P', 9) +
        customTable([
          `<w:tr>${exact(120)}${cell(lines('F', 4), RESTART)}${cell(para('M0'))}${cell(para('N0'))}</w:tr>`,
          `<w:tr>${exact(1000)}${cell('<w:p/>', CONTINUE)}${cell(para('M1'))}${cell(para('N1'))}</w:tr>`,
        ]) +
        para('After')
    )
  );
  expect(textsOn(layout, 1)).toEqual(expect.arrayContaining(['F01', 'F11', 'F21', 'F31']));
  const row = tablesOn(layout, 1)[0]!.rows.at(-1)!;
  expect(row.box.height).toBeCloseTo(50, 6);
});

test('a fixed head row over a growable row places every merged line once', () => {
  const tableRows = [
    `<w:tr>${exact(120)}${cell(lines('F', 4), RESTART)}${cell(para('M0'))}${cell(para('N0'))}</w:tr>`,
    `<w:tr>${cell('<w:p/>', CONTINUE)}${cell(para('M1'))}${cell(para('N1'))}</w:tr>`,
  ];
  for (let preamble = 1; preamble <= 12; preamble++) {
    const texts = textsOfAll(
      lay(load(para('P', preamble) + customTable(tableRows) + para('After')))
    );
    for (const text of ['F01', 'F11', 'F21', 'F31']) {
      expect({ preamble, text, count: texts.filter((t) => t === text).length }).toEqual({
        preamble,
        text,
        count: 1,
      });
    }
  }
});

test('three fixed merges from one head row each keep their lines across the break', () => {
  // Rows are 6pt, 30pt, 30pt and 30pt. The merges cover two, three and four rows. The
  // four-row merge holds eight lines, more than its rows show, so it is clipped at the end.
  const tableRows = [
    `<w:tr>${exact(120)}${cell(lines('A', 2), RESTART)}${cell(lines('B', 4), RESTART)}${cell(lines('C', 8), RESTART)}</w:tr>`,
    `<w:tr>${exact(600)}${cell('<w:p/>', CONTINUE)}${cell('<w:p/>', CONTINUE)}${cell('<w:p/>', CONTINUE)}</w:tr>`,
    `<w:tr>${exact(600)}${cell(para('K2'))}${cell('<w:p/>', CONTINUE)}${cell('<w:p/>', CONTINUE)}</w:tr>`,
    `<w:tr>${exact(600)}${cell(para('K3'))}${cell(para('J3'))}${cell('<w:p/>', CONTINUE)}</w:tr>`,
  ];
  for (let preamble = 1; preamble <= 12; preamble++) {
    const texts = textsOfAll(
      lay(load(para('P', preamble) + customTable(tableRows) + para('After')))
    );
    for (const text of ['A01', 'A11', 'B01', 'B11', 'B21', 'B31', 'C01']) {
      expect({ preamble, text, count: texts.filter((t) => t === text).length }).toEqual({
        preamble,
        text,
        count: 1,
      });
    }
  }
});

test('the last row keeps the closing rule of the table below a carried merge', () => {
  // A single 0.5pt bottom rule (`w:tblBorders`, 17.4.38) closes the table below its exact last
  // row. The merge from the head row continues into that row, and the rule still adds below
  // the row's 20pt, as it does in the same table without the merge.
  const rule =
    '<w:tblBorders><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders>';
  const bordered = (longMerge: boolean) =>
    tableXml({ longMerge }).replace(
      '<w:tblLayout w:type="fixed"/>',
      `<w:tblLayout w:type="fixed"/>${rule}`
    );
  const lastRow = (longMerge: boolean) => {
    const layout = lay(load(para('P', 9) + bordered(longMerge) + para('After')));
    return tablesOn(layout, 1)[0]!.rows.at(-1)!;
  };
  const merged = lastRow(true);
  expect(merged.box.height).toBeCloseTo(20.5, 6);
  expect(merged.box.height).toBeCloseTo(lastRow(false).box.height, 6);
});

const body = (part: OoxmlPart) => part.root.children.find((n) => n.kind === 'body')!;
const apply = (part: OoxmlPart, op: TreeDocOp) => {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
};

for (const longMerge of [true, false])
  test(`incremental relayout across the break matches a fresh layout (${longMerge ? 'two merges' : 'one merge'})`, () => {
    let part = load(para('P', 4) + tableXml({ longMerge }) + para('After'));
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    lay(part, 15, { session, cache });
    const leading = () => body(part).children.find((n) => n.kind === 'paragraph')!.id;
    const check = (label: string) => {
      const incremental = lay(part, 15, { session, cache });
      const fresh = lay(part);
      expect({ label, pages: JSON.stringify(incremental.pages) }).toEqual({
        label,
        pages: JSON.stringify(fresh.pages),
      });
      // Every line of the table paints once, and the merged lines keep their order.
      const texts = textsOfAll(fresh);
      const plain = ['M01', 'M11', 'M21', 'K21', 'L1', ...(longMerge ? [] : ['N11', 'N21'])];
      for (const text of [...HEAD_LINES, ...plain]) {
        const count = texts.filter((t) => t === text).length;
        expect({ label, text, count }).toEqual({ label, text, count: 1 });
      }
      const order = HEAD_LINES.map((text) => texts.indexOf(text));
      expect({ label, order }).toEqual({ label, order: [...order].sort((a, b) => a - b) });
    };
    for (let i = 0; i < 9; i++) {
      part = apply(part, { op: 'insertText', paragraphId: leading(), offset: 0, text: 'Q' });
      part = apply(part, { op: 'splitParagraph', paragraphId: leading(), offset: 1 });
      check(`push ${i}`);
    }
    for (let i = 0; i < 9; i++) {
      part = apply(part, { op: 'deleteBlock', blockId: leading() });
      check(`pull ${i}`);
    }
  });
