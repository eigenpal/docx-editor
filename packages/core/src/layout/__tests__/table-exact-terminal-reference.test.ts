import { expect, test } from 'bun:test';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { readTableStructure } from '../semantic-table.ts';
import { initialCellCursors, layoutRowFragmentBounded } from '../semantic-table-layout.ts';
import { tableTerminalDeps } from '../table-exact-terminal-border.ts';
import type { TableFlowDeps } from '../semantic-table-layout.ts';
import {
  exactTerminalFixture,
  tableNode,
  type ExactTerminalOptions,
} from './table-exact-terminal-fixtures.ts';

function deps(): TableFlowDeps {
  return {
    measurer: createFixedMeasurer(5, 12),
    producer: 'terminal-reference-test',
    nextLineId: (id, start, index) => `${id}:${start}:${index}`,
  };
}

// The reference keeps the same terminal rule across these authored table shapes.
for (const [name, options] of [
  ['header row', { header: true }],
  ['first-column terminal merge', { rows: 3, terminalMerge: true }],
  ['second-column merge', { rows: 3, otherColumnMerge: true }],
  ['three-row merge', { rows: 4, threeRowMerge: true }],
  ['terminal column span', { terminalSpan: true }],
  ['unequal top and bottom rules', { topWidth: 0.5 }],
  ['five-eighths rule', { width: 0.625 }],
] satisfies [string, ExactTerminalOptions][]) {
  test(`the reference terminal extent includes ${name}`, () => {
    const part = exactTerminalFixture(options);
    const source = serializeOoxmlPart(part);
    const structure = readTableStructure(tableNode(part.root), 464, 0);
    if (!structure) throw new Error('The table is missing');
    const original = deps();
    const actual = tableTerminalDeps(structure, original, undefined, false);
    expect(actual.exactTerminalBorder?.widthPt).toBe(options.width ?? 1.5);
    const result = layoutSemanticDocument(part, 0, { measurer: original.measurer });
    const tables = result.pages.flatMap((page) =>
      page.fragments.filter((fragment) => fragment.kind === 'table')
    );
    expect(tables).toHaveLength(1);
    const last = tables[0]!.rows.at(-1)!;
    expect(last.box.height).toBeCloseTo(19.85 + (options.width ?? 1.5), 6);
    if (options.terminalMerge) {
      const head = tables[0]!.rows[1]!.cells[0]!;
      expect(head.rowSpan).toBe(2);
      // Two authored rows give 39.7pt. The 0.5pt top band stays inside that box.
      expect(head.blocks[0]!.box.y - head.box.y).toBeCloseTo(14.1, 6);
    }
    expect(serializeOoxmlPart(part)).toBe(source);
  });
}

for (const align of ['center', 'bottom'] as const) {
  for (const room of [19.85, 20.5, 100]) {
    test(`${align} text uses the authored bottom with ${room}pt available`, () => {
      const part = exactTerminalFixture({ align });
      const structure = readTableStructure(tableNode(part.root), 464, 0);
      if (!structure) throw new Error('The table is missing');
      const row = structure.rows.at(-1)!;
      const actual = tableTerminalDeps(structure, deps(), undefined, false);
      const placed = layoutRowFragmentBounded(
        row,
        structure.columnWidthsPt,
        0,
        0,
        room,
        false,
        false,
        0,
        actual,
        initialCellCursors(row)
      );
      expect(placed.record.box.height).toBeCloseTo(21.35, 6);
      const paragraph = placed.record.cells[0]!.blocks[0];
      if (!paragraph || paragraph.kind !== 'paragraph')
        throw new Error('The cell paragraph is missing');
      // Authored height: 19.85pt; internal top rule: 0.5pt; bottom margin: 0pt.
      // The 1.5pt closing stroke sits below that box and reserves no text space.
      expect(paragraph.box.y).toBeCloseTo(align === 'center' ? 4.175 : 7.85, 6);
      expect(paragraph.box.height).toBeCloseTo(12, 6);
      expect(placed.remainder).toBeNull();
    });
  }
}

test('a fitting authored last row keeps its page when only the closing rule overflows', () => {
  const part = exactTerminalFixture({ pageHeight: 1800, align: 'bottom' });
  const source = serializeOoxmlPart(part);
  const result = layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer(5, 12) });
  const first = result.pages[0]!;
  const table = first.fragments.find((fragment) => fragment.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('The table is missing');
  expect(table.rows).toHaveLength(2);
  const last = table.rows.at(-1)!;
  const authoredBottom = last.box.y + 19.85;
  expect(authoredBottom).toBeLessThanOrEqual(54.001);
  expect(last.box.y + last.box.height).toBeCloseTo(authoredBottom + 1.5, 6);
  expect(last.box.y + last.box.height).toBeGreaterThan(54);
  expect(
    result.pages[1]!.fragments.some(
      (fragment) =>
        fragment.kind === 'paragraph' &&
        fragment.lines.some((line) => line.spans.some((span) => span.text === 'AFTER'))
    )
  ).toBe(true);
  expect(serializeOoxmlPart(part)).toBe(source);
});
