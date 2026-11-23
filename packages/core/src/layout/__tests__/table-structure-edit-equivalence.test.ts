import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { wmlChildNamed } from '../../store/store/tree-op-table-shared.ts';
import type { TreeDocOp } from '../../store/store/tree-op-types.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type { SemanticLayout } from '../semantic-records.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';
import { shiftedRowsTestRecorder } from '../table-row-geometry-reuse.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import { tablePageRestartTestRecorder } from '../table-page-restart.ts';
import { readTableStructure, readTableStructureFresh } from '../semantic-table.ts';
import { reuseTableRowsFromForTests, tableRowReuseTestRecorder } from '../table-structure-rows.ts';
import { tableTextUpdateTestRecorder } from '../table-text-session.ts';
import { load, read, W } from './table-row-keep-fixtures.ts';

// Structure edits (rows, columns, merges, cell properties, header rows, a break above the
// table) paginate a table again with the previous rows on offer. Every pass here must equal a
// fresh layout of the same tree, key order included, and the retained paint must equal a
// cold paint of that layout, so rows reused across pages are proven to paint the same.
//
// Pages are 350pt by 210pt with a 170pt body, so a 40-row table runs onto several pages and
// most edits move rows across page breaks.

const styleCascade = buildStyleCascadeTable(
  read(
    `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
      '<w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:style>' +
      '<w:style w:type="table" w:styleId="Banded"><w:name w:val="Banded"/>' +
      '<w:tblPr><w:tblStyleRowBandSize w:val="1"/></w:tblPr>' +
      '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr>' +
      '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="333333"/></w:tcPr></w:tblStylePr>' +
      '<w:tblStylePr w:type="band1Horz">' +
      '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="DDEEFF"/></w:tcPr></w:tblStylePr>' +
      '<w:tblStylePr w:type="lastRow"><w:tcPr><w:tcBorders>' +
      '<w:top w:val="double" w:sz="6" w:space="0" w:color="000000"/>' +
      '</w:tcBorders></w:tcPr></w:tblStylePr>' +
      '</w:style></w:styles>',
    '/word/styles.xml'
  ).root
);
const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, extra: object = {}): SemanticLayout =>
  layoutSemanticDocument(part, 1, { measurer, styleCascade, compatibilityMode: 15, ...extra });

const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
    .join('') +
  '</w:tblBorders>';
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const lines = (name: string, count: number) =>
  `<w:p><w:r>${Array.from({ length: count }, (_, i) => `<w:t>${name}-${i}</w:t>`).join('<w:br/>')}</w:r></w:p>`;
const tc = (content: string, tcPr = '', width = 2000) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;
const tr = (cells: string, trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells}</w:tr>`;
const table = (rows: readonly string[], tblPr = BORDERS) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>${tblPr}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>${rows.join('')}</w:tbl>`;
const rule = (edge: string, style = 'single', size = 4) =>
  `<w:${edge} w:val="${style}" w:sz="${size}" w:space="0" w:color="000000"/>`;
// A thick compound bottom rule: a row that ends a page fits only when the next row follows it.
const compoundBorders = (insideH: string) =>
  `<w:tblBorders>${['top', 'left', 'right', 'insideV'].map((edge) => rule(edge)).join('')}` +
  `${rule('bottom', 'thickThinLargeGap', 96)}${insideH}</w:tblBorders>`;
const tracked = (kind: 'ins' | 'del', id: number) =>
  `<w:${kind} w:id="${id}" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"/>`;
const HEADER = tr(tc(p('Head A')) + tc(p('Head B')) + tc(p('Head C')), '<w:tblHeader/>');
const plainRow = (r: number) => tr(tc(p(`R${r}a`)) + tc(p(`R${r}b`)) + tc(p(`R${r}c`)));
/** Exact-height, `w:cantSplit`, and plain rows under a compound bottom rule. */
const compoundTable = (insideH: string) =>
  table(
    [
      HEADER,
      ...Array.from({ length: 40 }, (_, r) =>
        r % 5 === 0
          ? tr(
              tc(p(`E${r}a`)) + tc(p(`E${r}b`)) + tc(p(`E${r}c`)),
              `<w:trHeight w:val="${600 + 200 * (r % 4)}" w:hRule="exact"/>`
            )
          : r % 5 === 2
            ? tr(tc(lines(`K${r}`, 3)) + tc(p(`K${r}b`)) + tc(p(`K${r}c`)), '<w:cantSplit/>')
            : plainRow(r)
      ),
    ],
    compoundBorders(insideH)
  );

/** The document shapes: each opens with a preamble paragraph a break can be typed into. */
const SHAPES: Record<string, string> = {
  plain: table([HEADER, ...Array.from({ length: 40 }, (_, r) => plainRow(r))]),
  merged: table([
    HEADER,
    ...Array.from({ length: 40 }, (_, r) => {
      const vMerge = r % 5 === 1 ? '<w:vMerge w:val="restart"/>' : r % 5 > 1 ? '<w:vMerge/>' : '';
      const first = tc(p(`R${r}a`), vMerge);
      return r % 3 === 2
        ? tr(first + tc(p(`R${r}bc`), '<w:gridSpan w:val="2"/>', 4000))
        : tr(first + tc(p(`R${r}b`)) + tc(p(`R${r}c`)));
    }),
  ]),
  split: table([
    HEADER,
    ...Array.from({ length: 30 }, (_, r) =>
      r % 4 === 1
        ? tr(tc(lines(`R${r}`, 3 + (r % 5))) + tc(p(`R${r}b`)) + tc(p(`R${r}c`)))
        : r % 7 === 3
          ? tr(tc(lines(`K${r}`, 4)) + tc(p(`K${r}b`)) + tc(p(`K${r}c`)), '<w:cantSplit/>')
          : r % 9 === 5
            ? tr(
                tc(p(`E${r}a`)) + tc(p(`E${r}b`)) + tc(p(`E${r}c`)),
                '<w:trHeight w:val="500" w:hRule="exact"/>'
              )
            : plainRow(r)
    ),
  ]),
  banded: table(
    [HEADER, ...Array.from({ length: 40 }, (_, r) => plainRow(r))],
    '<w:tblStyle w:val="Banded"/><w:tblLook w:val="0060" w:firstRow="1" w:lastRow="1" ' +
      'w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>' +
      BORDERS
  ),
  kept: table([
    HEADER,
    ...Array.from({ length: 40 }, (_, r) =>
      r % 6 === 1 || r % 6 === 2
        ? tr(
            tc(`<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>K${r}a</w:t></w:r></w:p>`) +
              tc(`<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>K${r}b</w:t></w:r></w:p>`) +
              tc(`<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>K${r}c</w:t></w:r></w:p>`)
          )
        : plainRow(r)
    ),
  ]),
  compound: compoundTable(rule('insideH')),
  compoundInside: compoundTable(rule('insideH', 'thinThickSmallGap', 48)),
  tracked: table([
    HEADER,
    ...Array.from({ length: 40 }, (_, r) =>
      r % 7 === 3
        ? tr(tc(p(`I${r}a`)) + tc(p(`I${r}b`)) + tc(p(`I${r}c`)), tracked('ins', 100 + r))
        : r % 7 === 5
          ? tr(tc(lines(`D${r}`, 2)) + tc(p(`D${r}b`)) + tc(p(`D${r}c`)), tracked('del', 100 + r))
          : plainRow(r)
    ),
  ]),
  mixed: table([
    HEADER,
    ...Array.from({ length: 36 }, (_, r) =>
      r % 6 === 2
        ? tr(
            tc(table([plainRow(100 + r), plainRow(200 + r)]).replace('w:w="6000"', 'w:w="1800"')) +
              tc(p(`N${r}b`)) +
              tc(p(`N${r}c`))
          )
        : r % 5 === 4
          ? tr(
              tc(p(`F${r}a`), '<w:shd w:val="clear" w:color="auto" w:fill="FFEE00"/>') +
                tc(p(`F${r}b`), '<w:vAlign w:val="center"/>') +
                tc(p(`F${r}c`)),
              '<w:trHeight w:val="600" w:hRule="atLeast"/>'
            )
          : plainRow(r)
    ),
  ]),
};

const kids = (node: OoxmlNode | undefined, kind: string): OoxmlElement[] =>
  node && 'children' in node
    ? (node.children as OoxmlNode[]).filter((child): child is OoxmlElement => child.kind === kind)
    : [];
const body = (part: OoxmlPart) => kids(part.root, 'body')[0]!;
const tableOf = (part: OoxmlPart) => kids(body(part), 'table')[0]!;
const rowsOf = (part: OoxmlPart) => kids(tableOf(part), 'tableRow');
const cellsOf = (row: OoxmlElement) => kids(row, 'tableCell');
const gridColumns = (part: OoxmlPart) =>
  (wmlChildNamed(tableOf(part), 'tblGrid')?.children ?? []).filter(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'gridCol'
  );

/** A seeded generator, so a failure names a reproducible step. */
function random(seed: number) {
  let state = seed >>> 0;
  return (bound: number): number => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    state = (state ^ (state >>> 13)) >>> 0;
    return state % bound;
  };
}

type Pick = (bound: number) => number;
type Edit = (part: OoxmlPart, pick: Pick) => TreeDocOp | null;

const anyRow = (part: OoxmlPart, pick: Pick) => {
  const rows = rowsOf(part);
  return rows[pick(rows.length)]!;
};
const anyCell = (part: OoxmlPart, pick: Pick) => {
  const cells = cellsOf(anyRow(part, pick));
  return cells[pick(cells.length)]!;
};
const firstParagraph = (cell: OoxmlElement) => kids(cell, 'paragraph')[0];

const EDITS: Record<string, Edit> = {
  insertRow: (part, pick) => ({
    op: 'insertTableRow',
    tableId: tableOf(part).id,
    rowId: anyRow(part, pick).id,
    where: pick(2) ? 'above' : 'below',
  }),
  deleteRow: (part, pick) =>
    rowsOf(part).length > 3
      ? { op: 'deleteTableRow', tableId: tableOf(part).id, rowId: anyRow(part, pick).id }
      : null,
  enter: (part, pick) => {
    const paragraph = firstParagraph(anyCell(part, pick));
    return paragraph ? { op: 'splitParagraph', paragraphId: paragraph.id, offset: 1 } : null;
  },
  join: (part, pick) => {
    const paragraphs = kids(anyCell(part, pick), 'paragraph');
    return paragraphs.length > 1
      ? { op: 'joinParagraphs', firstId: paragraphs[0]!.id, secondId: paragraphs[1]!.id }
      : null;
  },
  grow: (part, pick) => {
    const paragraph = firstParagraph(anyCell(part, pick));
    return paragraph
      ? { op: 'insertText', paragraphId: paragraph.id, offset: 0, text: 'grows onto more lines ' }
      : null;
  },
  fill: (part, pick) => ({
    op: 'setTableCellFill',
    tableId: tableOf(part).id,
    cellIds: [anyCell(part, pick).id],
    color: pick(3) ? { kind: 'hex', value: ['FF0000', '00AA00', '0000FF'][pick(3)]! } : null,
  }),
  align: (part, pick) => ({
    op: 'setTableCellVerticalAlignment',
    tableId: tableOf(part).id,
    cellIds: [anyCell(part, pick).id],
    alignment: (['top', 'center', 'bottom'] as const)[pick(3)]!,
  }),
  height: (part, pick) => ({
    op: 'setTableRowHeight',
    tableId: tableOf(part).id,
    rowId: anyRow(part, pick).id,
    heightTwips: [300, 700, 1500][pick(3)]!,
  }),
  borders: (part, pick) => ({
    op: 'setTableCellBorders',
    tableId: tableOf(part).id,
    cellIds: [anyCell(part, pick).id],
    scope: (['top', 'bottom', 'all'] as const)[pick(3)]!,
    spec: { style: 'double', size: 12, color: { kind: 'hex', value: '000000' } },
  }),
  mergeDown: (part, pick) => {
    const rows = rowsOf(part);
    const at = pick(rows.length - 1);
    const column = pick(3);
    const top = cellsOf(rows[at]!)[column];
    const below = cellsOf(rows[at + 1]!)[column];
    return top && below
      ? { op: 'mergeTableCells', tableId: tableOf(part).id, cellIds: [top.id, below.id] }
      : null;
  },
  split: (part, pick) => ({
    op: 'splitTableCell',
    tableId: tableOf(part).id,
    cellId: anyCell(part, pick).id,
    rows: 2,
    columns: 1,
  }),
  insertColumn: (part, pick) => {
    const columns = gridColumns(part);
    return columns.length < 5
      ? {
          op: 'insertTableColumn',
          tableId: tableOf(part).id,
          where: pick(2) ? 'left' : 'right',
          gridColumnId: columns[pick(columns.length)]!.id,
        }
      : null;
  },
  deleteColumn: (part, pick) => {
    const columns = gridColumns(part);
    return columns.length > 2
      ? {
          op: 'deleteTableColumn',
          tableId: tableOf(part).id,
          gridColumnId: columns[pick(columns.length)]!.id,
        }
      : null;
  },
  columnWidths: (part, pick) => {
    const columns = gridColumns(part);
    const at = pick(columns.length - 1);
    const left = [1200, 2400, 2800][pick(3)]!;
    return {
      op: 'setTableColumnWidths',
      tableId: tableOf(part).id,
      leftGridColumnId: columns[at]!.id,
      rightGridColumnId: columns[at + 1]!.id,
      leftWidthTwips: left,
      rightWidthTwips: 4000 - left,
    };
  },
  headerRows: (part, pick) => ({
    op: 'setTableProperties',
    tableId: tableOf(part).id,
    headerRowCount: pick(3),
  }),
  breakAbove: (part, pick) => {
    const preamble = kids(body(part), 'paragraph')[0]!;
    return pick(2)
      ? { op: 'insertHardBreak', paragraphId: preamble.id, offset: 0 }
      : { op: 'insertPageBreak', paragraphId: preamble.id, offset: 0 };
  },
};

// The shapes are short, so reuse their rows as a long table's are.
let restoreReuse: () => void = () => {};
beforeAll(() => {
  restoreReuse = reuseTableRowsFromForTests(1);
});
afterAll(() => restoreReuse());

const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const container of mounted.splice(0)) container.remove();
});

