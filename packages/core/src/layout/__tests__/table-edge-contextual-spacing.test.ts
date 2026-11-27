// `w:contextualSpacing` (ECMA-376 Part 1, 17.3.1.9; `CT_OnOff`) across the edge of a table
// (17.4.37 `w:tbl`). The property compares a paragraph with the paragraphs before and after
// it in document order, and a table edge does not stop that walk:
//
// - a paragraph before a table compares with the first paragraph of the first cell of the
//   first row, inside a nested table when one opens that cell;
// - a paragraph after a table compares with the end mark of the last row (17.4.78 `w:tr`),
//   which is in the paragraph style named "Normal" (17.7.4.9 `w:name`): the default paragraph
//   style (17.7.4.17 `w:default`) of most documents;
// - the first paragraph of a table compares with the block before the table, in a body, in a
//   cell, and in a header alike. A table that opens a story has nothing before it.
//
// The space that the property removes is the `w:spacing` before or after (17.3.1.33).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, WML_NAMESPACE_URI, type OoxmlPart } from '@docx-editor.dev/core/store';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { layoutNoteStory } from '../note-layout.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import type { BlockFragmentRecord } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = WML_NAMESPACE_URI;
const measurer = createFixedMeasurer(6, 14);

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const cascade = (...definitions: string[]) =>
  buildStyleCascadeTable(
    read(`<w:styles xmlns:w="${W}">${definitions.join('')}</w:styles>`, '/word/styles.xml').root
  );
const style = (id: string, name: string, flag = '') =>
  `<w:style w:type="paragraph"${flag} w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;
const DEFAULT = ' w:default="1"';
const styles = cascade(style('Normal', 'Normal', DEFAULT), style('Other', 'Other'));

const CS = '<w:contextualSpacing/>';
const NONE = '<w:spacing w:before="0" w:after="0"/>';
const AFTER = '<w:spacing w:before="0" w:after="200"/>';
const BEFORE = '<w:spacing w:before="200" w:after="0"/>';
/** The 200 twips of space that a paragraph keeps. */
const KEPT = 10;

/** A paragraph in the default style, and one in the style `Other`. */
const N = (pPr: string) => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>x</w:t></w:r></w:p>`;
const O = (pPr: string) => N(`<w:pStyle w:val="Other"/>${pPr}`);
/** A one-column table with zero cell margins and no borders; each row holds one cell. */
const table = (...rows: string[]) =>
  '<w:tbl><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/>' +
  '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
  rows.map((row) => `<w:tr><w:tc>${row}</w:tc></w:tr>`).join('') +
  '</w:tbl>';

/** The top of the first line of each paragraph in reading order, nested tables included. */
function lineTops(fragments: readonly BlockFragmentRecord[]): number[] {
  return fragments.flatMap((fragment) =>
    fragment.kind === 'table'
      ? fragment.rows.flatMap((row) => row.cells.flatMap((cell) => lineTops(cell.blocks)))
      : fragment.kind === 'paragraph' && fragment.lines[0]
        ? [fragment.lines[0].box.y]
        : []
  );
}

/** The space between each pair of consecutive one-line paragraphs of `tops`. */
function gapsOf(tops: readonly number[]): number[] {
  const line = tops.length > 1 ? LINE : 0;
  // `|| 0` turns a negative zero into zero.
  return tops
    .slice(1)
    .map((top, index) => Math.round((top - tops[index]! - line) * 100) / 100 || 0);
}

