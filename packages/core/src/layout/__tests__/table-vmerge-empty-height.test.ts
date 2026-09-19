import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (merge: string, text: string) =>
  `<w:tc><w:tcPr><w:vMerge ${merge}/></w:tcPr>${p(text)}</w:tc>`;
function table(rowProperties = '', content = p('Head')) {
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl>
    <w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>
    <w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>
    <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${content}</w:tc></w:tr>
    <w:tr>${rowProperties}${cell('', 'Ignored continuation')}</w:tr>
    <w:tr><w:tc>${p('After')}</w:tc></w:tr>
    </w:tbl>${p('Closing')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer: createFixedMeasurer() });
  expect(layout.pages).toHaveLength(1);
  const table = layout.pages[0]!.fragments.find(
    (f): f is TableFragmentRecord => f.kind === 'table'
  )!;
  expect(table.rows).toHaveLength(3);
  const head = table.rows[0]!.cells[0]!;
  expect(head.rowSpan).toBe(2);
  for (const block of head.blocks)
    expect(block.box.y + block.box.height).toBeLessThanOrEqual(
      head.box.y + head.box.height + 0.001
    );
  expect(table.rows[1]!.cells[0]!.blocks).toEqual([]);
  return table;
}

test('an automatic continuation-only row adds no phantom line to its merged cell', () => {
  const result = table();
  expect(result.rows[1]!.box.height).toBe(0);
  expect(result.rows[2]!.box.y).toBe(result.rows[1]!.box.y);
});

for (const rule of ['atLeast', 'exact']) {
  test(`a continuation-only row preserves its ${rule} authored height`, () => {
    const result = table(`<w:trPr><w:trHeight w:val="720" w:hRule="${rule}"/></w:trPr>`);
    expect(result.rows[1]!.box.height).toBe(36);
  });
}

test('a continuation-only row still carries the merged content height', () => {
  const result = table('', Array.from({ length: 6 }, (_, i) => p(`Line ${i}`)).join(''));
  expect(result.rows[1]!.box.height).toBeGreaterThan(0);
  expect(result.rows[0]!.cells[0]!.blocks).toHaveLength(6);
});