/** An editing session whose every pass is checked against a fresh layout and a cold paint. */
function session(shape: string, displayMode: RevisionDisplayMode = 'all-markup') {
  let part = load(p('Preamble') + SHAPES[shape]!);
  const retained = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const view = { displayMode };
  let layout = lay(part, { session: retained, cache, ...view });
  const container = document.createElement('div');
  document.body.append(container);
  mounted.push(container);
  paintSemanticLayout(container, layout, { scale: 1 });
  return {
    get part() {
      return part;
    },
    get layout() {
      return layout;
    },
    /** Apply `ops` in one pass; false when the store refuses one, which leaves everything as it was. */
    apply(ops: TreeDocOp | readonly TreeDocOp[], label: string): boolean {
      let next = part;
      for (const op of Array.isArray(ops) ? ops : [ops]) {
        const edit = applyTreeOp(next, op as TreeDocOp);
        if (!edit.ok) return false;
        next = edit.part;
      }
      part = next;
      layout = lay(part, { session: retained, cache, ...view });
      // A read that reuses the rows of earlier reads equals a read from nothing.
      for (const width of [300, 260])
        expect([
          label,
          width,
          readTableStructure(tableOf(part), width, 0, styleCascade, displayMode, undefined, 15),
        ]).toStrictEqual([
          label,
          width,
          readTableStructureFresh(tableOf(part), width, styleCascade, 15, displayMode),
        ]);
      expect([label, JSON.stringify(layout.pages)]).toEqual([
        label,
        JSON.stringify(lay(part, view).pages),
      ]);
      paintSemanticLayout(container, layout, { scale: 1 });
      const cold = document.createElement('div');
      paintSemanticLayout(cold, layout, { scale: 1 });
      expect([label, container.innerHTML]).toEqual([label, cold.innerHTML]);
      return true;
    },
  };
}