function bodyTops(
  body: string,
  session?: ReturnType<typeof createLayoutSession>,
  styleCascade = styles,
  displayMode?: 'proposed'
): number[] {
  const document = read(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  const layout = layoutSemanticDocument(document, 1, {
    measurer,
    styleCascade,
    geometry: { width: 400, height: 600, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    ...(session ? { session } : {}),
    ...(displayMode ? { displayMode } : {}),
  });
  return lineTops(layout.pages[0]!.fragments);
}

/** One line of the fixed measurer. */
const LINE = (() => {
  const [first, second] = bodyTops(N(NONE) + N(NONE));
  return second! - first!;
})();
/** The space between the consecutive paragraphs of a body. */
const gaps = (body: string) => gapsOf(bodyTops(body));

function headerGaps(header: string, root: 'hdr' | 'ftr' = 'hdr'): number[] {
  const story = layoutHeaderFooterStory(
    read(`<w:${root} xmlns:w="${W}">${header}</w:${root}>`, `/word/${root}1.xml`),
    400,
    measurer,
    'test',
    undefined,
    styles
  );
  return gapsOf(lineTops(story.fragments));
}

describe('a paragraph before a table compares with the first paragraph of the table', () => {
  test('the same style drops the space after', () => {
    expect(gaps(O(AFTER + CS) + table(O(NONE)) + N(NONE))).toEqual([0, 0]);
    expect(gaps(N(AFTER + CS) + table(N(NONE)) + N(NONE))).toEqual([0, 0]);
  });

  test('another style keeps it', () => {
    expect(gaps(O(AFTER + CS) + table(N(NONE)) + N(NONE))).toEqual([KEPT, 0]);
    expect(gaps(N(AFTER + CS) + table(O(NONE)) + N(NONE))).toEqual([KEPT, 0]);
  });

  test('without the property the space stays', () => {
    expect(gaps(O(AFTER) + table(O(NONE)) + N(NONE))).toEqual([KEPT, 0]);
  });

  test('only the first cell of the first row counts', () => {
    expect(gaps(O(AFTER + CS) + table(N(NONE), O(NONE)) + N(NONE))).toEqual([KEPT, 0, 0]);
    expect(gaps(O(AFTER + CS) + table(O(NONE), N(NONE)) + N(NONE))).toEqual([0, 0, 0]);
  });

  test('a nested table that opens the first cell gives its first paragraph', () => {
    const nested = (inner: string) => table(table(inner) + N(NONE));
    expect(gaps(O(AFTER + CS) + nested(O(BEFORE + CS)) + N(NONE))).toEqual([0, 0, 0]);
    expect(gaps(O(AFTER + CS) + nested(N(BEFORE + CS)) + N(NONE))).toEqual([2 * KEPT, 0, 0]);
  });

  test('a table in a content control is the same neighbour', () => {
    const control = `<w:sdt><w:sdtContent>${table(O(NONE))}</w:sdtContent></w:sdt>`;
    expect(gaps(O(AFTER + CS) + control + N(NONE))).toEqual([0, 0]);
  });
});

describe('a paragraph after a table compares with the end mark of the last row', () => {
  test('the default style drops the space before, for any cell style', () => {
    expect(gaps(N(NONE) + table(N(NONE)) + N(BEFORE + CS))).toEqual([0, 0]);
    expect(gaps(N(NONE) + table(O(NONE)) + N(BEFORE + CS))).toEqual([0, 0]);
  });

  test('any other style keeps it, even after a cell in that style', () => {
    expect(gaps(N(NONE) + table(O(NONE)) + O(BEFORE + CS))).toEqual([0, KEPT]);
    expect(gaps(N(NONE) + table(N(NONE)) + O(BEFORE + CS))).toEqual([0, KEPT]);
  });

  test('without the property the space stays', () => {
    expect(gaps(N(NONE) + table(N(NONE)) + N(BEFORE))).toEqual([0, KEPT]);
  });

  test('a table after a table compares its first paragraph with that end mark', () => {
    expect(gaps(table(N(NONE)) + table(N(BEFORE + CS)) + N(NONE))).toEqual([0, 0]);
    expect(gaps(table(O(NONE)) + table(O(BEFORE + CS)) + N(NONE))).toEqual([KEPT, 0]);
  });
});

describe('a table edge is the edge of the table that the view lays out', () => {
  const DELETED = '<w:trPr><w:del w:id="1" w:author="a" w:date="2020-01-01T00:00:00Z"/></w:trPr>';
  const tracked =
    '<w:tbl><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/>' +
    '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
    `<w:tr>${DELETED}<w:tc>${N(NONE)}</w:tc></w:tr><w:tr><w:tc>${O(BEFORE + CS)}</w:tc></w:tr></w:tbl>`;
  const body = O(AFTER + CS) + tracked + N(NONE);

  test('with all markup, the deleted first row is the first row', () => {
    // The paragraph before keeps its space, and the second row compares with a row end mark.
    expect(gaps(body)).toEqual([KEPT, KEPT, 0]);
  });

  test('a view that omits the deleted first row compares with the row that stays', () => {
    expect(gapsOf(bodyTops(body, undefined, styles, 'proposed'))).toEqual([0, 0]);
  });

  test('a table with no row has no edge to compare with', () => {
    const empty = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid></w:tbl>';
    const plain = gaps(N(AFTER) + empty + N(BEFORE) + N(NONE));
    expect(gaps(N(AFTER + CS) + empty + N(BEFORE + CS) + N(NONE))).toEqual(plain);
  });
});

describe('the end mark of a row is in the paragraph style named "Normal"', () => {
  const around = (pPr: string) => N(NONE) + table(N(`${pPr}${AFTER}${CS}`)) + N(pPr + BEFORE + CS);
  const gapsWith = (styleCascade: typeof styles, pPr = '') =>
    gapsOf(bodyTops(around(pPr), undefined, styleCascade));

  test('the style id does not decide', () => {
    expect(gapsWith(cascade(style('Standard', 'Normal', DEFAULT)))).toEqual([0, 0]);
    const renamed = cascade(style('Base', 'Body', DEFAULT), style('Normal', 'Plain'));
    expect(gapsWith(renamed, '<w:pStyle w:val="Normal"/>')).toEqual([0, 2 * KEPT]);
  });

  test('a default style with another name does not match the mark', () => {
    expect(gapsWith(cascade(style('Base', 'Body', DEFAULT)))).toEqual([0, 2 * KEPT]);
  });

  test('with no such style and no default style, a paragraph with no style matches', () => {
    expect(gapsWith(cascade(style('Plain', 'Plain')))).toEqual([0, 0]);
    expect(gapsWith(cascade(style('Plain', 'Plain')), '<w:pStyle w:val="Plain"/>')).toEqual([
      0,
      2 * KEPT,
    ]);
  });

  test('a style named "Normal" matches without the default flag', () => {
    const split = cascade(style('Base', 'Body', DEFAULT), style('N1', 'Normal'));
    expect(gapsWith(split)).toEqual([0, 2 * KEPT]);
    expect(gapsWith(split, '<w:pStyle w:val="N1"/>')).toEqual([0, 0]);
  });
});

describe('a floating table is the same neighbour as a table in the flow', () => {
  const float = (cell: string) =>
    '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" ' +
    'w:horzAnchor="margin" w:tblpX="4000" w:tblpY="1"/><w:tblW w:w="2000" w:type="dxa"/></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${cell}</w:tc></w:tr></w:tbl>`;
  /** The space between the paragraphs before and after the table. */
  const around = (before: string, cell: string, after: string) => {
    const layout = layoutSemanticDocument(
      read(
        `<w:document xmlns:w="${W}"><w:body>${before}${float(cell)}${after}</w:body></w:document>`,
        '/word/document.xml'
      ),
      1,
      {
        measurer,
        styleCascade: styles,
        geometry: { width: 400, height: 600, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      }
    );
    const tops = lineTops(layout.pages[0]!.fragments.filter((entry) => entry.kind !== 'table'));
    return gapsOf(tops)[0];
  };

  test('the paragraph before it compares with its first paragraph', () => {
    expect(around(O(AFTER + CS), O(NONE), N(NONE))).toBe(0);
    expect(around(O(AFTER + CS), N(NONE), N(NONE))).toBe(KEPT);
  });

  test('the paragraph after it compares with the end mark of its last row', () => {
    expect(around(N(NONE), O(NONE), N(BEFORE + CS))).toBe(0);
    expect(around(O(NONE), O(NONE), O(BEFORE + CS))).toBe(KEPT);
  });
});

describe('a table in a cell compares across its edges like a body table', () => {
  test('the paragraphs around a nested table drop their space', () => {
    const cell = (inner: string) => table(O(AFTER + CS) + table(inner) + N(BEFORE + CS)) + N(NONE);
    expect(gaps(cell(O(BEFORE + CS)))).toEqual([0, 0, 0]);
    // The first row of the nested table compares with the paragraph before the table.
    expect(gaps(cell(N(BEFORE + CS)))).toEqual([2 * KEPT, 0, 0]);
  });

  test('a nested table that opens a cell compares with what that cell compares with', () => {
    const nested = table(table(O(BEFORE + CS)) + N(NONE)) + N(NONE);
    expect(gaps(O(NONE) + nested)).toEqual([0, 0, 0]);
    expect(gaps(N(NONE) + nested)).toEqual([KEPT, 0, 0]);
    // In a later row, that is the end mark of the row above.
    const later = (inner: string) => table(O(NONE), table(inner) + N(NONE)) + N(NONE);
    expect(gaps(later(O(BEFORE + CS)))).toEqual([KEPT, 0, 0]);
    expect(gaps(later(N(BEFORE + CS)))).toEqual([0, 0, 0]);
  });
});

describe('a table in a header compares across its edges like a body table', () => {
  test('the paragraphs around the table drop their space', () => {
    const header = O(AFTER + CS) + table(O(BEFORE + CS)) + N(BEFORE + CS);
    expect(headerGaps(header)).toEqual([0, 0]);
    expect(headerGaps(O(AFTER + CS) + table(N(BEFORE + CS)) + O(BEFORE + CS))).toEqual([
      2 * KEPT,
      KEPT,
    ]);
  });

  test('a footer and a footnote compare the same way', () => {
    const story = O(AFTER + CS) + table(O(BEFORE + CS)) + N(BEFORE + CS);
    expect(headerGaps(story, 'ftr')).toEqual([0, 0]);
    const notes = read(
      `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${story}</w:footnote></w:footnotes>`,
      '/word/footnotes.xml'
    );
    const note = layoutNoteStory(notes.root.children[0]!, 400, {
      measurer,
      producer: 'test',
      styleCascade: styles,
    });
    expect(gapsOf(lineTops(note!.fragments))).toEqual([0, 0]);
  });

  test('a table that opens the story keeps the space before of its first paragraph', () => {
    const opening = (header: string) =>
      lineTops(
        layoutHeaderFooterStory(
          read(`<w:hdr xmlns:w="${W}">${header}</w:hdr>`, '/word/header1.xml'),
          400,
          measurer,
          'test',
          undefined,
          styles
        ).fragments
      )[0]!;
    const kept = opening(table(N(BEFORE + CS)) + N(NONE));
    expect(kept - opening(table(N(NONE)) + N(NONE))).toBeCloseTo(KEPT);
  });
});

describe('an incremental pass gives the answer of a full pass', () => {
  test('restyling the first cell paragraph re-places the paragraph before the table', () => {
    const session = createLayoutSession();
    const same = N(NONE) + O(AFTER + CS) + table(O(NONE)) + N(NONE);
    const other = N(NONE) + O(AFTER + CS) + table(N(NONE)) + N(NONE);
    const [fresh, restyled] = [bodyTops(same), bodyTops(other)];
    expect(gapsOf(fresh)).toEqual([0, 0, 0]);
    expect(gapsOf(restyled)).toEqual([0, KEPT, 0]);
    expect(bodyTops(same, session)).toEqual(fresh);
    expect(bodyTops(other, session)).toEqual(restyled);
    expect(bodyTops(same, session)).toEqual(fresh);
  });

  test('restyling the paragraph before a nested table re-places its first row', () => {
    const session = createLayoutSession();
    const nested = table(O(BEFORE + CS));
    const same = N(NONE) + table(O(NONE) + nested + N(NONE)) + N(NONE);
    const other = N(NONE) + table(N(NONE) + nested + N(NONE)) + N(NONE);
    const [fresh, restyled] = [bodyTops(same), bodyTops(other)];
    expect(gapsOf(fresh)).toEqual([0, 0, 0, 0]);
    expect(gapsOf(restyled)).toEqual([0, KEPT, 0, 0]);
    expect(bodyTops(same, session)).toEqual(fresh);
    expect(bodyTops(other, session)).toEqual(restyled);
    expect(bodyTops(same, session)).toEqual(fresh);
  });

  test('restyling the paragraph after the table re-places it', () => {
    const session = createLayoutSession();
    const dropped = N(NONE) + table(N(NONE)) + N(BEFORE + CS) + N(NONE);
    const kept = N(NONE) + table(N(NONE)) + O(BEFORE + CS) + N(NONE);
    expect(bodyTops(dropped, session)).toEqual(bodyTops(dropped));
    expect(bodyTops(kept, session)).toEqual(bodyTops(kept));
    expect(gapsOf(bodyTops(kept, session))).toEqual([0, KEPT, 0]);
  });
});
