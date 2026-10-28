import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableRowFragmentRecord } from '../semantic-records.ts';

// Letter page, 1in margins: a 648pt band. Outer rules 1.5pt, inside rules 0.5pt, cell margins 0.
// Every case opens with a 12pt line and an exact spacer, so the table rows land where a case
// needs them. Heights are multiples of 1.25 twips.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const line = (text: string, twips = 240) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${twips}" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

interface Row {
  readonly tag: string;
  readonly twips?: number;
  readonly rule?: 'exact' | 'atLeast';
  readonly header?: boolean;
  readonly cantSplit?: boolean;
  readonly lines?: number;
}

function letterDocument(
  spacerPt: number,
  rows: readonly Row[],
  options: { align?: 'top' | 'center' | 'bottom'; insideH?: boolean } = {}
) {
  const side = (name: string, size: number) => `<w:${name} w:val="single" w:sz="${size}"/>`;
  const borders =
    ['top', 'left', 'bottom', 'right'].map((name) => side(name, 12)).join('') +
    (options.insideH === false ? '<w:insideH w:val="nil"/>' : side('insideH', 4)) +
    side('insideV', 4);
  const margins = ['top', 'left', 'bottom', 'right']
    .map((name) => `<w:${name} w:w="0" w:type="dxa"/>`)
    .join('');
  let table =
    `<w:tbl><w:tblPr><w:tblW w:w="3600" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblBorders>${borders}</w:tblBorders><w:tblCellMar>${margins}</w:tblCellMar></w:tblPr>` +
    '<w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>';
  for (const row of rows) {
    const height = row.twips
      ? `<w:trHeight w:val="${row.twips}" w:hRule="${row.rule ?? 'exact'}"/>`
      : '';
    table +=
      `<w:tr><w:trPr>${row.cantSplit === false ? '' : '<w:cantSplit/>'}` +
      `${row.header ? '<w:tblHeader/>' : ''}${height}</w:trPr>`;
    for (const column of [1, 2]) {
      const text = Array.from({ length: row.lines ?? 1 }, (_, index) =>
        line(index === 0 ? `${row.tag}c${column}` : `${row.tag}l${index}`)
      ).join('');
      table += `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/><w:vAlign w:val="${options.align ?? 'center'}"/></w:tcPr>${text}</w:tc>`;
    }
    table += '</w:tr>';
  }
  const section =
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" ' +
    'w:bottom="1440" w:left="1440" w:header="0" w:footer="0"/></w:sectPr>';
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${line('LEAD')}${line('SPACER', spacerPt * 20)}` +
      `${table}</w:tbl>${line('AFTER')}${section}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

function layOut(part: ReturnType<typeof letterDocument>, compatibilityMode?: number) {
  const source = serializeOoxmlPart(part);
  const result = layoutSemanticDocument(part, 0, {
    measurer: createFixedMeasurer(5, 12),
    compatibilityMode,
  });
  expect(serializeOoxmlPart(part)).toBe(source);
  return result;
}

type Placed = { readonly page: number; readonly row: TableRowFragmentRecord };
function rowsOf(result: ReturnType<typeof layOut>): Map<string, Placed> {
  const rows = new Map<string, Placed>();
  result.pages.forEach((page, index) => {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table') continue;
      for (const row of fragment.rows) {
        const block = row.cells[0]!.blocks[0];
        const text = block?.kind === 'paragraph' ? block.lines[0]!.spans[0]!.text : '';
        rows.set(`${text}${row.isHeaderRepeat ? '@repeat' : ''}`, { page: index, row });
      }
    }
  });
  return rows;
}

const textTop = (placed: Placed | undefined) => {
  const block = placed?.row.cells[0]!.blocks[0];
  if (!block || block.kind !== 'paragraph') throw new Error('The cell text is missing');
  return block.lines[0]!.box.y;
};

// Rows a and m are 20pt, z is 40pt. Row m ends at `mBottom`, and z does not fit below it.
const breakRows = (mBottom: number) =>
  [
    mBottom - 12 - 40,
    [
      { tag: 'a', twips: 400 },
      { tag: 'm', twips: 400 },
      { tag: 'z', twips: 800 },
    ],
  ] as const;

