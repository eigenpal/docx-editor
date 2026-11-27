// Content positioned from the page edge on a page with mirrored side margins.
//
// `w:mirrorMargins` (CT_OnOff, ECMA-376 Part 1 §17.15.1.57) moves the content box of an even
// page. A floating table (`w:tblpPr`, CT_TblPPr, §17.4.57) or a text frame (`w:framePr`,
// CT_FramePr, §17.3.1.11) positioned from the page edge keeps its distance to the sheet, and
// one positioned from the margin moves with the text. This holds in the body, in a header,
// and for a continuous section that starts on an even page. Page borders (`w:pgBorders`,
// CT_PageBorders, §17.6.10) measured from the text follow the text.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type PageFurniture,
  type PageRecord,
  type SemanticLayout,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const MIRROR = { pageMarginSettings: { mirrorMargins: true } } as const;

function load(xml: string, name = '/word/document.xml'): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const body = (inner: string) =>
  load(`<w:document xmlns:w="${W}"><w:body>${inner}</w:body></w:document>`);

const p = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const lines = (count: number, prefix = 'line') =>
  Array.from({ length: count }, (_, index) => p(`${prefix}${index}`)).join('');

// A 300pt x 120pt sheet: left 60pt, right 10pt. Seven 14pt lines fit a page.
const sectPr = (extra = '', height = 2400, top = 200) =>
  `<w:sectPr><w:pgSz w:w="6000" w:h="${height}"/><w:pgMar w:top="${top}" w:right="200" ` +
  `w:bottom="200" w:left="1200" w:header="100" w:footer="0" w:gutter="0"/>${extra}</w:sectPr>`;

/** A floating table 20pt from its horizontal anchor. */
const table = (anchor: 'page' | 'margin') =>
  `<w:tbl><w:tblPr><w:tblpPr w:horzAnchor="${anchor}" w:vertAnchor="text" w:tblpX="400" w:tblpY="1"/>` +
  '<w:tblW w:w="1000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr>${p('T')}</w:tc></w:tr></w:tbl>`;

/** A text frame 20pt from its horizontal anchor. */
const frame = (anchor: 'page' | 'margin') =>
  p(
    'F',
    `<w:framePr w:w="600" w:h="300" w:hRule="exact" w:wrap="around" w:hAnchor="${anchor}" w:vAnchor="text" w:x="400" w:y="1"/>`
  );

const contentLeft = (page: PageRecord) => page.contentBox.x - page.box.x;

/** Sheet x of each floating table on the page. */
const tableLefts = (page: PageRecord) =>
  page.fragments
    .filter((fragment) => fragment.kind === 'table')
    .map((fragment) => Math.round((contentLeft(page) + fragment.box.x) * 100) / 100);

/** Sheet x of the floating tables, split by the side of the page each one is on. */
function tablesBySide(layout: SemanticLayout): { odd: number[]; even: number[] } {
  const sides = { odd: [] as number[], even: [] as number[] };
  for (const page of layout.pages)
    sides[page.index % 2 === 0 ? 'odd' : 'even'].push(...tableLefts(page));
  return sides;
}

describe('body content positioned on a mirrored page', () => {
  // A table every eight lines, so that odd and even pages both hold one.
  const tables = (anchor: 'page' | 'margin') =>
    Array.from({ length: 4 }, () => table(anchor) + lines(8)).join('') + sectPr();

  test('a page-positioned floating table keeps its distance to the sheet edge', () => {
    const layout = layoutSemanticDocument(body(tables('page')), 1, { measurer, ...MIRROR });
    expect(layout.pages.slice(0, 2).map(contentLeft)).toEqual([60, 10]);
    const { odd, even } = tablesBySide(layout);
    expect(odd.length).toBeGreaterThan(0);
    expect(even.length).toBeGreaterThan(0);
    expect(new Set([...odd, ...even]).size).toBe(1);
    expect(odd[0]).toBeLessThan(60);
  });

  test('a margin-positioned floating table moves with the text', () => {
    const layout = layoutSemanticDocument(body(tables('margin')), 1, { measurer, ...MIRROR });
    const { odd, even } = tablesBySide(layout);
    expect(even.length).toBeGreaterThan(0);
    expect(even[0]).toBeCloseTo(odd[0]! - 50, 5);
  });

  test('a two-column section keeps its columns inside the mirrored content box', () => {
    const layout = layoutSemanticDocument(
      body(lines(40) + sectPr('<w:cols w:num="2" w:space="100"/>')),
      1,
      { measurer, ...MIRROR }
    );
    expect(layout.pages.slice(0, 2).map(contentLeft)).toEqual([60, 10]);
    const columnsOf = (page: PageRecord) => [
      ...new Set(page.fragments.map((fragment) => fragment.box.x)),
    ];
    // Column origins are relative to the content box, so both pages have the same two.
    expect(columnsOf(layout.pages[1]!)).toEqual(columnsOf(layout.pages[0]!));
    expect(columnsOf(layout.pages[0]!)).toHaveLength(2);
  });

  test('page borders measured from the text follow the mirrored text', () => {
    const borders =
      '<w:pgBorders w:offsetFrom="text">' +
      ['top', 'left', 'bottom', 'right']
        .map((side) => `<w:${side} w:val="single" w:sz="8" w:space="4" w:color="000000"/>`)
        .join('') +
      '</w:pgBorders>';
    const layout = layoutSemanticDocument(body(lines(14) + sectPr(borders)), 1, {
      measurer,
      ...MIRROR,
    });
    const leftEdge = (page: PageRecord) =>
      page.pageBorders?.strokes.find((stroke) => stroke.side === 'left')?.box.x;
    const [odd, even] = layout.pages.slice(0, 2).map(leftEdge);
    expect(odd).toBeDefined();
    expect(even).toBe(odd! - 50);
  });
});

