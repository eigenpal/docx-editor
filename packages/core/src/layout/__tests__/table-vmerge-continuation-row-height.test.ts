// A row whose cells all continue a vertical merge (`w:vMerge`, `CT_VMerge`, ECMA-376 Part 1,
// 17.4.84). No cell paints content there, so the end-of-cell paragraph of the row's FIRST
// cell sizes it, as for a row of merge heads. The other cells do not count, and an
// `atLeast` row height (`w:trHeight`, `CT_Height`, 17.4.80; `ST_HeightRule`, 17.18.37) can
// only raise it. A first cell with `w:hideMark` (17.4.21) gives one default line.
//
// Each table has a head row, the continuation row under test, and a closing row. The cells
// have no margins. The fixed measurer gives an 8pt line 10.18pt, a 10pt line 12.73pt, a 12pt
// line 15.27pt, and a 16pt line 20.36pt.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
} from '../index.ts';
import type { BlockFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer();
const line = (sizePt: number) => (14 * sizePt) / 11;

/** An empty end paragraph with a mark of `size` half-points and optional spacing in twips. */
const mark = (size = 16, before = 0, after = 0) =>
  `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}"/>` +
  `<w:rPr><w:sz w:val="${size}"/></w:rPr></w:pPr></w:p>`;
const text = (value: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:rPr><w:sz w:val="16"/></w:rPr></w:pPr>` +
  `<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>${value}</w:t></w:r></w:p>`;
const HIDE = '<w:hideMark/>';
const tc = (body: string, properties = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${properties}</w:tcPr>${body}</w:tc>`;
const tr = (height: string, cells: readonly string[]) =>
  `<w:tr><w:trPr>${height}</w:trPr>${cells.join('')}</w:tr>`;
const LOW = '<w:trHeight w:val="100"/>';

/** A table whose middle row continues every column, with `ends[i]` in column i. */
function continuationTable(
  ends: readonly { readonly body: string; readonly properties?: string }[],
  options: { readonly height?: string; readonly tblPr?: string } = {}
): string {
  const grid = ends.map(() => '<w:gridCol w:w="2000"/>').join('');
  return (
    `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/>${options.tblPr ?? ''}<w:tblCellMar>` +
    ['top', 'left', 'bottom', 'right'].map((s) => `<w:${s} w:w="0" w:type="dxa"/>`).join('') +
    `</w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>` +
    tr(
      '',
      ends.map(() => tc(text('Head'), '<w:vMerge w:val="restart"/>'))
    ) +
    tr(
      options.height ?? LOW,
      ends.map((end) => tc(end.body, `<w:vMerge/>${end.properties ?? ''}`))
    ) +
    tr(
      '',
      ends.map(() => tc(text('After')))
    ) +
    '</w:tbl>'
  );
}

function tableOf(fragments: readonly BlockFragmentRecord[]): TableFragmentRecord {
  return fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
}

function middleRow(table: string, session = createLayoutSession()): number {
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p/>${table}<w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer, session });
  const rows = tableOf(layout.pages[0]!.fragments).rows;
  expect(rows).toHaveLength(3);
  expect(rows[1]!.cells.every((cell) => cell.blocks.length === 0)).toBe(true);
  expect(rows[2]!.box.y).toBeCloseTo(rows[1]!.box.y + rows[1]!.box.height, 6);
  return rows[1]!.box.height;
}

const small = { body: mark(16) };
const big = { body: mark(24) };

test('the first cell sizes a row of continuations, never the larger one', () => {
  expect(middleRow(continuationTable([small, big]))).toBeCloseTo(line(8), 6);
  expect(middleRow(continuationTable([big, small]))).toBeCloseTo(line(12), 6);
  expect(middleRow(continuationTable([small, big, { body: mark(32) }]))).toBeCloseTo(line(8), 6);
});