for (const shape of Object.keys(SHAPES)) {
  test(`random structure edits keep the ${shape} table equal to a fresh layout and paint`, () => {
    const run = session(shape);
    expect(run.layout.pages.length).toBeGreaterThan(2);
    const restarts = tablePageRestartTestRecorder();
    const reuse = tableRowReuseTestRecorder();
    const pick = random(0x1797 + shape.length * 977);
    const names = Object.keys(EDITS);
    let applied = 0;
    for (let step = 0; step < 36; step += 1) {
      const name = names[pick(names.length)]!;
      const op = EDITS[name]!(run.part, pick);
      if (op && run.apply(op, `${shape} step ${step}: ${name}`)) applied += 1;
    }
    restarts.dispose();
    reuse.dispose();
    expect(applied).toBeGreaterThan(24);
    // Reads reuse rows and run the border pass over a window, so the checks cover both.
    expect(reuse.reusedRows).toBeGreaterThan(0);
    expect(reuse.windows).toBeGreaterThan(0);
    // Some edits restart the pagination at a kept page, so the checks above cover restarts.
    expect(restarts.restarts).toBeGreaterThan(0);
  }, 60_000);
}

/** The row whose first fragment starts page `page` of the table, after its header repeat. */
function rowStartingPage(run: ReturnType<typeof session>, page: number): string {
  const tables = run.layout.pages.flatMap((entry) =>
    entry.fragments.filter((fragment) => fragment.kind === 'table')
  );
  const fragment = tables[page]!;
  if (fragment.kind !== 'table') throw Error('not a table');
  return fragment.rows.find((row) => !row.isHeaderRepeat)!.id;
}

