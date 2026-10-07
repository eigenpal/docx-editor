import { afterEach, expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { caretAt } from '../semantic-interaction.ts';
import { createParagraphLayoutCache, tableCellBreakKeysOf } from '../layout-cache.ts';
import { readTableStructure } from '../semantic-table.ts';
import { movedRowsTestRecorder } from '../table-row-geometry-reuse.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';
import { lay, load, styleCascade } from './table-row-keep-fixtures.ts';

// Page body: 310pt wide, 170pt tall, twelve 14pt lines. Token text is 6pt per character.
const p = (text: string, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:widowControl w:val="0"/>` +
  '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr>' +
  (text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : '') +
  '</w:p>';
const tc = (content: string, tcPr = '') => `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`;
const tr = (cells: readonly string[], trPr = '') =>
  `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`;
const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4"/>`)
    .join('') +
  '</w:tblBorders>';
const MARGINS =
  '<w:tblCellMar><w:top w:w="20" w:type="dxa"/><w:left w:w="60" w:type="dxa"/>' +
  '<w:bottom w:w="20" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar>';
const autofit = (rows: readonly string[], columns = 3) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>${BORDERS}${MARGINS}</w:tblPr>` +
  `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(columns)}</w:tblGrid>${rows.join('')}</w:tbl>`;

// Alignments, indents and vertical centring that a moved line must reproduce exactly.
const FORMATS = [
  '',
  '<w:jc w:val="center"/>',
  '<w:jc w:val="right"/>',
  '<w:jc w:val="both"/>',
  '<w:ind w:left="120" w:right="80" w:firstLine="100"/>',
  '<w:ind w:left="200" w:hanging="100"/><w:jc w:val="center"/>',
];
const tokenRow = (i: number) =>
  tr(
    [0, 1, 2].map((c) =>
      tc(
        // Some empty cells: an empty line places its content edge from the line indent.
        p((i * 3 + c) % 7 === 0 ? '' : `R${i}C${c}`, FORMATS[(i + c) % FORMATS.length]),
        c === 1 ? '<w:vAlign w:val="center"/>' : c === 2 ? '<w:vAlign w:val="bottom"/>' : ''
      )
    ),
    i % 4 === 0 ? '<w:trHeight w:val="400" w:hRule="atLeast"/>' : ''
  );

const tableNode = (part: OoxmlPart): OoxmlElement =>
  part.root.children
    .find((node) => node.kind === 'body')!
    .children.find((node) => node.kind === 'table')! as OoxmlElement;
const reparsed = (part: OoxmlPart): OoxmlPart => {
  const result = readOoxmlPart(serializeOoxmlPart(part), {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw Error(result.reason);
  return result.part;
};
const edges = (layout: SemanticLayout): string =>
  JSON.stringify(
    layout.pages
      .flatMap((page) => page.fragments)
      .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
      .map((fragment) => [fragment.box.x, fragment.columnEdges])
  );
const paragraphAt = (part: OoxmlPart, row: number, cell: number): string =>
  readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[row]!.cells[cell]!.blocks[0]!.id;

let recorder = movedRowsTestRecorder();
afterEach(() => {
  recorder.dispose();
  recorder = movedRowsTestRecorder();
});

/** Type `text` into a cell through a retained session, checking every step against cold. */
function burst(start: OoxmlPart, paragraphId: string, text: string) {
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  let part = start;
  let previous = lay(part, 15, { session, cache });
  let widthChanges = 0;
  const moved: number[] = [];
  for (const [index, character] of [...text].entries()) {
    const edit = applyTreeOp(part, {
      op: 'insertText',
      paragraphId,
      offset: index,
      text: character,
    });
    if (!edit.ok) throw Error(edit.reason);
    part = edit.part;
    const before = recorder.moved;
    const updated = lay(part, 15, { session, cache });
    expect(updated.pages).toEqual(lay(reparsed(part)).pages);
    if (edges(previous) !== edges(updated)) {
      widthChanges += 1;
      moved.push(recorder.moved - before);
    }
    previous = updated;
  }
  return { widthChanges, moved, part, session, cache };
}

test('ordinary single-line rows move to new widths with cold-layout geometry', () => {
  const part = load(autofit(Array.from({ length: 30 }, (_, i) => tokenRow(i))));
  const result = burst(part, paragraphAt(part, 13, 1), 'WIDER');
  expect(result.widthChanges).toBeGreaterThan(2);
  // Every body row except the edited one moves; header-less, so 29 rows per width change.
  expect(result.moved.every((count) => count >= 29)).toBe(true);
  // Moved cells report their placement's break keys, so retention keeps those entries.
  const keys = new Set(tableCellBreakKeysOf(tableNode(result.part)));
  expect(keys.size).toBeGreaterThanOrEqual(30 * 3 - 1);
});

test('empty cells and repeated header rows', () => {
  const header = tr([tc(p('Head0')), tc(p('Head1')), tc(p('Head2'))], '<w:tblHeader/>');
  const rows = Array.from({ length: 40 }, (_, i) =>
    tr([0, 1, 2].map((c) => tc(p((i + c) % 3 === 0 ? '' : `R${i}C${c}`))))
  );
  const part = load(autofit([header, ...rows]));
  const result = burst(part, paragraphAt(part, 21, 1), 'WIDTHWIDTHWIDTH');
  expect(result.widthChanges).toBeGreaterThan(1);
  // Body rows move; header rows and their repeats are placed again.
  expect(result.moved.every((count) => count >= 38)).toBe(true);
});

test('undo moves rows back to the original widths', () => {
  const part = load(autofit(Array.from({ length: 30 }, (_, i) => tokenRow(i))));
  const result = burst(part, paragraphAt(part, 13, 1), 'WIDE');
  const before = recorder.moved;
  const undone = lay(part, 15, { session: result.session, cache: result.cache });
  expect(undone.pages).toEqual(lay(part).pages);
  expect(recorder.moved - before).toBeGreaterThan(20);
});

for (const [name, content] of [
  ['a trailing space', (i: number) => p(`A${i} `)],
  ['two paragraphs', (i: number) => p(`P${i}`) + p('Q')],
  ['paragraph shading', (i: number) => p(`S${i}`, '<w:shd w:val="clear" w:fill="FFEE00"/>')],
] as const)
  test(`cells with ${name} are placed again, not moved`, () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      tr([tc(content(i)), tc(p(`R${i}C1`)), tc(p(`R${i}C2`))])
    );
    const part = load(autofit(rows));
    const result = burst(part, paragraphAt(part, 13, 1), 'WIDER');
    expect(result.widthChanges).toBeGreaterThan(0);
    expect(result.moved.every((count) => count === 0)).toBe(true);
  });

test('cells with ordinary inner spaces move like token cells', () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    tr([tc(p(`Item ${i} (net) 1.5`)), tc(p(`R${i} C1`)), tc(p(` R${i}  C2`))])
  );
  const part = load(autofit(rows));
  const result = burst(part, paragraphAt(part, 13, 1), 'WIDER');
  expect(result.widthChanges).toBeGreaterThan(0);
  expect(result.moved.every((count) => count >= 29)).toBe(true);
});

test('a line that wraps at the new width is not moved', () => {
  // The long token in row 5 fits only while its column keeps its share of the table.
  const rows = Array.from({ length: 30 }, (_, i) =>
    tr([tc(p(i === 5 ? 'L'.repeat(16) : `R${i}C0`)), tc(p(`R${i}C1`)), tc(p(`R${i}C2`))])
  );
  const part = load(autofit(rows));
  const result = burst(part, paragraphAt(part, 13, 1), 'MUCHWIDERTEXTHERE');
  expect(result.widthChanges).toBeGreaterThan(0);
});

test('a moved row equals a fresh placement, and every break input change refuses it', async () => {
  const { layoutRowFragment } = await import('../semantic-table-layout.ts');
  const { moveRowToWidths } = await import('../table-row-geometry-reuse.ts');
  const { bodyLineId } = await import('../body-line-id.ts');
  const { createFixedMeasurer } = await import('../semantic-layout.ts');
  const { measurer } = await import('./table-row-keep-fixtures.ts');
  const part = load(autofit(Array.from({ length: 6 }, (_, i) => tokenRow(i))));
  const structure = readTableStructure(tableNode(part), 310, 0, styleCascade)!;
  const deps = {
    measurer,
    styleCascade,
    // The move reads the placed line back from the break cache.
    cache: createParagraphLayoutCache<never>(),
    producer: 'unit',
    nextLineId: bodyLineId,
    compatibilityMode: 15,
    displayMode: 'all-markup' as const,
  };
  const narrow = [90, 100, 110];
  const wide = [100.5, 95.25, 104.125];
  for (const row of structure.rows) {
    const placed = layoutRowFragment(row, narrow, 3, 40, false, 0, deps).record;
    // Before any fresh placement at the new width: that one moves the cache entry to its key.
    const moved = moveRowToWidths(row, placed, wide, 2.5, deps);
    expect(moved).toEqual(layoutRowFragment(row, wide, 2.5, 40, false, 0, deps).record);
    const again = layoutRowFragment(row, narrow, 3, 40, false, 0, deps).record;
    // Each input of the break key, and each dependency of the line, must still match.
    for (const changed of [
      { producer: 'another-font' },
      { measurer: createFixedMeasurer(6, 14) },
      { styleCascade: undefined },
      { displayMode: 'proposed' as const },
      { compatibilityMode: 14 },
      { projectionTokenForParagraph: () => 'field-value' },
      { drawingTokenForParagraph: () => 'picture' },
      { listItems: new Map(row.cells.map((cell) => [cell.blocks[0]!.id, {} as never])) },
      { cache: createParagraphLayoutCache<never>() },
      { cache: undefined },
    ])
      expect(moveRowToWidths(row, again, wide, 2.5, { ...deps, ...changed })).toBeNull();
    // A width that no longer holds the line needs a fresh break.
    expect(moveRowToWidths(row, again, [20, 20, 20], 0, deps)).toBeNull();
    expect(moveRowToWidths(row, again, wide, 2.5, deps)).not.toBeNull();
  }
});

test('a row whose paragraph changed, or whose line inputs changed, is not moved', async () => {
  const { layoutRowFragment } = await import('../semantic-table-layout.ts');
  const { moveRowToWidths } = await import('../table-row-geometry-reuse.ts');
  const { bodyLineId } = await import('../body-line-id.ts');
  const { measurer } = await import('./table-row-keep-fixtures.ts');
  const part = load(autofit([tokenRow(1), tokenRow(2)]));
  const deps = {
    measurer,
    styleCascade,
    cache: createParagraphLayoutCache<never>(),
    producer: 'unit',
    nextLineId: bodyLineId,
    compatibilityMode: 15,
    displayMode: 'all-markup' as const,
  };
  const before = readTableStructure(tableNode(part), 310, 0, styleCascade)!.rows[0]!;
  const placed = layoutRowFragment(before, [90, 100, 110], 3, 40, false, 0, deps).record;
  expect(moveRowToWidths(before, placed, [100, 95, 105], 2.5, deps)).not.toBeNull();
  // Same formatting, new text: the old line must not be moved under the new paragraph.
  const edit = applyTreeOp(part, {
    op: 'insertText',
    paragraphId: before.cells[1]!.blocks[0]!.id,
    offset: 0,
    text: 'X',
  });
  if (!edit.ok) throw Error(edit.reason);
  const after = readTableStructure(tableNode(edit.part), 310, 0, styleCascade)!.rows[0]!;
  expect(moveRowToWidths(after, placed, [100, 95, 105], 2.5, deps)).toBeNull();
  // Same paragraph, a line-grid unit that changes its line inputs.
  const gridded = { ...deps, paragraphLineUnitPt: 18 };
  expect(moveRowToWidths(before, placed, [100, 95, 105], 2.5, gridded)).toBeNull();
});

test('saved pagination markers preserve moved rows and caret geometry', () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    tokenRow(i).replaceAll('<w:t ', '<w:lastRenderedPageBreak/><w:t ')
  );
  const part = load(autofit(rows));
  const result = burst(part, paragraphAt(part, 13, 1), 'WIDER');
  expect(result.widthChanges).toBeGreaterThan(2);
  expect(result.moved.every((count) => count >= 29)).toBe(true);
  const retained = lay(result.part, 15, { session: result.session, cache: result.cache });
  const cold = lay(reparsed(result.part));
  const paragraphId = paragraphAt(result.part, 7, 2);
  for (const offset of [0, 1, 4]) {
    const position = { paragraphId, offset };
    expect(caretAt(retained, position)).not.toBeNull();
    expect(caretAt(retained, position)).toEqual(caretAt(cold, position));
  }
});
