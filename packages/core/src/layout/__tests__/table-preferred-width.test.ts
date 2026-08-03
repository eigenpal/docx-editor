// Preferred table/cell widths and the fit that follows from them.
//
// Three sources settle a table's columns, strongest first: `w:tblGrid` (17.4.49, the
// producer's own RESOLVED grid), `w:tcW` (17.4.72, what a cell ASKED for), then an even
// split. Reading `w:tcW` does not mean overriding a stated grid with it — for a well-formed
// file the two agree, and where they disagree the grid is the later statement.
//
// `w:tblLayout` (17.4.53) then decides whether the result may exceed the text column: a
// fixed table renders past the right margin in Word rather than shrinking, an autofit one
// never does.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { readTableStructure } from '../semantic-table.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function tableNode(bodyXml: string): OoxmlElement {
  const document = part(
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    '/word/document.xml'
  );
  const found = document.root.children
    .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child) => child.kind === 'table');
  if (!found) throw new Error('no table');
  return found as OoxmlElement;
}

/** 468pt = 9360 twips, the content width of a portrait Letter page at 1" margins. */
const CONTENT_WIDTH_PT = 468;

function structureOf(bodyXml: string, contentWidthPt = CONTENT_WIDTH_PT) {
  return readTableStructure(tableNode(bodyXml), contentWidthPt, 0)!;
}

const cell = (tcPr = '') => `<w:tc>${tcPr}<w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>`;
const tcW = (w: string, type = 'dxa') => `<w:tcPr><w:tcW w:w="${w}" w:type="${type}"/></w:tcPr>`;
const grid = (...twips: number[]) =>
  `<w:tblGrid>${twips.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
const total = (widths: readonly number[]) => widths.reduce((sum, width) => sum + width, 0);

describe('w:tcW is read onto the cell', () => {
  test('a dxa preference lands in points', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(2340, 2340)}<w:tr>${cell(tcW('2340'))}${cell(tcW('2340'))}</w:tr></w:tbl>`
    );
    expect(structure.rows[0]!.cells[0]!.preferredWidth).toEqual({ type: 'dxa', value: 117 });
  });

  test('a pct preference is read from fiftieths of a percent, and from the string form', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(2340, 2340)}` +
        `<w:tr>${cell(tcW('2500', 'pct'))}${cell(tcW('50%', 'pct'))}</w:tr></w:tbl>`
    );
    expect(structure.rows[0]!.cells[0]!.preferredWidth).toEqual({ type: 'pct', value: 50 });
    expect(structure.rows[0]!.cells[1]!.preferredWidth).toEqual({ type: 'pct', value: 50 });
  });

  test('auto, nil, and an absent w:tcW all carry no width', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(2340, 2340, 2340)}` +
        `<w:tr>${cell(tcW('0', 'auto'))}${cell(tcW('0', 'nil'))}${cell()}</w:tr></w:tbl>`
    );
    const [auto, nil, absent] = structure.rows[0]!.cells;
    expect(auto!.preferredWidth.type).toBe('auto');
    expect(nil!.preferredWidth.type).toBe('nil');
    expect(absent!.preferredWidth).toEqual({ type: 'auto', value: 0 });
  });

  test('a hostile w:tcW is rejected the way every sibling geometry read rejects one', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(2340, 2340)}` +
        `<w:tr>${cell(tcW('999999999'))}${cell(tcW('12.5'))}</w:tr></w:tbl>`
    );
    // Clamped, not propagated: 999999999 twips would otherwise be ~50,000,000pt.
    expect(structure.rows[0]!.cells[0]!.preferredWidth.value).toBeLessThanOrEqual(31_680 / 20);
    // Non-integer is rejected outright, exactly like w:tcMar rejects one.
    expect(structure.rows[0]!.cells[1]!.preferredWidth.type).toBe('auto');
  });
});

describe('w:tblGrid outranks w:tcW when both are stated', () => {
  test('a grid that disagrees with the cell preferences still wins', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(3000, 1680)}` +
        `<w:tr>${cell(tcW('1000'))}${cell(tcW('1000'))}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([150, 84]);
  });
});

describe('w:tcW settles the columns when no usable grid does', () => {
  test('a table with no w:tblGrid takes its widths from w:tcW, not an even split', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/><w:tr>${cell(tcW('1440'))}${cell(tcW('2880'))}</w:tr></w:tbl>`
    );
    // Was an even split at contentWidth/2 = 234pt each; the file said 72pt and 144pt.
    expect(structure.columnWidthsPt).toEqual([72, 144]);
  });

  test('a gridSpan cell only settles the columns no narrower claim already did', () => {
    // Row 2 states column 0 alone at 1440tw; row 1's span-2 cell covers 0 and 1 at 2880tw,
    // so column 1 gets the 1440tw that the span does not already account for.
    const spanCell = `<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="2880" w:type="dxa"/></w:tcPr><w:p/></w:tc>`;
    const structure = structureOf(
      `<w:tbl><w:tblPr/><w:tr>${spanCell}</w:tr>` +
        `<w:tr>${cell(tcW('1440'))}${cell()}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([72, 72]);
  });

  test('a column nothing states still gets a positive width', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/><w:tr>${cell(tcW('1440'))}${cell()}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt[0]).toBe(72);
    expect(structure.columnWidthsPt[1]!).toBeGreaterThan(0);
  });

  test('an unreadable w:gridCol falls through to the preferences rather than guessing', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="oops"/><w:gridCol w:w="1440"/></w:tblGrid>` +
        `<w:tr>${cell(tcW('1440'))}${cell(tcW('2880'))}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([72, 144]);
  });
});

describe('w:tblLayout decides whether a table may exceed the text column', () => {
  const wide = `${grid(7200, 7200)}<w:tr>${cell()}${cell()}</w:tr>`;

  test('an autofit table wider than the content box scales down to fit it', () => {
    const structure = structureOf(`<w:tbl><w:tblPr/>${wide}</w:tbl>`);
    expect(total(structure.columnWidthsPt)).toBeCloseTo(CONTENT_WIDTH_PT, 6);
    // Proportions are preserved: both columns were equal and stay equal.
    expect(structure.columnWidthsPt[0]).toBeCloseTo(structure.columnWidthsPt[1]!, 6);
  });

  test('a fixed table wider than the content box is left alone, as Word renders it', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>${wide}</w:tbl>`
    );
    expect(structure.layoutFixed).toBe(true);
    expect(structure.columnWidthsPt).toEqual([360, 360]);
  });

  test('an autofit table narrower than the content box is not stretched to it', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(1440, 1440)}<w:tr>${cell()}${cell()}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt).toEqual([72, 72]);
  });

  test('w:tblLayout w:type="autofit" is autofit, like an absent element', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblLayout w:type="autofit"/></w:tblPr>${wide}</w:tbl>`
    );
    expect(structure.layoutFixed).toBe(false);
    expect(total(structure.columnWidthsPt)).toBeCloseTo(CONTENT_WIDTH_PT, 6);
  });
});

describe('w:tblW caps the width an autofit table fits into', () => {
  const wide = `${grid(7200, 7200)}<w:tr>${cell()}${cell()}</w:tr>`;

  test('a dxa table width narrower than the page is the target', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblW w:w="4680" w:type="dxa"/></w:tblPr>${wide}</w:tbl>`
    );
    expect(structure.tableWidth).toEqual({ type: 'dxa', value: 234 });
    expect(total(structure.columnWidthsPt)).toBeCloseTo(234, 6);
  });

  test('a pct table width resolves against the content box', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblW w:w="2500" w:type="pct"/></w:tblPr>${wide}</w:tbl>`
    );
    expect(total(structure.columnWidthsPt)).toBeCloseTo(CONTENT_WIDTH_PT / 2, 6);
  });

  test('a dxa table width wider than the page still cannot exceed the page', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblW w:w="20000" w:type="dxa"/></w:tblPr>${wide}</w:tbl>`
    );
    expect(total(structure.columnWidthsPt)).toBeCloseTo(CONTENT_WIDTH_PT, 6);
  });
});