// One test per shape: each edit lays the table out again and from nothing, and paints it twice.
for (const shape of ['plain', 'merged', 'split', 'banded', 'compound'])
  test(`targeted row edits at the start, middle, end and page breaks of the ${shape} table stay exact`, () => {
    const run = session(shape);
    const tableId = () => tableOf(run.part).id;
    const ids = () => rowsOf(run.part).map((row) => row.id);
    const targets = (): [string, string][] => [
      ['header', ids()[0]!],
      ['first body', ids()[1]!],
      ['middle', ids()[Math.floor(ids().length / 2)]!],
      ['last', ids().at(-1)!],
      ['opens page 2', rowStartingPage(run, 1)],
      ['opens page 3', rowStartingPage(run, 2)],
    ];
    for (const [where, rowId] of targets()) {
      const label = `${shape} ${where}`;
      for (const side of ['above', 'below'] as const)
        expect(
          run.apply({ op: 'insertTableRow', tableId: tableId(), rowId, where: side }, label)
        ).toBe(true);
    }
    for (const [where, rowId] of targets()) {
      expect(
        run.apply({ op: 'deleteTableRow', tableId: tableId(), rowId }, `${shape} delete ${where}`)
      ).toBe(true);
    }
  }, 60_000);

test('a row insert keeps the pages above it and moves the rows below without placing them again', () => {
  const run = session('plain');
  const before = run.layout.pages;
  const middle = rowsOf(run.part)[25]!.id;
  const shifted = shiftedRowsTestRecorder();
  const restarts = tablePageRestartTestRecorder();
  expect(
    run.apply(
      { op: 'insertTableRow', tableId: tableOf(run.part).id, rowId: middle, where: 'below' },
      'insert'
    )
  ).toBe(true);
  shifted.dispose();
  restarts.dispose();
  // The pagination restarts at a page above the insert, and the pages before it stay.
  expect(restarts.restarts).toBe(1);
  expect(restarts.keptPages).toBeGreaterThan(0);
  for (let page = 0; page < restarts.keptPages; page += 1)
    expect(run.layout.pages[page]).toBe(before[page]!);
  // Rows below the insert move and reuse their placement.
  expect(shifted.moved).toBeGreaterThan(5);
  expect(shifted.refused.fields).toBe(0);
});

