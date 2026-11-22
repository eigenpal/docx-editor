// A tab whose next stop lies past the right edge opens the next line, in table cells and text
// frames too. After text that ends on a custom stop at the edge, a legacy compatibility mode
// keeps that tab on its line outside table cells; modern modes and table cells wrap it.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const tabs = (count: number) => `<w:r>${'<w:tab/>'.repeat(count)}</w:r>`;
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const rightStop = (twips: number) => `<w:tabs><w:tab w:val="right" w:pos="${twips}"/></w:tabs>`;
// A 200pt cell with no cell margins.
const cell = (paragraph: string) =>
  `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>` +
  ['top', 'left', 'bottom', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('') +
  `</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl>`;
const FRAME = '<w:framePr w:w="4000" w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:x="1"/>';

/** The text of each line that holds a span, on a 400pt page with a 36pt tab grid. */
function lineTexts(content: string, compatibilityMode: number | undefined): string[] {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${content}<w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: elevenPointDefaults(),
    ...(compatibilityMode === undefined ? {} : { compatibilityMode }),
    geometry: { width: 400, height: 600, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
  return linesOf(result)
    .map((line) => line.spans.map((span) => span.text).join(''))
    .filter((text) => text !== '');
}

const MODES = [undefined, 11, 14, 15] as const;

describe('trailing tabs whose next default stop lies past the edge', () => {
  test('wrap in a table cell in every mode', () => {
    // "Field:" ends at 36pt; five tabs reach 72..216pt, past the 200pt cell edge from the fifth.
    for (const mode of MODES) {
      expect(lineTexts(cell(`<w:p>${run('Field:')}${tabs(5)}</w:p>`), mode)).toEqual([
        'Field:\t\t\t\t',
        '\t',
      ]);
    }
  });

  test('stay on the line while the stops fit the cell', () => {
    for (const mode of MODES) {
      expect(lineTexts(cell(`<w:p>${run('Field:')}${tabs(4)}</w:p>`), mode)).toEqual([
        'Field:\t\t\t\t',
      ]);
    }
  });

  test('wrap in a text frame in every mode', () => {
    for (const mode of MODES) {
      const texts = lineTexts(`<w:p><w:pPr>${FRAME}</w:pPr>${run('Field:')}${tabs(5)}</w:p>`, mode);
      expect(texts).toEqual(['Field:\t\t\t\t', '\t']);
    }
  });

  test('a custom left stop past the cell edge still takes a single tab on its line', () => {
    const paragraph = `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="4200" w:leader="underscore"/></w:tabs></w:pPr>${run('Field:')}${tabs(1)}</w:p>`;
    for (const mode of MODES) expect(lineTexts(cell(paragraph), mode)).toEqual(['Field:\t']);
  });
});

describe('trailing tabs after text that ends on a custom stop at the edge', () => {
  const atEdge = (twips: number, count: number) =>
    `<w:p><w:pPr>${rightStop(twips)}</w:pPr>${run('LEFT')}${tabs(1)}${run('RIGHT')}${tabs(count)}</w:p>`;

  test('a legacy body paragraph keeps them on its line', () => {
    for (const mode of [undefined, 11, 14]) {
      expect(lineTexts(atEdge(8000, 3), mode)).toEqual(['LEFT\tRIGHT\t\t\t']);
    }
  });

  test('a modern body paragraph opens a line for each of them', () => {
    // Each wrapped tab reaches the stop at the edge, so the next one wraps again.
    expect(lineTexts(atEdge(8000, 3), 15)).toEqual(['LEFT\tRIGHT', '\t', '\t', '\t']);
  });

  test('a table cell opens a line for each of them in every mode', () => {
    for (const mode of MODES) {
      expect(lineTexts(cell(atEdge(4000, 2)), mode)).toEqual(['LEFT\tRIGHT', '\t', '\t']);
    }
  });

  test('a text frame follows the body rule', () => {
    const framed = `<w:p><w:pPr>${FRAME}${rightStop(4000)}</w:pPr>${run('LEFT')}${tabs(1)}${run('RIGHT')}${tabs(2)}</w:p>`;
    expect(lineTexts(framed, 14)).toEqual(['LEFT\tRIGHT\t\t']);
    expect(lineTexts(framed, 15)).toEqual(['LEFT\tRIGHT', '\t', '\t']);
  });
});

describe('the same rule in other stories and directions', () => {
  const atEdge = `<w:p><w:pPr>${rightStop(8000)}</w:pPr>${run('LEFT')}${tabs(1)}${run('RIGHT')}${tabs(2)}</w:p>`;

  test('a header follows the body rule', () => {
    const header = (mode: number) => {
      const read = readOoxmlPart(`<w:hdr xmlns:w="${W}">${atEdge}</w:hdr>`, {
        name: '/word/header1.xml',
        contentType: 'app/xml',
      });
      if (!read.ok) throw new Error(read.reason);
      const story = layoutHeaderFooterStory(
        read.part,
        400,
        createFixedMeasurer(6, 12),
        'test',
        undefined,
        elevenPointDefaults(),
        ...Array<undefined>(9),
        { compatibilityMode: mode }
      );
      return story.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? fragment.lines.map((line) => line.spans.map((span) => span.text).join(''))
          : []
      );
    };
    expect(header(14)).toEqual(['LEFT\tRIGHT\t\t']);
    expect(header(15)).toEqual(['LEFT\tRIGHT', '\t', '\t']);
  });

  test('a nested table cell wraps in every mode', () => {
    const nested = (paragraph: string) =>
      cell(
        `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>` +
          ['top', 'left', 'bottom', 'right']
            .map((side) => `<w:${side} w:w="0" w:type="dxa"/>`)
            .join('') +
          `</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc></w:tr></w:tbl><w:p/>`
      );
    for (const mode of MODES) {
      expect(lineTexts(nested(`<w:p>${run('Field:')}${tabs(5)}</w:p>`), mode)).toEqual([
        'Field:\t\t\t\t',
        '\t',
      ]);
    }
  });

  test('right-to-left and positional tabs keep their placement', () => {
    const rtl = `<w:p><w:pPr><w:bidi/></w:pPr>${run('Field:')}${tabs(12)}</w:p>`;
    for (const mode of MODES) expect(lineTexts(rtl, mode)).toHaveLength(1);
    // A positional tab at the margin states its own destination and never wraps.
    const positional = `<w:p>${run('Field:')}<w:r><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="none"/></w:r></w:p>`;
    for (const mode of MODES) expect(lineTexts(positional, mode)).toHaveLength(1);
  });
});
