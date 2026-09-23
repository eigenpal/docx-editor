import { describe, expect, test } from 'bun:test';
import { load, layoutContext, squareAnchorInCell } from './anchored-drawing-test-fixtures.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

const measurer = createFixedMeasurer(6, 14);

/** Every line of the single cell, in the order they were laid out. */
function cellLines(xml: string): readonly { readonly contentX: number }[] {
  const part = load(xml);
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    inlineDrawingLayout: layoutContext(part),
  });
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
  walk(layout.pages[0]!.fragments);
  return lines;
}

describe('w:layoutInCell and a float anchored inside a table cell', () => {
  // `w:layoutInCell="0"` positions the object against the page rather than the cell that
  // encloses its anchor, so the cell's text is not part of its flow and runs straight through.
  // A Word control of two identical rows, one flag each, wraps only the `1` row.
  const TEXT = 'word '.repeat(60);

  test('a float that stays in the cell pushes the cell text across', () => {
    const lines = cellLines(squareAnchorInCell({ text: TEXT, layoutInCell: '1' }));
    expect(lines.length).toBeGreaterThan(1);
    // The object is 144pt wide, so every line it covers starts well clear of the cell edge.
    for (const line of lines) expect(line.contentX).toBeGreaterThan(100);
  });

  test('a float positioned against the page leaves the cell text alone', () => {
    const lines = cellLines(squareAnchorInCell({ text: TEXT, layoutInCell: '0' }));
    expect(lines.length).toBeGreaterThan(1);
    // Only the cell's own inset remains; nothing near the object's 144pt width.
    for (const line of lines) expect(line.contentX).toBeLessThan(1);
  });
});
