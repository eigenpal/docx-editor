import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { hitTestPage } from '../semantic-hit-test.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const text = 'A'.repeat(39);
function fixture(alignment: string, layout = 'autofit') {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>
    <w:tbl><w:tblPr><w:tblW w:w="10206" w:type="dxa"/><w:jc w:val="${alignment}"/><w:tblLayout w:type="${layout}"/></w:tblPr>
    <w:tblGrid><w:gridCol w:w="5015"/><w:gridCol w:w="5191"/></w:tblGrid>
    <w:tr><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Right cell</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const measurer = createFixedMeasurer(6, 14);
for (const layout of ['fixed', 'autofit']) {
  for (const [alignment, x] of [
    ['left', 0],
    ['center', -17],
    ['right', -34],
  ] as const) {
    test(`${layout} ${alignment} preserves the authored width, wrapping, and margin hit testing`, () => {
      const source = fixture(alignment, layout),
        before = serializeOoxmlPart(source);
      const options = {
        measurer,
        session: createLayoutSession(),
        geometry: {
          width: 595.35,
          height: 842,
          margin: { left: 56.7, right: 62.35, top: 56.7, bottom: 35.35 },
        },
      };
      const result = layoutSemanticDocument(source, 0, options);
      expect(layoutSemanticDocument(source, 0, options).pages).toEqual(result.pages);
      expect(serializeOoxmlPart(source)).toBe(before);
      expect(result.pages).toHaveLength(1);
      const page = result.pages[0]!;
      const table = page.fragments.find((f) => f.kind === 'table')!;
      expect(table.box.width).toBeCloseTo(510.3, 6);
      expect(table.box.x).toBeCloseTo(x, 6);
      expect(table.rows[0]!.cells.map((c) => c.box.width)).toEqual([250.75, 259.55]);
      const lines = linesOf(result);
      expect(lines).toHaveLength(2);
      expect(lines[0]!.spans.map((s) => s.text).join('')).toBe(text);
      const first = lines[0]!;
      const hit = hitTestPage(
        result,
        0,
        {
          x: page.contentBox.x + first.contentX + 2,
          y: page.contentBox.y + first.box.y + first.box.height / 2,
        },
        { measurer }
      );
      expect(hit?.position?.paragraphId).toBe(first.range.paragraphId);
    });
  }
}