test('typing keeps the restart, and undoing it in the pass of a row insert does not', () => {
  const run = session('plain');
  const typed = firstParagraph(cellsOf(rowsOf(run.part)[3]!)[0]!)!.id;
  const insertBelow = (at: number): TreeDocOp => ({
    op: 'insertTableRow',
    tableId: tableOf(run.part).id,
    rowId: rowsOf(run.part)[at]!.id,
    where: 'below',
  });
  const restartsOf = (ops: TreeDocOp | TreeDocOp[], label: string): number => {
    const restarts = tablePageRestartTestRecorder();
    expect(run.apply(ops, label)).toBe(true);
    restarts.dispose();
    return restarts.restarts;
  };
  // Typing updates its page in place and keeps the records of every page.
  const before = run.layout.pages;
  const typing: TreeDocOp = { op: 'insertText', paragraphId: typed, offset: 0, text: 'x' };
  expect(restartsOf(typing, 'type')).toBe(0);
  expect(run.layout.pages[0]).not.toBe(before[0]!);
  expect(run.layout.pages.slice(1).every((page, index) => page === before[index + 1])).toBe(true);
  expect(restartsOf(insertBelow(30), 'insert after typing')).toBe(1);
  // Undoing the typing in the pass of an insert leaves the typed page unlike the new rows.
  expect(
    restartsOf(
      [{ op: 'deleteText', paragraphId: typed, start: 0, end: 1 }, insertBelow(30)],
      'undo and insert'
    )
  ).toBe(0);
  expect(restartsOf(insertBelow(30), 'insert again')).toBe(1);
});

test('a page that opens a kept group paginates again when a row after the group changes', () => {
  const keptRow = (r: number) =>
    tr(
      ['a', 'b', 'c']
        .map((c) => tc(`<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>K${r}${c}</w:t></w:r></w:p>`))
        .join('')
    );
  SHAPES.keptLong = table([
    HEADER,
    ...Array.from({ length: 60 }, (_, r) =>
      r % 6 === 1 || r % 6 === 2 ? keptRow(r) : plainRow(r)
    ),
  ]);
  try {
    const run = session('keptLong');
    const table = (at: number) => `/word/document.xml#0.0.1${at < 0 ? '' : `.${at}`}`;
    // Found by random edits: after these, a page opens with a row that keeps with the next, and
    // deleting the row after its group lets the group move up onto the page above.
    const ops: TreeDocOp[] = [
      {
        op: 'setTableCellBorders',
        tableId: table(-1),
        cellIds: [`${table(40)}.2`],
        scope: 'all',
        spec: { style: 'double', size: 12, color: { kind: 'hex', value: '000000' } },
      },
      {
        op: 'setTableColumnWidths',
        tableId: table(-1),
        leftGridColumnId: `${table(1)}.1`,
        rightGridColumnId: `${table(1)}.2`,
        leftWidthTwips: 1200,
        rightWidthTwips: 2800,
      },
      { op: 'splitParagraph', paragraphId: `${table(56)}.2.1`, offset: 1 },
      { op: 'deleteTableRow', tableId: table(-1), rowId: table(17) },
    ];
    for (const [step, op] of ops.entries()) expect(run.apply(op, `kept group ${step}`)).toBe(true);
  } finally {
    delete SHAPES.keptLong;
  }
});

test('a banded style renumbered by a row insert places the restriped rows again', () => {
  const run = session('banded');
  const shifted = shiftedRowsTestRecorder();
  expect(
    run.apply(
      {
        op: 'insertTableRow',
        tableId: tableOf(run.part).id,
        rowId: rowsOf(run.part)[3]!.id,
        where: 'below',
      },
      'insert'
    )
  ).toBe(true);
  shifted.dispose();
  // Every row after the insert swapped band: its fill changed, so its old record is refused.
  expect(shifted.refused.fields).toBeGreaterThan(20);
});

