import { afterEach, expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { wmlChildNamed } from '../../store/store/tree-op-table-shared.ts';
import type { TreeDocOp } from '../../store/store/tree-op-types.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type { SemanticLayout } from '../semantic-records.ts';
import { movedRowsTestRecorder, shiftedRowsTestRecorder } from '../table-row-geometry-reuse.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
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
const HEADER = tr(tc(p('Head A')) + tc(p('Head B')) + tc(p('Head C')), '<w:tblHeader/>');
const plainRow = (r: number) => tr(tc(p(`R${r}a`)) + tc(p(`R${r}b`)) + tc(p(`R${r}c`)));

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

const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const container of mounted.splice(0)) container.remove();
});

/** An editing session whose every pass is checked against a fresh layout and a cold paint. */
function session(shape: string) {
  let part = load(p('Preamble') + SHAPES[shape]!);
  const retained = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let layout = lay(part, { session: retained, cache });
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
    /** Apply `op`; false when the store refuses it, which leaves everything as it was. */
    apply(op: TreeDocOp, label: string): boolean {
      const edit = applyTreeOp(part, op);
      if (!edit.ok) return false;
      part = edit.part;
      layout = lay(part, { session: retained, cache });
      expect([label, JSON.stringify(layout.pages)]).toEqual([
        label,
        JSON.stringify(lay(part).pages),
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
    const pick = random(0x1797 + shape.length * 977);
    const names = Object.keys(EDITS);
    let applied = 0;
    for (let step = 0; step < 36; step += 1) {
      const name = names[pick(names.length)]!;
      const op = EDITS[name]!(run.part, pick);
      if (op && run.apply(op, `${shape} step ${step}: ${name}`)) applied += 1;
    }
    expect(applied).toBeGreaterThan(24);
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

test('targeted row edits at the start, middle, end and page breaks stay exact', () => {
  for (const shape of ['plain', 'merged', 'split', 'banded']) {
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
  }
}, 60_000);

test('a row insert above page breaks moves the rows below without placing them again', () => {
  const run = session('plain');
  const middle = rowsOf(run.part)[10]!.id;
  const shifted = shiftedRowsTestRecorder();
  const inPlace = movedRowsTestRecorder();
  expect(
    run.apply(
      { op: 'insertTableRow', tableId: tableOf(run.part).id, rowId: middle, where: 'below' },
      'insert'
    )
  ).toBe(true);
  shifted.dispose();
  inPlace.dispose();
  // Rows above the insert stay in place and rows below it move; both reuse their placement.
  expect(inPlace.moved).toBeGreaterThan(5);
  expect(shifted.moved).toBeGreaterThan(20);
  expect(shifted.refused.fields).toBe(0);
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
