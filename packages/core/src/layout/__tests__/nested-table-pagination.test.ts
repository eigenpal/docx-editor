import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession, layoutSemanticDocument, linesOf } from '../index.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const row = (content: string, properties = '') =>
  `<w:tr><w:trPr>${properties}</w:trPr><w:tc>${content}</w:tc></w:tr>`;
const table = (rows: string) => `<w:tbl><w:tblPr><w:tblW w:w="1800" w:type="dxa"/>
  <w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar>
  </w:tblPr><w:tblGrid><w:gridCol w:w="1800"/></w:tblGrid>${rows}</w:tbl>`;
const options = {
  geometry: { width: 120, height: 60, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  measurer: {
    measure: (text: string) => text.length * 4,
    lineMetrics: () => ({ height: 10, baseline: 8 }),
  },
};
function source(inner: string, outerProperties = '') {
  const xml = `<w:document xmlns:w="${W}"><w:body>${p('prefix 0')}${p('prefix 1')}${p('prefix 2')}
    ${table(row(inner, outerProperties))}${p('after')}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const ordinary = () => table(Array.from({ length: 5 }, (_, i) => row(p(`inner ${i}`))).join(''));

test('nested rows fill the remaining band and resume without duplicates or changed source', () => {
  const part = source(ordinary());
  const original = serializeOoxmlPart(part);
  const layout = layoutSemanticDocument(part, 0, options);
  expect(layout.pages).toHaveLength(2);
  const nested = layout.pages.flatMap((page) =>
    page.fragments.flatMap((block) =>
      block.kind === 'table'
        ? block.rows.flatMap((row) =>
            row.cells.flatMap((cell) =>
              cell.blocks.filter((child): child is TableFragmentRecord => child.kind === 'table')
            )
          )
        : []
    )
  );
  expect(nested.map((t) => t.rows.length)).toEqual([3, 2]);
  expect(nested.map((t) => t.fragmentIndex)).toEqual([0, 1]);
  expect(new Set(nested.map((t) => t.id)).size).toBe(2);
  expect(nested.flatMap((t) => t.rows.map((row) => row.rowIndex))).toEqual([0, 1, 2, 3, 4]);
  expect(nested.map((t) => [t.box.y, t.box.height])).toEqual([
    [30, 30],
    [0, 20],
  ]);
  const lines = linesOf(layout);
  expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'prefix 0',
    'prefix 1',
    'prefix 2',
    'inner 0',
    'inner 1',
    'inner 2',
    'inner 3',
    'inner 4',
    'after',
  ]);
  expect(new Set(lines.map((line) => line.id)).size).toBe(lines.length);
  expect(serializeOoxmlPart(part)).toBe(original);
  const session = createLayoutSession();
  for (let revision = 0; revision < 2; revision++)
    expect(layoutSemanticDocument(part, revision, { ...options, session }).pages).toEqual(
      layout.pages
    );
});

test('an atomic outer row still carries its nested table whole', () => {
  const layout = layoutSemanticDocument(source(ordinary(), '<w:cantSplit/>'), 0, options);
  expect(layout.pages).toHaveLength(2);
  expect(layout.pages[0]!.fragments.every((block) => block.kind !== 'table')).toBe(true);
});

test('a nested row that cannot start here moves whole before its later rows continue', () => {
  const inner = table(row(p('a') + p('b') + p('c') + p('d'), '<w:cantSplit/>') + row(p('e')));
  const layout = layoutSemanticDocument(source(inner), 0, options);
  expect(layout.pages[0]!.fragments.every((block) => block.kind !== 'table')).toBe(true);
  expect(linesOf(layout).map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'prefix 0',
    'prefix 1',
    'prefix 2',
    'a',
    'b',
    'c',
    'd',
    'e',
    'after',
  ]);
});

test('nested repeated-header tables retain their atomic fallback', () => {
  const inner = table(row(p('head'), '<w:tblHeader/>') + row(p('a')) + row(p('b')) + row(p('c')));
  const layout = layoutSemanticDocument(source(inner), 0, options);
  expect(layout.pages[0]!.fragments.every((block) => block.kind !== 'table')).toBe(true);
  expect(
    linesOf(layout).filter((line) => line.spans.some((span) => span.text === 'head'))
  ).toHaveLength(1);
});
