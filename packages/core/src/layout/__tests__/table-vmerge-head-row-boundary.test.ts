// A two-row vertical merge (17.4.85 `w:vMerge`) whose page break falls right after its head
// row. From mode 15 on, when the merged text cannot place a line inside the head row's own
// height, the head row keeps its own cells on the first page and the whole merged text starts
// beside the continuation row on the next page. See `table-vmerge-boundary.ts`.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type {
  BlockFragmentRecord,
  PageGeometry,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// A 210pt content box. Every line is exactly 12pt, and a cell paragraph adds 6pt before it.
const GEOMETRY: PageGeometry = {
  width: 350,
  height: 250,
  margin: { top: 20, right: 20, bottom: 20, left: 20 },
};
const LINE = 12;
const BEFORE = 6;
/** `w:trHeight` 560 twips, `atLeast`. */
const ROW_MIN = 28;

interface Shape {
  /** Body lines above the table: the head row starts at `fill * LINE`. */
  readonly fill: number;
  /** Lines of merged text, in one paragraph broken by `w:br`. */
  readonly merged: number;
  readonly mode?: number;
  /** A third row the merges also cover. */
  readonly threeRows?: boolean;
  readonly cantSplit?: boolean;
  /** One-line paragraphs of the continuation row's own text. */
  readonly nextParagraphs?: number;
  /** Extra `w:pPr` content for the merged paragraph. */
  readonly mergedPPr?: string;
}

const spacing = (before: number) =>
  `<w:spacing w:before="${before}" w:after="0" w:line="240" w:lineRule="exact"/>`;
const paragraph = (lines: readonly string[], before = 120, pPr = '') =>
  `<w:p><w:pPr>${spacing(before)}${pPr}</w:pPr>` +
  lines
    .map((text, index) => `${index ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t>${text}</w:t></w:r>`)
    .join('') +
  '</w:p>';
const cell = (width: number, content: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;
const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';

function document(shape: Shape): string {
  const trPr = `<w:trPr>${shape.cantSplit ? '<w:cantSplit/>' : ''}<w:trHeight w:val="560"/></w:trPr>`;
  const merged = Array.from({ length: shape.merged }, (_, index) => `M${index + 1}`);
  const own = (label: string, count = 1) =>
    Array.from({ length: count }, (_, index) => paragraph([index ? `${label}x${index}` : label]));
  const continued = (label: string, count = 1) =>
    `<w:tr>${trPr}${cell(1300, paragraph([]), CONTINUE)}${cell(1500, own(label, count).join(''))}` +
    `${cell(3000, paragraph([]), CONTINUE)}</w:tr>`;
  const rows =
    `<w:tr>${trPr}${cell(1300, paragraph(['HEADA']), RESTART)}${cell(1500, paragraph(['ROWA']))}` +
    `${cell(3000, paragraph(merged, 120, shape.mergedPPr), RESTART)}</w:tr>` +
    continued('ROWB', shape.nextParagraphs) +
    (shape.threeRows ? continued('ROWC') : '') +
    `<w:tr>${cell(1300, paragraph(['NEXT']))}${cell(4500, paragraph(['AFTER']), '<w:gridSpan w:val="2"/>')}</w:tr>`;
  const table =
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="1300"/><w:gridCol w:w="1500"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `${rows}</w:tbl>`;
  const fill = Array.from({ length: shape.fill }, (_, index) => paragraph([`F${index + 1}`], 0));
  return `${fill.join('')}${table}${paragraph(['TAIL'], 0)}`;
}

function load(body: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (shape: Shape): SemanticLayout =>
  layoutSemanticDocument(load(document(shape)), 1, {
    measurer,
    geometry: GEOMETRY,
    compatibilityMode: shape.mode ?? 15,
  });

const tablesOn = (layout: SemanticLayout, pageIndex: number): TableFragmentRecord[] =>
  (layout.pages[pageIndex]?.fragments ?? []).filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );
const linesOf = (blocks: readonly BlockFragmentRecord[]) =>
  blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : []));