describe('a continuous section on a mirrored even page', () => {
  // Section one ends on page 2. Section two continues there with a page-positioned table.
  const continued = (numbering = '') =>
    lines(10) +
    p('end', sectPr()) +
    table('page') +
    lines(3, 'more') +
    sectPr(`<w:type w:val="continuous"/>${numbering}`);
  const layoutOf = (inner: string): SemanticLayout =>
    layoutSemanticDocument(body(inner), 1, { measurer, ...MIRROR });

  test('the table resolves against the side of the page it is on', () => {
    const layout = layoutOf(continued());
    expect(layout.pages.map(contentLeft)).toEqual([60, 10]);
    expect(tableLefts(layout.pages[1]!)).toEqual([19.45]);
  });

  test('a numbering restart does not move the shared page to the other side', () => {
    // The section restarts at an odd number, but its first page is the even host sheet.
    const layout = layoutOf(continued('<w:pgNumType w:start="5"/>'));
    expect(layout.pages.map(contentLeft)).toEqual([60, 10]);
    expect(tableLefts(layout.pages[1]!)).toEqual([19.45]);
  });
});

describe('header content positioned on a mirrored page', () => {
  function layoutWithHeader(inner: string): SemanticLayout {
    const document = body(lines(40) + sectPr('', 4000, 1000));
    const header = load(`<w:hdr xmlns:w="${W}">${inner}${p('HEAD')}</w:hdr>`, '/word/header1.xml');
    const section = enumerateDocumentSections(document)[0]!;
    const geometry = geometryOfSection(section.properties, { mirrorMargins: true });
    const story = layoutHeaderFooterStory(
      header,
      geometry.width - geometry.margin.left - geometry.margin.right,
      measurer,
      'header',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        pageNumber: 1,
        pageWidth: geometry.width,
        pageHeight: geometry.height,
        marginLeft: geometry.margin.left,
        marginRight: geometry.margin.right,
        marginTop: geometry.margin.top,
        marginBottom: geometry.margin.bottom,
        storyDistance: geometry.headerDistance ?? 0,
      }
    );
    const furniture: PageFurniture = {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default', story]]),
      footers: new Map(),
    };
    return layoutSemanticDocument(document, 1, {
      measurer,
      sectionFurniture: [furniture],
      ...MIRROR,
    });
  }

  /** Sheet x of the header's first fragment that is not at the story origin, else the origin. */
  const positionedLeft = (page: PageRecord): number => {
    const story = page.header!;
    const moved = story.fragments.find((fragment) => fragment.box.x !== 0);
    return Math.round((story.box.x - page.box.x + (moved?.box.x ?? 0)) * 100) / 100;
  };

  for (const [name, inner] of [
    ['floating table', table('page')],
    ['text frame', frame('page')],
  ] as const) {
    test(`a page-positioned ${name} keeps its distance to the sheet edge`, () => {
      const layout = layoutWithHeader(inner);
      const [odd, even] = layout.pages.slice(0, 2);
      expect([contentLeft(odd!), contentLeft(even!)]).toEqual([60, 10]);
      expect(odd!.header!.box.x - odd!.box.x).toBe(60);
      expect(even!.header!.box.x - even!.box.x).toBe(10);
      expect(positionedLeft(even!)).toBe(positionedLeft(odd!));
      expect(positionedLeft(odd!)).toBeLessThan(60);
    });
  }

  test('a margin-positioned floating table moves with the header text', () => {
    const layout = layoutWithHeader(table('margin'));
    const [odd, even] = layout.pages.slice(0, 2);
    expect(positionedLeft(even!)).toBeCloseTo(positionedLeft(odd!) - 50, 5);
  });
});
