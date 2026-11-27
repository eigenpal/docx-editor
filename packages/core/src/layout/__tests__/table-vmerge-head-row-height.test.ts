// A row whose cells all start or continue a vertical merge (`w:vMerge`, `CT_VMerge`,
// ECMA-376 Part 1, 17.4.84). The merged text belongs to the span, so no cell of the row sizes
// it. The end-of-cell paragraph of the row's FIRST cell then sets its floor, and an `atLeast`
// row height (`w:trHeight`, `CT_Height`, 17.4.80; `ST_HeightRule`, 17.18.37) can only raise it.
//
// Each table is a three-row footer band: a 6.25pt exact row, the row under test, and a
// 19.85pt exact row. The cells have no borders and no side margins. The fixed measurer gives
// an 8pt line 10.18pt and a 12pt line 15.27pt.

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage, readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type PageFurniture,
} from '../index.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const measurer = createFixedMeasurer();
const LINE_8PT = (14 * 8) / 11;
const LINE_12PT = (14 * 12) / 11;

const p = (text: string, before = 0, size = 16) =>
  `<w:p><w:pPr><w:spacing w:before="${before}" w:after="0"/><w:rPr><w:sz w:val="${size}"/></w:rPr></w:pPr>` +
  (text ? `<w:r><w:rPr><w:sz w:val="${size}"/></w:rPr><w:t>${text}</w:t></w:r>` : '') +
  '</w:p>';
type Merge = 'restart' | 'continue' | undefined;
const tc = (width: number, body: string, merge?: Merge) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
  (merge === 'restart'
    ? '<w:vMerge w:val="restart"/>'
    : merge === 'continue'
      ? '<w:vMerge/>'
      : '') +
  `</w:tcPr>${body}</w:tc>`;
const tr = (height: string, cells: readonly string[]) =>
  `<w:tr><w:trPr>${height}</w:trPr>${cells.join('')}</w:tr>`;

const EXACT_TOP = '<w:trHeight w:hRule="exact" w:val="125"/>';
const EXACT_BOTTOM = '<w:trHeight w:hRule="exact" w:val="397"/>';

/** The middle row's cells and its `w:trHeight`, between the two fixed rows. */
function band(
  middle: readonly string[],
  middleHeight: string,
  top: Merge = undefined,
  bottomMerges?: readonly Merge[]
): string {
  const bottom =
    bottomMerges ??
    middle.map((cell) => (cell.includes('w:vMerge w:val="restart"') ? 'continue' : undefined));
  const firstContinues = middle[0]!.includes('<w:vMerge/>');
  return (
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar>' +
    '<w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="7767"/><w:gridCol w:w="2993"/></w:tblGrid>' +
    tr(EXACT_TOP, [
      tc(7767, p(''), firstContinues ? 'restart' : undefined),
      tc(2993, p('Page 1'), top),
    ]) +
    tr(middleHeight, middle) +
    tr(EXACT_BOTTOM, [tc(7767, p(''), bottom[0]), tc(2993, p('Notice', 90), bottom[1])]) +
    '</w:tbl>'
  );
}

const twoLines = p('Form', 80) + p('Second line');
const shapes = {
  'an ordinary cell beside a merge head': band(
    [tc(7767, twoLines, 'restart'), tc(2993, p(''))],
    '<w:trHeight w:val="184"/>'
  ),
  'two merge heads': band(
    [tc(7767, twoLines, 'restart'), tc(2993, p('Code'), 'restart')],
    '<w:trHeight w:val="184"/>'
  ),
  // Column 1 merges rows 0-1 and column 0 merges rows 1-2: a staircase.
  'a merge head beside a continuation': band(
    [tc(7767, twoLines, 'restart'), tc(2993, p(''), 'continue')],
    '<w:trHeight w:val="184"/>',
    'restart'
  ),
};

function rowHeights(table: string, rowMeasurer = measurer): readonly number[] {
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${table}${p('After')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer: rowMeasurer });
  const fragment = layout.pages[0]!.fragments.find(
    (f): f is TableFragmentRecord => f.kind === 'table'
  )!;
  return fragment.rows.map((row) => row.box.height);
}

test('an ordinary cell sizes the middle row to its own line', () => {
  const heights = rowHeights(shapes['an ordinary cell beside a merge head']);
  expect(heights[0]).toBeCloseTo(6.25, 6);
  expect(heights[1]).toBeGreaterThan(9.2);
  expect(heights[2]).toBeCloseTo(19.85, 6);
});

for (const shape of ['two merge heads', 'a merge head beside a continuation'] as const) {
  test(`a row with ${shape} takes its first cell's end line over a smaller atLeast height`, () => {
    const heights = rowHeights(shapes[shape]);
    expect(heights[0]).toBeCloseTo(6.25, 6);
    expect(heights[1]).toBeCloseTo(LINE_8PT, 6);
    expect(heights[2]).toBeCloseTo(19.85, 6);
  });
}

