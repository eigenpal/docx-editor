// Content that merged text over `hRule="exact"` rows carries across a page break (`w:vMerge`,
// `CT_VMerge`, ECMA-376 Part 1, 17.4.84; `w:trHeight`, `CT_Height`, 17.4.80; `ST_HeightRule`,
// 17.18.37):
//
// - Content in the line or block flow: a line break (`w:br`, `CT_Br`, 17.3.3.1), an inline
//   drawing (`w:drawing`, `CT_Drawing`, 17.3.3.9), and a nested table (`w:tbl`, `CT_Tbl`,
//   17.4.37).
// - A family of merges where one merge starts in a row that an earlier merge covers.
//
// The page body is 170pt and lines are 14pt (`table-row-keep-fixtures.ts`). Rows are exact 6pt,
// 50pt and 20pt.

import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { cell, lay, load, para } from './table-row-keep-fixtures.ts';
import { layoutContext } from './anchored-drawing-test-fixtures.ts';
import type { OoxmlPart, TreeDocOp } from '../../store/index.ts';
import type {
  BlockFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '../semantic-records.ts';

const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';
const exact = (twips: number) => `<w:trPr><w:trHeight w:val="${twips}" w:hRule="exact"/></w:trPr>`;
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function tableXml(rows: readonly string[]): string {
  return (
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `${rows.join('')}</w:tbl>`
  );
}

/** Column 0 merges rows 0-1 with `head`, and column 2 merges rows 0-2 with one line. */
const familyTable = (head: string) =>
  tableXml([
    `<w:tr>${exact(120)}${cell(head, RESTART)}${cell(para('M0'))}${cell(para('L'), RESTART)}</w:tr>`,
    `<w:tr>${exact(1000)}${cell('<w:p/>', CONTINUE)}${cell(para('M1'))}${cell('<w:p/>', CONTINUE)}</w:tr>`,
    `<w:tr>${exact(400)}${cell(para('K2'))}${cell(para('M2'))}${cell('<w:p/>', CONTINUE)}</w:tr>`,
  ]);

const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** One 24pt by 12pt inline picture. Layout needs only its extent, not the image part. */
const picture =
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}" distT="0" distB="0" distL="0" distR="0">` +
  '<wp:extent cx="304800" cy="152400"/><wp:docPr id="1" name="Picture"/>' +
  `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
  `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip xmlns:r="${R}" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  '<pic:spPr><a:xfrm><a:ext cx="304800" cy="152400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
const nestedTable =
  '<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${para('T')}</w:tc></w:tr></w:tbl>`;
const brokenLines = para('H0').replace('<w:t>', '<w:br/><w:t>');

const textOf = (block: BlockFragmentRecord): string[] =>
  block.kind === 'paragraph'
    ? block.lines
        .map((line) => line.spans.map((span) => span.text).join(''))
        .filter((text) => text !== '')
    : block.rows.flatMap((row) => row.cells.flatMap((placed) => placed.blocks.flatMap(textOf)));
const drawingsOf = (block: BlockFragmentRecord): number =>
  block.kind === 'paragraph'
    ? block.lines.reduce((sum, line) => sum + (line.drawings?.length ?? 0), 0)
    : block.rows.reduce(
        (sum, row) =>
          sum +
          row.cells.reduce(
            (inner, placed) =>
              inner + placed.blocks.reduce((count, child) => count + drawingsOf(child), 0),
            0
          ),
        0
      );
/** Layout with inline drawings placed from their extents. */
const layDoc = (part: OoxmlPart, extra: object = {}) =>
  lay(part, 15, { inlineDrawingLayout: layoutContext(part), ...extra });
const tablesOn = (layout: SemanticLayout, page: number) =>
  layout.pages[page]!.fragments.filter((f): f is TableFragmentRecord => f.kind === 'table');
const textsOn = (layout: SemanticLayout, page: number): string[] =>
  tablesOn(layout, page).flatMap(textOf);
const textsOfAll = (layout: SemanticLayout) =>
  layout.pages.flatMap((_page, index) => textsOn(layout, index));
const drawingsOn = (layout: SemanticLayout, page: number) =>
  tablesOn(layout, page).reduce((sum, table) => sum + drawingsOf(table), 0);

const shapes = [
  {
    name: 'a line break',
    table: familyTable(brokenLines + para('H1')),
    merged: ['H01', 'H11', 'L1'],
    drawings: 0,
  },
  {
    name: 'an inline drawing',
    table: familyTable(para('H0') + picture + para('H1')),
    merged: ['H01', 'H11', 'L1'],
    drawings: 1,
  },
  {
    name: 'a nested table',
    table: familyTable(para('H0') + nestedTable + para('H1')),
    merged: ['H01', 'T1', 'H11', 'L1'],
    drawings: 0,
  },
  {
    // Column 1 merges rows 1-2: it starts in a row that the column 0 merge covers.
    name: 'a merge that starts in a covered row',
    table: tableXml([
      `<w:tr>${exact(120)}${cell(para('H0') + para('H1'), RESTART)}${cell(para('M0'))}${cell(para('L'), RESTART)}</w:tr>`,
      `<w:tr>${exact(1000)}${cell('<w:p/>', CONTINUE)}${cell(para('N'), RESTART)}${cell('<w:p/>', CONTINUE)}</w:tr>`,
      `<w:tr>${exact(400)}${cell(para('K2'))}${cell('<w:p/>', CONTINUE)}${cell('<w:p/>', CONTINUE)}</w:tr>`,
    ]),
    merged: ['H01', 'H11', 'L1', 'N1'],
    drawings: 0,
  },
];

