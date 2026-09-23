import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { readTableStructure } from '../semantic-table.ts';
import { positionedTableOriginX } from '../table-origin.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

const frames = {
  text: { left: 72, width: 468 },
  margin: { left: 72, width: 468 },
  page: { left: 0, width: 612 },
};
function document(margin = 108, extra = '', position = 'w:tblpY="1"') {
  const parsed = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      `<w:tbl><w:tblPr><w:tblpPr w:horzAnchor="text" w:vertAnchor="text" ${position}/>` +
      '<w:tblW w:type="dxa" w:w="2880"/><w:tblLayout w:type="fixed"/>' +
      `<w:tblCellMar><w:left w:type="dxa" w:w="${margin}"/></w:tblCellMar>` +
      '<w:tblBorders><w:left w:val="single" w:sz="4"/></w:tblBorders>' +
      extra +
      '</w:tblPr><w:tblGrid><w:gridCol w:w="2880"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
function structure(margin = 108, extra = '', position?: string) {
  const body = document(margin, extra, position).root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  ) as OoxmlElement;
  const table = body.children.find((node) => node.kind === 'table') as OoxmlElement;
  return readTableStructure(table, 468, 0)!;
}

test('legacy numeric text anchors align the leading content edge across cell margins', () => {
  for (const mode of [undefined, 11, 12, 14]) {
    for (const [margin, origin] of [
      [0, 71.5],
      [108, 66.35],
      [200, 61.75],
    ] as const) {
      expect(positionedTableOriginX(structure(margin), frames, mode)).toBeCloseTo(origin, 6);
    }
    expect(positionedTableOriginX(structure(108, '', 'w:tblpX="1441"'), frames, mode)).toBeCloseTo(
      138.35,
      6
    );
  }
});

test('modern, aligned, separated, and bidirectional tables retain their outer-edge anchor', () => {
  expect(positionedTableOriginX(structure(), frames, 15)).toBe(72);
  expect(positionedTableOriginX(structure(), frames, 99)).toBe(72);
  expect(positionedTableOriginX(structure(108, '', 'w:tblpXSpec="left"'), frames, 12)).toBe(72);
  expect(
    positionedTableOriginX(structure(108, '<w:tblCellSpacing w:type="dxa" w:w="20"/>'), frames, 12)
  ).toBe(72);
  expect(positionedTableOriginX(structure(108, '<w:bidiVisual/>'), frames, 12)).toBe(72);
});

test('legacy table fragments, rows, and cell text use the same origin in cold and warm layout', () => {
  const part = document();
  const session = createLayoutSession();
  const options = { measurer: createFixedMeasurer(), compatibilityMode: 12, session };
  const cold = layoutSemanticDocument(part, 1, options);
  const table = cold.pages
    .flatMap((page) => page.fragments)
    .find((block) => block.kind === 'table')!;
  expect(table.box.x).toBeCloseTo(-5.65, 6);
  expect(table.rows[0]!.box.x).toBeCloseTo(-5.65, 6);
  expect(table.rows[0]!.cells[0]!.box.x).toBeCloseTo(-5.65, 6);
  const first = table.rows[0]!.cells[0]!.blocks[0]!;
  if (first.kind !== 'paragraph') throw new Error('Expected cell paragraph');
  expect(first.lines[0]!.spans[0]!.box.x).toBeCloseTo(0, 6);
  expect(layoutSemanticDocument(part, 1, options).pages).toEqual(cold.pages);
});
