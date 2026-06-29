import { describe, expect, test } from 'bun:test';
import type {
  FlowBlock,
  Measure,
  ParagraphBlock,
  ParagraphMetrics,
} from '@eigenpal/docx-editor-core/pagination-model';
import { measureTableCellBlockVisualHeight } from '@eigenpal/docx-editor-core/flow-model';

function paragraphBlock(
  runs: ParagraphBlock['runs'],
  attrs?: ParagraphBlock['attrs']
): ParagraphBlock {
  return {
    kind: 'paragraph',
    id: 'p1',
    runs,
    attrs,
  };
}

function paragraphMetrics(totalHeight: number, lineHeight: number): ParagraphMetrics {
  return {
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        toRun: 0,
        fromChar: 0,
        toChar: 0,
        width: lineHeight,
        ascent: lineHeight,
        descent: 0,
        lineHeight,
      },
    ],
    totalHeight,
  };
}

describe('measureTableCellBlockVisualHeight', () => {
  test('keeps normal paragraph total height for text content', () => {
    const block = paragraphBlock([{ kind: 'text', text: 'hello' }]);
    const measure = paragraphMetrics(17.9, 17.9);

    expect(measureTableCellBlockVisualHeight(block, measure)).toBe(17.9);
  });

  test('uses image height for single-line image-only paragraphs', () => {
    const block = paragraphBlock([{ kind: 'image', src: 'logo.png', width: 186, height: 29 }], {
      spacing: { before: 0, after: 0 },
    });
    const measure = paragraphMetrics(34.859375, 34.859375);

    expect(measureTableCellBlockVisualHeight(block, measure)).toBe(29);
  });

  test('preserves explicit spacing around image-only paragraphs', () => {
    const block = paragraphBlock([{ kind: 'image', src: 'logo.png', width: 186, height: 29 }], {
      spacing: { before: 8, after: 4 },
    });
    const measure = paragraphMetrics(40, 40);

    expect(measureTableCellBlockVisualHeight(block, measure)).toBe(41);
  });

  test('falls back to totalHeight for non-paragraph measures', () => {
    const block: FlowBlock = {
      kind: 'image',
      id: 'img1',
      src: 'logo.png',
      width: 186,
      height: 29,
    };
    const measure: Measure = {
      kind: 'image',
      width: 186,
      height: 29,
    };

    expect(measureTableCellBlockVisualHeight(block, measure)).toBe(29);
  });
});
