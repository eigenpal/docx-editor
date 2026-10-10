import { expect, test } from 'bun:test';
import { readTableStructure } from '../semantic-table.ts';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function document(cellBorders = '', spacing = 0) {
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4"/>`)
    .join('');
  const margins = ['top', 'left', 'bottom', 'right']
    .map((side) => `<w:${side} w:w="0" w:type="dxa"/>`)
    .join('');
  const cell = `<w:tc><w:tcPr>${cellBorders}</w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="240"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Text</w:t></w:r></w:p></w:tc>`;
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>
    <w:tblBorders>${borders}</w:tblBorders><w:tblCellMar>${margins}</w:tblCellMar>
    <w:tblCellSpacing w:w="${spacing}" w:type="dxa"/>
    </w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>
    <w:tr>${cell}</w:tr><w:tr>${cell}</w:tr></w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

test.each([0, 40])(
  'table-level borders reserve cell space before layout (spacing=%s)',
  (spacing) => {
    const part = document('', spacing);
    const xml = serializeOoxmlPart(part);
    const options = { measurer: createFixedMeasurer(5, 12), session: createLayoutSession() };
    const layout = layoutSemanticDocument(part, 0, options);
    const table = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table')!;
    const [first, second] = table.rows;
    // Collapsed: each row carries its own top rule and the last row also the outer bottom,
    // so the two rows split 25.5 as 12.5 + 13 rather than 12.75 twice.
    expect(first!.box.height).toBeCloseTo(spacing === 0 ? 12.5 : 13, 6);
    expect(second!.box.height).toBeCloseTo(13, 6);
    expect(first!.cells[0]!.blocks[0]!.box.x - first!.cells[0]!.box.x).toBeCloseTo(0.5, 6);
    expect(first!.cells[0]!.blocks[0]!.box.y - first!.cells[0]!.box.y).toBeCloseTo(0.5, 6);
    expect(layoutSemanticDocument(part, 0, options).pages).toEqual(layout.pages);
    expect(serializeOoxmlPart(part)).toBe(xml);
  }
);

test('explicit cell suppression reserves no inherited border space', () => {
  const none = ['top', 'left', 'bottom', 'right']
    .map((side) => `<w:${side} w:val="none"/>`)
    .join('');
  const part = document(`<w:tcBorders>${none}</w:tcBorders>`);
  const layout = layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer(5, 12) });
  const table = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'table')!;
  for (const row of table.rows) {
    expect(row.box.height).toBeCloseTo(12, 6);
    expect(row.cells[0]!.borders?.strokes ?? []).toHaveLength(0);
  }
});

test.each([false, true])('merged side clears every painted neighbor interval (RTL=%s)', (rtl) => {
  const sharedSide = rtl ? 'left' : 'right';
  for (const suppressedRows of [1, 2]) {
    const cell = (row: number, merged: boolean) =>
      `<w:tc><w:tcPr>${
        merged
          ? `<w:vMerge${row === 0 ? ' w:val="restart"' : ''}/>`
          : row < suppressedRows
            ? '<w:tcBorders><w:left w:val="none"/></w:tcBorders>'
            : ''
      }</w:tcPr><w:p/></w:tc>`;
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>
      ${rtl ? '<w:bidiVisual/>' : ''}
      <w:tblBorders><w:insideV w:val="single" w:sz="16"/></w:tblBorders>
      </w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>
      ${[0, 1].map((row) => `<w:tr>${cell(row, true)}${cell(row, false)}</w:tr>`).join('')}
      </w:tbl></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const body = read.part.root.children.find(
      (node) => node.kind !== 'textValue' && node.localName === 'body'
    );
    const table = body?.children.find((node) => node.kind === 'table');
    const structure = readTableStructure(table!, 240, 0)!;
    const head = structure.rows[0]!.cells[0]!;
    expect(head.borders[sharedSide].state).toBe('omitted');
    expect((head.contentBorders ?? head.borders)[sharedSide].state).toBe(
      suppressedRows === 2 ? 'omitted' : 'edge'
    );
    const laid = layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer(5, 12) });
    const fragment = laid.pages[0]!.fragments.find((item) => item.kind === 'table')!;
    const painted = fragment.rows.flatMap((row) =>
      row.cells.flatMap((cell) => cell.borders?.edgeSegments ?? [])
    );
    expect(painted.length > 0).toBe(suppressedRows === 1);
  }
});
