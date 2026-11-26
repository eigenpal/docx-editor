// The cell properties of a table style that move content: `w:tcMar` (CT_TcMar, 17.4.68) and
// `w:vAlign` (CT_VerticalJc, 17.4.83) in the whole-table `w:tcPr` (17.7.6.9) and in the
// `w:tcPr` of a conditional format (17.7.6.8).
//
// Each table is 3 columns of 100pt at the page origin, with no borders. The fixed measurer
// gives 12pt lines, so a row without margins is 12pt high. A margin of 200 twips is 10pt.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { TreeDocOp } from '../../store/store/tree-op-types.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import { linesOf, type SemanticLayout } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 12);

function read(name: string, xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

type Sides = Partial<Record<'top' | 'left' | 'start' | 'bottom' | 'right' | 'end', number>>;
const margins = (tag: 'tcMar' | 'tblCellMar', sides: Sides, type = 'dxa') =>
  `<w:${tag}>${Object.entries(sides)
    .map(([side, width]) => `<w:${side} w:w="${width}" w:type="${type}"/>`)
    .join('')}</w:${tag}>`;
const tcMar = (sides: Sides, type?: string) => margins('tcMar', sides, type);
const tcPr = (inner: string) => `<w:tcPr>${inner}</w:tcPr>`;
const vAlign = (value: string) => `<w:vAlign w:val="${value}"/>`;
const condition = (type: string, inner: string) =>
  `<w:tblStylePr w:type="${type}">${tcPr(inner)}</w:tblStylePr>`;
const style = (id: string, body: string, basedOn = '') =>
  `<w:style w:type="table" w:styleId="${id}"><w:name w:val="${id}"/>` +
  `${basedOn ? `<w:basedOn w:val="${basedOn}"/>` : ''}${body}</w:style>`;
const look = (flags: Partial<Record<string, 0 | 1>> = {}) => {
  const all = {
    firstRow: 1,
    lastRow: 0,
    firstColumn: 1,
    lastColumn: 0,
    noHBand: 0,
    noVBand: 1,
    ...flags,
  };
  return `<w:tblLook ${Object.entries(all)
    .map(([name, value]) => `w:${name}="${value}"`)
    .join(' ')}/>`;
};

interface TableOptions {
  readonly styleId?: string;
  readonly columns?: number;
  /** Table properties after `w:tblW`, in schema order. */
  readonly tblPr?: string;
  readonly look?: string;
  /** Each cell's own properties, by `row,column`. */
  readonly cells?: Readonly<Record<string, string>>;
  /** The `w:tblPrEx` content of a row, by row index. */
  readonly exceptions?: Readonly<Record<number, string>>;
  /** Row heights of 50pt, so vertical alignment shows. */
  readonly tall?: boolean;
}

function documentPart(options: TableOptions = {}): OoxmlPart {
  const { styleId = 'T', columns = 3, tblPr = '', cells = {}, tall = false } = options;
  const exceptions = options.exceptions ?? {};
  const cell = (key: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${cells[key] ?? ''}</w:tcPr>` +
    `<w:p><w:r><w:t>${key}</w:t></w:r></w:p></w:tc>`;
  const rows = [0, 1, 2]
    .map(
      (row) =>
        `<w:tr>${exceptions[row] ? `<w:tblPrEx>${exceptions[row]}</w:tblPrEx>` : ''}` +
        `${tall ? '<w:trPr><w:trHeight w:val="1000"/></w:trPr>' : ''}` +
        `${Array.from({ length: columns }, (_, column) => cell(`${row},${column}`)).join('')}</w:tr>`
    )
    .join('');
  return read(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblStyle w:val="${styleId}"/>` +
      `<w:tblW w:w="${columns * 2000}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${tblPr}` +
      `${options.look ?? look()}</w:tblPr>` +
      `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(columns)}</w:tblGrid>${rows}</w:tbl>` +
      '<w:p/></w:body></w:document>'
  );
}

const cascadeOf = (styles: string) =>
  buildStyleCascadeTable(
    read(
      '/word/styles.xml',
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr>` +
        `</w:rPrDefault><w:pPrDefault/></w:docDefaults>${styles}</w:styles>`
    ).root
  );
const geometry = { width: 600, height: 600, margin: { top: 0, right: 0, bottom: 0, left: 0 } };

/** The x and y of each cell's line, row by row, relative to the cell's column and the table top. */
function cellOrigins(layout: SemanticLayout, columns = 3) {
  const lines = linesOf(layout).slice(0, 3 * columns);
  const at = (pick: (line: (typeof lines)[number], column: number) => number) =>
    [0, 1, 2].map((row) =>
      lines
        .slice(row * columns, (row + 1) * columns)
        .map((line, column) => Math.round(pick(line, column) * 100) / 100)
    );
  return { x: at((line, column) => line.box.x - column * 100), y: at((line) => line.box.y) };
}

function origins(styles: string, options: TableOptions = {}) {
  const layout = layoutSemanticDocument(documentPart(options), 0, {
    measurer,
    geometry,
    styleCascade: cascadeOf(styles),
    compatibilityMode: 15,
  });
  return cellOrigins(layout, options.columns);
}

const row = (value: number) => [value, value, value];

test('a table style without cell properties leaves the table-level margins (control)', () => {
  const plain = origins(
    style('T', `<w:tblPr>${margins('tblCellMar', { left: 400, top: 200 })}</w:tblPr>`)
  );
  expect(plain.x).toEqual([row(20), row(20), row(20)]);
  expect(plain.y).toEqual([row(10), row(32), row(54)]);
  // A conditional format the look turns off states nothing.
  const off = origins(
    style(
      'T',
      condition('firstRow', tcMar({ left: 400, top: 200 })) +
        condition('firstCol', tcMar({ left: 300 }))
    ),
    { look: look({ firstRow: 0, firstColumn: 0 }) }
  );
  expect(off.x).toEqual([row(0.5), row(0.5), row(0.5)]);
  expect(off.y).toEqual([row(0), row(12), row(24)]);
});

test('whole-table style cell margins inset every cell, under a cell margin of its own', () => {
  // The style's `w:tcMar` wins over the table's own `w:tblCellMar` and a row's `w:tblPrEx`
  // exception (17.4.41, 17.4.42); a side it omits takes the table-level margin.
  const { x, y } = origins(
    style(
      'T',
      `<w:tblPr>${margins('tblCellMar', { left: 600, bottom: 100 })}</w:tblPr>${tcPr(tcMar({ left: 400, top: 200 }))}`
    ),
    {
      tblPr: margins('tblCellMar', { left: 100, top: 60 }),
      cells: { '1,0': tcMar({ left: 800 }), '1,2': tcMar({ top: 500 }) },
      exceptions: { 2: margins('tblCellMar', { left: 240, top: 300 }) },
    }
  );
  expect(x).toEqual([row(20), [40, 20, 20], row(20)]);
  // Rows: 10pt top + 12pt line + 5pt bottom from the style's table-level margin; the second
  // row takes the 25pt top margin of its last cell.
  expect(y).toEqual([row(10), row(52), row(79)]);
});

test('a derived style replaces a margin side and inherits the others', () => {
  const styles =
    style('Base', tcPr(tcMar({ left: 400, top: 200 }))) +
    style('T', tcPr(tcMar({ left: 200 })), 'Base');
  const { x, y } = origins(styles);
  expect(x).toEqual([row(10), row(10), row(10)]);
  expect(y).toEqual([row(10), row(32), row(54)]);
});

test('a conditional cell margin holds for the whole row of a cell it covers', () => {
  // First-column and corner formats inset every cell of the row.
  expect(origins(style('T', condition('firstCol', tcMar({ left: 400 })))).x).toEqual([
    row(20),
    row(20),
    row(20),
  ]);
  expect(origins(style('T', condition('nwCell', tcMar({ left: 400 })))).x).toEqual([
    row(20),
    row(0.5),
    row(0.5),
  ]);
  // A row format covers its own row only, and its `w:tblStylePr` replaces the base style's.
  const derived =
    style('Base', condition('firstRow', tcMar({ left: 400, top: 200 }))) +
    style('T', condition('firstRow', tcMar({ left: 200 })), 'Base');
  expect(origins(derived)).toEqual({
    x: [row(10), row(0.5), row(0.5)],
    y: [row(0), row(12), row(24)],
  });
});

test('the cells of a row write their conditional margins in order', () => {
  const left = (width: number) => tcMar({ left: width });
  const lastColumn = look({ firstRow: 0, lastColumn: 1 });
  // The last cell's format replaces the first cell's.
  expect(
    origins(style('T', condition('firstCol', left(100)) + condition('lastCol', left(300))), {
      look: lastColumn,
    }).x
  ).toEqual([row(15), row(15), row(15)]);
  // Bands alternate by cell: the band of the last cell decides, in 3 columns and in 4.
  const bands = style('T', condition('band1Vert', left(100)) + condition('band2Vert', left(300)));
  const banded = look({ firstRow: 0, firstColumn: 0, noVBand: 0 });
  expect(origins(bands, { look: banded }).x).toEqual([row(5), row(5), row(5)]);
  expect(origins(bands, { look: banded, columns: 4 }).x[0]).toEqual([15, 15, 15, 15]);
  // Inside one cell the stronger format wins (17.7.6): the corner over the first row. The
  // later cells then write the first row's margin again.
  expect(
    origins(style('T', condition('nwCell', left(100)) + condition('firstRow', left(300)))).x
  ).toEqual([row(15), row(0.5), row(0.5)]);
  // A cell without a format for the side leaves what an earlier cell wrote.
  expect(origins(style('T', tcPr(left(400)) + condition('firstCol', left(100)))).x).toEqual([
    row(5),
    row(5),
    row(5),
  ]);
});

test('a margin side without a width clears the weaker sources of its own level', () => {
  const all = (width: number) => ({ top: width, left: width, bottom: width, right: width });
  const styled = style('T', tcPr(tcMar(all(300))));
  for (const type of ['nil', 'auto', 'pct']) {
    // Cell level: the cell falls to the table-level margin, here the table's own 200 twips.
    const cells = {
      '0,0': tcMar(all(100), type),
      '0,1': tcMar(all(100), type),
      '0,2': tcMar(all(100), type),
    };
    const own = origins(styled, { tblPr: margins('tblCellMar', all(200)), cells });
    expect([type, own.x, own.y]).toEqual([
      type,
      [row(10), row(15), row(15)],
      [row(10), row(47), row(89)],
    ]);
    // Table level: the side takes the omitted-margin default, not the style's width.
    const table = origins(style('T', `<w:tblPr>${margins('tblCellMar', all(300))}</w:tblPr>`), {
      tblPr: margins('tblCellMar', all(100), type),
    });
    expect([type, table.x, table.y]).toEqual([
      type,
      [row(0.5), row(0.5), row(0.5)],
      [row(0), row(12), row(24)],
    ]);
  }
  // A style's own widthless side does the same over its base style.
  const derived =
    style('Base', tcPr(tcMar(all(300)))) + style('T', tcPr(tcMar(all(100), 'nil')), 'Base');
  expect(origins(derived, { tblPr: margins('tblCellMar', all(200)) }).x).toEqual([
    row(10),
    row(10),
    row(10),
  ]);
  // A `dxa` side still reads its width (control).
  expect(origins(style('T', ''), { tblPr: margins('tblCellMar', all(100), 'dxa') }).x[0]).toEqual(
    row(5)
  );
});

test('a table style aligns cell content vertically, under an alignment of the cell', () => {
  // 50pt rows and 12pt lines: top 0, center 19, bottom 38 inside each row.
  const { y } = origins(style('T', tcPr(vAlign('center'))), {
    tall: true,
    cells: { '1,0': vAlign('top'), '1,1': vAlign('bottom') },
  });
  expect(y).toEqual([row(19), [50, 88, 69], row(119)]);
  // A derived style's alignment replaces its base's.
  const derived =
    style('Base', tcPr(vAlign('bottom'))) + style('T', tcPr(vAlign('center')), 'Base');
  expect(origins(derived, { tall: true }).y).toEqual([row(19), row(69), row(119)]);
});

test('conditional vertical alignment applies cell by cell, under a whole-table center or bottom', () => {
  const formats = condition('firstRow', vAlign('bottom')) + condition('firstCol', vAlign('center'));
  // The first row wins over the first column in the corner cell (`conditionalTypesFor`).
  expect(origins(style('T', formats), { tall: true }).y).toEqual([
    row(38),
    [69, 50, 50],
    [119, 100, 100],
  ]);
  // A whole-table `center` or `bottom` holds against every conditional format.
  expect(origins(style('T', tcPr(vAlign('center')) + formats), { tall: true }).y).toEqual([
    row(19),
    row(69),
    row(119),
  ]);
  expect(
    origins(style('T', tcPr(vAlign('bottom')) + condition('firstRow', vAlign('top'))), {
      tall: true,
    }).y
  ).toEqual([row(38), row(88), row(138)]);
  // A whole-table `top` does not: the conditional format decides.
  expect(
    origins(style('T', tcPr(vAlign('top')) + condition('firstRow', vAlign('bottom'))), {
      tall: true,
    }).y
  ).toEqual([row(38), row(50), row(100)]);
  // A conditional `top` replaces a weaker conditional format.
  expect(
    origins(
      style('T', condition('firstRow', vAlign('top')) + condition('firstCol', vAlign('center'))),
      {
        tall: true,
      }
    ).y
  ).toEqual([row(0), [69, 50, 50], [119, 100, 100]]);
});

test('edits under style cell properties lay out like a fresh layout, and the caret follows', () => {
  const styleCascade = cascadeOf(
    style(
      'T',
      tcPr(tcMar({ left: 400, top: 200 }) + vAlign('center')) +
        condition('firstCol', tcMar({ left: 300 }))
    )
  );
  let part = documentPart({ tall: true });
  const options = { measurer, geometry, styleCascade, compatibilityMode: 15 };
  const retained = { session: createLayoutSession(), cache: createParagraphLayoutCache() };
  let layout = layoutSemanticDocument(part, 0, { ...options, ...retained });
  const table = part.root.children
    .flatMap((node) => (node.kind === 'textValue' ? [] : (node as OoxmlElement).children))
    .find((node) => node.kind === 'table') as OoxmlElement;
  const cellAt = (rowIndex: number, column: number) =>
    (
      table.children.filter((node) => node.kind === 'tableRow')[rowIndex] as OoxmlElement
    ).children.filter((node) => node.kind === 'tableCell')[column] as OoxmlElement;
  const paragraphOf = (cell: OoxmlElement) =>
    cell.children.find((node) => node.kind === 'paragraph')!;
  const apply = (op: TreeDocOp) => {
    const edit = applyTreeOp(part, op);
    if (!edit.ok) throw new Error(JSON.stringify(edit));
    part = edit.part;
    layout = layoutSemanticDocument(part, 0, { ...options, ...retained });
    expect(JSON.stringify(layout.pages)).toBe(
      JSON.stringify(layoutSemanticDocument(part, 0, options).pages)
    );
  };
  const target = paragraphOf(cellAt(1, 1));
  // A row is its 50pt minimum plus the 10pt top margin. The caret sits at the style's 15pt
  // row-wide left margin, centered under the top margin.
  const before = caretAt(layout, { paragraphId: target.id, offset: 0 }, measurer)!;
  expect([before.x, before.y]).toEqual([115, 89]);
  apply({ op: 'insertText', paragraphId: target.id, offset: 0, text: 'ab' });
  const after = caretAt(layout, { paragraphId: target.id, offset: 2 }, measurer)!;
  expect([after.x, after.y]).toEqual([127, 89]);
  // The cell's own alignment wins over the style's, also a stated `top`.
  apply({
    op: 'setTableCellVerticalAlignment',
    tableId: table.id,
    cellIds: [cellAt(1, 1).id],
    alignment: 'top',
  });
  expect(cellOrigins(layout).y).toEqual([row(29), [89, 70, 89], row(149)]);
});
