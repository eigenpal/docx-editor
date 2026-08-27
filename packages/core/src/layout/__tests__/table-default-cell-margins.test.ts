// Word's default cell metrics: the default table style, the fallback beneath it, and the
// empty paragraph a cell must end with when its content ends with a table.
//
// A `w:tbl` that states no `w:tblStyle` is not unstyled. Word applies
// `w:style[@w:type='table'][@w:default='1']`, which in a Word-authored styles.xml is
// `TableNormal` and states 0 top, 0 bottom, 108 twips left and right. Charging 3 pt on all
// four sides instead makes every row of every such table 6 pt taller than Word's, and the
// error compounds down the table until it paginates a page early.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable, readTableStructure } from '../index.ts';
import { cascadeTableFormatting } from '../style-cascade.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { documentOrder } from '../semantic-interaction.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** `TableNormal` exactly as Word writes it, plus a named style based on it. */
const WORD_STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="table" w:styleId="TableNormal" w:default="1">' +
  '<w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar>' +
  '<w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/>' +
  '</w:tblCellMar></w:tblPr></w:style>' +
  '<w:style w:type="table" w:styleId="Roomy"><w:name w:val="Roomy"/>' +
  '<w:basedOn w:val="TableNormal"/><w:tblPr><w:tblCellMar>' +
  '<w:top w:w="200" w:type="dxa"/><w:bottom w:w="200" w:type="dxa"/>' +
  '</w:tblCellMar></w:tblPr></w:style>' +
  '</w:styles>';

/** The same part with no default table style at all. */
const NO_DEFAULT_STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="table" w:styleId="Roomy"><w:name w:val="Roomy"/><w:tblPr><w:tblCellMar>' +
  '<w:top w:w="200" w:type="dxa"/><w:bottom w:w="200" w:type="dxa"/>' +
  '</w:tblCellMar></w:tblPr></w:style>' +
  '</w:styles>';

function tableOf(bodyXml: string): OoxmlElement {
  const document = part(
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    '/word/document.xml'
  );
  const found = document.root.children
    .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child) => child.kind === 'table');
  return found as OoxmlElement;
}

const ONE_CELL_TABLE = (tblPr = '') =>
  `<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tr>` +
  '<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
  '<w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

const marginsOf = (table: OoxmlElement, styles?: OoxmlPart) =>
  readTableStructure(table, 468, 0, styles ? buildStyleCascadeTable(styles.root) : undefined)!
    .rows[0]!.cells[0]!.margins;

