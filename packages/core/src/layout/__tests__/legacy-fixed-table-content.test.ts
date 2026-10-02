import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { readTableStructure, tableOriginX } from '../semantic-table.ts';
import { cellContentInsets } from '../table-cell-geometry.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string, name = '/word/document.xml') {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const styles = buildStyleCascadeTable(
  part(
    `<w:styles xmlns:w="${W}">
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>
<w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>
<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`,
    '/word/styles.xml'
  ).root
);
function document(
  extra = '',
  cell = '',
  indent = 108,
  width = 'auto',
  text = 'abcdefghij klmnopqrst'
) {
  const edges = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4"/>`)
    .join('');
  return part(`<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>
<w:tblW w:w="${width === 'auto' ? 0 : 2000}" w:type="${width}"/><w:tblInd w:w="${indent}" w:type="dxa"/>
<w:tblBorders>${edges}</w:tblBorders><w:tblLayout w:type="fixed"/>${extra}</w:tblPr>
<w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid><w:tr>${[0, 1]
    .map(
      () =>
        `<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/>${cell}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`
    )
    .join('')}</w:tr></w:tbl><w:p/></w:body></w:document>`);
}
function structure(doc = document(), mode: number | null = 14, depth = 0, cascade = styles) {
  const body = doc.root.children.find((node) => node.kind === 'body') as OoxmlElement;
  const table = body.children.find((node) => node.kind === 'table') as OoxmlElement;
  return readTableStructure(table, 300, depth, cascade, 'proposed', undefined, mode ?? undefined)!;
}
function layout(
  doc: ReturnType<typeof document>,
  session = createLayoutSession(),
  revision = 0,
  cascade = styles,
  compatibilityMode: number | undefined = 14
) {
  return layoutSemanticDocument(doc, revision, {
    compatibilityMode,
    styleCascade: cascade,
    measurer: createFixedMeasurer(3.9, 12),
    session,
    geometry: { width: 444, height: 400, margin: { top: 72, right: 72, bottom: 72, left: 72 } },
  });
}