test('a row that splits onto more pages as it grows stays exact, in layout and paint', () => {
  SHAPES.tall = table([
    HEADER,
    ...Array.from({ length: 4 }, (_, r) => plainRow(r)),
    tr(tc(lines('Tall', 10)) + tc(p('Tb')) + tc(p('Tc'))),
    ...Array.from({ length: 6 }, (_, r) => plainRow(10 + r)),
  ]);
  try {
    const run = session('tall');
    const tall = () => firstParagraph(cellsOf(rowsOf(run.part)[5]!)[0]!)!.id;
    const fragmentsOfTall = () =>
      run.layout.pages
        .flatMap((page) => page.fragments)
        .filter((fragment) => fragment.kind === 'table')
        .filter((fragment) =>
          fragment.rows.some((row) => row.id === rowsOf(run.part)[5]!.id && !row.isHeaderRepeat)
        ).length;
    const initial = fragmentsOfTall();
    expect(initial).toBeGreaterThan(1);
    for (let step = 0; step < 24; step += 1)
      expect(
        run.apply({ op: 'insertHardBreak', paragraphId: tall(), offset: 0 }, `grow ${step}`)
      ).toBe(true);
    expect(fragmentsOfTall()).toBeGreaterThan(initial + 1);
    for (let step = 0; step < 24; step += 1)
      expect(
        run.apply({ op: 'deleteText', paragraphId: tall(), start: 0, end: 1 }, `shrink ${step}`)
      ).toBe(true);
    expect(fragmentsOfTall()).toBe(initial);
  } finally {
    delete SHAPES.tall;
  }
}, 60_000);

test('rows added at the end keep one header repeat per page as new pages open', () => {
  SHAPES.short = table([HEADER, ...Array.from({ length: 6 }, (_, r) => plainRow(r))]);
  try {
    const run = session('short');
    const pages = run.layout.pages.length;
    // Only the last fragment changes, so its header repeat is the one old repeat on offer
    // while the new page wants one too.
    for (let step = 0; step < 30; step += 1)
      expect(
        run.apply(
          {
            op: 'insertTableRow',
            tableId: tableOf(run.part).id,
            rowId: rowsOf(run.part).at(-1)!.id,
            where: 'below',
          },
          `append ${step}`
        )
      ).toBe(true);
    expect(run.layout.pages.length).toBeGreaterThan(pages + 1);
  } finally {
    delete SHAPES.short;
  }
}, 60_000);

/** The rows next to the row that opens page `page` of the table: the one before and after. */
function rowsAroundPageStart(run: ReturnType<typeof session>, page: number): [string, string] {
  const ids = rowsOf(run.part).map((row) => row.id);
  const at = ids.indexOf(rowStartingPage(run, page));
  return [ids[at - 1]!, ids[at + 1]!];
}

test('edits beside a page-opening row of a compound-ruled table stay exact', () => {
  for (const shape of ['compound', 'compoundInside', 'split']) {
    const run = session(shape);
    const tableId = () => tableOf(run.part).id;
    const pages = () =>
      run.layout.pages.filter((page) => page.fragments.some((f) => f.kind === 'table')).length;
    let step = 0;
    for (let page = 1; page < Math.min(pages(), 5); page += 1)
      for (const side of [1, 0] as const) {
        const label = () => `${shape} page ${page} side ${side} step ${(step += 1)}`;
        const rowId = () => rowsAroundPageStart(run, page)[side];
        for (const heightTwips of [200, 1400])
          expect(
            run.apply(
              { op: 'setTableRowHeight', tableId: tableId(), rowId: rowId(), heightTwips },
              label()
            )
          ).toBe(true);
        expect(
          run.apply(
            { op: 'insertTableRow', tableId: tableId(), rowId: rowId(), where: 'below' },
            label()
          )
        ).toBe(true);
        expect(
          run.apply({ op: 'deleteTableRow', tableId: tableId(), rowId: rowId() }, label())
        ).toBe(true);
      }
  }
}, 60_000);

test('row edits between tracked row insertions and deletions stay exact in each view', () => {
  for (const mode of ['original', 'proposed', 'all-markup'] as const) {
    const run = session('tracked', mode);
    const restarts = tablePageRestartTestRecorder();
    const pick = random(0x1797 + mode.length);
    const names = ['insertRow', 'deleteRow', 'height', 'enter', 'grow', 'borders'];
    for (let step = 0; step < 24; step += 1) {
      const name = names[pick(names.length)]!;
      const op = EDITS[name]!(run.part, pick);
      if (op) run.apply(op, `${mode} step ${step}: ${name}`);
    }
    // Edits next to the rows each view drops or keeps.
    for (const at of [3, 5, 10, 12]) {
      const rowId = rowsOf(run.part)[at]!.id;
      const tableId = tableOf(run.part).id;
      expect(
        run.apply({ op: 'insertTableRow', tableId, rowId, where: 'above' }, `${mode} beside ${at}`)
      ).toBe(true);
    }
    restarts.dispose();
    expect(restarts.restarts).toBeGreaterThan(0);
  }
}, 60_000);

test('row edits in a table between sections of other page sizes stay exact', () => {
  const section = (width: number, height: number) =>
    `<w:p><w:pPr><w:sectPr><w:pgSz w:w="${width}" w:h="${height}"/><w:pgMar w:top="400" ` +
    `w:bottom="400" w:left="400" w:right="400" w:header="0" w:footer="0" w:gutter="0"/>` +
    `</w:sectPr></w:pPr></w:p>`;
  SHAPES.sections =
    p('Small page') + section(6000, 3600) + SHAPES.split! + section(8000, 5200) + p('Large page');
  try {
    const run = session('sections');
    const pick = random(0x1797);
    const names = ['insertRow', 'deleteRow', 'height', 'enter', 'grow', 'breakAbove'];
    let applied = 0;
    for (let step = 0; step < 24; step += 1) {
      const name = names[pick(names.length)]!;
      const op = EDITS[name]!(run.part, pick);
      if (op && run.apply(op, `sections step ${step}: ${name}`)) applied += 1;
    }
    expect(applied).toBeGreaterThan(16);
  } finally {
    delete SHAPES.sections;
  }
}, 60_000);

