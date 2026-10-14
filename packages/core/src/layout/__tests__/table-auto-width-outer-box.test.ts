import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const edges = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];

/** An automatic-width table with 3pt rules whose grid fills the 468pt text column. */
function grid(columns: readonly number[], texts: readonly string[], jc: string) {
  const cells = columns
    .map(
      (width, index) =>
        `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${texts[index]}</w:t></w:r></w:p></w:tc>`
    )
    .join('');
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
      `<w:jc w:val="${jc}"/><w:tblBorders>${edges.map((edge) => `<w:${edge} w:val="single" w:sz="24"/>`).join('')}</w:tblBorders>` +
      `</w:tblPr><w:tblGrid>${columns.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>` +
      `<w:tr>${cells}</w:tr></w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    compatibilityMode: 15,
  });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  const cellsBoxes = table.rows[0]!.cells.map((cell) => cell.box);
  return cellsBoxes.map((box) => box.width);
}

const total = (widths: readonly number[]) => widths.reduce((sum, width) => sum + width, 0);

for (const jc of ['left', 'center', 'right']) {
  test(`a ${jc}-aligned automatic-width table keeps its outer rules in the text column`, () => {
    // The grid gives way by one 3pt rule: half of each outer rule sits inside the column.
    const even = grid([3120, 3120, 3120], ['a', 'b', 'c'], jc);
    expect(total(even)).toBeCloseTo(465, 6);
    expect(even[0]!).toBeCloseTo(155, 6);
    // A widened column settles against the same 465pt grid.
    expect(total(grid([4000, 4360, 1000], ['a', 'b', 'x'.repeat(16)], jc))).toBeCloseTo(465, 6);
  });
}