/** A line's text; a `w:br` line ends in a newline span. */
const lineText = (line: ReturnType<typeof linesOf>[number]): string =>
  line.spans
    .map((span) => span.text)
    .join('')
    .trim();
const cellText = (cell: TableCellFragmentRecord): string[] => linesOf(cell.blocks).map(lineText);
const words = (blocks: readonly BlockFragmentRecord[]): string[] =>
  blocks.flatMap((block) =>
    block.kind === 'paragraph'
      ? block.lines.map(lineText)
      : block.rows.flatMap((row) => row.cells.flatMap((placed) => words(placed.blocks)))
  );
const pageWords = (layout: SemanticLayout): string[][] =>
  layout.pages.map((page) => words(page.fragments).filter((word) => word !== ''));
/** Page index of every merged line, in order. */
const mergedPages = (layout: SemanticLayout): number[] =>
  pageWords(layout).flatMap((page, index) =>
    page.filter((word) => /^M\d+$/.test(word)).map(() => index)
  );

function expectEveryWordOnce(layout: SemanticLayout, shape: Shape): void {
  const painted = pageWords(layout).flat();
  const expected = [
    ...Array.from({ length: shape.fill }, (_, index) => `F${index + 1}`),
    'HEADA',
    'ROWA',
    ...Array.from({ length: shape.merged }, (_, index) => `M${index + 1}`),
    'ROWB',
    ...Array.from({ length: (shape.nextParagraphs ?? 1) - 1 }, (_, index) => `ROWBx${index + 1}`),
    ...(shape.threeRows ? ['ROWC'] : []),
    'NEXT',
    'AFTER',
    'TAIL',
  ];
  for (const word of expected) expect(painted.filter((seen) => seen === word)).toEqual([word]);
}

/** Element children of an OOXML node with this local name. */
const childrenNamed = (node: OoxmlElement, name: string): OoxmlElement[] =>
  node.children.filter(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === name
  );

