import { expect, test } from 'bun:test';
import type { ExportSemanticLayout, ExportSession } from '@docx-editor.dev/core/export';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '@docx-editor.dev/core/layout';
import { exportMarkdownFrom } from '../src/index.ts';

function paragraph(id: string, text: string): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    id: `${id}:f0`,
    paragraphId: id,
    fragmentIndex: 0,
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

function session(layout: SemanticLayout): ExportSession {
  const exportLayout = {
    ...layout,
    reviewArtifacts: layout.reviewArtifacts ?? Object.freeze([]),
  } as ExportSemanticLayout;
  return {
    layout: async () => exportLayout,
    layoutFor: async () => exportLayout,
    validatedImageBytes: () => null,
    dispose: () => {},
  };
}

function selectedBindingText(
  result: Awaited<ReturnType<typeof exportMarkdownFrom>>,
  binding: Awaited<ReturnType<typeof exportMarkdownFrom>>['reviewBindings'][number]
): string {
  const projection =
    binding.projection.kind === 'document'
      ? result.markdown
      : result.pages[binding.projection.pageIndex]![binding.projection.field];
  return binding.ranges.map(({ start, end }) => projection.slice(start, end)).join('');
}

test('keeps nested table fragments inside their physical page projection', async () => {
  const nested = (fragmentIndex: number, text: string): TableFragmentRecord =>
    ({
      kind: 'table',
      id: `nested:f${fragmentIndex}`,
      tableId: 'nested',
      fragmentIndex,
      columnEdges: [0, 50],
      rows: [
        {
          id: `nested-row-${fragmentIndex}`,
          isHeaderRow: false,
          isHeaderRepeat: false,
          cells: [
            {
              gridColumn: 0,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [paragraph(`nested-p-${fragmentIndex}`, text)],
            },
          ],
        },
      ],
    }) as unknown as TableFragmentRecord;
  const outer = (fragmentIndex: number, text: string): TableFragmentRecord =>
    ({
      kind: 'table',
      id: `outer-split:f${fragmentIndex}`,
      tableId: 'outer-split',
      fragmentIndex,
      columnEdges: [0, 100],
      rows: [
        {
          id: `outer-row-${fragmentIndex}`,
          isHeaderRow: false,
          isHeaderRepeat: false,
          cells: [
            {
              gridColumn: 0,
              gridSpan: 1,
              vMergeContinue: false,
              blocks: [nested(fragmentIndex, text)],
            },
          ],
        },
      ],
    }) as unknown as TableFragmentRecord;
  const layout = {
    revision: 1,
    pages: [
      { index: 0, fragments: [outer(0, 'Only page one')] },
      { index: 1, fragments: [outer(1, 'Only page two')] },
    ],
  } as unknown as SemanticLayout;

  const result = await exportMarkdownFrom(session(layout));

  expect(result.markdown).toContain('Only page one');
  expect(result.markdown).toContain('Only page two');
  expect(result.pages[0]?.markdown).toContain('Only page one');
  expect(result.pages[0]?.markdown).not.toContain('Only page two');
  expect(result.pages[1]?.markdown).toContain('Only page two');
  expect(result.pages[1]?.markdown).not.toContain('Only page one');
});

test('does not append a same-page repeated header to its original row', async () => {
  const row = (id: string, text: string, repeat = false) => ({
    id,
    isHeaderRow: id === 'header',
    isHeaderRepeat: repeat,
    isContinuation: false,
    cells: [
      { gridColumn: 0, gridSpan: 1, vMergeContinue: false, blocks: [paragraph(`${text}:p`, text)] },
    ],
  });
  const fragment = (fragmentIndex: number, rows: ReturnType<typeof row>[]) =>
    ({
      kind: 'table',
      id: `same-page:f${fragmentIndex}`,
      tableId: 'same-page',
      fragmentIndex,
      columnEdges: [0, 100],
      rows,
    }) as unknown as TableFragmentRecord;
  const layout = {
    revision: 1,
    pages: [
      {
        index: 0,
        fragments: [
          fragment(0, [row('header', 'Header'), row('a', 'A')]),
          fragment(1, [row('header', 'Header', true), row('b', 'B')]),
        ],
      },
    ],
  } as unknown as SemanticLayout;

  const result = await exportMarkdownFrom(session(layout));

  expect(result.pages[0]?.markdown.match(/Header/g)).toHaveLength(1);
  expect(result.pages[0]?.markdown).toContain('| A |');
  expect(result.pages[0]?.markdown).toContain('| B |');
});

