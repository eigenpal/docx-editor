// Side margins on facing pages.
//
// `w:mirrorMargins` (CT_OnOff, ECMA-376 Part 1 §17.15.1.57) swaps the left and right margins
// of `w:pgMar` (CT_PageMar, §17.6.11) on every second page: the pages with an even displayed
// number. The gutter (`w:pgMar/@w:gutter`) is binding allowance on the inside edge, so on
// facing pages (`w:mirrorMargins` or `w:evenAndOddHeaders`, §17.10.1) an even page has it on
// the right. Both pages have the same content width, so no line breaks differently; only the
// content box, the header and the footer move. Caret geometry, hit testing and selection read
// the content box, so they follow.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  caretAt,
  createFixedMeasurer,
  createLayoutSession,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type LayoutSession,
  type PageFurniture,
  type SemanticLayout,
  type SemanticLayoutOptions,
} from '../index.ts';
import { hitTestSheet } from '../semantic-hit-test.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const p = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

// A 300pt x 120pt sheet: left 60pt, right 10pt, gutter 10pt. Seven 14pt lines fit a page.
const sectPr = (extra = '', gutter = 200) =>
  `<w:sectPr><w:pgSz w:w="6000" w:h="2400"/><w:pgMar w:top="200" w:right="200" w:bottom="200" ` +
  `w:left="1200" w:header="0" w:footer="0" w:gutter="${gutter}"/>${extra}</w:sectPr>`;

/** `count` one-line paragraphs: seven to a page. */
const lines = (count: number, prefix = 'line') =>
  Array.from({ length: count }, (_, index) => p(`${prefix}${index}`)).join('');

const MIRROR = { pageMarginSettings: { mirrorMargins: true } } as const;

const lay = (
  body: string,
  options: Partial<SemanticLayoutOptions> = {},
  revision = 1
): SemanticLayout => layoutSemanticDocument(load(body), revision, { measurer, ...options });

const contentLefts = (layout: SemanticLayout) =>
  layout.pages.map((page) => page.contentBox.x - page.box.x);
const contentRights = (layout: SemanticLayout) =>
  layout.pages.map(
    (page) => page.box.width - (page.contentBox.x - page.box.x) - page.contentBox.width
  );