test("only the first cell's spacing before and after counts", () => {
  expect(middleRow(continuationTable([small, { body: mark(16, 0, 120) }]))).toBeCloseTo(line(8), 6);
  expect(middleRow(continuationTable([small, { body: mark(16, 120, 0) }]))).toBeCloseTo(line(8), 6);
  expect(middleRow(continuationTable([{ body: mark(16, 80, 120) }, small]))).toBeCloseTo(
    4 + line(8) + 6,
    6
  );
});

test('the text of a continuation does not count, only its end paragraph', () => {
  const lots = { body: text('Lots') + mark(24) };
  expect(middleRow(continuationTable([{ body: text('Lots') + mark(16) }, lots]))).toBeCloseTo(
    line(8),
    6
  );
});

test('the first cell in document order decides in a right-to-left table', () => {
  const rtl = continuationTable([small, big], { tblPr: '<w:bidiVisual/>' });
  expect(middleRow(rtl)).toBeCloseTo(line(8), 6);
});

test('an atLeast height above the first cell raises the row; no height keeps the line', () => {
  expect(
    middleRow(continuationTable([small, big], { height: '<w:trHeight w:val="300"/>' }))
  ).toBeCloseTo(15, 6);
  expect(middleRow(continuationTable([small, big], { height: '' }))).toBeCloseTo(line(8), 6);
});

// No styles part, so the default line is the 10pt default run style.
test('a hidden first mark gives one default line, whatever the other cells hold', () => {
  const hidden = { body: mark(40, 120, 120), properties: HIDE };
  expect(middleRow(continuationTable([hidden, big]))).toBeCloseTo(line(10), 6);
  expect(middleRow(continuationTable([hidden, { body: mark(40), properties: HIDE }]))).toBeCloseTo(
    line(10),
    6
  );
  expect(middleRow(continuationTable([big, { body: mark(40), properties: HIDE }]))).toBeCloseTo(
    line(12),
    6
  );
});

test('a nested table sizes its row of continuations from the first cell', () => {
  const outer = (inner: string) =>
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid>' +
    tr('', [tc(inner + '<w:p/>')]) +
    '</w:tbl>';
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p/>${outer(continuationTable([small, big]))}<w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer });
  const cell = tableOf(layout.pages[0]!.fragments).rows[0]!.cells[0]!;
  expect(tableOf(cell.blocks).rows[1]!.box.height).toBeCloseTo(line(8), 6);
});

test('a header sizes its row of continuations from the first cell', () => {
  const header = readOoxmlPart(
    `<w:hdr xmlns:w="${W}">${continuationTable([small, big])}<w:p/></w:hdr>`,
    { name: '/word/header1.xml', contentType: 'app/xml' }
  );
  if (!header.ok) throw new Error(header.reason);
  const story = layoutHeaderFooterStory(header.part, 400, measurer, 'test');
  expect(tableOf(story.fragments).rows[1]!.box.height).toBeCloseTo(line(8), 6);
});

test('a reused layout session keeps no stale row height after the first cell changes', () => {
  const session = createLayoutSession();
  expect(middleRow(continuationTable([small, big]), session)).toBeCloseTo(line(8), 6);
  expect(middleRow(continuationTable([big, small]), session)).toBeCloseTo(line(12), 6);
  expect(middleRow(continuationTable([small, big]), session)).toBeCloseTo(line(8), 6);
});

// Each cell pads the first cell's box with its own margins, so the largest top and bottom
// margins in the row count, wherever they are.
test("the row's largest top and bottom margins pad the first cell's box", () => {
  const margins = (top: number, bottom: number) =>
    `<w:tcMar><w:top w:w="${top}" w:type="dxa"/><w:bottom w:w="${bottom}" w:type="dxa"/></w:tcMar>`;
  const padded = (first: string, second: string) =>
    middleRow(
      continuationTable(
        [
          { body: mark(16), properties: first },
          { body: mark(24), properties: second },
        ],
        { height: '' }
      )
    );
  expect(padded(margins(0, 0), margins(400, 400))).toBeCloseTo(20 + line(8) + 20, 6);
  expect(padded(margins(400, 400), margins(0, 0))).toBeCloseTo(20 + line(8) + 20, 6);
  expect(padded(margins(0, 0), margins(0, 400))).toBeCloseTo(line(8) + 20, 6);
});

