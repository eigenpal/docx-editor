// A text-anchored floating table in a table cell whose band rises above its anchor
// (`w:tblpY` < 0, ECMA-376 Part 1, 17.4.57) keeps its place, and the earlier paragraphs of the
// cell that the band reaches lay out again around it: a line that fits beside the table stays
// beside it, the others move below it, and the anchor paragraph follows them.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  ParagraphFragmentRecord,
  TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SPACING = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>';
const p = (text: string) =>
  `<w:p><w:pPr>${SPACING}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const empty = `<w:p><w:pPr>${SPACING}</w:pPr></w:p>`;
/** A floating table `twips` wide, raised `y` twips, with two one-line rows of text. */
const float = (y: number, twips: number) =>
  `<w:tbl><w:tblPr><w:tblpPr w:leftFromText="144" w:rightFromText="144" w:vertAnchor="text" ` +
  `w:horzAnchor="margin" w:tblpY="${y}"/><w:tblW w:w="${twips}" w:type="dxa"/>` +
  `<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${twips}"/></w:tblGrid>` +
  `<w:tr><w:tc>${p('F0')}${p('F1')}</w:tc></w:tr></w:tbl>`;
/** A 300pt-wide outer table with one cell holding `cell`. */
const outer = (cell: string) =>
  '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
  `<w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>${cell}</w:tc></w:tr></w:tbl>`;
const lay = (cell: string) => {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${p('top')}${outer(cell)}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer(6, 12) });
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table') as TableFragmentRecord;
  return table.rows[0]!.cells[0]!.blocks;
};
const text = (line: LineRecord) => line.spans.map((span) => span.text).join('');
const paragraphs = (blocks: readonly BlockFragmentRecord[]) =>
  blocks.filter((b): b is ParagraphFragmentRecord => b.kind === 'paragraph');
const byText = (blocks: readonly BlockFragmentRecord[], tag: string) =>
  paragraphs(blocks).find((q) => q.lines[0] && text(q.lines[0]).startsWith(tag))!;
const floatOf = (blocks: readonly BlockFragmentRecord[]) =>
  blocks.find((b): b is TableFragmentRecord => b.kind === 'table')!;

const FULL = 5980;

test('a raised float that spans the cell moves the earlier line it covers below it', () => {
  // Without the float the anchor would start at 48: L2 (36-48) crosses the raised band.
  const blocks = lay(p('L0') + p('L1') + p('L2') + float(-200, FULL) + p('anchor') + p('after'));
  const table = floatOf(blocks);
  const l2 = byText(blocks, 'L2');
  const anchor = byText(blocks, 'anchor');
  // The float keeps the place its anchor had before the move.
  expect(table.box.y).toBeCloseTo(48 - 10, 1);
  // L1 ends above the band and stays; L2 moves below the float, and the anchor follows it.
  expect(byText(blocks, 'L1').lines[0]!.box.y).toBeCloseTo(24, 3);
  expect(l2.lines[0]!.box.y).toBeCloseTo(table.box.y + table.box.height, 3);
  expect(anchor.lines[0]!.box.y).toBeCloseTo(l2.lines[0]!.box.y + 12, 3);
  expect(byText(blocks, 'after').lines[0]!.box.y).toBeCloseTo(anchor.lines[0]!.box.y + 12, 3);
});

test('a raised float that spans the cell moves the empty earlier paragraphs it covers too', () => {
  const blocks = lay(p('L0') + p('L1') + empty + empty + float(-290, FULL) + p('anchor'));
  const table = floatOf(blocks);
  const [first, second] = paragraphs(blocks).filter((q) => q.lines.every((l) => !text(l)));
  const below = table.box.y + table.box.height;
  expect(first!.lines[0]!.box.y).toBeCloseTo(below, 3);
  expect(second!.lines[0]!.box.y).toBeCloseTo(below + 12, 3);
  expect(byText(blocks, 'anchor').lines[0]!.box.y).toBeCloseTo(below + 24, 3);
});

test('an earlier line beside a raised float with a passage wraps beside it', () => {
  const blocks = lay(p('L0') + p('L1') + p('L2') + float(-200, 2000) + p('anchor'));
  const table = floatOf(blocks);
  const l2 = byText(blocks, 'L2').lines[0]!;
  // L2 keeps its line but leaves the float and its 7.2pt side distance clear.
  expect(l2.box.y).toBeCloseTo(36, 3);
  expect(l2.spans[0]!.box.x).toBeGreaterThanOrEqual(table.box.x + table.box.width + 7.2 - 0.01);
  expect(byText(blocks, 'L1').lines[0]!.spans[0]!.box.x).toBeLessThan(table.box.x + 1);
});

test('a float at its anchor top, or with a table between, leaves the earlier lines in place', () => {
  const level = lay(p('L0') + p('L1') + p('L2') + float(0, FULL) + p('anchor'));
  expect(byText(level, 'L2').lines[0]!.box.y).toBeCloseTo(36, 3);
  expect(byText(level, 'anchor').lines[0]!.box.y).toBeCloseTo(
    floatOf(level).box.y + floatOf(level).box.height,
    3
  );
  // An in-flow table ends the run of paragraphs a later raised float can move.
  const inFlow =
    '<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p('T0')}</w:tc></w:tr></w:tbl>`;
  const between = lay(p('L0') + inFlow + float(-600, FULL) + p('anchor'));
  expect(byText(between, 'L0').lines[0]!.box.y).toBeCloseTo(12, 3);
});

test('earlier lines the float would push past the page bottom keep their place', () => {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${Array.from({ length: 49 }, (_, i) => p(`top${i}`)).join('')}` +
      `${outer(p('L0') + p('L1') + p('L2') + float(-200, FULL) + p('anchor'))}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer(6, 12) });
  const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table') as TableFragmentRecord;
  const blocks = table.rows[0]!.cells[0]!.blocks;
  // L2 (612-624) crosses the float's band, but below the float it would end past the page
  // bottom, so it keeps its place and the anchor continues on the next page.
  expect(floatOf(blocks).box.y).toBeCloseTo(624 - 10, 1);
  expect(byText(blocks, 'L2').lines[0]!.box.y).toBeCloseTo(612, 3);
  expect(layout.pages.length).toBe(2);
});
