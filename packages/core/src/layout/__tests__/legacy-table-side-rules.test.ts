import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { readTableStructure } from '../semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function source(margin = 0, extra = '', rightWidth = 4, style = 'single', widthType = 'dxa') {
  const xml = `<w:tbl><w:tblPr><w:tblW w:w="2880" w:type="${widthType}"/>${extra}<w:tblBorders><w:left w:val="${style}" w:sz="4"/><w:right w:val="${style}" w:sz="${rightWidth}"/></w:tblBorders><w:tblCellMar><w:left w:type="dxa" w:w="${margin * 20}"/><w:right w:type="dxa" w:w="${margin * 20}"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Left</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children.find((node) => node.kind === 'body')! as OoxmlElement;
  return { part: parsed.part, table: body.children[0]! as OoxmlElement };
}
function read(table: OoxmlElement, mode?: number, depth = 0) {
  return readTableStructure(table, 300, depth, undefined, 'proposed', undefined, mode)!;
}
for (const mode of [undefined, 11, 12, 14]) {
  for (const margin of [0, 0.5, 5.4]) {
    test(`mode ${mode} centers equal side rules and shares clearance with margin ${margin}`, () => {
      const { part, table } = source(margin);
      const before = serializeOoxmlPart(part);
      expect(read(table, mode).rows[0]!.cells[0]!.centeredSideRules).toBe(true);
      const options = {
        compatibilityMode: mode,
        measurer: createFixedMeasurer(6, 12),
        session: createLayoutSession(),
        geometry: { width: 300, height: 792, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      };
      const layout = layoutSemanticDocument(part, 0, options);
      expect(layoutSemanticDocument(part, 0, options).pages).toEqual(layout.pages);
      const fragment = layout.pages[0]!.fragments[0]!;
      if (fragment.kind !== 'table') throw new Error('Expected table');
      const cell = fragment.rows[0]!.cells[0]!;
      expect(fragment.box.x).toBe(0);
      expect(fragment.box.width).toBe(144);
      const paragraph = cell.blocks[0]!;
      if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph');
      const content = paragraph.lines[0]!.box;
      expect(content.x - cell.box.x).toBe(Math.max(margin, 0.25));
      expect(cell.box.width - content.width).toBeCloseTo(2 * Math.max(margin, 0.25), 8);
      const strokes = cell.borders!.strokes!;
      expect(strokes.find((edge) => edge.side === 'left')!.x).toBe(-0.25);
      expect(strokes.find((edge) => edge.side === 'right')!.x).toBe(143.75);
      expect(serializeOoxmlPart(part)).toBe(before);
    });
  }
}

test('mode changes do not reuse the legacy side-rule projection', () => {
  const { table } = source(0.5);
  const legacy = read(table, 14);
  expect(read(table, 15).rows[0]!.cells[0]!.centeredSideRules).toBeUndefined();
  expect(read(table, 14)).toEqual(legacy);
});

test('compound, unequal, separated, positioned and percentage tables retain their geometry policy', () => {
  for (const table of [
    source(0.5, '', 8).table,
    source(0.5, '', 4, 'double').table,
    source(0.5, '<w:tblCellSpacing w:w="20" w:type="dxa"/>').table,
    source(0.5, '<w:tblpPr w:horzAnchor="text" w:vertAnchor="text" w:tblpX="1" w:tblpY="1"/>')
      .table,
    source(0.5, '<w:bidiVisual/>').table,
    source(0.5, '', 4, 'single', 'pct').table,
  ])
    expect(read(table, 12).rows[0]!.cells[0]!.centeredSideRules).toBeUndefined();
  expect(read(source().table, 12, 1).rows[0]!.cells[0]!.centeredSideRules).toBeUndefined();
});

// Mode 16 is Word 2019 and Microsoft 365. A bordered one-cell table rendered by Word at mode
// 14 starts its text at 72.24pt and at mode 16 at 72.48pt, one device unit further in, and
// this engine reproduces both. So 16 is NOT a legacy mode for side rules: it must not take
// the centred path that modes 11, 12 and 14 do.
test('mode 16 keeps the modern side-rule inset, as the rendered controls show', () => {
  const { table } = source(0);
  expect(read(table, 16).rows[0]!.cells[0]!.centeredSideRules).toBeUndefined();
  expect(read(table, 15).rows[0]!.cells[0]!.centeredSideRules).toBeUndefined();
  expect(read(table, 14).rows[0]!.cells[0]!.centeredSideRules).toBe(true);
});