describe('legacy fixed table content edges', () => {
  test('the indent owns the first content edge without changing the grid', () => {
    for (const width of ['auto', 'dxa']) {
      const s = structure(document('', '', 108, width));
      expect(s.columnWidthsPt).toEqual([50, 50]);
      expect(tableOriginX(s, 300)).toBeCloseTo(0, 8);
      expect(cellContentInsets(s.rows[0]!.cells[0]!, true).left).toBe(5.4);
      expect(cellContentInsets(s.rows[0]!.cells[0]!, true).right).toBe(5.4);
    }
  });
  test('zero and signed indents retain the complete authored displacement', () => {
    for (const indent of [-200, 0, 987]) {
      const s = structure(document('', '', indent));
      expect(tableOriginX(s, 300) + cellContentInsets(s.rows[0]!.cells[0]!, true).left).toBeCloseTo(
        indent / 20,
        8
      );
    }
  });
  test('cell margins override inherited margins at the leading edge', () => {
    const s = structure(
      document(
        '',
        '<w:tcMar><w:left w:w="240" w:type="dxa"/><w:right w:w="180" w:type="dxa"/></w:tcMar>'
      )
    );
    expect(tableOriginX(s, 300)).toBeCloseTo(5.4 - 12, 8);
    expect(cellContentInsets(s.rows[0]!.cells[0]!, true).left).toBe(12);
    expect(cellContentInsets(s.rows[0]!.cells[0]!, true).right).toBe(9);
  });
  test('a narrow margin clears half the rule without a second charge', () => {
    const s = structure(document('<w:tblCellMar><w:right w:w="6" w:type="dxa"/></w:tblCellMar>'));
    expect(cellContentInsets(s.rows[0]!.cells[0]!, true).right).toBe(0.3);
  });
  test('reclaimed side clearance keeps a complete word on its line', () => {
    // Ten 3.9pt glyphs fit in 39.2pt. Charging an extra 0.5pt splits that word.
    const result = layout(document());
    const table = result.pages[0]!.fragments.find((item) => item.kind === 'table')!;
    if (table.kind !== 'table') throw new Error('table');
    const p = table.rows[0]!.cells[0]!.blocks[0]!;
    if (p.kind !== 'paragraph') throw new Error('paragraph');
    expect(p.lines).toHaveLength(2);
    expect(
      p.lines[0]!.spans.map((span) => span.text)
        .join('')
        .trim()
    ).toBe('abcdefghij');
  });
  test('every legacy mode aligns the first content edge; newer modes keep the prior origin', () => {
    // Word places the first cell's text at the same position with no mode and with modes 11,
    // 12 and 14, and about 5.7pt further in with modes 15, 16 and above.
    for (const mode of [null, 11, 12, 14]) {
      expect(tableOriginX(structure(document(), mode), 300)).toBeCloseTo(0, 8);
      for (const width of ['auto', 'dxa']) {
        const doc = document('', '', 108, width);
        const table = layout(doc, createLayoutSession(), 0, styles, mode ?? undefined).pages[0]!
          .fragments[0]!;
        if (table.kind !== 'table') throw new Error('table');
        const p = table.rows[0]!.cells[0]!.blocks[0]!;
        if (p.kind !== 'paragraph') throw new Error('paragraph');
        expect(p.lines[0]!.box.x).toBeCloseTo(5.4, 8);
      }
    }
    for (const mode of [15, 16, 17]) {
      // The prior origin plus half the 0.5pt outer rule (`modernGridLineSideRules`).
      expect(tableOriginX(structure(document(), mode), 300)).toBeCloseTo(5.65, 8);
      const table = layout(document(), createLayoutSession(), 0, styles, mode).pages[0]!
        .fragments[0]!;
      if (table.kind !== 'table') throw new Error('table');
      const p = table.rows[0]!.cells[0]!.blocks[0]!;
      if (p.kind !== 'paragraph') throw new Error('paragraph');
      expect(p.lines[0]!.box.x).toBeCloseTo(11.05, 8);
    }
  });
  test('table boundaries retain their prior origin', () => {
    for (const extra of [
      '<w:bidiVisual/>',
      '<w:tblCellSpacing w:w="20" w:type="dxa"/>',
      '<w:jc w:val="center"/>',
    ]) {
      expect(structure(document(extra)).outerRuleOffsetPt).toBeUndefined();
    }
    expect(structure(document(), 14, 1).outerRuleOffsetPt).toBeUndefined();
    expect(structure(document('', '', 108, 'pct')).outerRuleOffsetPt).toBeUndefined();
  });
  test('invalid margins and unsupported border clearances keep the original geometry', () => {
    for (const cell of [
      '<w:tcMar><w:left w:w="20" w:type="pct"/></w:tcMar>',
      '<w:tcMar><w:left w:w="0" w:type="dxa"/></w:tcMar>',
      '<w:tcBorders><w:left w:val="double" w:sz="4"/></w:tcBorders>',
      '<w:tcBorders><w:left w:val="single" w:sz="8"/></w:tcBorders>',
    ])
      expect(structure(document('', cell)).outerRuleOffsetPt).toBeUndefined();
  });
  test('incomplete row grids and different leading margins keep the original origin', () => {
    const xml = serializeOoxmlPart(document());
    const row = xml.match(/<w:tr>[\s\S]*?<\/w:tr>/)![0];
    for (const changed of [
      row.replace('<w:tr>', '<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>'),
      row.replace('<w:tr>', '<w:tr><w:trPr><w:gridAfter w:val="1"/></w:trPr>'),
      row.replace('</w:tcPr>', '<w:tcMar><w:left w:w="240" w:type="dxa"/></w:tcMar></w:tcPr>'),
    ]) {
      expect(
        structure(part(xml.replace('</w:tbl>', changed + '</w:tbl>'))).outerRuleOffsetPt
      ).toBeUndefined();
    }
  });
  test('unresolved row geometry exceptions retain the original table origin', () => {
    const xml = serializeOoxmlPart(document());
    const row = xml.match(/<w:tr>[\s\S]*?<\/w:tr>/)![0];
    for (const exception of [
      '<w:tblCellSpacing w:w="240" w:type="dxa"/>',
      '<w:tblCellMar><w:left w:w="360" w:type="dxa"/></w:tblCellMar>',
      '<w:tblInd w:w="240" w:type="dxa"/>',
      '<w:tblW w:w="4000" w:type="dxa"/>',
    ]) {
      const changed = row.replace('<w:tr>', `<w:tr><w:tblPrEx>${exception}</w:tblPrEx>`);
      const s = structure(part(xml.replace('</w:tbl>', changed + '</w:tbl>')));
      expect(s.outerRuleOffsetPt).toBeUndefined();
      expect(tableOriginX(s, 300)).toBe(5.4);
    }
  });
  test('vertical merge continuation keeps the same leading content edge', () => {
    const xml = serializeOoxmlPart(document());
    const row = xml.match(/<w:tr>[\s\S]*?<\/w:tr>/)![0];
    const restart = row.replace('</w:tcPr>', '<w:vMerge w:val="restart"/></w:tcPr>');
    const continuation = row.replace('</w:tcPr>', '<w:vMerge/></w:tcPr>');
    const s = structure(part(xml.replace(row, restart + continuation)));
    expect(tableOriginX(s, 300)).toBeCloseTo(0, 8);
    expect(s.rows[1]!.cells[0]!.vMergeContinue).toBe(true);
  });
  test('invalid inherited indentation does not authorize a new origin', () => {
    for (const attrs of ['w:w="300" w:type="pct"', 'w:w="bad" w:type="dxa"']) {
      const cascade = buildStyleCascadeTable(
        part(
          `<w:styles xmlns:w="${W}"><w:style w:type="table" w:default="1" w:styleId="Default"><w:name w:val="Default"/><w:tblPr><w:tblInd ${attrs}/></w:tblPr></w:style></w:styles>`,
          '/word/styles.xml'
        ).root
      );
      expect(structure(document(), 14, 0, cascade).outerRuleOffsetPt).toBeUndefined();
    }
  });
  test('style margin edits use fresh content geometry in a retained session', () => {
    const doc = part(
      serializeOoxmlPart(document()).replace('<w:tblPr>', '<w:tblPr><w:tblStyle w:val="Named"/>')
    );
    const session = createLayoutSession();
    for (const [revision, margin] of [108, 240, 108].entries()) {
      const cascade = buildStyleCascadeTable(
        part(
          `<w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="Named"><w:name w:val="Named"/><w:tblPr><w:tblCellMar><w:left w:w="${margin}" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`,
          '/word/styles.xml'
        ).root
      );
      expect(structure(doc, 14, 0, cascade).rows[0]!.cells[0]!.margins.left).toBe(margin / 20);
      const warm = layout(doc, session, revision, cascade);
      expect(warm.pages).toEqual(layout(doc, createLayoutSession(), revision, cascade).pages);
      expect(layout(doc, session, revision, cascade).pages[0]).toBe(warm.pages[0]);
    }
  });
  test('geometry edits preserve warm/cold results and canonical content', () => {
    const session = createLayoutSession();
    for (const [revision, indent] of [108, 300, 0].entries()) {
      const doc = document('', '', indent);
      const before = serializeOoxmlPart(doc);
      const warm = layout(doc, session, revision);
      const cold = layout(doc, createLayoutSession(), revision);
      expect(warm.pages).toEqual(cold.pages);
      expect(layout(doc, session, revision).pages[0]).toBe(warm.pages[0]);
      expect(serializeOoxmlPart(doc)).toBe(before);
    }
  });
});
