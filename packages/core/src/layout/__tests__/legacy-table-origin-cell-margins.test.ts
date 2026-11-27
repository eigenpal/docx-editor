// Where a leading-aligned table with an absolute width starts before compatibility mode 15,
// by the source of its left cell margin: `w:tblCellMar` (17.4.42), a cell's `w:tcMar`
// (17.4.68), and a table style's `w:tcPr/w:tcMar` (17.7.6.8, 17.7.6.9).
//
// A stated indent (`w:tblInd`, 17.4.50) puts the content edge of the first cell on the text
// edge. Without one, the outer edge stays on the text edge, and only a conditional left
// margin moves the grid out. Each table is 3 columns of 100pt without borders in a text
// column; positions below are relative to the text edge.

import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type TableFragmentRecord } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function read(name: string, xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const left = (tag: 'tcMar' | 'tblCellMar', twips: number) =>
  `<w:${tag}><w:left w:w="${twips}" w:type="dxa"/></w:${tag}>`;
const tcPr = (inner: string) => `<w:tcPr>${inner}</w:tcPr>`;
const condition = (type: string, inner: string) =>
  `<w:tblStylePr w:type="${type}">${tcPr(inner)}</w:tblStylePr>`;
const style = (id: string, body: string, attributes = '') =>
  `<w:style w:type="table" w:styleId="${id}"${attributes}><w:name w:val="${id}"/>${body}</w:style>`;
/** A default table style that states a zero indent, as authored documents carry. */
const WITH_INDENT = style(
  'Base',
  `<w:tblPr><w:tblInd w:w="0" w:type="dxa"/>${left('tblCellMar', 108)}</w:tblPr>`,
  ' w:default="1"'
);
const LOOK =
  '<w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>';

interface Options {
  readonly mode?: number;
  /** Table properties after `w:tblW`, in schema order. */
  readonly tblPr?: string;
  /** Table properties before `w:tblW`, in schema order. */
  readonly lead?: string;
  /** The text of the first cell; the other cells hold their `row,column`. */
  readonly text?: string;
  /** Each cell's own properties, by `row,column`. */
  readonly cells?: Readonly<Record<string, string>>;
}

/** The grid's left edge, and the text x of each cell of the first two rows. */
function placement(styles: string, options: Options = {}) {
  const { mode = 14, tblPr = '', cells = {}, lead = '' } = options;
  const cell = (key: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${cells[key] ?? ''}</w:tcPr>` +
    `<w:p><w:r><w:t>${key === '0,0' ? (options.text ?? key) : key}</w:t></w:r></w:p></w:tc>`;
  const rows = [0, 1]
    .map((row) => `<w:tr>${[0, 1, 2].map((column) => cell(`${row},${column}`)).join('')}</w:tr>`)
    .join('');
  const document = read(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblStyle w:val="T"/>${lead}` +
      `<w:tblW w:w="6000" w:type="dxa"/>${tblPr}${LOOK}</w:tblPr>` +
      `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>${rows}</w:tbl>` +
      '<w:p/></w:body></w:document>'
  );
  const layout = layoutSemanticDocument(document, 0, {
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 612, height: 600, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
    styleCascade: buildStyleCascadeTable(
      read(
        '/word/styles.xml',
        `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr>` +
          `</w:rPrDefault><w:pPrDefault/></w:docDefaults>${styles}</w:styles>`
      ).root
    ),
    compatibilityMode: mode,
  });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  const round = (value: number) => Math.round(value * 100) / 100;
  const text = linesOf(layout)
    .slice(0, 6)
    .map((line) => round(line.box.x));
  return {
    grid: round(table.rows[0]!.cells[0]!.box.x),
    first: text.slice(0, 3),
    second: text.slice(3),
  };
}

const PLAIN = style('T', '');
/** Style `T` over the default style that states the indent. */
const indented = (body: string) => WITH_INDENT + style('T', `<w:basedOn w:val="Base"/>${body}`);
const STYLE_MARGIN = style('T', tcPr(left('tcMar', 400)));

test('without a stated indent the outer edge stays on the text edge, whatever states the margin', () => {
  const inset = { grid: 0, first: [20, 120, 220], second: [20, 120, 220] };
  expect(placement(PLAIN, { tblPr: left('tblCellMar', 400) })).toEqual(inset);
  expect(placement(style('T', `<w:tblPr>${left('tblCellMar', 400)}</w:tblPr>`))).toEqual(inset);
  expect(placement(STYLE_MARGIN)).toEqual(inset);
  expect(placement(STYLE_MARGIN, { mode: 12 })).toEqual(inset);
  // A cell's own margin insets that cell only.
  expect(placement(PLAIN, { cells: { '0,0': left('tcMar', 400) } })).toEqual({
    grid: 0,
    first: [20, 100.5, 200.5],
    second: [0.5, 100.5, 200.5],
  });
});

test('a stated indent puts the content edge of the first cell on the text edge', () => {
  // The style's cell margin counts as the cell's own does.
  const aligned = { grid: -20, first: [0, 100, 200], second: [0, 100, 200] };
  expect(placement(indented(tcPr(left('tcMar', 400))))).toEqual(aligned);
  expect(placement(STYLE_MARGIN, { tblPr: '<w:tblInd w:w="0" w:type="dxa"/>' })).toEqual(aligned);
  expect(
    placement(indented(''), {
      cells: { '0,0': left('tcMar', 400), '1,0': left('tcMar', 400) },
    })
  ).toEqual({ grid: -20, first: [0, 85.4, 185.4], second: [0, 85.4, 185.4] });
  // Table-level margins only (control).
  expect(placement(indented(''))).toEqual({
    grid: -5.4,
    first: [0, 100, 200],
    second: [0, 100, 200],
  });
});

test('a conditional left margin moves the grid out and leaves the text in place', () => {
  // The first-column margin holds for each row; the text stays at the 0.5pt default inset.
  expect(placement(style('T', condition('firstCol', left('tcMar', 400))))).toEqual({
    grid: -19.5,
    first: [0.5, 100.5, 200.5],
    second: [0.5, 100.5, 200.5],
  });
  // Over a margin without conditional formats, the grid moves by the difference.
  const moved = { grid: -10, first: [10, 110, 210], second: [10, 110, 210] };
  expect(
    placement(style('T', tcPr(left('tcMar', 200)) + condition('firstCol', left('tcMar', 400))))
  ).toEqual(moved);
  expect(
    placement(style('T', condition('firstCol', left('tcMar', 400))), {
      tblPr: left('tblCellMar', 200),
    })
  ).toEqual(moved);
  // The first row decides for the table; a later row keeps the grid and its own margin.
  expect(placement(style('T', condition('firstRow', left('tcMar', 400))))).toEqual({
    grid: -19.5,
    first: [0.5, 100.5, 200.5],
    second: [-19, 81, 181],
  });
  // A conditional format without a left margin moves nothing (control).
  expect(
    placement(
      style('T', condition('firstCol', '<w:tcMar><w:right w:w="400" w:type="dxa"/></w:tcMar>'))
    ).grid
  ).toBe(0);
});

test('compatibility mode 15 keeps the outer edge on the text edge (control)', () => {
  const inset = { grid: 0, first: [20, 120, 220], second: [20, 120, 220] };
  expect(placement(STYLE_MARGIN, { mode: 15 })).toEqual(inset);
  expect(placement(indented(tcPr(left('tcMar', 400))), { mode: 15 })).toEqual(inset);
  expect(placement(style('T', condition('firstCol', left('tcMar', 400))), { mode: 15 })).toEqual(
    inset
  );
});

test('the conditional shift holds when a column widens and in a fixed layout, not when centered', () => {
  const firstColumn = style('T', condition('firstCol', left('tcMar', 400)));
  // A 180pt word widens the first column; the grid keeps its place.
  expect(placement(firstColumn, { text: 'x'.repeat(30) })).toMatchObject({
    grid: -19.5,
    first: [0.5, 201, 250.75],
  });
  expect(placement(firstColumn, { tblPr: '<w:tblLayout w:type="fixed"/>' }).grid).toBe(-19.5);
  // A centered table centers its outer edges in the 468pt text column (control).
  expect(placement(firstColumn, { tblPr: '<w:jc w:val="center"/>' })).toMatchObject({
    grid: 84,
    first: [104, 204, 304],
  });
});
