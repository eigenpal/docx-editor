import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import { updateTableText } from '../table-text-update.ts';
import { splitRowWidthTestRecorder } from '../table-width-split-rows.ts';
import type {
  SemanticLayout,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from '../semantic-records.ts';
import { lay, load, measurer, styleCascade } from './table-row-keep-fixtures.ts';

// Page body: 310pt wide, 170pt tall. Exact 14pt lines; columns start at 100pt, no cell margins.
const p = (text: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:widowControl w:val="0"/>` +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (content: string, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const body = (index: number) => tr([0, 1, 2].map((c) => tc(p(`r${index}c${c}`))));
/** Twenty lines in its first cell: taller than a page, so it splits over three pages. */
const tall = (line: (index: number) => string = (i) => `n${i}`, firstPPr = '', trPr = '') =>
  tr(
    [
      tc(Array.from({ length: 20 }, (_, i) => p(line(i), i === 0 ? firstPPr : '')).join('')),
      tc(p('x')),
      tc(p('y')),
    ],
    trPr
  );
const HEADER = tr([tc(p('Head A')), tc(p('Head B')), tc(p('Head C'))], '<w:tblHeader/>');
const MERGED_HEADERS = [
  tr(
    [tc(p('Group') + p('Two'), '<w:vMerge w:val="restart"/>'), tc(p('Top B')), tc(p('C'))],
    '<w:tblHeader/>'
  ),
  tr([tc(p(''), '<w:vMerge/>'), tc(p('Low B')), tc(p('Low C'))], '<w:tblHeader/>'),
];
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('') +
  '</w:tblBorders>';
const ZERO_MARGINS =
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
/** Headers, six body rows, the split row (row `headers.length + 6`), then ten body rows. */
const table = (headers: readonly string[], split = tall()) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${BORDERS}${ZERO_MARGINS}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>` +
  [
    ...headers,
    ...Array.from({ length: 6 }, (_, i) => body(i)),
    split,
    ...Array.from({ length: 10 }, (_, i) => body(10 + i)),
  ].join('') +
  '</w:tbl>';

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const deps = {
  measurer,
  styleCascade,
  producer: 'test',
  nextLineId: () => '',
  displayMode: 'all-markup' as const,
  compatibilityMode: 15,
};
const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
};
const paragraphAt = (part: OoxmlPart, row: number, cell: number): string =>
  readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[row]!.cells[cell]!.blocks[0]!.id;
/** The body band of each page; these pages carry no note reserve. */
const band = (layout: SemanticLayout) => (index: number) => layout.pages[index]!.contentBox.height;
const rowsOf = (layout: SemanticLayout): TableRowFragmentRecord[] =>
  layout.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
    .flatMap((fragment) => fragment.rows);
const occurrences = (layout: SemanticLayout, id: string) =>
  rowsOf(layout).filter((row) => row.id === id);
const lineIds = (row: TableRowFragmentRecord): string[] =>
  row.cells.flatMap((cell) =>
    cell.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : [])).map((l) => l.id)
  );
const lineCount = (rows: readonly TableRowFragmentRecord[]): number =>
  rows.reduce((sum, row) => sum + lineIds(row).length, 0);

/** One edit through the direct update and the retained session, both against a cold layout. */
function widthEdit(xml: string, row: number, cell: number, text: string, splitRow: number) {
  const part = load(xml);
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const previous = lay(part, 15, { session, cache });
  const splitId = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[splitRow]!.id;
  const edit = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: paragraphAt(part, row, cell),
    offset: 0,
    text,
  });
  if (!edit.ok) throw Error(edit.reason);
  const recorder = splitRowWidthTestRecorder();
  const direct = updateTableText(
    tableNode(part),
    tableNode(edit.part),
    previous.pages,
    310,
    { ...deps, cache } as never,
    band(previous)
  );
  recorder.dispose();
  const cold = lay(reparsed(edit.part));
  expect(lay(edit.part, 15, { session, cache }).pages).toEqual(cold.pages);
  return {
    previous,
    direct,
    cold,
    splitId,
    placed: recorder.placed,
    refused: recorder.refused,
  };
}

/** The split row spans three pages, and the edit changed the widths. */
function expectSplitWidthChange(run: ReturnType<typeof widthEdit>): void {
  const before = occurrences(run.previous, run.splitId);
  expect(before.length).toBeGreaterThanOrEqual(3);
  expect(before[0]!.hasContinuation).toBe(true);
  expect(before.at(-1)!.isContinuation).toBe(true);
  const edges = (layout: SemanticLayout) =>
    JSON.stringify(
      layout.pages
        .flatMap((page) => page.fragments)
        .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
        .map((fragment) => fragment.columnEdges)
    );
  expect(edges(run.cold)).not.toBe(edges(run.previous));
}

/** Accepted, exact, and every occurrence keeps its own stable line ids. */
function expectAccepted(run: ReturnType<typeof widthEdit>): void {
  expectSplitWidthChange(run);
  expect(run.direct).not.toBeNull();
  expect(run.direct!.pages).toEqual(run.cold.pages);
  expect(run.direct!.lineDelta).toBe(0);
  expect([run.placed, run.refused]).toEqual([1, 0]);
  const split = occurrences(run.cold, run.splitId).flatMap(lineIds);
  expect(new Set(split).size).toBe(split.length);
  for (const id of split) expect(id.includes(':occ:')).toBe(false);
}

test('a width edit after a row splits over three pages stays in the width lane', () => {
  const run = widthEdit(table([HEADER]), 3, 1, 'wider ', 7);
  expectAccepted(run);
  // Each continuation opens below its page's repeated header, which has its own stamp.
  const repeats = rowsOf(run.cold).filter((row) => row.isHeaderRepeat);
  expect(repeats.length).toBeGreaterThanOrEqual(2);
  const stamps = repeats.map((row) => lineIds(row)[0]!.split(':occ:')[1]);
  expect(new Set(stamps).size).toBe(repeats.length);
});

test('a width edit inside the split row itself stays in the width lane', () => {
  expectAccepted(widthEdit(table([HEADER]), 7, 2, 'wider ', 7));
});

test('a split row below repeated merged headers stays in the width lane', () => {
  expectAccepted(widthEdit(table(MERGED_HEADERS), 4, 1, 'wider ', 8));
});

test('a split row in a table without header rows stays in the width lane', () => {
  expectAccepted(widthEdit(table([]), 2, 1, 'wider ', 6));
});

test('a width change that rewraps the split row falls back to full pagination', () => {
  const run = widthEdit(
    table(
      [HEADER],
      tall(() => 'aaaa bbbb cccc')
    ),
    3,
    1,
    // Wider than the columns can share: the split row's first column narrows and wraps.
    `${'W'.repeat(40)} `,
    7
  );
  expectSplitWidthChange(run);
  expect(lineCount(occurrences(run.cold, run.splitId))).not.toBe(
    lineCount(occurrences(run.previous, run.splitId))
  );
  expect(run.direct).toBeNull();
});

test('split rows whose page decisions read the unsplit row are refused', () => {
  for (const split of [tall(undefined, '', '<w:cantSplit/>'), tall(undefined, '<w:keepNext/>')]) {
    const run = widthEdit(table([HEADER], split), 3, 1, 'wider ', 7);
    expect(occurrences(run.previous, run.splitId).length).toBeGreaterThanOrEqual(2);
    expect(run.direct).toBeNull();
    expect([run.placed, run.refused]).toEqual([0, 1]);
  }
});