function headerFurniture(evenAndOddHeaders: boolean): PageFurniture {
  const part = readOoxmlPart(`<w:hdr xmlns:w="${W}">${p('HEAD')}</w:hdr>`, {
    name: '/word/header1.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  });
  if (!part.ok) throw new Error(part.reason);
  const story = layoutHeaderFooterStory(part.part, 220, measurer, 'header');
  return {
    titlePage: false,
    evenAndOddHeaders,
    headers: new Map([
      ['default', story],
      ['even', story],
    ]),
    footers: new Map(),
  };
}

describe('mirrored side margins', () => {
  test('pages with an even number swap the left and right margins', () => {
    const layout = lay(lines(21) + sectPr(), MIRROR);
    expect(layout.pages).toHaveLength(3);
    // Odd: left 60 + gutter 10. Even: the right margin on the left, the gutter on the right.
    expect(contentLefts(layout)).toEqual([70, 10, 70]);
    expect(contentRights(layout)).toEqual([10, 70, 10]);
    expect(layout.pages.map((page) => page.contentBox.width)).toEqual([220, 220, 220]);
  });

  test('without the setting every page keeps its margins and the gutter on the left', () => {
    const layout = lay(lines(21) + sectPr());
    expect(contentLefts(layout)).toEqual([70, 70, 70]);
    expect(contentRights(layout)).toEqual([10, 10, 10]);
  });

  test('equal side margins and no gutter leave nothing to mirror', () => {
    const symmetric =
      '<w:sectPr><w:pgSz w:w="6000" w:h="2400"/><w:pgMar w:top="200" w:right="600" ' +
      'w:bottom="200" w:left="600" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
    expect(contentLefts(lay(lines(21) + symmetric, MIRROR))).toEqual([30, 30, 30]);
  });

  test('the first page is mirrored when the numbering starts at an even number', () => {
    const layout = lay(lines(21) + sectPr('<w:pgNumType w:start="2"/>'), MIRROR);
    expect(contentLefts(layout)).toEqual([10, 70, 10]);
  });

  test('the header and the footer band move with the body', () => {
    const furniture = headerFurniture(false);
    const layout = lay(lines(14) + sectPr(), { ...MIRROR, sectionFurniture: [furniture] });
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) {
      expect(page.header?.box.x).toBe(page.contentBox.x);
      expect(page.header?.box.width).toBe(page.contentBox.width);
    }
    expect(contentLefts(layout).slice(0, 2)).toEqual([70, 10]);
  });

  test('each section mirrors its own margins', () => {
    const second =
      '<w:sectPr><w:pgSz w:w="6000" w:h="2400"/><w:pgMar w:top="200" w:right="1600" ' +
      'w:bottom="200" w:left="400" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
    const layout = lay(lines(13) + p('end', sectPr()) + lines(14, 'next') + second, MIRROR);
    // Pages 1 and 2 are the first section; pages 3 and 4 the second (left 20, right 80).
    expect(contentLefts(layout)).toEqual([70, 10, 20, 80]);
    expect(contentRights(layout)).toEqual([10, 70, 80, 20]);
  });

  test('a section that restarts its numbering starts on a sheet of that parity', () => {
    const layout = lay(
      lines(6) + p('end', sectPr()) + lines(14, 'next') + sectPr('<w:pgNumType w:start="1"/>'),
      MIRROR
    );
    // Page 1, a blank even sheet, then pages 1 and 2 of the restarted section.
    expect(layout.pages.map((page) => page.parityBlank === true)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect([0, 2, 3].map((index) => contentLefts(layout)[index])).toEqual([70, 70, 10]);
  });
});

describe('the gutter on facing pages', () => {
  test('even and odd headers put the gutter of an even page on the right', () => {
    const layout = lay(lines(21) + sectPr(), { evenAndOddHeaders: true });
    // The margins do not swap: only the gutter changes side.
    expect(contentLefts(layout)).toEqual([70, 60, 70]);
    expect(contentRights(layout)).toEqual([10, 20, 10]);
  });

  test('even and odd headers without a gutter move nothing', () => {
    const layout = lay(lines(21) + sectPr('', 0), { evenAndOddHeaders: true });
    expect(contentLefts(layout)).toEqual([60, 60, 60]);
  });

  test('a right-side gutter is on the left of an even facing page', () => {
    const rtl = sectPr('<w:rtlGutter/>');
    expect(contentLefts(lay(lines(21) + rtl))).toEqual([60, 60, 60]);
    expect(contentRights(lay(lines(21) + rtl))).toEqual([20, 20, 20]);
    expect(contentLefts(lay(lines(21) + rtl, { evenAndOddHeaders: true }))).toEqual([60, 70, 60]);
    // Mirrored: the right margin (10) is on the left of the even page, with the gutter.
    expect(contentLefts(lay(lines(21) + rtl, MIRROR))).toEqual([60, 20, 60]);
  });

  test('a gutter at the top adds to the top margin and stops the mirroring', () => {
    const layout = lay(lines(21) + sectPr(), {
      pageMarginSettings: { mirrorMargins: true, gutterAtTop: true },
    });
    for (const page of layout.pages) {
      expect(page.contentBox.x - page.box.x).toBe(60);
      expect(page.contentBox.y - page.box.y).toBe(20);
    }
  });
});

describe('facing pages of a restarted section', () => {
  const restarted =
    lines(6) + p('end', sectPr()) + lines(14, 'next') + sectPr('<w:pgNumType w:start="1"/>');
  const blanks = (layout: SemanticLayout) => layout.pages.map((page) => page.parityBlank === true);

  test('mirrored margins alone do not add a sheet without a restart', () => {
    const layout = lay(lines(6) + p('end', sectPr()) + lines(14, 'next') + sectPr(), MIRROR);
    expect(blanks(layout)).toEqual([false, false, false]);
  });

  test('without the setting a restart adds no sheet', () => {
    expect(blanks(lay(restarted))).toEqual([false, false, false]);
  });

  test('a gutter at the top stops the mirroring but keeps the facing pages', () => {
    const layout = lay(restarted, {
      pageMarginSettings: { mirrorMargins: true, gutterAtTop: true },
    });
    expect(blanks(layout)).toEqual([false, true, false, false]);
    expect(new Set(contentLefts(layout))).toEqual(new Set([60]));
  });
});

describe('editing on a mirrored page', () => {
  const firstLineOf = (layout: SemanticLayout, pageIndex: number) => {
    const page = layout.pages[pageIndex]!;
    const fragment = page.fragments.find((entry) => entry.kind === 'paragraph');
    if (!fragment || fragment.kind !== 'paragraph') throw new Error('no paragraph');
    return { page, fragment };
  };

  test('the caret and a click resolve against the mirrored content box', () => {
    const layout = lay(lines(21) + sectPr(), MIRROR);
    const { page, fragment } = firstLineOf(layout, 1);
    const caret = caretAt(layout, { paragraphId: fragment.paragraphId, offset: 0 }, measurer);
    expect(caret?.pageIndex).toBe(1);
    // Caret geometry is relative to the content box, which starts 10pt from the sheet edge.
    expect(page.contentBox.x + (caret?.x ?? Number.NaN)).toBe(10);

    // A click on the first glyph of the line, in sheet coordinates.
    const y = page.contentBox.y + 4;
    const hit = hitTestSheet(layout, { x: page.contentBox.x + 1, y }, { measurer });
    expect(hit?.position).toEqual({ paragraphId: fragment.paragraphId, offset: 0 });
    // The same click 60pt to the right, where an odd page starts its lines, is past the text.
    const pastText = hitTestSheet(layout, { x: 70 + 1, y }, { measurer });
    expect(pastText?.position).toEqual({ paragraphId: fragment.paragraphId, offset: 5 });
  });

  const shapeOf = (layout: SemanticLayout): string =>
    JSON.stringify(
      layout.pages.map((page) => ({
        index: page.index,
        box: page.box,
        contentBox: page.contentBox,
        header: page.header?.box,
        blank: page.parityBlank === true,
        fragments: page.fragments.map((fragment) => ({
          id: fragment.id,
          box: fragment.box,
          lines:
            fragment.kind === 'paragraph'
              ? fragment.lines.map((line) => ({ id: line.id, box: line.box, spans: line.spans }))
              : [],
        })),
      }))
    );

  const incremental = (
    before: string,
    after: string,
    options: Partial<SemanticLayoutOptions>
  ): { session: LayoutSession; edited: SemanticLayout; fresh: SemanticLayout } => {
    const session = createLayoutSession();
    lay(before, { ...options, session }, 1);
    const edited = lay(after, { ...options, session }, 2);
    return { session, edited, fresh: lay(after, options, 2) };
  };

  test('a paragraph that moves to an even page takes that page origin', () => {
    const furniture = headerFurniture(false);
    const options = { ...MIRROR, sectionFurniture: [furniture] };
    const before = lines(18) + sectPr();
    // One more paragraph at the top moves the last line of each page to the next page.
    const after = p('inserted') + lines(18) + sectPr();
    const { edited, fresh } = incremental(before, after, options);
    expect(shapeOf(edited)).toBe(shapeOf(fresh));
    expect(contentLefts(edited).slice(0, 2)).toEqual([70, 10]);
    const moved = firstLineOf(edited, 1);
    expect(moved.page.contentBox.x + moved.fragment.box.x).toBe(10);
  });

  test('an edit that adds a page keeps every later page on its own side', () => {
    const before = lines(21) + sectPr();
    const after = lines(4) + lines(7, 'added') + lines(17, 'tail') + sectPr();
    const { edited, fresh } = incremental(before.replace(/line(\d+)/g, 'tail$1'), after, MIRROR);
    expect(shapeOf(edited)).toBe(shapeOf(fresh));
    expect(contentLefts(edited)).toEqual([70, 10, 70, 10]);
  });

  test('an edit in the first section moves a later section to the other parity', () => {
    const tail = lines(14, 'next') + sectPr();
    const before = lines(6) + p('end', sectPr()) + tail;
    const after = lines(13) + p('end', sectPr()) + tail;
    for (const options of [MIRROR, { evenAndOddHeaders: true }]) {
      const { edited, fresh } = incremental(before, after, options);
      expect(shapeOf(edited)).toBe(shapeOf(fresh));
      // The second section now starts on page 3, an odd page.
      expect(contentLefts(edited)[2]).toBe(70);
      expect(contentLefts(edited)[3]).not.toBe(70);
    }
  });

  test('a pass with no change returns the same pages', () => {
    const session = createLayoutSession();
    const part = load(lines(21) + sectPr());
    const first = layoutSemanticDocument(part, 1, { measurer, ...MIRROR, session });
    const second = layoutSemanticDocument(part, 2, { measurer, ...MIRROR, session });
    expect(second.pages.map((page, index) => page === first.pages[index])).toEqual([
      true,
      true,
      true,
    ]);
  });
});