for (const shape of shapes) {
  test(`merged text with ${shape.name} paints once wherever the page break falls`, () => {
    for (let preamble = 1; preamble <= 12; preamble++) {
      const layout = layDoc(load(para('P', preamble) + shape.table + para('After')));
      const texts = textsOfAll(layout);
      for (const text of [...shape.merged, 'M01']) {
        const count = texts.filter((t) => t === text).length;
        expect({ preamble, text, count }).toEqual({ preamble, text, count: 1 });
      }
      const drawings = layout.pages.reduce(
        (sum, _page, index) => sum + drawingsOn(layout, index),
        0
      );
      expect({ preamble, drawings }).toEqual({ preamble, drawings: shape.drawings });
    }
  });

  test(`merged text with ${shape.name} moves to the next page below the head row`, () => {
    // Nine lines put the 6pt head row at the page end: no merged line fits beside it.
    const layout = layDoc(load(para('P', 9) + shape.table + para('After')));
    expect(textsOn(layout, 0)).toContain('M01');
    for (const text of shape.merged) expect(textsOn(layout, 0)).not.toContain(text);
    expect(textsOn(layout, 1)).toEqual(expect.arrayContaining(shape.merged));
    expect(drawingsOn(layout, 1)).toBe(shape.drawings);
  });
}

/** Whether the merged text on the second page continues in a zero-height carried head row. */
const carries = (head: string) => {
  const layout = layDoc(load(para('P', 9) + familyTable(head + para('H1')) + para('After')));
  return tablesOn(layout, 1).some((table) =>
    table.rows.some((row) => row.isContinuation && row.box.height === 0)
  );
};

test('a text-wrapping break and a carriage return stay in the line flow', () => {
  // `ST_BrType` (17.18.4) `textWrapping` is the default break type; `w:cr` is 17.3.3.4.
  expect(carries(para('H0').replace('<w:t>', '<w:br w:type="textWrapping"/><w:t>'))).toBe(true);
  expect(carries(para('H0').replace('<w:t>', '<w:cr/><w:t>'))).toBe(true);
});

test('content that leaves the flow keeps the older path', () => {
  // A page break (`ST_BrType` `page`), a nested table positioned on the page (`w:tblpPr`,
  // `CT_TblPPr`, 17.4.57), and an empty drawing do not stay in the flow of the merged cell.
  expect(carries(para('H0').replace('<w:t>', '<w:br w:type="page"/><w:t>'))).toBe(false);
  const floating = nestedTable.replace(
    '<w:tblPr>',
    '<w:tblPr><w:tblpPr w:vertAnchor="page" w:horzAnchor="page" w:tblpX="2000" w:tblpY="2000"/>'
  );
  expect(carries(para('H0') + floating)).toBe(false);
  // A repeated header row (`w:tblHeader`, 17.4.49) keeps a nested table whole.
  const headed = nestedTable.replace('<w:tr>', '<w:tr><w:trPr><w:tblHeader/></w:trPr>');
  expect(carries(para('H0') + headed)).toBe(false);
  const empty = '<w:p><w:r><w:drawing/></w:r></w:p>';
  expect(carries(para('H0') + empty)).toBe(false);
});

const body = (part: OoxmlPart) => part.root.children.find((n) => n.kind === 'body')!;
const apply = (part: OoxmlPart, op: TreeDocOp) => {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
};

for (const shape of shapes)
  test(`incremental relayout across the break matches a fresh layout (${shape.name})`, () => {
    let part = load(para('P', 4) + shape.table + para('After'));
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    layDoc(part, { session, cache });
    const leading = () => body(part).children.find((n) => n.kind === 'paragraph')!.id;
    const check = (label: string) => {
      const incremental = layDoc(part, { session, cache });
      const fresh = layDoc(part);
      expect({ label, pages: JSON.stringify(incremental.pages) }).toEqual({
        label,
        pages: JSON.stringify(fresh.pages),
      });
    };
    for (let i = 0; i < 8; i++) {
      part = apply(part, { op: 'insertText', paragraphId: leading(), offset: 0, text: 'Q' });
      part = apply(part, { op: 'splitParagraph', paragraphId: leading(), offset: 1 });
      check(`push ${i}`);
    }
    for (let i = 0; i < 8; i++) {
      part = apply(part, { op: 'deleteBlock', blockId: leading() });
      check(`pull ${i}`);
    }
  });