describe('the table fragment box reports the table’s own width', () => {
  function tableFragment(bodyXml: string): TableFragmentRecord {
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const layout = layoutSemanticDocument(result.part, 0, { measurer: createFixedMeasurer() });
    const fragment = layout.pages
      .flatMap((page) => page.fragments)
      .find((item): item is TableFragmentRecord => item.kind === 'table');
    if (!fragment) throw new Error('no table fragment');
    return fragment;
  }

  const rightEdge = (fragment: TableFragmentRecord) =>
    Math.max(...fragment.rows.flatMap((row) => row.cells.map((c) => c.box.x + c.box.width)));

  test('a table narrower than the page reports its own width, not the page’s', () => {
    const fragment = tableFragment(
      `<w:tbl><w:tblPr/>${grid(1440, 1440)}<w:tr>${cell()}${cell()}</w:tr></w:tbl>`
    );
    expect(fragment.box.width).toBeCloseTo(144, 6);
    expect(fragment.box.width).toBeCloseTo(rightEdge(fragment), 6);
  });

  test('a fixed table wider than the page reports the width it actually paints', () => {
    const fragment = tableFragment(
      `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>` +
        `${grid(7200, 7200)}<w:tr>${cell()}${cell()}</w:tr></w:tbl>`
    );
    expect(fragment.box.width).toBeCloseTo(720, 6);
    expect(fragment.box.width).toBeCloseTo(rightEdge(fragment), 6);
  });
});

describe('a hostile grid column cannot shrink the columns beside it', () => {
  test('the clamp bounds the one column and no fit is derived from it', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr/>${grid(999999999, 1200)}<w:tr>${cell()}${cell()}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt[0]!).toBeLessThanOrEqual(31_680 / 20);
    // Scaling this table to the page would let one absurd w:gridCol crush every real
    // column in it; the per-column clamp is the whole defense.
    expect(structure.columnWidthsPt[1]).toBe(60);
  });
});
