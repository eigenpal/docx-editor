// A top-level table row does not wrap its cell text beside a float that crosses the table. The
// row moves below the float's wrap band, with the rows after it, on the first page and on every
// continuation page. Paragraphs still wrap beside the same float, and a table that stays clear
// of the float horizontally does not move.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type PageFurniture,
  type SemanticLayout,
} from '../index.ts';
import {
  layoutContext,
  load as loadDrawingPart,
  squareAnchorAtLeft,
} from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const EMU_PER_PT = 12700;
const HEADER = '/word/header1.xml';

type Story = ReturnType<typeof layoutHeaderFooterStory>;
type Fragment = SemanticLayout['pages'][number]['fragments'][number];
type TableFragment = Extract<Fragment, { kind: 'table' }>;

interface Picture {
  /** Page x of the picture's left edge. */
  readonly x: number;
  /** Page y of the picture's top edge. */
  readonly y: number;
  readonly size: number;
  readonly wrap?: 'square' | 'topAndBottom' | 'none' | 'tightTopHalf';
  readonly distB?: number;
}

/** A header whose only content is one picture anchored to page coordinates. */
function pictureHeader(picture: Picture): Story {
  let xml = squareAnchorAtLeft({ text: '' })
    .replace('<w:document ', '<w:hdr ')
    .replace('<w:body>', '')
    .replace('</w:body></w:document>', '</w:hdr>')
    .replace(
      'relativeFrom="column"><wp:posOffset>0',
      `relativeFrom="page"><wp:posOffset>${picture.x * EMU_PER_PT}`
    )
    .replace(
      'relativeFrom="paragraph"><wp:posOffset>0',
      `relativeFrom="page"><wp:posOffset>${picture.y * EMU_PER_PT}`
    )
    .replaceAll('cx="1828800"', `cx="${picture.size * EMU_PER_PT}"`)
    .replaceAll('cy="914400"', `cy="${picture.size * EMU_PER_PT}"`);
  if (picture.distB !== undefined)
    xml = xml.replaceAll('distB="0" distL="0"', `distB="${picture.distB * EMU_PER_PT}" distL="0"`);
  if (picture.wrap === 'topAndBottom')
    xml = xml.replace(/<wp:wrapSquare [^>]*\/>/, '<wp:wrapTopAndBottom/>');
  if (picture.wrap === 'none') xml = xml.replace(/<wp:wrapSquare [^>]*\/>/, '<wp:wrapNone/>');
  if (picture.wrap === 'tightTopHalf')
    xml = xml.replace(
      /<wp:wrapSquare [^>]*\/>/,
      '<wp:wrapTight wrapText="bothSides"><wp:wrapPolygon edited="0"><wp:start x="0" y="0"/>' +
        '<wp:lineTo x="0" y="10800"/><wp:lineTo x="21600" y="10800"/><wp:lineTo x="21600" y="0"/>' +
        '<wp:lineTo x="0" y="0"/></wp:wrapPolygon></wp:wrapTight>'
    );
  const part = loadDrawingPart(xml, HEADER);
  return layoutHeaderFooterStory(
    part,
    468,
    measurer,
    HEADER,
    undefined,
    undefined,
    undefined,
    128,
    undefined,
    undefined,
    layoutContext(part, HEADER),
    undefined,
    undefined,
    {
      pageNumber: 1,
      pageWidth: 612,
      pageHeight: 792,
      marginLeft: 72,
      marginRight: 72,
      marginTop: 72,
      marginBottom: 72,
    }
  );
}

const SECT =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
  '</w:sectPr>';

const paragraph = (text: string) =>
  `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const cell = (width: number, texts: readonly string[]) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${texts.map(paragraph).join('')}</w:tc>`;

interface TableOptions {
  readonly rows: number;
  /** Total width in twips, split over two equal columns. */
  readonly width?: number;
  readonly headerRow?: boolean;
  readonly cantSplit?: boolean;
  /** One-line paragraphs in each row's first cell. */
  readonly linesPerRow?: number;
}

function table(options: TableOptions): string {
  const width = options.width ?? 9360;
  const half = width / 2;
  const rowXml = (index: number, header: boolean) => {
    const properties =
      (header ? '<w:tblHeader/>' : '') + (options.cantSplit && !header ? '<w:cantSplit/>' : '');
    const label = header ? 'head' : `r${index}`;
    const lines = Array.from({ length: options.linesPerRow ?? 1 }, () => label);
    return (
      `<w:tr>${properties ? `<w:trPr>${properties}</w:trPr>` : ''}` +
      cell(half, lines) +
      cell(half, [label]) +
      '</w:tr>'
    );
  };
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
    `</w:tblPr><w:tblGrid><w:gridCol w:w="${half}"/><w:gridCol w:w="${half}"/></w:tblGrid>` +
    (options.headerRow ? rowXml(0, true) : '') +
    Array.from({ length: options.rows }, (_unused, index) => rowXml(index + 1, false)).join('') +
    '</w:tbl>'
  );
}

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}${SECT}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function lay(body: string, header?: Story): SemanticLayout {
  const furniture: PageFurniture = {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map(header ? [['default', header]] : []) as PageFurniture['headers'],
    footers: new Map(),
  };
  return layoutSemanticDocument(load(body), 1, { measurer, sectionFurniture: [furniture] });
}

function tablesOn(layout: SemanticLayout, page: number): TableFragment[] {
  return layout.pages[page]!.fragments.filter(
    (fragment): fragment is TableFragment => fragment.kind === 'table'
  );
}

/** The one square picture every case uses: page x 390..540, page y 20..170 (content -52..98). */
const RIGHT_LOGO: Picture = { x: 390, y: 20, size: 150 };
const LOGO_BOTTOM = 98;

