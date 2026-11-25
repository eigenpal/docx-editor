// A row whose cells all start or continue a vertical merge (`w:vMerge`, `CT_VMerge`,
// ECMA-376 Part 1, 17.4.84). The merged text belongs to the span, so no cell of the row sizes
// it. An `atLeast` row height (`w:trHeight`, `CT_Height`, 17.4.80; `ST_HeightRule`, 17.18.37)
// is then the row's height, not one line of the default run style.
//
// Each table is a three-row footer band: a 6.25pt exact row, a 9.2pt atLeast row, and a
// 19.85pt exact row. Fonts are 8pt, and the cells have no borders and no side margins.

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
function band(middle: readonly string[], middleHeight: string, top: Merge = undefined): string {
  const bottom = middle.map((cell) => cell.includes('w:vMerge w:val="restart"'));
  return (
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar>' +
    '<w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="7767"/><w:gridCol w:w="2993"/></w:tblGrid>' +
    tr(EXACT_TOP, [tc(7767, p('')), tc(2993, p('Page 1'), top)]) +
    tr(middleHeight, middle) +
    tr(EXACT_BOTTOM, [
      tc(7767, p(''), bottom[0] ? 'continue' : undefined),
      tc(2993, p('Notice', 90), bottom[1] ? 'continue' : undefined),
    ]) +
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

function rowHeights(table: string): readonly number[] {
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${table}${p('After')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer });
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
  test(`a row with ${shape} takes its atLeast height`, () => {
    const heights = rowHeights(shapes[shape]);
    expect(heights[0]).toBeCloseTo(6.25, 6);
    expect(heights[1]).toBeCloseTo(9.2, 6);
    expect(heights[2]).toBeCloseTo(19.85, 6);
  });
}

// Without a height of its own, the row keeps one line of the default run style.
test('a row of merge heads with no authored height keeps a line', () => {
  const auto = band(
    [tc(7767, twoLines, 'restart'), tc(2993, p('Code'), 'restart')],
    '<w:trHeight w:hRule="auto" w:val="184"/>'
  );
  expect(rowHeights(auto)[1]).toBeGreaterThan(9.2);
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
