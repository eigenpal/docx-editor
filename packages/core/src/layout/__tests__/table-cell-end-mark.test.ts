import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession, layoutSemanticDocument, linesOf } from '../index.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { flowBlocksInBox, layoutRowFragment } from '../semantic-table-layout.ts';
import { readTableStructure } from '../semantic-table.ts';
import type { PendingLine, TextMeasurer } from '../paragraph-flow.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer: TextMeasurer = {
  measure: (text, style) => text.length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({ height: style.fontSizePt, baseline: style.fontSizePt * 0.8 }),
};
const paragraph = (text: string, mark = 20) =>
  `<w:p><w:pPr><w:rPr><w:sz w:val="${mark * 2}"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="10"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const table = (content: string, cellProperties = '', rowProperties = '') =>
  `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr>${rowProperties}</w:trPr><w:tc><w:tcPr>${cellProperties}</w:tcPr>${content}</w:tc></w:tr></w:tbl>`;
function load(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
function run(body: string, height = 200) {
  const part = load(body);
  const before = serializeOoxmlPart(part);
  const options = {
    measurer,
    session: createLayoutSession(),
    geometry: {
      width: 150,
      height,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
  };
  const result = layoutSemanticDocument(part, 0, options);
  expect(layoutSemanticDocument(part, 0, options).pages).toEqual(result.pages);
  expect(serializeOoxmlPart(part)).toBe(before);
  return result;
}
function rows(result: ReturnType<typeof run>) {
  return result.pages.flatMap((p) =>
    p.fragments.flatMap((f) => (f.kind === 'table' ? f.rows : []))
  );
}

test('a cell marker sets a row minimum without adding height to its final printable line', () => {
  const result = run(table(paragraph('Short')));
  expect(rows(result)[0]!.box.height).toBe(20);
  expect(linesOf(result)[0]!.box.height).toBe(5);
  expect(linesOf(result)[0]!.baseline).toBe(4);
});

test('wrapped small text grows beyond the cell marker without enlarging its last line', () => {
  const result = run(table(paragraph('Small text '.repeat(30))));
  const lines = linesOf(result);
  expect(lines.length).toBeGreaterThan(4);
  expect(lines.every((line) => line.box.height === 5)).toBe(true);
  expect(rows(result)[0]!.box.height).toBe(lines.length * 5);
});

test('only the final paragraph uses the cell marker, and bottom alignment uses the row floor', () => {
  const result = run(table(paragraph('First') + paragraph('Last'), '<w:vAlign w:val="bottom"/>'));
  const lines = linesOf(result);
  expect(lines.map((line) => line.box.height)).toEqual([20, 5]);
  expect(rows(result)[0]!.box.height).toBe(25);
  const single = run(table(paragraph('Last'), '<w:vAlign w:val="bottom"/>'));
  const row = rows(single)[0]!;
  const line = linesOf(single)[0]!;
  expect(line.box.y + line.box.height).toBe(row.box.y + row.box.height);
});

for (const [rule, expected] of [
  ['exact', 8],
  ['atLeast', 20],
] as const) {
  test(`an ${rule} row retains its authored height constraint`, () => {
    const result = run(
      table(paragraph('Small'), '', `<w:trHeight w:val="160" w:hRule="${rule}"/>`)
    );
    expect(rows(result)[0]!.box.height).toBe(expected);
    expect(linesOf(result)[0]!.box.height).toBe(5);
  });
}

test('a row moves when the printable text fits but its marker minimum does not', () => {
  const result = run(paragraph('Prefix', 15) + table(paragraph('Cell')), 30);
  expect(result.pages).toHaveLength(2);
  expect(result.pages[0]!.fragments.every((f) => f.kind !== 'table')).toBe(true);
  expect(rows(result)[0]!.box.height).toBe(20);
});

test('split rows reserve the marker minimum in their final fragment without losing text', () => {
  const text = 'Small text '.repeat(35);
  const result = run(table(paragraph(text)), 30);
  expect(result.pages.length).toBeGreaterThan(1);
  expect(rows(result).at(-1)!.box.height).toBeGreaterThanOrEqual(20);
  expect(rows(result).every((row) => row.box.height <= 30)).toBe(true);
  expect(
    linesOf(result)
      .flatMap((line) => line.spans.map((span) => span.text))
      .join('')
  ).toBe(text);
});

test('a collapsed nested-table terminator cannot restore its oversized marker floor', () => {
  const nested = table(paragraph('Nested', 5));
  const terminator = '<w:p><w:pPr><w:rPr><w:sz w:val="72"/></w:rPr></w:pPr></w:p>';
  const result = run(table(nested + terminator));
  expect(rows(result)[0]!.box.height).toBe(5);
  expect(linesOf(result).at(-1)!.box.height).toBe(0);
  expect(rows(run(table('<w:tbl/>' + terminator)))[0]!.box.height).toBe(36);
});

test('vertical cells keep their existing rotated paragraph-marker geometry', () => {
  const result = run(table(paragraph('Small'), '<w:textDirection w:val="btLr"/>'));
  expect(linesOf(result)[0]!.box.height).toBe(20);
});

test('the same paragraph cannot reuse a break from a different cell-end role', () => {
  const part = load(table(paragraph('Small')));
  const body = part.root.children.find((n) => n.kind !== 'textValue' && n.localName === 'body')!;
  if (body.kind === 'textValue') throw new Error('body');
  const node = body.children.find((n) => n.kind === 'table')!;
  const structure = readTableStructure(node, 100, 0)!;
  const row = structure.rows[0]!;
  const paragraphNode = row.cells[0]!.blocks[0]!;
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const deps = { measurer, cache, producer: 'cell-marker-test', nextLineId: () => 'line' };
  for (const end of [false, true, false, true]) {
    const placed = end
      ? layoutRowFragment(row, [100], 0, 0, false, 0, deps).record.cells[0]!.blocks[0]!
      : flowBlocksInBox([paragraphNode], 0, 100, 0, 0, deps).blocks[0]!;
    if (placed.kind !== 'paragraph') throw new Error('paragraph');
    expect(placed.lines[0]!.box.height).toBe(end ? 5 : 20);
  }
  expect(cache.stats.hits).toBeGreaterThan(0);
});