describe('a table that crosses a wrapping float', () => {
  test('starts below the header picture on the first page', () => {
    const layout = lay(table({ rows: 10 }), pictureHeader(RIGHT_LOGO));
    const [fragment] = tablesOn(layout, 0);
    expect(fragment!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
    expect(fragment!.rows[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
  });

  test('continues below the header picture on every continuation page', () => {
    const layout = lay(table({ rows: 90 }), pictureHeader(RIGHT_LOGO));
    expect(layout.pages.length).toBeGreaterThan(2);
    for (let page = 0; page < layout.pages.length; page += 1) {
      for (const fragment of tablesOn(layout, page))
        expect(fragment.rows[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
    }
  });

  test('places a repeated header row below the picture', () => {
    const layout = lay(table({ rows: 90, headerRow: true }), pictureHeader(RIGHT_LOGO));
    const [continued] = tablesOn(layout, 1);
    expect(continued!.rows[0]!.isHeaderRepeat).toBe(true);
    expect(continued!.rows[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
  });

  test('never paints a row across the picture band', () => {
    const layout = lay(
      table({ rows: 90, cantSplit: true, linesPerRow: 40 }),
      pictureHeader(RIGHT_LOGO)
    );
    for (let page = 0; page < layout.pages.length; page += 1) {
      for (const fragment of tablesOn(layout, page))
        for (const row of fragment.rows)
          expect(row.box.y).toBeGreaterThanOrEqual(LOGO_BOTTOM - 0.001);
    }
  });

  test('keeps the wrap distance below the picture', () => {
    const layout = lay(table({ rows: 10 }), pictureHeader({ ...RIGHT_LOGO, distB: 12 }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(LOGO_BOTTOM + 12, 3);
  });

  test('clears a top-and-bottom picture the same way', () => {
    const layout = lay(table({ rows: 10 }), pictureHeader({ ...RIGHT_LOGO, wrap: 'topAndBottom' }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
  });

  test('moves only the rows that reach the band below a paragraph', () => {
    // Five 14pt lines end at 70; the first row (70..84) crosses the band that ends at 98.
    const body = [1, 2, 3, 4, 5].map((index) => paragraph(`p${index}`)).join('');
    const layout = lay(body + table({ rows: 10 }), pictureHeader(RIGHT_LOGO));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(LOGO_BOTTOM, 3);
  });
});

describe('a table below a body float', () => {
  /** A paragraph with a 144pt by 72pt square picture at content x 0, then `after`. */
  function withBodyFloat(after: string): SemanticLayout {
    const xml = squareAnchorAtLeft({ text: 'lead' }).replace(
      '</w:body>',
      `${after}${SECT}</w:body>`
    );
    const part = loadDrawingPart(xml);
    return layoutSemanticDocument(part, 1, { measurer, inlineDrawingLayout: layoutContext(part) });
  }

  test('starts below a float anchored before it', () => {
    const layout = withBodyFloat(table({ rows: 4 }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(72, 3);
  });

  test('stays beside the float when it starts clear of it horizontally', () => {
    const narrow = table({ rows: 4, width: 4000 }).replace(
      '<w:tblLayout',
      '<w:tblInd w:w="4000" w:type="dxa"/><w:tblLayout'
    );
    const layout = withBodyFloat(narrow);
    expect(tablesOn(layout, 0)[0]!.box.y).toBeLessThan(72);
  });
});

describe('bounded clearance', () => {
  test('a tight outline ends the band at its polygon, not at the picture extent', () => {
    // The polygon covers the top half: page y 20..95, content y -52..23.
    const layout = lay(table({ rows: 10 }), pictureHeader({ ...RIGHT_LOGO, wrap: 'tightTopHalf' }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(23, 3);
  });

  test('a band that reaches the page bottom moves nothing', () => {
    const layout = lay(table({ rows: 10 }), pictureHeader({ ...RIGHT_LOGO, size: 750 }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(0, 3);
  });

  test('a kept row that fits a page but not below the picture keeps its place', () => {
    // 45 lines of 12.727pt exceed the 550pt below the picture but fit the 648pt page.
    const layout = lay(
      table({ rows: 3, cantSplit: true, linesPerRow: 45 }),
      pictureHeader(RIGHT_LOGO)
    );
    expect(layout.pages).toHaveLength(3);
    for (let page = 0; page < 3; page += 1)
      expect(tablesOn(layout, page)[0]!.rows[0]!.box.y).toBeCloseTo(0, 3);
  });
});

describe('controls that keep their layout', () => {
  test('a table clear of the picture horizontally starts at the content top', () => {
    // 4000 twips = 200pt wide; the picture starts at content x 318.
    const layout = lay(table({ rows: 10, width: 4000 }), pictureHeader(RIGHT_LOGO));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(0, 3);
  });

  test('a wrap-none picture does not move the table', () => {
    const layout = lay(table({ rows: 10 }), pictureHeader({ ...RIGHT_LOGO, wrap: 'none' }));
    expect(tablesOn(layout, 0)[0]!.box.y).toBeCloseTo(0, 3);
  });

  test('paragraphs still wrap beside the picture', () => {
    const body = [1, 2, 3].map((index) => paragraph(`p${index}`)).join('');
    const layout = lay(body, pictureHeader(RIGHT_LOGO));
    const first = layout.pages[0]!.fragments[0]!;
    expect(first.kind).toBe('paragraph');
    expect(first.box.y).toBeCloseTo(0, 3);
  });

  test('a table without a wrapping float keeps the content top', () => {
    const layout = lay(table({ rows: 90 }));
    for (let page = 0; page < layout.pages.length; page += 1)
      expect(tablesOn(layout, page)[0]!.box.y).toBeCloseTo(0, 3);
  });
});