for (const [align, mText, zText] of [
  ['bottom', 618, 29],
  ['center', 614.25, 15.25],
  ['top', 610.5, 1.5],
] as const) {
  test(`a ${align} exact row that ends a page draws its rules outside the authored height`, () => {
    const [spacer, rows] = breakRows(630);
    const placed = rowsOf(layOut(letterDocument(spacer, rows, { align })));
    const m = placed.get('mc1')!;
    const z = placed.get('zc1')!;
    expect([m.page, z.page]).toEqual([0, 1]);
    // Row m: 610pt to the authored 630pt, then the 1.5pt table bottom rule below it.
    expect(m.row.box.y).toBeCloseTo(610, 6);
    expect(m.row.box.height).toBeCloseTo(21.5, 6);
    expect(textTop(m)).toBeCloseTo(mText, 6);
    // Row z opens page 2: its 1.5pt top rule replaces the 0.5pt inside rule. The 1pt
    // difference sits above the authored 40pt, and its closing rule below it.
    expect(z.row.box.y).toBe(0);
    expect(z.row.box.height).toBeCloseTo(1 + 40 + 1.5, 6);
    expect(textTop(z)).toBeCloseTo(zText, 6);
    // The table's first row keeps its 1.5pt top rule inside its authored height.
    expect(placed.get('ac1')!.row.box.height).toBeCloseTo(20, 6);
    expect(textTop(placed.get('ac1'))).toBeCloseTo(
      align === 'top' ? 591.5 : align === 'center' ? 594.75 : 598,
      6
    );
  });
}

for (const compatibilityMode of [undefined, 14, 15]) {
  for (const [mBottom, moves] of [
    [646.25, false],
    [646.5, false],
    [646.75, true],
    // The 0.5pt inside rule would fit. The row ends the page, so the 1.5pt bottom rule counts.
    [647.25, true],
  ] as const) {
    test(`an exact row that ends a page at ${mBottom}pt ${moves ? 'moves' : 'stays'} (mode ${compatibilityMode})`, () => {
      const [spacer, rows] = breakRows(mBottom);
      const placed = rowsOf(layOut(letterDocument(spacer, rows), compatibilityMode));
      const a = placed.get('ac1')!;
      const m = placed.get('mc1')!;
      expect(a.page).toBe(0);
      expect(m.page).toBe(moves ? 1 : 0);
      if (moves) {
        // Row a now ends page 1 and takes the bottom rule; row m opens page 2.
        expect(a.row.box.height).toBeCloseTo(21.5, 6);
        expect(m.row.box.y).toBe(0);
        expect(m.row.box.height).toBeCloseTo(21, 6);
        expect(placed.get('zc1')!.row.box.y).toBeCloseTo(21, 6);
      } else {
        expect(m.row.box.y + m.row.box.height).toBeCloseTo(mBottom + 1.5, 6);
      }
    });
  }
}

test('without an inside rule, a row that opens a page gains the whole top rule', () => {
  const [spacer, rows] = breakRows(647.25);
  const placed = rowsOf(layOut(letterDocument(spacer, rows, { insideH: false })));
  const m = placed.get('mc1')!;
  expect(m.page).toBe(1);
  expect(m.row.box.height).toBeCloseTo(21.5, 6);
  expect(textTop(m)).toBeCloseTo(5.5, 6);
  expect(placed.get('zc1')!.row.box.y).toBeCloseTo(21.5, 6);
});

// Page 1: lead, spacer, header h, and row a, with 5pt left. Row m goes to page 2.
// Below a repeated 20pt header, m ends at 647.5pt: it fits, but the 1.5pt bottom rule does not.
const headerCase = () =>
  letterDocument(648 - 12 - 40 - 5, [
    { tag: 'h', twips: 400, header: true },
    { tag: 'a', twips: 400 },
    { tag: 'm', twips: 12550 },
    { tag: 'z', twips: 400 },
  ]);

test('mode 15 omits a repeated header that leaves an exact row that ends the page no rule room', () => {
  const placed = rowsOf(layOut(headerCase(), 15));
  const m = placed.get('mc1')!;
  expect(m.page).toBe(1);
  expect(m.row.box.y).toBe(0);
  expect(m.row.box.height).toBeCloseTo(1 + 627.5 + 1.5, 6);
  // Page 3 repeats the header above row z.
  expect(placed.get('hc1@repeat')!.page).toBe(2);
  expect(placed.get('zc1')!.page).toBe(2);
});

for (const compatibilityMode of [undefined, 14]) {
  test(`before mode 15, the header repeats and the row's rule crosses the margin (mode ${compatibilityMode})`, () => {
    const placed = rowsOf(layOut(headerCase(), compatibilityMode));
    const m = placed.get('mc1')!;
    expect(m.page).toBe(1);
    expect(m.row.box.y).toBeCloseTo(20, 6);
    // The row stays below the repeat: 20 + 627.5 = 647.5pt, and its rule ends at 649pt.
    expect(m.row.box.y + m.row.box.height).toBeCloseTo(649, 6);
    expect(placed.get('zc1')!.page).toBe(2);
  });
}
