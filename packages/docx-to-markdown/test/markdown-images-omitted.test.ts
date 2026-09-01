import { describe, expect, test } from 'bun:test';
import type { ExportSemanticLayout } from '@docx-editor.dev/core/export';
import type { ParagraphFragmentRecord, SemanticLayout } from '@docx-editor.dev/core/layout';
import { exportMarkdownLayout } from '../src/index.ts';

function paragraph(id: string, text: string, fragmentIndex = 0): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    id: `${id}:f${fragmentIndex}`,
    paragraphId: id,
    fragmentIndex,
    styleId: null,
    outlineLevel: null,
    alignment: 'left',
    lines: [
      {
        range: { paragraphId: id, start: 0, end: text.length },
        spans: [
          {
            range: { paragraphId: id, start: 0, end: text.length },
            text,
            style: {},
            box: { x: 0, y: 0, width: text.length, height: 10 },
          },
        ],
      },
    ],
  } as unknown as ParagraphFragmentRecord;
}

function markdown(fragments: readonly ParagraphFragmentRecord[]): string {
  const layout = {
    revision: 1,
    displayMode: 'original',
    pages: [{ index: 0, fragments }],
  } as unknown as SemanticLayout;
  return exportMarkdownLayout(layout as ExportSemanticLayout).markdown;
}

describe('omitted Markdown images', () => {
  test('keeps a lexical boundary without adding space before punctuation', () => {
    const render = (after: string, before = 'A'): string => {
      const value = paragraph('drawing-boundary', '');
      const line = value.lines[0]! as unknown as { spans: unknown[]; drawings: unknown[] };
      const drawingStart = before.length;
      const afterStart = drawingStart + 1;
      line.spans = [
        {
          range: { paragraphId: 'drawing-boundary', start: 0, end: drawingStart },
          text: before,
          style: {},
          box: { x: 0, y: 0, width: drawingStart, height: 10 },
        },
        {
          range: {
            paragraphId: 'drawing-boundary',
            start: afterStart,
            end: afterStart + after.length,
          },
          text: after,
          style: {},
          box: { x: afterStart, y: 0, width: after.length, height: 10 },
        },
      ];
      line.drawings = [
        {
          kind: 'inlineDrawing',
          paragraphId: 'drawing-boundary',
          ownerPartName: '/word/document.xml',
          start: drawingStart,
          accessibility: { label: 'omitted image' },
        },
      ];
      return markdown([value]);
    };

    expect(render('B')).toBe('A B');
    expect(render(',')).toBe('A,');
    expect(render('B', '\u{20000}')).toBe('\u{20000} B');
    expect(render('\u{20000}')).toBe('A \u{20000}');
    expect(render('B', 'e\u0301')).toBe('e\u0301 B');
  });

  test('keeps boundaries across lines, fragments, and consecutive drawings', () => {
    const first = paragraph('wrapped-drawing', 'A', 0);
    const firstLine = first.lines[0]! as unknown as { drawings: unknown[] };
    firstLine.drawings = [
      {
        kind: 'inlineDrawing',
        paragraphId: 'wrapped-drawing',
        ownerPartName: '/word/document.xml',
        start: 1,
        accessibility: { label: 'first omitted image' },
      },
    ];
    const second = paragraph('wrapped-drawing', 'B', 1);
    const secondLine = second.lines[0]! as unknown as {
      spans: Array<{ range: { start: number; end: number } }>;
      drawings: unknown[];
    };
    secondLine.spans[0]!.range = { start: 3, end: 4 };
    secondLine.drawings = [
      {
        kind: 'inlineDrawing',
        paragraphId: 'wrapped-drawing',
        ownerPartName: '/word/document.xml',
        start: 2,
        accessibility: { label: 'second omitted image' },
      },
    ];

    expect(markdown([first, second])).toBe('A B');

    const wrapped = paragraph('line-wrapped-drawing', '');
    const wrappedParagraph = wrapped as unknown as { lines: unknown[] };
    wrappedParagraph.lines = [first.lines[0], second.lines[0]];
    expect(markdown([wrapped])).toBe('A B');
  });
});
