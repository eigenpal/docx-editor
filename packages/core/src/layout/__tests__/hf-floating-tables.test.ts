import { describe, expect, test } from 'bun:test';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { bodyParagraphBreakKey } from '../paragraph-break-request.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';
import { load, layoutContext, squareAnchorAtLeft } from './anchored-drawing-test-fixtures.ts';

const measurer = createFixedMeasurer(6, 14);
const OWNER = '/word/header1.xml';
/** `w:tblpX`/`w:tblpY` twips carry a one-twip storage bias (MS-OE376 2.1.163e). */
const offsetPt = (twips: number) => (twips - 1) / 20;
const PAGE = {
  pageNumber: 1,
  pageWidth: 612,
  pageHeight: 792,
  marginLeft: 72,
  marginRight: 72,
  marginTop: 144,
  marginBottom: 72,
};
const PAGE_ANCHOR =
  '<w:tblpPr w:vertAnchor="page" w:horzAnchor="page" w:tblpX="6238" w:tblpY="2723"/>';
// The picture fixture's root carries the drawing namespaces; its first run is the picture.
const PICTURE_XML = squareAnchorAtLeft({ text: '' });
const ROOT_ATTRIBUTES = PICTURE_XML.slice('<w:document'.length, PICTURE_XML.indexOf('>'));
const PICTURE_RUN = PICTURE_XML.slice(
  PICTURE_XML.indexOf('<w:r><w:drawing>'),
  PICTURE_XML.indexOf('</w:drawing></w:r>') + '</w:drawing></w:r>'.length
);

const table = (tblpPr: string, cell = '<w:r><w:t>Ref</w:t></w:r>') =>
  `<w:tbl><w:tblPr>${tblpPr}<w:tblW w:w="2000" w:type="dxa"/></w:tblPr>` +
  '<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
  `<w:p>${cell}</w:p></w:tc></w:tr></w:tbl>`;

/** A header of `blocks` followed by a `Title` paragraph, laid out on {@link PAGE}. */
function header(
  blocks: string,
  options: {
    readonly storyTop?: number;
    readonly storyDistance?: number;
    readonly footer?: boolean;
  } = { storyTop: 36 }
) {
  const tag = options.footer ? 'ftr' : 'hdr';
  const part = load(
    `<w:${tag}${ROOT_ATTRIBUTES}>${blocks}<w:p><w:r><w:t>Title</w:t></w:r></w:p></w:${tag}>`,
    options.footer ? '/word/footer1.xml' : OWNER
  );
  const story = layoutHeaderFooterStory(
    part,
    468,
    measurer,
    'test',
    undefined,
    undefined,
    options.storyTop === undefined
      ? undefined
      : { pageNumber: 1, pageCount: 1, storyTop: options.storyTop },
    128,
    undefined,
    undefined,
    layoutContext(part, OWNER),
    undefined,
    undefined,
    {
      ...PAGE,
      ...(options.storyDistance !== undefined ? { storyDistance: options.storyDistance } : {}),
    }
  );
  const tables = story.fragments.filter((f) => f.kind === 'table') as TableFragmentRecord[];
  const title = story.fragments.find((f) => f.kind === 'paragraph') as ParagraphFragmentRecord;
  return { story, table: tables[0]!, tables, title };
}

// A top-level `tblpPr` table in a header sits at its anchor position, and the blocks after it
// start where the table would have started.
describe('floating tables in a header', () => {
  test('a page-anchored table sits at its page position, outside the header flow', () => {
    const { story, table: placed, title } = header(table(PAGE_ANCHOR));
    // Story coordinates: x from the left margin, y from the header top at 36pt.
    expect(placed.box.x).toBeCloseTo(offsetPt(6238) - 72, 3);
    expect(placed.box.y).toBeCloseTo(offsetPt(2723) - 36, 3);
    expect((placed as { outOfFlow?: true }).outOfFlow).toBe(true);
    expect(title.box.y).toBe(0);
    expect(story.flowHeight).toBeCloseTo(title.box.height, 3);
  });

  test('a margin-anchored table measures from the top margin', () => {
    const { table: placed } = header(
      table('<w:tblpPr w:vertAnchor="margin" w:horzAnchor="margin" w:tblpX="200" w:tblpY="400"/>')
    );
    expect(placed.box.x).toBeCloseTo(offsetPt(200), 3);
    expect(placed.box.y).toBeCloseTo(144 - 36 + offsetPt(400), 3);
  });

  test('a text-anchored table measures from the next block in flow', () => {
    const textAnchor =
      '<w:tblpPr w:vertAnchor="text" w:horzAnchor="text" w:tblpX="0" w:tblpY="200"/>';
    const { tables, title } = header(table(textAnchor) + table(PAGE_ANCHOR));
    expect(title.box.y).toBe(0);
    // The page-anchored table between them floats too, so `Title` is the anchor.
    expect(tables[0]!.box.y).toBeCloseTo(offsetPt(200), 3);
  });

  test('a picture inside a floating table is still published', () => {
    const { story } = header(table(PAGE_ANCHOR, PICTURE_RUN));
    expect(story.anchoredDrawings).toHaveLength(1);
  });

  test('the story distance places the table before any page context exists', () => {
    const { story, table: placed, title } = header(table(PAGE_ANCHOR), { storyDistance: 36 });
    expect(placed.box.y).toBeCloseTo(offsetPt(2723) - 36, 3);
    expect((placed as { outOfFlow?: true }).outOfFlow).toBe(true);
    expect(title.box.y).toBe(0);
    expect(story.flowHeight).toBeCloseTo(title.box.height, 3);
  });

  test('a footer measures its top edge from the sheet bottom', () => {
    const { table: placed, title } = header(
      table('<w:tblpPr w:vertAnchor="page" w:horzAnchor="page" w:tblpX="1440" w:tblpY="15000"/>'),
      { storyDistance: 36, footer: true }
    );
    // The footer's flow is the title alone, so its top edge is 36pt plus that height up.
    const footerTop = 792 - 36 - title.box.height;
    expect(placed.box.y).toBeCloseTo(offsetPt(15000) - footerTop, 3);
  });

  test('without page geometry the table stays in the flow', () => {
    const { table: placed, title } = header(table(PAGE_ANCHOR), {});
    expect(placed.box.y).toBe(0);
    expect(title.box.y).toBeGreaterThan(0);
  });
});

describe('body break key and spacing before', () => {
  const key = (spaceBefore: number, anchorsTopAndBottom: boolean) =>
    bodyParagraphBreakKey('k', {
      exclusionToken: '',
      paragraphStartY: 100,
      paragraphSpaceBefore: spaceBefore,
      anchorsTopAndBottom,
      columnIndex: 0,
      startOffset: 0,
    });

  test('a paragraph with its own topAndBottom band keys its spacing before', () => {
    expect(key(12, true)).not.toBe(key(0, true));
  });

  test('other paragraphs keep the base key', () => {
    expect(key(12, false)).toBe('k');
  });
});
