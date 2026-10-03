import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';
import { revisionAuthorFilter } from '../revision-projection.ts';
import {
  autofitContextOf,
  autofitColumnWidthsPt,
  widenAutofitColumns,
} from '../table-autofit-widths.ts';
import { readTableStructure } from '../semantic-table.ts';
import { layoutContext } from './anchored-drawing-test-fixtures.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const round = (widths: readonly number[]) => widths.map((width) => Math.round(width * 10) / 10);

describe('widenAutofitColumns', () => {
  // Minimums 25.7 / 301.4 / 31.9 pt: a URL in the middle column, one short word beside it.
  const minimums = [25.7, 301.4, 31.9];

  test('returns columns that already hold their content unchanged', () => {
    const widths = [250, 125, 75];
    expect(widenAutofitColumns(widths, [20, 100, 30], 450, 451.3)).toBe(widths);
  });

  test('takes the extra width from the other columns in proportion to their slack', () => {
    expect(round(widenAutofitColumns([250, 125, 75], minimums, 450, 451.3))).toEqual([
      102, 301.4, 46.6,
    ]);
    // A shorter unbroken word takes proportionally less.
    expect(round(widenAutofitColumns([250, 125, 75], [25.7, 158.6, 31.9], 450, 451.3))).toEqual([
      221.8, 158.6, 69.6,
    ]);
  });

  test('a table without an absolute width settles at the room it has', () => {
    const widths = widenAutofitColumns([250, 125, 75], minimums, 462.1, 462.1);
    expect(round(widths)).toEqual([112.2, 301.4, 48.5]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(462.1, 6);
  });

  test('an automatic width also shrinks to the room an indent leaves', () => {
    // 72 pt of indent leaves 379.3 pt: the authored 450 pt grid gives back the rest too.
    expect(round(widenAutofitColumns([250, 125, 75], minimums, 379.3, 379.3))).toEqual([
      42.7, 301.4, 35.2,
    ]);
  });

  test('grows past the stated table width once the other columns reach their minimums', () => {
    expect(round(widenAutofitColumns([100, 50, 50], minimums, 200, 451.3))).toEqual(minimums);
  });

  test('scales every minimum down when together they exceed the text column', () => {
    const widths = widenAutofitColumns([150, 150, 150], [301.4, 301.4, 34], 450, 451.3);
    expect(round(widths)).toEqual([213.5, 213.5, 24.3]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(451.3, 6);
  });
});

describe('autofit layout', () => {
  const NAMESPACES = [
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
  ].join(' ');
  const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const table = (layout: string, middle: string, extraCell = '') =>
    `<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/>${layout}<w:tblCellMar><w:left w:w="0" w:type="dxa"/>` +
    '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/>${extraCell}</w:tcPr><w:p>${middle}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
    '</w:tr></w:tbl>';
  const lines = (body: string) => columns(body).lines;
  const columns = (body: string, extra: Record<string, unknown> = {}) => {
    const read = readOoxmlPart(`<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`, {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!read.ok) throw new Error(read.reason);
    const result = layoutSemanticDocument(read.part, 1, {
      measurer: createFixedMeasurer(6, 12),
      styleCascade: elevenPointDefaults(),
      geometry: { width: 300, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
      ...(extra.drawings ? { inlineDrawingLayout: layoutContext(read.part) } : {}),
      ...extra,
    });
    const fragment = result.pages[0]!.fragments.find(
      (candidate): candidate is TableFragmentRecord => candidate.kind === 'table'
    )!;
    const row = fragment.rows[0]!;
    return {
      box: fragment.box,
      widths: row.cells.map((cell) => Math.round(cell.box.width * 100) / 100),
      lines: row.cells.map(
        (cell) =>
          cell.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : [])).length
      ),
    };
  };

  test('widens a column to keep a 10-letter word whole', () => {
    // A 60 pt word in a 30 pt column. The others give the 30 pt in proportion to their
    // slack above their 12 pt minimums: 48 and 18 pt.
    const { widths, lines } = columns(table('', run('ABCDEFGHIJ')));
    expect(widths).toEqual([38.18, 60, 21.82]);
    expect(lines).toEqual([1, 1, 1]);
  });

  test('a field result and a hyphenated word count the same way', () => {
    const field =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://e/" </w:instrText></w:r>' +
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('ABCDEFGHIJ')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    expect(columns(table('', field)).widths).toEqual([38.18, 60, 21.82]);
    // The hyphen is a break opportunity: the widest piece is `ABCDEFG-` (48 pt).
    expect(columns(table('', run('ABCDEFG-HIJ'))).widths[1]).toBe(48);
  });

  test('spaces split words, so ordinary text keeps the authored widths', () => {
    expect(columns(table('', run('AB CD EF GH IJ'))).widths).toEqual([60, 30, 30]);
  });

  test('a fixed layout and vertical text keep the authored widths', () => {
    expect(columns(table('<w:tblLayout w:type="fixed"/>', run('ABCDEFGHIJ'))).widths).toEqual([
      60, 30, 30,
    ]);
    expect(columns(table('', run('ABCDEFGHIJ'), '<w:textDirection w:val="btLr"/>')).widths).toEqual(
      [60, 30, 30]
    );
  });

  test('a first-line indent counts against the first word', () => {
    const indented = `<w:pPr><w:ind w:firstLine="240"/></w:pPr>${run('ABCDEFGHIJ')}`;
    const { widths } = columns(table('', indented));
    expect(widths[1]).toBe(72);
    expect(lines(table('', indented))).toEqual([1, 1, 1]);
  });

  test('cell spacing counts against the column', () => {
    const spaced = table('<w:tblCellSpacing w:w="100" w:type="dxa"/>', run('ABCDEFGHIJ'));
    expect(columns(spaced).widths[1]).toBeCloseTo(60, 6);
    expect(lines(spaced)).toEqual([1, 1, 1]);
  });

  test('hidden text joins the visible text around it into one word', () => {
    const hidden = `${run('ABCDE')}<w:r><w:rPr><w:vanish/></w:rPr><w:t>x</w:t></w:r>${run('FGHIJ')}`;
    expect(columns(table('', hidden)).widths[1]).toBe(60);
  });

  test('a dash that ends its run is a break opportunity', () => {
    const split = `${run('ABCDEFG-')}<w:r><w:rPr><w:b/></w:rPr><w:t>HIJ</w:t></w:r>`;
    expect(columns(table('', split)).widths[1]).toBe(48);
  });

  test('a nested table keeps its own grid width', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr><w:p>${run('n')}</w:p></w:tc></w:tr></w:tbl>`;
    const body =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(14))}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    const { widths } = columns(body);
    expect(widths[0]).toBeGreaterThanOrEqual(50);
    expect(widths[1]).toBe(84);
  });

  test('an indented automatic-width table grows only to the margin', () => {
    const indented =
      '<w:tbl><w:tblPr><w:tblInd w:w="1200" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(40))}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    const { box } = columns(indented);
    expect(box.x + box.width).toBeLessThanOrEqual(300 + 0.01);
  });

  test('a percentage width grows only to its share of the text column', () => {
    const half =
      '<w:tbl><w:tblPr><w:tblW w:w="2500" w:type="pct"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('ABCDEFGHIJ')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(half).box.width).toBeCloseTo(150, 6);
  });

  const picture = (effectEmu = 0) =>
    '<w:r><w:drawing><wp:inline distL="114300" distR="114300">' +
    `<wp:extent cx="698500" cy="127000"/><wp:effectExtent l="${effectEmu}" t="0" r="${effectEmu}" b="0"/>` +
    '<wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="698500" cy="127000"/></a:xfrm>' +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const withPicture = (content: string) =>
    table('', run('ABCDEFGHIJ')).replace(`<w:p>${run('ab')}</w:p>`, `<w:p>${content}</w:p>`);

  test('an inline picture keeps the width it paints at, effect extents included', () => {
    // 55 pt picture: its column keeps 55 pt; side distances do not count for an inline one.
    expect(columns(withPicture(picture()), { drawings: true }).widths[0]).toBeCloseTo(55, 6);
    // 10 pt of effect extent on each side paints it 75 pt wide.
    expect(columns(withPicture(picture(127000)), { drawings: true }).widths[0]).toBeCloseTo(75, 6);
  });

  test('a picture a hidden author deleted sets no minimum', () => {
    const deleted = `<w:del w:id="1" w:author="B" w:date="2026-01-01T00:00:00Z">${picture()}</w:del>${run('ab')}`;
    const view = { drawings: true, revisionAuthorFilter: revisionAuthorFilter(['B']) };
    expect(columns(withPicture(deleted), view).widths[0]).toBeLessThan(55);
  });

  test('text a hidden author deleted sets no minimum', () => {
    const deleted =
      '<w:del w:id="1" w:author="B" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>ABCDEFGHIJ</w:delText></w:r></w:del>' +
      run('ab');
    const filter = { revisionAuthorFilter: revisionAuthorFilter(['B']) };
    expect(columns(table('', deleted), filter).widths).toEqual([60, 30, 30]);
  });

  test('a table wider than the text column keeps its own width while widening', () => {
    const wide =
      '<w:tbl><w:tblPr><w:tblW w:w="7000" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="1000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(10))}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(wide).box.width).toBeCloseTo(350, 6);
  });

  test('a leading tab uses up the first-line indent', () => {
    const tabbed = `<w:pPr><w:ind w:firstLine="720"/></w:pPr><w:r><w:tab/></w:r>${run('ABCDEFGHIJ')}`;
    expect(columns(table('', tabbed)).widths[1]).toBe(60);
  });

  test('a run that holds only a dash ends the word before it', () => {
    const dashed = `${run('ABCDEFG')}<w:r><w:rPr><w:b/></w:rPr><w:t>-</w:t></w:r>${run('HIJ')}`;
    expect(columns(table('', dashed)).widths[1]).toBe(48);
  });

  test('a hard break ends the first-line indent', () => {
    const broken = `<w:pPr><w:ind w:firstLine="720"/></w:pPr><w:r><w:br/></w:r>${run('ABCDEFGHIJ')}`;
    expect(columns(table('', broken)).widths[1]).toBe(60);
  });

  test('a dash run seam breaks where line breaking does', () => {
    // A dash before another dash does not break; a lone dash after a space is its own word.
    expect(
      columns(table('', `${run('ABCDE-')}<w:r><w:rPr><w:b/></w:rPr><w:t>-FGHIJ</w:t></w:r>`))
        .widths[1]
    ).toBe(72);
    expect(
      columns(table('', `${run('ABCDEFGH -')}<w:r><w:rPr><w:b/></w:rPr><w:t>IJKLMNOP</w:t></w:r>`))
        .widths[1]
    ).toBe(48);
  });

  test('an indent that fills the text column settles at the minimums, not hairlines', () => {
    const crowded =
      '<w:tbl><w:tblPr><w:tblInd w:w="6000" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('ABCDEFGHIJ')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    // With no room left, every column settles at its minimum and every word stays whole.
    const { widths, lines } = columns(crowded);
    expect(widths).toEqual([12, 60, 12]);
    expect(lines).toEqual([1, 1, 1]);
  });

  test('an inline equation keeps its column as wide as it paints', () => {
    const equation = '<m:oMath><m:r><m:t>abcdefghijklmnop</m:t></m:r></m:oMath>';
    const fragment = columns(table('', equation));
    expect(fragment.widths[1]).toBeGreaterThan(30);
    expect(fragment.lines[1]).toBe(1);
  });

  test('a field value that only layout knows sets the minimum it paints', () => {
    // AUTHOR with no cached result paints the document's author.
    const author =
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> AUTHOR </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const fragment = columns(table('', author), { documentProperties: { creator: 'ABCDEFGHIJ' } });
    expect(fragment.widths[1]).toBe(60);
    expect(fragment.lines[1]).toBe(1);
  });

  test('words on each side of a page break in a cell are one word', () => {
    const broken = `${run('ABCDE')}<w:r><w:br w:type="page"/></w:r>${run('FGHIJ')}`;
    const fragment = columns(table('', broken));
    expect(fragment.widths[1]).toBe(60);
  });

  test('a new pass with equal field values reuses every measured minimum', () => {
    const read = readOoxmlPart(
      `<w:document ${NAMESPACES}><w:body>${table('', run('ABCDEFGHIJ'))}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const tableNode = read.part.root.children
      .flatMap((node) => ('children' in node ? node.children : []))
      .find((node) => node.kind === 'table')!;
    const base = readTableStructure(tableNode, 300, 0, elevenPointDefaults())!;
    const fixed = createFixedMeasurer(6, 12);
    let measured = 0;
    const measurer = {
      ...fixed,
      measure: (...args: Parameters<typeof fixed.measure>) => (measured++, fixed.measure(...args)),
    };
    const view = {
      styleCascade: elevenPointDefaults(),
      displayMode: 'all-markup' as const,
      authorFilter: undefined,
    };
    // Each pass builds its own deps and a fresh, frozen page-field context.
    const pass = () =>
      autofitColumnWidthsPt(
        base,
        300,
        autofitContextOf({ measurer, bodyPageFields: Object.freeze({}) }),
        view
      );
    expect(round(pass())).toEqual([38.2, 60, 21.8]);
    const first = measured;
    pass();
    expect(measured).toBe(first);
    // A new producer (renumbered note marks, another view) measures again.
    autofitColumnWidthsPt(
      base,
      300,
      autofitContextOf({ measurer, producer: 'another-pass' }),
      view
    );
    expect(measured).toBeGreaterThan(first);
  });

  test('an empty spacer column with no insets gives its width up', () => {
    const spacer = table('', run('ABCDEFGHIJ')).replace(`<w:p>${run('ab')}</w:p>`, '<w:p/>');
    // Slack 59 and 18 pt (each keeps its hairline) give the 30 pt in proportion.
    expect(columns(spacer).widths).toEqual([37.01, 60, 22.99]);
  });

  test('an anchored drawing in a word takes no width', () => {
    const anchored =
      '<w:r><w:drawing><wp:anchor simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="127000" cy="127000"/><wp:wrapNone/><wp:docPr id="2" name="a"/></wp:anchor></w:drawing></w:r>';
    const content = `${run('ABCDE')}${anchored}${run('FGHIJ')}`;
    expect(columns(table('', content), { drawings: true }).widths).toEqual([38.18, 60, 21.82]);
  });

  test('a nested autofit table passes its own word minimum to the outer column', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>' +
      '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="600"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('ABCDEFGHIJ')}</w:p></w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(outer).widths[0]).toBe(60);
  });

  test('spaces that open a line count toward its first word', () => {
    const lead = columns(table('', run('  ABCDEFGHIJ')));
    expect(lead.widths[1]).toBe(72);
    expect(lead.lines[1]).toBe(1);
  });

  test('an empty grid band gains no width when the table scales down', () => {
    const banded =
      '<w:tbl><w:tblPr><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>' +
      '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="0"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
      '<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>' +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(30))}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('B'.repeat(30))}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    // The band keeps the hairline the grid reader gives it; it gains nothing from scaling.
    const { widths, box } = columns(banded);
    expect(widths[0]).toBe(widths[1]!);
    expect(box.width).toBeCloseTo(300, 6);
    expect(300 - widths[0]! - widths[1]!).toBeLessThanOrEqual(1);
  });

  test('an empty zero-inset column keeps a hairline when the minimums overflow', () => {
    const crowded =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="800"/><w:gridCol w:w="800"/><w:gridCol w:w="800"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(30))}</w:p></w:tc>` +
      '<w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/></w:tcPr><w:p/></w:tc>' +
      `<w:tc><w:tcPr><w:tcW w:w="800" w:type="dxa"/></w:tcPr><w:p>${run('B'.repeat(30))}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    const { widths, box } = columns(crowded);
    expect(widths[1]).toBeGreaterThan(0.5);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(box.width, 6);
  });

  test('a nested percentage table resolves against its cell, not the page', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="300"/><w:gridCol w:w="300"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(outer).widths).toEqual([30, 90]);
  });

  test('a word nested past the nesting limit sets no minimum', () => {
    let inner = `<w:p>${run('ABCDEFGHIJ')}</w:p>`;
    for (let level = 0; level < 30; level += 1)
      inner =
        '<w:tbl><w:tblPr><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>' +
        '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="600"/></w:tblGrid>' +
        `<w:tr><w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${inner}<w:p/></w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${inner}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(outer).widths).toEqual([30, 90]);
  });

  test('spaces after a tab do not count toward the next word', () => {
    const tabbed = `<w:r><w:tab/></w:r>${run('      ABCDEFGHIJ')}`;
    expect(columns(table('', tabbed)).widths[1]).toBe(60);
  });

  test('a word that widens a ruled table stays whole when the rules move', () => {
    const ruled = (letters: number) =>
      '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/>' +
      '<w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/>' +
      '<w:insideH w:val="single" w:sz="8"/><w:insideV w:val="single" w:sz="8"/></w:tblBorders>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(letters))}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    for (const letters of [20, 35, 38, 40])
      expect(columns(ruled(letters), { compatibilityMode: 15 }).lines[1]).toBe(1);
  });

  test('a run ending in an em space ends its word', () => {
    const spaced = `${run('ABCDEFGHIJ\u2003')}<w:r><w:rPr><w:b/></w:rPr><w:t>KLMNOPQRST</w:t></w:r>`;
    expect(columns(table('', spaced)).widths[1]).toBeLessThan(70);
  });

  test('a word that already fits its ruled cell does not widen the column', () => {
    const ruled =
      '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/>' +
      '<w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/>' +
      '<w:insideH w:val="single" w:sz="8"/><w:insideV w:val="single" w:sz="8"/></w:tblBorders>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="510"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="510" w:type="dxa"/></w:tcPr><w:p>${run('ABCD')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    const fragment = columns(ruled, { compatibilityMode: 15 });
    expect(fragment.widths[1]).toBeCloseTo(25.5, 6);
    expect(fragment.lines[1]).toBe(1);
  });

  test('a run that opens with an em space starts a new word', () => {
    const spaced = `${run('ABCDE')}<w:r><w:rPr><w:b/></w:rPr><w:t>\u2003FGHIJ</w:t></w:r>`;
    expect(columns(table('', spaced)).widths[1]).toBe(36);
  });

  test('a centered nested table does not count its indent', () => {
    const nested =
      '<w:tbl><w:tblPr><w:jc w:val="center"/><w:tblInd w:w="1440" w:type="dxa"/><w:tblCellMar>' +
      '<w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('ABCDEFGHIJ')}</w:p></w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(outer).widths[0]).toBe(60);
  });

  test('every word of a ruled table stays whole after another column widens it', () => {
    const ruled =
      '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/>' +
      '<w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/>' +
      '<w:insideH w:val="single" w:sz="8"/><w:insideV w:val="single" w:sz="8"/></w:tblBorders>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="510"/><w:gridCol w:w="600"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="510" w:type="dxa"/></w:tcPr><w:p>${run('ABCD')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(30))}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(ruled, { compatibilityMode: 15 }).lines).toEqual([1, 1, 1]);
  });

  test('a fixed nested table keeps room for its indent', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblInd w:w="400" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('n')}</w:p></w:tc></w:tr></w:tbl>`;
    const outer =
      '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
      '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p>${run('A'.repeat(14))}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(outer).widths[0]).toBeGreaterThanOrEqual(50 - 0.01);
  });

  const outerWith = (nested: string, second: string) =>
    '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
    '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="1800"/></w:tblGrid><w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p>${second}</w:p></w:tc>` +
    '</w:tr></w:tbl>';

  test('a wide nested grid does not lock or widen the outer column', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
      '</w:tr></w:tbl>';
    expect(columns(outerWith(nested, run('cd'))).widths).toEqual([30, 90]);
  });

  test('a fixed nested table keeps the width it paints at', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${run('n')}</w:p></w:tc></w:tr></w:tbl>`;
    expect(columns(outerWith(nested, run('A'.repeat(30)))).widths[0]).toBeGreaterThanOrEqual(60);
  });

  const halfAndHalf = (nested: string, second: string) =>
    '<w:tbl><w:tblPr><w:tblW w:w="2400" w:type="dxa"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/>' +
    '<w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="1200"/><w:gridCol w:w="1200"/></w:tblGrid><w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${nested}<w:p/></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p>${second}</w:p></w:tc>` +
    '</w:tr></w:tbl>';
  const twoCellNested = (properties: string) =>
    `<w:tbl><w:tblPr>${properties}</w:tblPr><w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="600"/></w:tblGrid><w:tr>` +
    `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="600" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
    '</w:tr></w:tbl>';

  test('a nested autofit table with an absolute width keeps the outer column wide enough', () => {
    const nested = twoCellNested('<w:tblW w:w="1200" w:type="dxa"/>');
    expect(columns(halfAndHalf(nested, run('A'.repeat(15)))).widths[0]).toBeGreaterThanOrEqual(60);
  });

  test('a nested percentage table gives its width up with its cell', () => {
    const nested = twoCellNested('<w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/>');
    const { box } = columns(halfAndHalf(nested, run('A'.repeat(15))));
    expect(box.width).toBeCloseTo(120, 6);
  });
});