// A hidden default paragraph style gives no default line: the row then takes only its 5pt
// minimum, as a row of merge heads does (not measured). The head and closing rows show.
test('a hidden first mark under a hidden default paragraph style gives no line', () => {
  const styles = readOoxmlPart(
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="16"/></w:rPr>` +
      '</w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>' +
      '</w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
      '<w:rPr><w:vanish/></w:rPr></w:style></w:styles>',
    { name: '/word/styles.xml', contentType: 'app/xml' }
  );
  if (!styles.ok) throw new Error(styles.reason);
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p/>${continuationTable([
      { body: mark(40), properties: HIDE },
      big,
    ]).replaceAll(
      '<w:rPr><w:sz w:val="16"/></w:rPr>',
      '<w:rPr><w:vanish w:val="0"/><w:sz w:val="16"/></w:rPr>'
    )}<w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, {
    measurer,
    styleCascade: buildStyleCascadeTable(styles.part.root),
  });
  expect(tableOf(layout.pages[0]!.fragments).rows[1]!.box.height).toBeCloseTo(5, 6);
});

// A `w:vanish` mark is not measured, so it takes the default line as a hidden mark does.
test('a vanished first mark gives one default line', () => {
  const vanished =
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:rPr><w:vanish/><w:sz w:val="40"/></w:rPr></w:pPr></w:p>';
  expect(middleRow(continuationTable([{ body: vanished }, big]))).toBeCloseTo(line(10), 6);
});

// A merged-text carry empties the heads of a row whose cells all head one span. That row has
// no end paragraph left, so it is not a row of continuations: it keeps sizing from each cell,
// and the carry decides from those heights as before.
test('a carried row of merge heads is not sized as a row of continuations', () => {
  const lineOnly = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>';
  const line12 = (value: string) =>
    `<w:p><w:pPr>${lineOnly}</w:pPr><w:r><w:t>${value}</w:t></w:r></w:p>`;
  const merged =
    Array.from({ length: 42 }, (_, i) => line12(`Merged ${i}`)).join('') +
    '<w:p><w:pPr><w:spacing w:before="0" w:after="480"/></w:pPr></w:p>';
  const cell = (index: number) =>
    `<w:tc><w:tcPr><w:vMerge${index === 0 ? ' w:val="restart"' : ''}/></w:tcPr>` +
    `${index === 0 ? merged : `<w:p><w:pPr>${lineOnly}</w:pPr></w:p>`}</w:tc>`;
  const rows = Array.from(
    { length: 30 },
    (_, index) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(index)}${cell(index)}</w:tr>`
  ).join('');
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:pPr><w:spacing w:line="4400" w:lineRule="exact"/></w:pPr><w:r><w:t>Intro</w:t></w:r></w:p>` +
      '<w:tbl><w:tblPr><w:tblW w:w="10000" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/>' +
      '<w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      `<w:tblGrid><w:gridCol w:w="5000"/><w:gridCol w:w="5000"/></w:tblGrid>${rows}</w:tbl><w:p/>` +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, {
    geometry: { width: 612, height: 720, margin: { top: 40, bottom: 40, left: 40, right: 40 } },
    measurer: {
      measure: (value) => [...value].length * 5,
      lineMetrics: () => ({ height: 12, baseline: 10 }),
    },
  });
  const tables = layout.pages.map((page) =>
    page.fragments.filter((f): f is TableFragmentRecord => f.kind === 'table')
  );
  // The table moves whole to the next page, and its head row keeps its end paragraph's box.
  expect(tables[0]).toHaveLength(0);
  expect(tables[1]).toHaveLength(1);
  expect(tables[1]![0]!.rows).toHaveLength(30);
  expect(tables[1]![0]!.rows[0]!.box.height).toBeCloseTo(12 + 24, 6);
});