// Typing in a cell between row edits. A text edit that keeps its row's height updates the
// table's pages in place (`table-text-update.ts`); each such pass must equal a fresh layout too.

const typed = (part: OoxmlPart, pick: Pick) => {
  for (let tries = 0; tries < 8; tries += 1) {
    const paragraph = firstParagraph(anyCell(part, pick));
    if (paragraph) return paragraph.id;
  }
  return undefined;
};
const TEXT_EDITS: Record<string, Edit> = {
  type: (part, pick) => {
    const paragraphId = typed(part, pick);
    return paragraphId ? { op: 'insertText', paragraphId, offset: 0, text: 'x' } : null;
  },
  erase: (part, pick) => {
    const paragraphId = typed(part, pick);
    return paragraphId ? { op: 'deleteText', paragraphId, start: 0, end: 1 } : null;
  },
  typeWords: (part, pick) => {
    const paragraphId = typed(part, pick);
    return paragraphId
      ? { op: 'insertText', paragraphId, offset: 1, text: ' and some more words here' }
      : null;
  },
  shrink: (part, pick) => {
    const paragraphId = typed(part, pick);
    return paragraphId ? { op: 'deleteText', paragraphId, start: 0, end: 3 } : null;
  },
};
/** The same table with AutoFit widths, so typing can move its column edges. */
const autofit = (xml: string) =>
  xml.replaceAll(
    '<w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>',
    '<w:tblW w:w="0" w:type="auto"/>'
  );
const section = (type = '') =>
  `<w:p><w:pPr><w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}` +
  '<w:pgSz w:w="7000" w:h="4200"/><w:pgMar w:top="400" w:bottom="400" w:left="400" ' +
  'w:right="400" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:pPr></w:p>';
const TEXT_SHAPES: Record<string, string> = {
  ...SHAPES,
  autofitPlain: autofit(SHAPES.plain!),
  autofitMerged: autofit(SHAPES.merged!),
  autofitTracked: autofit(SHAPES.tracked!),
  sections: p('Small') + section() + SHAPES.split! + section('continuous') + p('Large'),
  autofitSections: autofit(p('Before') + section('continuous') + SHAPES.tracked!),
};

/** Run `body` with the text shapes on offer as session shapes. */
function withTextShapes(body: () => void) {
  const added = Object.keys(TEXT_SHAPES).filter((name) => !(name in SHAPES));
  for (const name of added) SHAPES[name] = TEXT_SHAPES[name]!;
  try {
    body();
  } finally {
    for (const name of added) delete SHAPES[name];
  }
}

for (const shape of Object.keys(TEXT_SHAPES)) {
  test(`random text and row edits keep the ${shape} table equal to a fresh layout`, () => {
    withTextShapes(() => {
      const run = session(shape);
      const updates = tableTextUpdateTestRecorder();
      const pick = random(0x2086 + shape.length * 131);
      const names = [...Object.keys(EDITS), ...Object.keys(TEXT_EDITS), ...Object.keys(TEXT_EDITS)];
      for (let step = 0; step < 32; step += 1) {
        const name = names[pick(names.length)]!;
        const op = (EDITS[name] ?? TEXT_EDITS[name])!(run.part, pick);
        if (op) run.apply(op, `${shape} step ${step}: ${name}`);
      }
      updates.dispose();
      // Typing took the in-place update, so the checks above cover it.
      expect(updates.updates).toBeGreaterThan(0);
    });
  }, 60_000);
}

/**
 * Apply `ops` to `shape`. The last one types where the in-place update cannot prove the result,
 * so it must refuse and let the pagination run.
 */
function typeAfter(shape: string, ops: readonly TreeDocOp[]) {
  withTextShapes(() => {
    const run = session(shape);
    const updates = tableTextUpdateTestRecorder();
    try {
      for (const [step, op] of ops.entries()) {
        const before = updates.updates;
        expect([step, run.apply(op, `${shape} step ${step}`)]).toEqual([step, true]);
        if (step === ops.length - 1) expect(updates.updates).toBe(before);
      }
    } finally {
      updates.dispose();
    }
  });
}

const at = (path: string) => `/word/document.xml#0.0.3${path}`;
const grows = (paragraphId: string): TreeDocOp => ({
  op: 'insertText',
  paragraphId,
  offset: 0,
  text: 'grows onto more lines ',
});

