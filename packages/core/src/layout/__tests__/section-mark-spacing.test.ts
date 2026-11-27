// Paragraph spacing around an empty paragraph that only carries a section mark, before a
// continuous section (`w:sectPr`, `CT_SectPr`, ECMA-376 Part 1 §17.6.18; `w:type`,
// `CT_SectType`, §17.6.22; `w:spacing`, `CT_Spacing`, §17.3.1.33).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
import type { ParagraphFragmentRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

// One line is 14pt high.
const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, compatibilityMode?: number) =>
  layoutSemanticDocument(part, 1, { measurer, compatibilityMode });

// 200pt wide and 300pt high sheets with 10pt margins.
const sect = (type = '') =>
  `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="4000" w:h="6000"/>` +
  '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200" ' +
  'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

const spacing = (before: number, after: number) =>
  `<w:spacing w:before="${before * 20}" w:after="${after * 20}"/>`;
const paragraph = (text: string, before = 0, after = 0) =>
  `<w:p><w:pPr>${spacing(before, after)}</w:pPr>` +
  `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
/** The run properties of a paragraph mark at the size of the text, so its line is 14pt too. */
const SIZED = '<w:rPr><w:sz w:val="22"/></w:rPr>';
/** An empty paragraph that carries the mark of the first section. */
const mark = (before = 0, after = 0, extra = SIZED) =>
  `<w:p><w:pPr>${spacing(before, after)}${extra}${sect()}</w:pPr></w:p>`;
const HIDDEN = '<w:rPr><w:vanish/></w:rPr>';
const table =
  '<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/>' +
  '</w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' +
  `${paragraph('cell')}</w:tc></w:tr></w:tbl>`;

/** `one`, the mark, `two` in a continuous section, and the gap between the two lines. */
const body = (afterOne: number, markXml: string, beforeTwo: number, type = 'continuous') =>
  paragraph('one', 0, afterOne) + markXml + paragraph('two', beforeTwo) + sect(type);

const paragraphs = (layout: SemanticLayout, page = 0): ParagraphFragmentRecord[] =>
  layout.pages[page]!.fragments.filter(
    (fragment): fragment is ParagraphFragmentRecord => fragment.kind === 'paragraph'
  );
const textOf = (fragment: ParagraphFragmentRecord): string =>
  fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('');
const lineTop = (layout: SemanticLayout, text: string, page = 0): number =>
  paragraphs(layout, page).find((fragment) => textOf(fragment) === text)!.lines[0]!.box.y;
/** The space between the line of `one` and the line of `two`. */
const gap = (part: OoxmlPart, compatibilityMode?: number): number => {
  const layout = lay(part, compatibilityMode);
  expect(layout.pages).toHaveLength(1);
  return lineTop(layout, 'two') - lineTop(layout, 'one') - 14;
};

describe('spacing around an empty section mark before a continuous section', () => {
  test('adds the space after above the mark and the space before below it', () => {
    // The mark takes no line. Its own space after is 0, so nothing collapses.
    for (const mode of [undefined, 12, 14, 15]) {
      expect(gap(load(body(6, mark(), 9)), mode)).toBe(6 + 9);
    }
  });

  test('collapses the next space before against the space after of the mark', () => {
    // The space after of the mark takes no room. The next paragraph adds the excess only.
    expect(gap(load(body(0, mark(0, 3), 12)))).toBe(12 - 3);
    expect(gap(load(body(12, mark(0, 6), 12)))).toBe(12 + 12 - 6);
    expect(gap(load(body(0, mark(0, 12), 6)))).toBe(0);
    expect(gap(load(body(6, mark(0, 24), 12)))).toBe(6);
  });

  test('ignores the space before and the line height of the mark', () => {
    expect(gap(load(body(12, mark(12, 0), 0)))).toBe(12);
    expect(gap(load(body(0, mark(12, 0), 9)))).toBe(9);
    const tall = '<w:rPr><w:sz w:val="96"/></w:rPr>';
    expect(gap(load(body(6, mark(0, 0, tall), 9)))).toBe(6 + 9);
  });

  test('keeps the larger of the two gaps across a hidden mark', () => {
    // A hidden mark joins the next paragraph and has no spacing of its own.
    expect(gap(load(body(6, mark(0, 12, HIDDEN), 9)))).toBe(9);
    expect(gap(load(body(6, mark(0, 0, HIDDEN), 9)))).toBe(9);
  });

  test('leaves a mark with text and a mark before a next-page section in the flow', () => {
    const text =
      `<w:p><w:pPr>${spacing(0, 12)}${sect()}</w:pPr>` +
      '<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>mark</w:t></w:r></w:p>';
    expect(gap(load(body(6, text, 9)))).toBe(6 + 14 + 12);
    // Before a next-page section the mark keeps its line. The space before of the new page's
    // first paragraph still collapses against the space after of the mark.
    for (const [after, top] of [
      [0, 9],
      [12, 0],
    ] as const) {
      const layout = lay(load(body(6, mark(0, after), 9, 'nextPage')));
      expect(layout.pages).toHaveLength(2);
      expect(paragraphs(layout).some((fragment) => fragment.outOfFlow)).toBe(false);
      expect(lineTop(layout, 'two', 1)).toBe(top);
    }
  });

  test('collapses the same way when a page break ends the paragraph before the mark', () => {
    const broken =
      '<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>one</w:t></w:r>' +
      '<w:r><w:br w:type="page"/></w:r></w:p>';
    for (const type of ['continuous', 'nextPage']) {
      for (const [after, top] of [
        [0, 9],
        [12, 0],
      ] as const) {
        const layout = lay(load(broken + mark(0, after) + paragraph('two', 9) + sect(type)));
        expect(layout.pages).toHaveLength(2);
        expect(lineTop(layout, 'two', 1)).toBe(top);
      }
    }
  });

  test('keeps the caret in the mark and matches a cold layout after an edit', () => {
    const session = createLayoutSession();
    layoutSemanticDocument(load(body(6, mark(0, 0), 9)), 1, { measurer, session });
    const edited = load(body(6, mark(0, 4), 9));
    const warm = layoutSemanticDocument(edited, 2, { measurer, session });
    const cold = layoutSemanticDocument(edited, 2, { measurer });
    expect(warm.pages).toEqual(cold.pages);
    expect(lineTop(warm, 'two') - lineTop(warm, 'one') - 14).toBe(6 + 9 - 4);
    const markFragment = paragraphs(warm).find((fragment) => fragment.outOfFlow)!;
    const caret = caretAt(warm, { paragraphId: markFragment.paragraphId, offset: 0 });
    expect(caret?.pageIndex).toBe(0);
    expect(caret?.height).toBeGreaterThan(0);
  });

  test('matches a cold layout when typing fills and clears the mark', () => {
    const typed =
      `<w:p><w:pPr>${spacing(0, 4)}${SIZED}${sect()}</w:pPr>` +
      '<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>x</w:t></w:r></w:p>';
    const session = createLayoutSession();
    const gaps = [mark(0, 4), typed, mark(0, 4)].map((markXml, revision) => {
      const part = load(body(6, markXml, 9));
      const warm = layoutSemanticDocument(part, revision, { measurer, session });
      expect(warm.pages).toEqual(layoutSemanticDocument(part, revision, { measurer }).pages);
      return lineTop(warm, 'two') - lineTop(warm, 'one') - 14;
    });
    // With text the mark is a paragraph in the flow: its line, then the larger gap below it.
    expect(gaps).toEqual([6 + 9 - 4, 6 + 14 + 9, 6 + 9 - 4]);
  });
});

describe('an empty section mark directly after a table', () => {
  const afterTable = (markXml: string, beforeTwo: number) =>
    load(table + markXml + paragraph('two', beforeTwo) + sect('continuous'));
  const twoTop = (part: OoxmlPart, mode?: number) => lineTop(lay(part, mode), 'two');
  // Where the next section starts when the mark takes no room and adds no spacing.
  const flush = twoTop(afterTable(mark(), 0), 14);

  test('keeps its line and its space after in compatibility mode 15', () => {
    expect(twoTop(afterTable(mark(), 0), 15)).toBe(flush + 14);
    expect(twoTop(afterTable(mark(), 9), 15)).toBe(flush + 14 + 9);
    // The larger of the mark's space after and the next space before.
    expect(twoTop(afterTable(mark(0, 12), 9), 15)).toBe(flush + 14 + 12);
    const layout = lay(afterTable(mark(), 0), 15);
    expect(paragraphs(layout).some((fragment) => fragment.outOfFlow)).toBe(false);
  });

  test('does not apply its space before in compatibility mode 15', () => {
    expect(twoTop(afterTable(mark(12, 0), 0), 15)).toBe(flush + 14);
  });

  test('takes no room in legacy compatibility modes', () => {
    for (const mode of [undefined, 12, 14]) {
      expect(twoTop(afterTable(mark(), 9), mode)).toBe(flush + 9);
      expect(twoTop(afterTable(mark(0, 12), 9), mode)).toBe(flush);
    }
  });

  test('keeps its line after a table positioned against the page', () => {
    const positioned = table.replace(
      '<w:tblPr>',
      '<w:tblPr><w:tblpPr w:vertAnchor="page" w:horzAnchor="margin" w:tblpX="1500" w:tblpY="4000"/>'
    );
    const part = load(
      paragraph('one') + positioned + mark(12, 0) + paragraph('two') + sect('continuous')
    );
    expect(gap(part, 14)).toBe(0);
    expect(gap(part, 15)).toBe(14);
  });

  test('does not open a page for its line', () => {
    // 280pt of content: twenty 14pt rows fill the page, so the line of the mark does not fit.
    const row = table.slice(table.indexOf('<w:tr>'), table.indexOf('</w:tbl>'));
    const full = table.replace(row, row.repeat(20));
    const layout = lay(load(full + mark() + paragraph('two') + sect('continuous')), 15);
    expect(layout.pages).toHaveLength(2);
    expect(paragraphs(layout).filter((fragment) => fragment.outOfFlow)).toHaveLength(1);
    expect(lineTop(layout, 'two', 1)).toBe(0);
  });

  test('takes no room when the mark is hidden', () => {
    expect(twoTop(afterTable(mark(0, 0, HIDDEN), 9), 15)).toBe(flush + 9);
  });

  test('takes no room after a paragraph that follows the table', () => {
    const part = load(table + body(6, mark(), 9));
    expect(gap(part, 15)).toBe(6 + 9);
  });

  test('matches a cold layout when the table before the mark goes away', () => {
    const options = { measurer, compatibilityMode: 15 };
    const session = createLayoutSession();
    const withTable = load(table + mark(0, 3) + paragraph('two', 9) + sect('continuous'));
    const without = load(
      paragraph('one', 0, 6) + mark(0, 3) + paragraph('two', 9) + sect('continuous')
    );
    for (const [revision, part] of [withTable, without, withTable].entries()) {
      const warm = layoutSemanticDocument(part, revision, { ...options, session });
      expect(warm.pages).toEqual(layoutSemanticDocument(part, revision, options).pages);
    }
    expect(gap(without, 15)).toBe(6 + 9 - 3);
  });
});
