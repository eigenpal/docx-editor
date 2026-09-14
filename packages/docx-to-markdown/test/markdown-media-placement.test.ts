import { expect, test } from 'bun:test';
import type { ExportSemanticLayout } from '@docx-editor.dev/core/export';
import type { AnchoredDrawingRecord, ParagraphFragmentRecord } from '@docx-editor.dev/core/layout';
import type { MarkdownImageAsset } from '../src/index.ts';
import { exportMarkdownLayout } from '../src/markdown.ts';
import { PNG } from './media-fixture.ts';

const partName = '/word/document.xml';
function paragraph(text: string, start = 0, fragmentIndex = 0): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    id: `p:${fragmentIndex}`,
    paragraphId: 'p',
    fragmentIndex,
    styleId: null,
    outlineLevel: null,
    alignment: 'left',
    range: { start, end: start + text.length },
    lines: [
      {
        range: { paragraphId: 'p', start, end: start + text.length },
        spans: [
          {
            range: { paragraphId: 'p', start, end: start + text.length },
            text,
            style: { bold: true },
            link: { kind: 'external', id: 'link', href: 'https://example.test' },
            box: { x: 0, y: 0, width: 100, height: 10 },
          },
        ],
      },
    ],
  } as unknown as ParagraphFragmentRecord;
}
function anchor(id: string, start: number, sourceOrder = 1): AnchoredDrawingRecord {
  return {
    kind: 'anchoredDrawing',
    drawingNodeId: id,
    paragraphId: 'p',
    anchorParagraphId: 'p',
    ownerPartName: partName,
    start,
    sourceOrder,
    width: 12,
    height: 6,
    accessibility: { hidden: false, decorative: false, label: id },
    resource: { kind: 'ready' },
  } as unknown as AnchoredDrawingRecord;
}
function asset(ids: readonly string[]): MarkdownImageAsset {
  return {
    id: 'a'.repeat(64),
    path: `media/${'a'.repeat(64)}.png`,
    url: '/image.png',
    bytes: PNG,
    byteLength: PNG.length,
    mimeType: 'image/png',
    pixelWidth: 1,
    pixelHeight: 1,
    occurrences: ids.map((drawingNodeId) => ({
      partName,
      drawingNodeId,
      pageNumber: 1,
      story: 'body',
      rootStory: 'body',
      paragraphId: 'p',
      start: 2,
      displayWidthPx: 16,
      displayHeightPx: 16,
      kind: 'anchored',
      decorative: false,
      alt: drawingNodeId,
    })),
  };
}

test.each(['markdown', 'html'] as const)(
  'mid-span anchors preserve bold, links, and exact source offsets with %s images',
  (syntax) => {
    const fragment = paragraph('ABCD');
    const layout = {
      revision: 1,
      displayMode: 'original',
      pages: [
        { id: 'page', index: 0, fragments: [fragment], anchoredDrawings: [anchor('image', 2)] },
      ],
      reviewArtifacts: [
        {
          kind: 'comment',
          id: 'comment',
          author: 'Ada',
          initials: 'AL',
          text: 'Check D',
          resolved: false,
          replyIds: [],
          orphaned: false,
          occurrences: [
            {
              pageIndex: 0,
              physicalPageNumber: 1,
              story: 'body',
              rootStory: 'body',
              textboxPath: [],
              noteScopeId: null,
              noteAreaKind: null,
              source: {
                partName,
                start: { paragraphId: 'p', offset: 3 },
                end: { paragraphId: 'p', offset: 4 },
              },
            },
          ],
        },
      ],
    } as unknown as ExportSemanticLayout;
    const result = exportMarkdownLayout(layout, [asset(['image'])], syntax);
    const image =
      syntax === 'html'
        ? '<img src="/image.png" alt="image" width="16" height="8">'
        : '![image](/image.png)';
    expect(result.markdown).toBe(
      `[**AB**](https://example.test)${image}[**CD**](https://example.test)`
    );
    expect(result.reviewBindings.length).toBeGreaterThan(0);
    expect(fragment.lines[0]!.spans[0]!.text).toBe('ABCD');
    for (const binding of result.reviewBindings) {
      expect(
        binding.ranges.map((range) => result.markdown.slice(range.start, range.end)).join('')
      ).toBe('D');
      expect(binding.ranges.every((range) => range.precision === 'exact')).toBe(true);
    }
    expect(result.warnings).toEqual([]);
  }
);

test('same-offset anchors use source order and render once', () => {
  const layout = {
    revision: 1,
    pages: [
      {
        index: 0,
        fragments: [paragraph('ABCD')],
        anchoredDrawings: [anchor('last', 2, 2), anchor('first', 2, 1)],
      },
    ],
  } as unknown as ExportSemanticLayout;
  const result = exportMarkdownLayout(layout, [asset(['first', 'last'])]);
  expect(result.markdown).toContain('![first](/image.png)![last](/image.png)');
  expect(result.markdown.match(/!\[/g)).toHaveLength(2);
});

test('anchors inside a projected field follow its complete display text', () => {
  const original = paragraph('A long field result');
  const fragment = {
    ...original,
    lines: original.lines.map((line) => ({
      ...line,
      spans: line.spans.map((span) => ({
        ...span,
        range: { ...span.range, end: 3 },
        projected: true,
      })),
    })),
  };
  const layout = {
    revision: 1,
    pages: [{ index: 0, fragments: [fragment], anchoredDrawings: [anchor('image', 2)] }],
  } as unknown as ExportSemanticLayout;
  const result = exportMarkdownLayout(layout, [asset(['image'])]);
  expect(result.markdown).toBe(
    '[**A long field result**](https://example.test)![image](/image.png)'
  );
  expect(result.pages[0]!.markdown).toBe(result.markdown);
  expect(result.warnings).toEqual([]);
});

test('a split paragraph emits the anchor once logically and only on its physical page', () => {
  const layout = {
    revision: 1,
    pages: [
      { index: 0, fragments: [paragraph('First', 0)], anchoredDrawings: [] },
      { index: 1, fragments: [paragraph('Second', 6, 1)], anchoredDrawings: [anchor('image', 6)] },
    ],
  } as unknown as ExportSemanticLayout;
  const result = exportMarkdownLayout(layout, [asset(['image'])]);
  expect(result.markdown.match(/!\[/g)).toHaveLength(1);
  expect(result.pages[0]!.markdown).not.toContain('![');
  expect(result.pages[1]!.markdown.match(/!\[/g)).toHaveLength(1);
  expect(result.warnings).toEqual([]);
});

test('an anchor without a rendered owner uses one explicit story fallback', () => {
  const layout = {
    revision: 1,
    pages: [{ index: 0, fragments: [], anchoredDrawings: [anchor('orphan', 0)] }],
  } as unknown as ExportSemanticLayout;
  const result = exportMarkdownLayout(layout, [asset(['orphan'])]);
  expect(result.markdown).toBe('![orphan](/image.png)');
  expect(result.pages[0]!.markdown).toBe(result.markdown);
  expect(result.warnings.every((warning) => warning.code === 'image-placement-fallback')).toBe(
    true
  );
  expect(result.warnings).toHaveLength(2); // Logical and physical projection diagnostics.
});