test('an atLeast height above the end line sizes a row of merge heads', () => {
  const heads = [tc(7767, twoLines, 'restart'), tc(2993, p('Code'), 'restart')];
  expect(rowHeights(band(heads, '<w:trHeight w:val="300"/>'))[1]).toBeCloseTo(15, 6);
});

// Without a height of its own, the row takes the first cell's end line, not one line of the
// default run style.
for (const height of ['<w:trHeight w:hRule="auto" w:val="184"/>', '']) {
  test(`a row of merge heads with ${height ? 'an auto' : 'no'} height takes its end line`, () => {
    const heads = [tc(7767, twoLines, 'restart'), tc(2993, p('Code'), 'restart')];
    expect(rowHeights(band(heads, height))[1]).toBeCloseTo(LINE_8PT, 6);
  });
}

const low = '<w:trHeight w:val="100"/>';
test('only the first cell of a row of merge heads sets its floor', () => {
  const big = p('Big', 0, 24);
  const small = p('small');
  expect(
    rowHeights(band([tc(7767, big, 'restart'), tc(2993, small, 'restart')], low))[1]
  ).toBeCloseTo(LINE_12PT, 6);
  expect(
    rowHeights(band([tc(7767, small, 'restart'), tc(2993, big, 'restart')], low))[1]
  ).toBeCloseTo(LINE_8PT, 6);
  // The text of the head does not count: its end paragraph does.
  expect(
    rowHeights(band([tc(7767, big + small, 'restart'), tc(2993, small, 'restart')], low))[1]
  ).toBeCloseTo(LINE_8PT, 6);
});

const spaced = (before: number, after: number, text = '') =>
  `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}"/><w:rPr><w:sz w:val="16"/></w:rPr></w:pPr>` +
  (text ? `<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>${text}</w:t></w:r>` : '') +
  '</w:p>';
test("a merge head adds its end paragraph's spacing after, not its spacing before", () => {
  const head = (body: string) =>
    band([tc(7767, body, 'restart'), tc(2993, p('b'), 'restart')], low);
  expect(rowHeights(head(spaced(80, 0, 'one')))[1]).toBeCloseTo(LINE_8PT, 6);
  expect(rowHeights(head(p('one') + spaced(0, 120, 'two')))[1]).toBeCloseTo(LINE_8PT + 6, 6);
});

test('a continuation in the first cell gives its whole end paragraph box', () => {
  const heights = rowHeights(
    band([tc(7767, spaced(80, 0), 'continue'), tc(2993, p('b'), 'restart')], low, undefined, [
      undefined,
      'continue',
    ])
  );
  expect(heights[1]).toBeCloseTo(4 + LINE_8PT, 6);
});

// The band as a footer at 0pt from the sheet edge, under a 28.35pt bottom margin. The footer
// is taller than the margin, so it raises the bottom of the body. The 765.5pt exact row and
// a 1pt paragraph fit above the 9.2pt band row. Above a band row one default line tall, the
// row does not fit the body, takes a page of its own, and pushes the paragraph to page 2.
test('the footer band leaves the body room for a page-tall exact row and its paragraph', () => {
  const footer = `<w:ftr xmlns:w="${W}">${band(
    [tc(7767, twoLines, 'restart'), tc(2993, p(''), 'continue')],
    '<w:trHeight w:val="184"/>',
    'restart'
  )}${p('')}</w:ftr>`;
  const pageRow =
    '<w:tbl><w:tblGrid><w:gridCol w:w="10760"/></w:tblGrid>' +
    tr('<w:trHeight w:hRule="exact" w:val="15310"/>', [tc(10760, p('Form page'))]) +
    '</w:tbl>';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdF" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${pageRow}${p('After the row', 0, 2)}` +
        '<w:sectPr><w:footerReference w:type="default" r:id="rIdF"/><w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="567" w:header="0" w:footer="0" w:gutter="0"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/footer1.xml': strToU8(footer),
  };
  const loaded = readOoxmlPackage(zipSync(files));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const [section] = enumerateDocumentSections(part);
  const geometry = geometryOfSection(section!.properties);
  const width = geometry.width - geometry.margin.left - geometry.margin.right;
  const footerPart = loaded.package.parts.get('/word/footer1.xml')!;
  const furniture: PageFurniture = {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map(),
    footers: new Map([['default', layoutHeaderFooterStory(footerPart, width, measurer, 'test')]]),
  };
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'test',
    sectionFurniture: [furniture],
  });
  expect(layout.pages).toHaveLength(1);
  expect(layout.pages[0]!.fragments.map((fragment) => fragment.kind)).toEqual([
    'table',
    'paragraph',
  ]);
});

