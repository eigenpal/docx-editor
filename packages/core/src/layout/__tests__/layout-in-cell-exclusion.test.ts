import { describe, expect, test } from 'bun:test';
import { load, layoutContext, squareAnchorInCell } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';

const measurer = createFixedMeasurer(6, 14);

function layout(xml: string, compatibilityMode: number | undefined) {
  const part = load(xml);
  return layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
    ...(compatibilityMode !== undefined ? { compatibilityMode } : {}),
  });
}

/** Every line of the single cell, in the order they were laid out. */
function cellLines(
  xml: string,
  compatibilityMode?: number
): readonly { readonly contentX: number }[] {
  const lines: { readonly contentX: number }[] = [];
  const walk = (fragments: readonly unknown[]): void => {
    for (const fragment of fragments as readonly Record<string, unknown>[]) {
      if (fragment.kind === 'paragraph') {
        for (const line of fragment.lines as readonly { contentX: number }[])
          lines.push({ contentX: line.contentX });
        continue;
      }
      for (const row of (fragment.rows ?? []) as readonly Record<string, unknown>[])
        for (const cell of (row.cells ?? []) as readonly Record<string, unknown>[])
          walk((cell.blocks ?? []) as readonly unknown[]);
    }
  };
  walk(layout(xml, compatibilityMode).pages[0]!.fragments);
  return lines;
}

describe('w:layoutInCell and a float anchored inside a table cell', () => {
  // Word honours `layoutInCell="0"` only in compatibility mode 14 and below, or with no mode:
  // the object is positioned against the page and the cell's text runs straight through it.
  // From mode 15 Word ignores the flag and lays the object out in the cell, as for `"1"`.
  // Word 16.113 printed identical rows this way under modes absent, 12, 14, 15 and 16.
  const TEXT = 'word '.repeat(60);

  test('a float that stays in the cell pushes the cell text across', () => {
    const lines = cellLines(squareAnchorInCell({ text: TEXT, layoutInCell: '1' }));
    expect(lines.length).toBeGreaterThan(1);
    // The object is 144pt wide, so every line it covers starts well clear of the cell edge.
    for (const line of lines) expect(line.contentX).toBeGreaterThan(100);
  });

  for (const mode of [undefined, 14]) {
    test(`layoutInCell="0" leaves the cell text alone in mode ${mode ?? 'absent'}`, () => {
      const lines = cellLines(squareAnchorInCell({ text: TEXT, layoutInCell: '0' }), mode);
      expect(lines.length).toBeGreaterThan(1);
      // Only the cell's own inset remains; nothing near the object's 144pt width.
      for (const line of lines) expect(line.contentX).toBeLessThan(1);
    });
  }

  for (const mode of [15, 16]) {
    test(`layoutInCell="0" still wraps the cell text in mode ${mode}`, () => {
      const lines = cellLines(squareAnchorInCell({ text: TEXT, layoutInCell: '0' }), mode);
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) expect(line.contentX).toBeGreaterThan(100);
    });
  }

  test('the object sits in an indented cell exactly when the mode lays it out there', () => {
    const drawingOf = (layoutInCell: '0' | '1', mode: number) => {
      const xml = squareAnchorInCell({ text: TEXT, layoutInCell, tableIndent: 2880 });
      const drawings = layout(xml, mode).pages[0]!.anchoredDrawings ?? [];
      expect(drawings).toHaveLength(1);
      return drawings[0]!;
    };
    const inCell = drawingOf('1', 15);
    expect(inCell.layoutInCell).toBe(true);
    // Mode 15 ignores the `0`: same place as `1`, and the record says it is in the cell.
    const ignored = drawingOf('0', 15);
    expect(ignored.layoutInCell).toBe(true);
    expect(ignored.x).toBeCloseTo(inCell.x, 3);
    // Mode 14 honours it: the object leaves the indented cell for the page column.
    expect(inCell.x).toBeGreaterThan(20);
    const honoured = drawingOf('0', 14);
    expect(honoured.layoutInCell).toBe(false);
    expect(honoured.x).toBeCloseTo(0, 3);
  });

  test('a vertically centred cell republishes the object where the mode lays it out', () => {
    const drawingOf = (layoutInCell: '0' | '1', mode: number) => {
      const xml = squareAnchorInCell({
        text: 'word',
        layoutInCell,
        tableIndent: 2880,
        centred: true,
      });
      const drawings = layout(xml, mode).pages[0]!.anchoredDrawings ?? [];
      expect(drawings).toHaveLength(1);
      return drawings[0]!;
    };
    const inCell = drawingOf('1', 15);
    // Centring moved the content, and the object with it, well below the row top.
    expect(inCell.y).toBeGreaterThan(50);
    const ignored = drawingOf('0', 15);
    expect(ignored.layoutInCell).toBe(true);
    expect(ignored.x).toBeCloseTo(inCell.x, 3);
    expect(ignored.y).toBeCloseTo(inCell.y, 3);
    expect(drawingOf('0', 14).layoutInCell).toBe(false);
  });

  // Headers, footers, notes and text boxes reuse cell flow but are not tables: the mode rule
  // is a table-cell rule, so a header anchor reads the same in every mode.
  for (const mode of [undefined, 14, 15]) {
    test(`a header anchor reads layoutInCell="0" as authored in mode ${mode ?? 'absent'}`, () => {
      const cell = squareAnchorInCell({ text: TEXT, layoutInCell: '0' });
      const paragraph = cell.slice(cell.indexOf('<w:p>'), cell.lastIndexOf('</w:p>') + 6);
      const xml =
        cell.slice(0, cell.indexOf('>') + 1).replace('<w:document', '<w:hdr') +
        paragraph +
        '</w:hdr>';
      const part = load(xml, '/word/header1.xml');
      const story = layoutHeaderFooterStory(
        part,
        468,
        measurer,
        'test',
        undefined,
        undefined,
        undefined,
        128,
        undefined,
        undefined,
        layoutContext(part, '/word/header1.xml'),
        undefined,
        undefined,
        {
          pageNumber: 1,
          pageWidth: 612,
          pageHeight: 792,
          marginLeft: 72,
          marginRight: 72,
          marginTop: 72,
          marginBottom: 72,
        },
        undefined,
        mode === undefined ? undefined : { compatibilityMode: mode }
      );
      expect(story.anchoredDrawings?.[0]?.layoutInCell).toBe(false);
      const lines = (story.fragments[0] as { lines: readonly { contentX: number }[] }).lines;
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) expect(line.contentX).toBeLessThan(1);
    });
  }
});