test('typing in the first row of a table below other content keeps the in-place update', () => {
  const run = session('plain');
  const typeIn = (rowId: string) => {
    const row = rowsOf(run.part).find((candidate) => candidate.id === rowId)!;
    const paragraphId = firstParagraph(cellsOf(row)[1]!)!.id;
    const updates = tableTextUpdateTestRecorder();
    expect(run.apply({ op: 'insertText', paragraphId, offset: 0, text: 'x' }, rowId)).toBe(true);
    updates.dispose();
    return updates.updates;
  };
  // The table starts below the preamble, so its first body row was placed whole there.
  expect(typeIn(rowsOf(run.part)[1]!.id)).toBe(1);
  // A row that opens a later page may have moved there, so the pagination places it again.
  expect(typeIn(rowStartingPage(run, 1))).toBe(0);
  expect(typeIn(rowStartingPage(run, 2))).toBe(0);
});

test('typing in the first rows of a table that opens the document keeps the in-place update', () => {
  // No page comes before the first page, so its rows cannot have moved there.
  let part = load(table(Array.from({ length: 4 }, (_, r) => plainRow(r))));
  const retained = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, { session: retained, cache });
  const updates = tableTextUpdateTestRecorder();
  for (const row of rowsOf(part).slice(0, 2)) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: firstParagraph(cellsOf(row)[1]!)!.id,
      offset: 0,
      text: 'x',
    });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    expect(JSON.stringify(lay(part, { session: retained, cache }).pages)).toBe(
      JSON.stringify(lay(part).pages)
    );
  }
  updates.dispose();
  expect(updates.updates).toBe(2);
});

test('typing in an exact row that ends a page keeps the edge the page gave it', () => {
  // Found by random edits. The exact row ends its page without the table's bottom edge. Its
  // old text fits under either edge, so only the new text, clipped by the row, tells them apart.
  typeAfter('sections', [
    grows(at('.10.0.1')),
    { op: 'deleteTableRow', tableId: at(''), rowId: at('.4') },
    { op: 'splitTableCell', tableId: at(''), cellId: at('.23.2'), rows: 2, columns: 1 },
    { op: 'deleteTableRow', tableId: at(''), rowId: at('.6') },
    grows(at('.17.2.1')),
  ]);
});

test('typing in a row split across pages lets the pagination choose where it breaks', () => {
  // Found by random edits. The row splits at a page bottom. Its new text gives a second line
  // to a cell that held one, and the row no longer starts on that page.
  typeAfter('sections', [
    { op: 'insertHardBreak', paragraphId: '/word/document.xml#0.0.0', offset: 0 },
    { op: 'deleteText', paragraphId: at('.8.2.1'), start: 0, end: 1 },
    { op: 'setTableProperties', tableId: at(''), headerRowCount: 1 },
    {
      op: 'setTableColumnWidths',
      tableId: at(''),
      leftGridColumnId: at('.1.0'),
      rightGridColumnId: at('.1.1'),
      leftWidthTwips: 2800,
      rightWidthTwips: 1200,
    },
    grows(at('.12.1.1')),
  ]);
});

test('typing in a merge head of an exact row lets the text run through its span', () => {
  // Found by random edits. The head spans the row below its exact row, and its new text
  // needs two lines: the exact row would clip them, while the span holds them.
  const ops: TreeDocOp[] = [
    {
      op: 'setTableCellFill',
      tableId: at(''),
      cellIds: [at('.40.2')],
      color: { kind: 'hex', value: 'FF0000' },
    },
    { op: 'splitParagraph', paragraphId: at('.3.1.1'), offset: 1 },
    { op: 'insertTableColumn', tableId: at(''), where: 'left', gridColumnId: at('.1.0') },
    { op: 'setTableRowHeight', tableId: at(''), rowId: at('.19'), heightTwips: 300 },
    {
      op: 'insertText',
      paragraphId: at('.23.1.1'),
      offset: 1,
      text: ' and some more words here',
    },
    { op: 'setTableProperties', tableId: at(''), headerRowCount: 2 },
    { op: 'insertPageBreak', paragraphId: '/word/document.xml#0.0.0', offset: 0 },
    grows(at('.19.1.1')),
    {
      op: 'setTableColumnWidths',
      tableId: at(''),
      leftGridColumnId: at('.1.0'),
      rightGridColumnId: at('.1.1'),
      leftWidthTwips: 1200,
      rightWidthTwips: 2800,
    },
    { op: 'deleteTableColumn', tableId: at(''), gridColumnId: at('.1.1') },
    {
      op: 'insertTableColumn',
      tableId: at(''),
      where: 'right',
      gridColumnId: '/word/document.xml#new:172',
    },
    { op: 'splitTableCell', tableId: at(''), cellId: at('.23.0'), rows: 2, columns: 1 },
    { op: 'setTableRowHeight', tableId: at(''), rowId: at('.23'), heightTwips: 700 },
    { op: 'deleteTableRow', tableId: at(''), rowId: at('.11') },
    grows('/word/document.xml#new:353'),
  ];
  typeAfter('autofitSections', ops);
});