test('binds split paragraphs and repeated table headers to each physical page', async () => {
  const splitFirst = paragraph('split-p', 'PageOne');
  const splitSecond = paragraph('split-p', 'PageTwo') as ParagraphFragmentRecord & {
    fragmentIndex: number;
    id: string;
  };
  splitSecond.fragmentIndex = 1;
  splitSecond.id = 'split-p:f1';
  const secondLine = splitSecond.lines[0]! as unknown as {
    range: { paragraphId: string; start: number; end: number };
    spans: Array<{ range: { paragraphId: string; start: number; end: number } }>;
  };
  secondLine.range = { paragraphId: 'split-p', start: 7, end: 14 };
  secondLine.spans[0]!.range = { paragraphId: 'split-p', start: 7, end: 14 };

  const headerRow = (repeat: boolean) => ({
    id: 'header-row',
    isHeaderRow: true,
    isHeaderRepeat: repeat,
    isContinuation: false,
    cells: [
      {
        gridColumn: 0,
        gridSpan: 1,
        vMergeContinue: false,
        blocks: [paragraph('header-p', 'Header')],
      },
    ],
  });
  const table = (fragmentIndex: number, repeat: boolean) =>
    ({
      kind: 'table',
      id: `repeated:f${fragmentIndex}`,
      tableId: 'repeated',
      fragmentIndex,
      columnEdges: [0, 100],
      rows: [headerRow(repeat)],
    }) as unknown as TableFragmentRecord;
  const occurrence = (pageIndex: number, paragraphId: string, start: number, end: number) => ({
    pageIndex,
    physicalPageNumber: pageIndex + 1,
    story: 'body' as const,
    rootStory: 'body' as const,
    textboxPath: [],
    noteScopeId: null,
    noteAreaKind: null,
    source: {
      partName: '/word/document.xml',
      start: { paragraphId, offset: start },
      end: { paragraphId, offset: end },
    },
  });
  const splitArtifact = {
    kind: 'comment' as const,
    id: 'split-comment',
    author: 'Ada',
    initials: 'AL',
    text: 'Split',
    resolved: false,
    replyIds: [],
    orphaned: false,
    occurrences: [occurrence(0, 'split-p', 0, 7), occurrence(1, 'split-p', 7, 14)],
  };
  const splitResult = await exportMarkdownFrom(
    session({
      revision: 2,
      pages: [
        { id: 'page-a', index: 0, fragments: [splitFirst] },
        { id: 'page-b', index: 1, fragments: [splitSecond] },
      ],
      reviewArtifacts: [splitArtifact],
    } as unknown as SemanticLayout)
  );

  const splitPageBindings = splitResult.reviewBindings.filter(
    (binding) => binding.artifactId === 'split-comment' && binding.projection.kind === 'page'
  );
  expect(splitPageBindings.map((binding) => binding.projection)).toEqual([
    { kind: 'page', pageIndex: 0, pageNumber: 1, field: 'markdown' },
    { kind: 'page', pageIndex: 1, pageNumber: 2, field: 'markdown' },
  ]);
  expect(splitPageBindings.map((binding) => selectedBindingText(splitResult, binding))).toEqual([
    'PageOne',
    'PageTwo',
  ]);

  const headerArtifact = {
    kind: 'comment' as const,
    id: 'header-comment',
    author: 'Ada',
    initials: 'AL',
    text: 'Header',
    resolved: false,
    replyIds: [],
    orphaned: false,
    occurrences: [occurrence(0, 'header-p', 0, 6), occurrence(1, 'header-p', 0, 6)],
  };
  const headerResult = await exportMarkdownFrom(
    session({
      revision: 3,
      pages: [
        { id: 'page-a', index: 0, fragments: [table(0, false)] },
        { id: 'page-b', index: 1, fragments: [table(1, true)] },
      ],
      reviewArtifacts: [headerArtifact],
    } as unknown as SemanticLayout)
  );
  const headerBindings = headerResult.reviewBindings.filter(
    (binding) => binding.artifactId === 'header-comment'
  );
  expect(
    headerBindings
      .filter((binding) => binding.projection.kind === 'page')
      .map((binding) => selectedBindingText(headerResult, binding))
  ).toEqual(['Header', 'Header']);
  expect(
    headerBindings
      .filter((binding) => binding.projection.kind === 'document')
      .map((binding) => selectedBindingText(headerResult, binding))
  ).toEqual(['Header', 'Header']);
});