// A 3pt rule above and below every cell. A merge head's bottom rule belongs to its span, so
// the floor takes the row's own clearance: the 3pt rule above it, and no rule of its own below.
test('the end line of a row of merge heads takes the row-local border clearance', () => {
  const ruled = (height: string) =>
    band([tc(7767, twoLines, 'restart'), tc(2993, p('Code'), 'restart')], height).replace(
      '<w:tblLayout w:type="fixed"/>',
      '<w:tblLayout w:type="fixed"/><w:tblBorders>' +
        ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
          .map((side) => `<w:${side} w:val="single" w:sz="24" w:space="0" w:color="000000"/>`)
          .join('') +
        '</w:tblBorders>'
    );
  expect(rowHeights(ruled(''))[1]).toBeCloseTo(LINE_8PT + 3, 6);
  expect(rowHeights(ruled('<w:trHeight w:val="100"/>'))[1]).toBeCloseTo(LINE_8PT + 3, 6);
});

test('a waiting btLr cell beside a merge head takes the end line, or the atLeast height', () => {
  const vertical = tc(2993, p('vertical text'), undefined).replace(
    '</w:tcPr>',
    '<w:textDirection w:val="btLr"/></w:tcPr>'
  );
  const row = (height: string) =>
    band([tc(7767, twoLines, 'restart'), vertical], height, undefined, ['continue', undefined]);
  expect(rowHeights(row(''))[1]).toBeCloseTo(LINE_8PT, 6);
  // A minimum takes the row; the head's end line does not floor it.
  expect(rowHeights(row(low))[1]).toBeCloseTo(5, 6);
});

test('a first cell with hideMark gives the line of the default run properties', () => {
  const hidden = tc(7767, p('', 0, 24), 'restart').replace('</w:tcPr>', '<w:hideMark/></w:tcPr>');
  // No styles part: the default run is 10pt.
  const heights = rowHeights(band([hidden, tc(2993, p('Big', 0, 24), 'restart')], low));
  expect(heights[1]).toBeCloseTo((14 * 10) / 11, 6);
});

test('the first cell in document order decides in a right-to-left table', () => {
  const rtl = band(
    [tc(7767, p('Big', 0, 24), 'restart'), tc(2993, p('b'), 'restart')],
    low
  ).replace('<w:tblLayout w:type="fixed"/>', '<w:tblLayout w:type="fixed"/><w:bidiVisual/>');
  expect(rowHeights(rtl)[1]).toBeCloseTo(LINE_12PT, 6);
});

test('cell spacing adds its gap above the end line', () => {
  const heads = [tc(7767, twoLines, 'restart'), tc(2993, p('Code'), 'restart')];
  const spaced = band(heads, low).replace(
    '<w:tblLayout w:type="fixed"/>',
    '<w:tblLayout w:type="fixed"/><w:tblCellSpacing w:w="100" w:type="dxa"/>'
  );
  // 5pt on each side of every cell (`w:tblCellSpacing`, 17.4.45): 10pt between two rows' cells.
  expect(rowHeights(spaced)[1]).toBeCloseTo(LINE_8PT + 10, 6);
});

test('a repeated header row of merge heads keeps its end line on the next page', () => {
  const heads = [tc(7767, twoLines, 'restart'), tc(2993, p('Code'), 'restart')];
  const header = band(heads, low)
    .replaceAll('<w:trPr>', '<w:trPr><w:tblHeader/>')
    .replace('</w:tbl>', '');
  const body = Array.from({ length: 80 }, (_, index) =>
    tr('', [tc(7767, p(`Row ${index}`)), tc(2993, p(''))])
  ).join('');
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${header}${body}</w:tbl>${p('After')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer });
  expect(layout.pages.length).toBeGreaterThan(1);
  for (const page of layout.pages.slice(0, 2)) {
    const table = page.fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
    expect(table.rows[1]!.box.height).toBeCloseTo(LINE_8PT, 6);
  }
});

// Outside merges, a row of `btLr` cells whose marks are hidden text has nothing to size it
// either. It keeps one line of the default run style (10pt here).
test('a row of btLr cells with hidden marks keeps the default line', () => {
  const vanished =
    '<w:p><w:pPr><w:rPr><w:vanish/><w:sz w:val="16"/></w:rPr></w:pPr>' +
    '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>abc</w:t></w:r></w:p>';
  const vertical = tc(7767, vanished).replace(
    '</w:tcPr>',
    '<w:textDirection w:val="btLr"/></w:tcPr>'
  );
  const table =
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="7767"/></w:tblGrid>' +
    tr('', [vertical]) +
    '</w:tbl>';
  expect(rowHeights(table)[0]).toBeCloseTo((14 * 10) / 11, 6);
});

// No face resolves, so no end mark can be measured: the row keeps the fallback line (10pt).
test('a row of merge heads whose faces do not resolve keeps the fallback line', () => {
  const heads = [tc(7767, twoLines, 'restart'), tc(2993, p('Code'), 'restart')];
  const unresolved = { ...measurer, hasResolvedFont: () => false };
  expect(rowHeights(band(heads, low), unresolved)[1]).toBeCloseTo((14 * 10) / 11, 6);
});