describe('mode 15: the merged text moves whole past a break after its head row', () => {
  test('the head row keeps its own height and the text starts beside the continuation row', () => {
    const shape: Shape = { fill: 14, merged: 5 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)).toEqual([1, 1, 1, 1, 1]);

    const [first] = tablesOn(layout, 0);
    expect(first!.rows).toHaveLength(1);
    const head = first!.rows[0]!;
    expect(head.box.y).toBeCloseTo(shape.fill * LINE, 3);
    expect(head.box.height).toBeCloseTo(ROW_MIN, 3);
    expect(head.cells.map(cellText)).toEqual([['HEADA'], ['ROWA'], []]);

    const [second] = tablesOn(layout, 1);
    const continuation = second!.rows[0]!;
    expect(continuation.box.y).toBeCloseTo(0, 3);
    // The merged text keeps its space before, and the continuation row grows to hold it.
    expect(continuation.box.height).toBeCloseTo(BEFORE + 5 * LINE, 3);
    const merged = continuation.cells[2]!;
    expect(cellText(merged)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
    expect(linesOf(merged.blocks)[0]!.box.y).toBeCloseTo(BEFORE, 3);
    expect(cellText(continuation.cells[1]!)).toEqual(['ROWB']);
    expect(second!.rows[1]!.box.y).toBeCloseTo(BEFORE + 5 * LINE, 3);
  });

  test('a merged text that would fit the page when the head row grows still moves', () => {
    // 30pt of merged text in a 28pt head row with 42pt of page left: the head row does not grow.
    const shape: Shape = { fill: 14, merged: 2 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)).toEqual([1, 1]);
    expect(tablesOn(layout, 0)[0]!.rows[0]!.box.height).toBeCloseTo(ROW_MIN, 3);
    expect(tablesOn(layout, 1)[0]!.rows[0]!.box.height).toBeCloseTo(BEFORE + 2 * LINE, 3);
  });

  test('the head row stays on the page when only its own height fits there', () => {
    const shape: Shape = { fill: 15, merged: 5 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(pageWords(layout)[0]).toContain('HEADA');
    expect(pageWords(layout)[0]).toContain('ROWA');
    expect(mergedPages(layout)).toEqual([1, 1, 1, 1, 1]);
  });

  test('a w:cantSplit head row stays on the page at its own height', () => {
    const shape: Shape = { fill: 14, merged: 5, cantSplit: true };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(pageWords(layout)[0]).toContain('ROWA');
    expect(mergedPages(layout)).toEqual([1, 1, 1, 1, 1]);
    expect(tablesOn(layout, 1)[0]!.rows[0]!.box.height).toBeCloseTo(BEFORE + 5 * LINE, 3);
  });

  test('the carried text keeps the head paragraph and the continuation cell keeps its id', () => {
    const shape: Shape = { fill: 14, merged: 5 };
    const part = load(document(shape));
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      geometry: GEOMETRY,
      compatibilityMode: 15,
    });
    const body = childrenNamed(part.root, 'body')[0]!;
    const [headRow, nextRow] = childrenNamed(childrenNamed(body, 'tbl')[0]!, 'tr');
    const headCell = childrenNamed(headRow!, 'tc')[2]!;
    const continuationCell = childrenNamed(nextRow!, 'tc')[2]!;
    const headParagraph = childrenNamed(headCell, 'p')[0]!;

    const placedHead = tablesOn(layout, 0)[0]!.rows[0]!.cells[2]!;
    expect(placedHead.id).toBe(headCell.id);
    expect(placedHead.blocks).toHaveLength(0);

    const carried = tablesOn(layout, 1)[0]!.rows[0]!.cells[2]!;
    expect(carried.id).toBe(continuationCell.id);
    expect(carried.vMergeContinue).toBe(false);
    expect(carried.paintInert).not.toBe(true);
    const paragraphIds = new Set(linesOf(carried.blocks).map((line) => line.range.paragraphId));
    expect([...paragraphIds]).toEqual([headParagraph.id]);
  });

  test('an incremental relayout reaches the same pages as a cold layout', () => {
    const before: Shape = { fill: 7, merged: 5 };
    const after: Shape = { fill: 14, merged: 5 };
    const shapeOf = (layout: SemanticLayout) =>
      layout.pages.map((page) =>
        tablesOn(layout, page.index).map((table) =>
          table.rows.map((row) => [row.box.y, row.box.height, row.cells.map(cellText)])
        )
      );
    const options = {
      measurer,
      geometry: GEOMETRY,
      compatibilityMode: 15,
      session: createLayoutSession(),
      cache: createParagraphLayoutCache(),
    };
    layoutSemanticDocument(load(document(before)), 1, options);
    const warm = layoutSemanticDocument(load(document(after)), 2, options);
    expect(shapeOf(warm)).toEqual(shapeOf(lay(after)));
    expect(mergedPages(warm)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('shapes the rule leaves on the older path', () => {
  test('merged text that fits the head row stays there', () => {
    const shape: Shape = { fill: 14, merged: 1 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)).toEqual([0]);
    expect(pageWords(layout)[1]).toContain('ROWB');
  });

  test('mode 14 keeps the merged text starting in the head row', () => {
    const shape: Shape = { fill: 14, merged: 5, mode: 14 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)[0]).toBe(0);
  });

  test('a merge over three rows keeps its first lines on the head page', () => {
    // 54pt of page: four merged lines fit, and the widow rule sends two over.
    const shape: Shape = { fill: 13, merged: 5, threeRows: true };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)).toEqual([0, 0, 0, 1, 1]);
  });

  test('a merged first line that may stay alone keeps its place in the head row', () => {
    const shape: Shape = { fill: 14, merged: 5, mergedPPr: '<w:widowControl w:val="0"/>' };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)[0]).toBe(0);
  });

  test('a continuation row that can start on the page keeps the merged text above it', () => {
    // 26pt below the 28pt head row: the continuation row cannot fit its 54pt, but its first
    // 18pt paragraph can start there.
    const shape: Shape = { fill: 13, merged: 5, nextParagraphs: 3 };
    const layout = lay(shape);
    expectEveryWordOnce(layout, shape);
    expect(mergedPages(layout)[0]).toBe(0);
  });
});