describe("a table with no w:tblStyle takes the document's default table style", () => {
  test('TableNormal supplies 0 top and bottom, 108 twips left and right', () => {
    const margins = marginsOf(tableOf(ONE_CELL_TABLE()), part(WORD_STYLES, '/word/styles.xml'));
    expect(margins).toEqual({ top: 0, right: 5.4, bottom: 0, left: 5.4 });
  });

  test('a named style still wins, and inherits the default through w:basedOn', () => {
    const margins = marginsOf(
      tableOf(ONE_CELL_TABLE('<w:tblStyle w:val="Roomy"/>')),
      part(WORD_STYLES, '/word/styles.xml')
    );
    // `Roomy` states only top and bottom; left and right come from `TableNormal`.
    expect(margins).toEqual({ top: 10, right: 5.4, bottom: 10, left: 5.4 });
  });

  test("the table's own w:tblCellMar still overrides the default style", () => {
    const margins = marginsOf(
      tableOf(
        ONE_CELL_TABLE(
          '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>'
        )
      ),
      part(WORD_STYLES, '/word/styles.xml')
    );
    expect(margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  test('a w:tblStyle naming a style nobody defines falls to the default too', () => {
    // Word resolves an unknown style reference to the default table style. Returning
    // nothing instead costs such a table the borders, conditional formats and cell margins
    // `TableNormal` supplies.
    const margins = marginsOf(
      tableOf(ONE_CELL_TABLE('<w:tblStyle w:val="NoSuchStyle"/>')),
      part(WORD_STYLES, '/word/styles.xml')
    );
    expect(margins).toEqual({ top: 0, right: 5.4, bottom: 0, left: 5.4 });
  });

  test('two tables naming one style share the resolved chain', () => {
    // The chain is flattened once per (cascade, style id): every table in a document asks
    // the same question, and allocating five containers per table showed up as GC.
    const cascade = buildStyleCascadeTable(part(WORD_STYLES, '/word/styles.xml').root);
    const first = readTableStructure(tableOf(ONE_CELL_TABLE()), 468, 0, cascade)!;
    const second = readTableStructure(
      tableOf(ONE_CELL_TABLE('<w:tblStyle w:val="Roomy"/>')),
      468,
      0,
      cascade
    )!;
    expect(cascadeTableFormatting(cascade, undefined)).toBe(
      cascadeTableFormatting(cascade, 'AlsoUndefined')
    );
    expect(first.defaultMargins).toEqual({ top: 0, right: 5.4, bottom: 0, left: 5.4 });
    expect(second.defaultMargins).toEqual({ top: 10, right: 5.4, bottom: 10, left: 5.4 });
  });

  test('a styles part with no default table style falls back to the same numbers', () => {
    const margins = marginsOf(
      tableOf(ONE_CELL_TABLE()),
      part(NO_DEFAULT_STYLES, '/word/styles.xml')
    );
    expect(margins).toEqual({ top: 0, right: 5.4, bottom: 0, left: 5.4 });
  });

  test('no styles part at all falls back to the same numbers', () => {
    expect(marginsOf(tableOf(ONE_CELL_TABLE()))).toEqual({
      top: 0,
      right: 5.4,
      bottom: 0,
      left: 5.4,
    });
  });
});

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A cell holding a paragraph, a nested table, and the `w:p` §17.4.66 makes it end with. */
const cellWithNestedTable = (terminator: string) =>
  '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
  p('AAA') +
  '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>' +
  p('BBB') +
  '</w:tc></w:tr></w:tbl>' +
  terminator +
  '</w:tc></w:tr></w:tbl>';

function layoutOf(bodyXml: string): SemanticLayout {
  const document = part(
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    '/word/document.xml'
  );
  return layoutSemanticDocument(document, 0, { measurer: createFixedMeasurer() });
}

function outerRowHeight(layout: SemanticLayout): number {
  const fragment = layout.pages[0]!.fragments.find(
    (record): record is TableFragmentRecord => record.kind === 'table'
  )!;
  return fragment.rows[0]!.box.height;
}

describe('the empty paragraph a nested table forces at the end of a cell', () => {
  test('costs the row nothing', () => {
    const withTerminator = outerRowHeight(layoutOf(cellWithNestedTable('<w:p/>')));
    const withNone = outerRowHeight(layoutOf(cellWithNestedTable('')));
    expect(withTerminator).toBeCloseTo(withNone, 6);
  });

  test('a terminator with content keeps its full line', () => {
    const withText = outerRowHeight(layoutOf(cellWithNestedTable(p('CCC'))));
    const withNone = outerRowHeight(layoutOf(cellWithNestedTable('')));
    // The fixed measurer's line box at the default 10 pt size.
    expect(withText - withNone).toBeCloseTo(14 * (10 / 11), 6);
  });

  test('an empty paragraph that does NOT follow a table keeps its line', () => {
    const plain =
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
      p('AAA') +
      '<w:p/>' +
      '</w:tc></w:tr></w:tbl>';
    const one =
      '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="5000" w:type="dxa"/></w:tcPr>' +
      p('AAA') +
      '</w:tc></w:tr></w:tbl>';
    expect(outerRowHeight(layoutOf(plain)) - outerRowHeight(layoutOf(one))).toBeCloseTo(
      14 * (10 / 11),
      6
    );
  });

  test('a w:pBdr on the terminator costs the row nothing either', () => {
    // The fit test charges the border zero, so placement has to as well: charging it here
    // grew the row past the height the caller already sized, and past `maxBottom` on the
    // last row of a page.
    const bordered =
      '<w:p><w:pPr><w:pBdr>' +
      '<w:top w:val="single" w:sz="24" w:space="6"/>' +
      '<w:bottom w:val="single" w:sz="24" w:space="6"/>' +
      '</w:pBdr></w:pPr></w:p>';
    const withBorder = outerRowHeight(layoutOf(cellWithNestedTable(bordered)));
    const withNone = outerRowHeight(layoutOf(cellWithNestedTable('')));
    expect(withBorder).toBeCloseTo(withNone, 6);
  });

  test('its published line box is zero-height, so nothing paints below the row', () => {
    // `caretBoxOnLine`, the selection bands and `paragraphShadingBox` all read this box. A
    // line that kept its height while the cell stopped at `y` drew a full line of caret and
    // highlight below the row.
    const layout = layoutOf(cellWithNestedTable('<w:p/>'));
    const fragment = layout.pages[0]!.fragments.find(
      (record): record is TableFragmentRecord => record.kind === 'table'
    )!;
    const cell = fragment.rows[0]!.cells[0]!;
    const paragraphs = cell.blocks.filter((block) => block.kind === 'paragraph');
    const terminator = paragraphs[paragraphs.length - 1]!;
    if (terminator.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
    expect(terminator.box.height).toBe(0);
    for (const line of terminator.lines) expect(line.box.height).toBe(0);
    const rowBottom = fragment.rows[0]!.box.y + fragment.rows[0]!.box.height;
    for (const line of terminator.lines) {
      expect(line.box.y + line.box.height).toBeLessThanOrEqual(rowBottom + 0.001);
    }
  });

  test('typing into it makes it an ordinary paragraph again', () => {
    // The zero box is what Word draws, and it is not a trap: the moment the paragraph holds
    // anything it stops being a terminator and takes its full line back.
    const withText = outerRowHeight(layoutOf(cellWithNestedTable(p('x'))));
    const withNone = outerRowHeight(layoutOf(cellWithNestedTable('')));
    expect(withText).toBeGreaterThan(withNone);
  });

  test('it stays addressable, so the caret and select-all still reach it', () => {
    const layout = layoutOf(cellWithNestedTable('<w:p/>'));
    const order = documentOrder(layout);
    const withNone = documentOrder(layoutOf(cellWithNestedTable('')));
    expect(order).toHaveLength(withNone.length + 1);
  });
});
