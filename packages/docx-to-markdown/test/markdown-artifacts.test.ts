import { expect, test } from 'bun:test';
import type { ExportSemanticLayout, ExportSession } from '@docx-editor.dev/core/export';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  TableFragmentRecord,
} from '@docx-editor.dev/core/layout';
import { exportMarkdownFrom } from '../src/index.ts';

function session(layout: SemanticLayout): ExportSession {
  const exportLayout = layout as ExportSemanticLayout;
  return {
    layout: async () => exportLayout,
    layoutFor: async () => exportLayout,
    validatedImageBytes: () => null,
    dispose: () => {},
  };
}

function paragraph(id: string, text: string): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    id: `${id}:0`,
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

function comment(id: string, paragraphId: string, start: number, end: number, pageIndex = 0) {
  return {
    kind: 'comment' as const,
    id,
    author: 'Ada',
    initials: 'AL',
    text: id,
    resolved: false,
    replyIds: [],
    orphaned: false,
    occurrences: [
      {
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
      },
    ],
  };
}

function selectedPageText(
  result: Awaited<ReturnType<typeof exportMarkdownFrom>>,
  artifactId: string
): string {
  const binding = result.reviewBindings.find(
    (candidate) => candidate.artifactId === artifactId && candidate.projection.kind === 'page'
  )!;
  if (binding.projection.kind !== 'page') return '';
  const markdown = result.pages[binding.projection.pageIndex]![binding.projection.field];
  return binding.ranges.map(({ start, end }) => markdown.slice(start, end)).join('');
}

test('makes paginated review artifacts primary while retaining unplaced artifacts globally', async () => {
  const anchoredComment = {
    kind: 'comment',
    id: 'comment-1',
    author: 'Ada',
    initials: 'AL',
    text: 'Check this',
    resolved: false,
    replyIds: [],
    orphaned: false,
    occurrences: [
      {
        pageIndex: 1,
        physicalPageNumber: 2,
        story: 'footer',
        rootStory: 'footer',
        textboxPath: [],
        noteScopeId: null,
        noteAreaKind: null,
        source: {
          partName: '/word/footer1.xml',
          start: { paragraphId: 'footer-p', offset: 0 },
          end: { paragraphId: 'footer-p', offset: 3 },
        },
      },
    ],
  } as const;
  const unplacedChange = {
    kind: 'tracked-change',
    id: 'change-1',
    change: 'insert',
    author: 'Grace',
    text: 'Pending',
    replacedText: '',
    nesting: 0,
    readOnly: false,
    replyIds: [],
    occurrences: [],
  } as const;
  const layout = {
    revision: 1,
    pages: [
      { id: 'page-a', index: 0, fragments: [] },
      { id: 'page-b', index: 1, fragments: [] },
    ],
    reviewArtifacts: [anchoredComment, unplacedChange],
  } as unknown as SemanticLayout;

  const result = await exportMarkdownFrom(session(layout));

  expect(result.pages.map(({ id, number }) => ({ id, number }))).toEqual([
    { id: 'page-a', number: 1 },
    { id: 'page-b', number: 2 },
  ]);
  expect(result.pages[0]?.comments).toEqual([]);
  expect(result.pages[1]?.comments).toEqual([anchoredComment]);
  expect(result.pages[1]?.trackedChanges).toEqual([]);
  expect(result.reviewArtifacts).toEqual([anchoredComment, unplacedChange]);
});

test('binds a review range to exact clean-Markdown offsets in page and document projections', async () => {
  const text = 'alpha *beta* omega';
  const comment = {
    kind: 'comment',
    id: 'comment-range',
    author: 'Ada',
    initials: 'AL',
    text: 'Check beta',
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
          partName: '/word/document.xml',
          start: { paragraphId: 'body-p', offset: 6 },
          end: { paragraphId: 'body-p', offset: 12 },
        },
      },
    ],
  } as const;
  const layout = {
    revision: 7,
    displayMode: 'all-markup',
    pages: [{ id: 'page-a', index: 0, fragments: [paragraph('body-p', text)] }],
    reviewArtifacts: [comment],
  } as unknown as SemanticLayout;

  const result = await exportMarkdownFrom(session(layout));

  expect(result.markdown).toBe('alpha \\*beta\\* omega');
  expect(result.pages[0]?.markdown).toBe(result.markdown);
  expect(result.reviewBindings).toHaveLength(2);
  for (const binding of result.reviewBindings) {
    const projection =
      binding.projection.kind === 'document'
        ? result.markdown
        : result.pages[binding.projection.pageIndex]?.[binding.projection.field];
    expect(binding.artifactId).toBe('comment-range');
    expect(binding.occurrenceIndex).toBe(0);
    expect(binding.unmappedReason).toBeUndefined();
    expect(binding.coverage).toBe('complete');
    expect(binding.ranges.map((range) => projection?.slice(range.start, range.end)).join('')).toBe(
      '\\*beta\\*'
    );
    expect(binding.ranges.every((range) => range.unit === 'utf16-code-unit')).toBe(true);
  }
  expect(Object.isFrozen(result.reviewBindings)).toBe(true);
  expect(result.reviewBindings.every(Object.isFrozen)).toBe(true);
});

test('targets footer Markdown and reports deliberately omitted and structural occurrences', async () => {
  const footerComment = {
    kind: 'comment',
    id: 'footer-comment',
    author: 'Ada',
    initials: 'AL',
    text: 'Footer note',
    resolved: false,
    replyIds: [],
    orphaned: false,
    occurrences: [
      {
        pageIndex: 0,
        physicalPageNumber: 1,
        story: 'footer',
        rootStory: 'footer',
        textboxPath: [],
        noteScopeId: null,
        noteAreaKind: null,
        source: {
          partName: '/word/footer1.xml',
          start: { paragraphId: 'footer-p', offset: 0 },
          end: { paragraphId: 'footer-p', offset: 6 },
        },
      },
    ],
  } as const;
  const textboxComment = {
    ...footerComment,
    id: 'textbox-comment',
    occurrences: [
      {
        ...footerComment.occurrences[0],
        story: 'textbox',
        rootStory: 'body',
        textboxPath: ['drawing-1'],
        source: {
          partName: '/word/document.xml',
          // Deliberately collides with the visible body paragraph id below. Exact story
          // provenance must still prevent an omitted textbox from binding to body Markdown.
          start: { paragraphId: 'body-p', offset: 0 },
          end: { paragraphId: 'body-p', offset: 4 },
        },
      },
    ],
  } as const;
  const structuralChange = {
    kind: 'tracked-change',
    id: 'structural-change',
    change: 'structural',
    author: 'Grace',
    text: '',
    replacedText: '',
    nesting: 0,
    readOnly: true,
    replyIds: [],
    occurrences: [
      {
        ...footerComment.occurrences[0],
        story: 'body',
        rootStory: 'body',
        source: {
          partName: '/word/document.xml',
          start: { paragraphId: 'body-p', offset: 0 },
          end: { paragraphId: 'body-p', offset: 4 },
        },
      },
    ],
  } as const;
  const layout = {
    revision: 8,
    pages: [
      {
        id: 'page-a',
        index: 0,
        fragments: [paragraph('body-p', 'Body')],
        footer: {
          kind: 'footer',
          variant: 'default',
          partName: '/word/footer1.xml',
          fragments: [paragraph('footer-p', 'Footer')],
        },
      },
    ],
    reviewArtifacts: [footerComment, textboxComment, structuralChange],
  } as unknown as SemanticLayout;

  const result = await exportMarkdownFrom(session(layout));

  const footerBinding = result.reviewBindings.find(
    (binding) => binding.artifactId === 'footer-comment'
  );
  expect(footerBinding?.projection).toEqual({
    kind: 'page',
    pageIndex: 0,
    pageNumber: 1,
    field: 'footerMarkdown',
  });
  expect(footerBinding?.ranges).toEqual([
    { start: 0, end: 6, unit: 'utf16-code-unit', precision: 'exact' },
  ]);

  const textboxBinding = result.reviewBindings.find(
    (binding) => binding.artifactId === 'textbox-comment'
  );
  expect(textboxBinding?.ranges).toEqual([]);
  expect(textboxBinding?.coverage).toBe('none');
  expect(textboxBinding?.unmappedReason).toBe('omitted-story-content');

  const structuralBindings = result.reviewBindings.filter(
    (binding) => binding.artifactId === 'structural-change'
  );
  expect(structuralBindings).toHaveLength(2);
  expect(
    structuralBindings.every(
      (binding) =>
        binding.ranges.length === 0 && binding.unmappedReason === 'non-linear-structural-change'
    )
  ).toBe(true);
});

test('maps leading entities, Markdown style delimiters, cross-paragraph ranges, and point anchors', async () => {
  const first = paragraph('first-p', '  Bold');
  const firstSpan = first.lines[0]!.spans[0]! as unknown as { style: { bold: boolean } };
  firstSpan.style = { bold: true };
  const second = paragraph('second-p', 'Next');
  const occurrence = (
    id: string,
    start: { paragraphId: string; offset: number },
    end: { paragraphId: string; offset: number }
  ) => ({
    kind: 'comment' as const,
    id,
    author: 'Ada',
    initials: 'AL',
    text: id,
    resolved: false,
    replyIds: [],
    orphaned: false,
    occurrences: [
      {
        pageIndex: 0,
        physicalPageNumber: 1,
        story: 'body' as const,
        rootStory: 'body' as const,
        textboxPath: [],
        noteScopeId: null,
        noteAreaKind: null,
        source: { partName: '/word/document.xml', start, end },
      },
    ],
  });
  const layout = {
    revision: 9,
    pages: [{ id: 'page-a', index: 0, fragments: [first, second] }],
    reviewArtifacts: [
      occurrence(
        'leading',
        { paragraphId: 'first-p', offset: 0 },
        { paragraphId: 'first-p', offset: 2 }
      ),
      occurrence(
        'cross',
        { paragraphId: 'first-p', offset: 2 },
        { paragraphId: 'second-p', offset: 2 }
      ),
      occurrence(
        'point',
        { paragraphId: 'second-p', offset: 2 },
        { paragraphId: 'second-p', offset: 2 }
      ),
    ],
  } as unknown as SemanticLayout;

  const result = await exportMarkdownFrom(session(layout));
  const pageBindings = result.reviewBindings.filter(
    (binding) => binding.projection.kind === 'page'
  );
  const selected = (artifactId: string): string =>
    pageBindings
      .find((binding) => binding.artifactId === artifactId)!
      .ranges.map((range) => result.pages[0]!.markdown.slice(range.start, range.end))
      .join('');

  expect(result.pages[0]?.markdown).toBe('\u00a0\u00a0**Bold**\n\nNext');
  expect(selected('leading')).toBe('\u00a0\u00a0');
  expect(selected('cross')).toBe('BoldNe');
  const point = pageBindings.find((binding) => binding.artifactId === 'point')?.ranges;
  expect(point).toEqual([
    {
      start: result.pages[0]!.markdown.length - 2,
      end: result.pages[0]!.markdown.length - 2,
      unit: 'utf16-code-unit',
      precision: 'exact',
    },
  ]);
});

test('binds represented drawings, marks omitted drawings honestly, and biases points forward', async () => {
  const comment = (id: string, paragraphId: string, start: number, end: number) => ({
    kind: 'comment' as const,
    id,
    author: 'Ada',
    initials: 'AL',
    text: id,
    resolved: false,
    replyIds: [],
    orphaned: false,
    occurrences: [
      {
        pageIndex: 0,
        physicalPageNumber: 1,
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
      },
    ],
  });
  const drawingParagraph = (label: string): ParagraphFragmentRecord => {
    const value = paragraph('drawing-p', 'AB');
    const line = value.lines[0]! as unknown as { spans: unknown[]; drawings: unknown[] };
    line.spans = [
      {
        range: { paragraphId: 'drawing-p', start: 0, end: 1 },
        text: 'A',
        style: {},
        box: { x: 0, y: 0, width: 1, height: 10 },
      },
      {
        range: { paragraphId: 'drawing-p', start: 2, end: 3 },
        text: 'B',
        style: {},
        box: { x: 2, y: 0, width: 1, height: 10 },
      },
    ];
    line.drawings = [
      {
        kind: 'inlineDrawing',
        paragraphId: 'drawing-p',
        ownerPartName: '/word/document.xml',
        start: 1,
        accessibility: { label },
        hyperlinkHref: null,
      },
    ];
    return value;
  };

  const visible = await exportMarkdownFrom(
    session({
      revision: 10,
      pages: [{ id: 'page-a', index: 0, fragments: [drawingParagraph('diagram')] }],
      reviewArtifacts: [
        comment('drawing', 'drawing-p', 1, 2),
        comment('drawing-point', 'drawing-p', 1, 1),
      ],
    } as unknown as SemanticLayout)
  );
  expect(visible.markdown).toBe('A B');
  const visiblePageBindings = visible.reviewBindings.filter(
    (binding) => binding.projection.kind === 'page'
  );
  const drawingBinding = visiblePageBindings.find((binding) => binding.artifactId === 'drawing');
  expect(drawingBinding?.ranges).toEqual([]);
  expect(drawingBinding?.coverage).toBe('none');
  expect(drawingBinding?.unmappedReason).toBe('not-represented-in-markdown');
  expect(
    visiblePageBindings.find((binding) => binding.artifactId === 'drawing-point')?.ranges
  ).toEqual([{ start: 1, end: 1, unit: 'utf16-code-unit', precision: 'exact' }]);

  const omitted = await exportMarkdownFrom(
    session({
      revision: 11,
      pages: [{ id: 'page-a', index: 0, fragments: [drawingParagraph('')] }],
      reviewArtifacts: [
        comment('omitted-drawing', 'drawing-p', 1, 2),
        comment('mixed-drawing', 'drawing-p', 0, 3),
      ],
    } as unknown as SemanticLayout)
  );
  expect(omitted.markdown).toBe('A B');
  const omittedBindings = omitted.reviewBindings.filter(
    (binding) => binding.artifactId === 'omitted-drawing'
  );
  expect(omittedBindings.every((binding) => binding.ranges.length === 0)).toBe(true);
  expect(omittedBindings.every((binding) => binding.coverage === 'none')).toBe(true);
  expect(
    omittedBindings.every((binding) => binding.unmappedReason === 'not-represented-in-markdown')
  ).toBe(true);
  const mixedBindings = omitted.reviewBindings.filter(
    (binding) => binding.artifactId === 'mixed-drawing'
  );
  expect(mixedBindings.every((binding) => binding.coverage === 'partial')).toBe(true);
  expect(mixedBindings.every((binding) => binding.unmappedReason === undefined)).toBe(true);
  expect(
    mixedBindings.every(
      (binding) =>
        binding.ranges.length === 2 &&
        binding.ranges.map((range) => omitted.markdown.slice(range.start, range.end)).join('') ===
          'AB'
    )
  ).toBe(true);

  const styled = paragraph('styled-p', 'AB');
  const styledLine = styled.lines[0]! as unknown as { spans: unknown[] };
  styledLine.spans = [
    {
      range: { paragraphId: 'styled-p', start: 0, end: 1 },
      text: 'A',
      style: { bold: true },
      box: { x: 0, y: 0, width: 1, height: 10 },
    },
    {
      range: { paragraphId: 'styled-p', start: 1, end: 2 },
      text: 'B',
      style: {},
      box: { x: 1, y: 0, width: 1, height: 10 },
    },
  ];
  const styledResult = await exportMarkdownFrom(
    session({
      revision: 12,
      pages: [{ id: 'page-a', index: 0, fragments: [styled] }],
      reviewArtifacts: [comment('style-point', 'styled-p', 1, 1)],
    } as unknown as SemanticLayout)
  );
  expect(styledResult.markdown).toBe('**A**B');
  expect(
    styledResult.reviewBindings.find(
      (binding) => binding.artifactId === 'style-point' && binding.projection.kind === 'document'
    )?.ranges
  ).toEqual([{ start: 5, end: 5, unit: 'utf16-code-unit', precision: 'exact' }]);
});

test('builds sparse review maps in linear time for a single long source run', async () => {
  const text = 'x'.repeat(100_000);
  const source = paragraph('long-p', text);
  const artifact = {
    kind: 'comment',
    id: 'long-comment',
    author: 'Ada',
    initials: 'AL',
    text: 'One character',
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
          partName: '/word/document.xml',
          start: { paragraphId: 'long-p', offset: 50_000 },
          end: { paragraphId: 'long-p', offset: 50_001 },
        },
      },
    ],
  } as const;
  const withReview = await exportMarkdownFrom(
    session({
      revision: 13,
      pages: [{ id: 'page-a', index: 0, fragments: [source] }],
      reviewArtifacts: [artifact],
    } as unknown as SemanticLayout)
  );
  expect(withReview.reviewBindings).toHaveLength(2);
  expect(
    withReview.reviewBindings.every((binding) =>
      binding.ranges.every((range) => withReview.markdown.slice(range.start, range.end) === 'x')
    )
  ).toBe(true);

  const withoutReview = await exportMarkdownFrom(
    session({
      revision: 14,
      pages: [{ id: 'page-a', index: 0, fragments: [source] }],
      reviewArtifacts: [],
    } as unknown as SemanticLayout)
  );
  expect(withoutReview.reviewBindings).toEqual([]);
  expect(withoutReview.markdown).toBe(text);
});

test('indexes dense reviewed spans without rescanning every boundary and slice', async () => {
  const count = 20_000;
  const source = paragraph('dense-p', 'x'.repeat(count));
  const line = source.lines[0]! as unknown as { spans: unknown[] };
  line.spans = Array.from({ length: count }, (_, index) => ({
    range: { paragraphId: 'dense-p', start: index, end: index + 1 },
    text: 'x',
    style: index % 2 === 0 ? { bold: true } : {},
    box: { x: index, y: 0, width: 1, height: 10 },
  }));
  const result = await exportMarkdownFrom(
    session({
      revision: 17,
      pages: [{ id: 'page-a', index: 0, fragments: [source] }],
      reviewArtifacts: Array.from({ length: count }, (_, index) =>
        comment(`dense-${index}`, 'dense-p', index, index + 1)
      ),
    } as unknown as SemanticLayout)
  );

  expect(result.reviewBindings).toHaveLength(count * 2);
  expect(selectedPageText(result, 'dense-0')).toBe('x');
  expect(selectedPageText(result, `dense-${count - 1}`)).toBe('x');
}, 5_000);

test('keeps bindings exact through links, HTML style fallback, and UTF-16 escaping', async () => {
  const linked = paragraph('linked-p', '');
  const link = { id: 'rLink', kind: 'external', href: 'https://example.com/a(b)' } as const;
  const line = linked.lines[0]! as unknown as { spans: unknown[] };
  line.spans = [
    {
      range: { paragraphId: 'linked-p', start: 0, end: 1 },
      text: 'A',
      style: {},
      link,
      box: { x: 0, y: 0, width: 1, height: 10 },
    },
    {
      range: { paragraphId: 'linked-p', start: 1, end: 5 },
      text: '*😀&',
      style: { bold: true },
      link,
      box: { x: 1, y: 0, width: 4, height: 10 },
    },
    {
      range: { paragraphId: 'linked-p', start: 5, end: 6 },
      text: 'B',
      style: {},
      link,
      box: { x: 5, y: 0, width: 1, height: 10 },
    },
  ];
  const result = await exportMarkdownFrom(
    session({
      revision: 15,
      pages: [{ id: 'page-a', index: 0, fragments: [linked] }],
      reviewArtifacts: [comment('linked-selection', 'linked-p', 1, 5)],
    } as unknown as SemanticLayout)
  );

  expect(result.markdown).toBe('[A<strong>\\*😀&amp;</strong>B](https://example.com/a%28b%29)');
  expect(selectedPageText(result, 'linked-selection')).toBe('\\*😀&amp;');
});

test('marks equation and projected-field atoms as containing constructs', async () => {
  const atoms = paragraph('atom-p', '\uFFFC\uFFFC');
  const line = atoms.lines[0]! as unknown as { spans: unknown[] };
  line.spans = [
    {
      range: { paragraphId: 'atom-p', start: 0, end: 1 },
      text: '\uFFFC',
      equation: { fallbackText: 'x' },
      projected: true,
      style: {},
      box: { x: 0, y: 0, width: 1, height: 10 },
    },
    {
      range: { paragraphId: 'atom-p', start: 1, end: 2 },
      text: 'P',
      projected: true,
      style: {},
      box: { x: 1, y: 0, width: 1, height: 10 },
    },
  ];
  const result = await exportMarkdownFrom(
    session({
      revision: 18,
      pages: [{ id: 'page-a', index: 0, fragments: [atoms] }],
      reviewArtifacts: [
        comment('equation-selection', 'atom-p', 0, 1),
        comment('field-selection', 'atom-p', 1, 2),
      ],
    } as unknown as SemanticLayout)
  );

  expect(result.markdown).toBe('xP');
  for (const artifactId of ['equation-selection', 'field-selection']) {
    const bindings = result.reviewBindings.filter((binding) => binding.artifactId === artifactId);
    expect(bindings).toHaveLength(2);
    expect(bindings.every((binding) => binding.coverage === 'complete')).toBe(true);
    expect(
      bindings.every(
        (binding) =>
          binding.ranges.length === 1 && binding.ranges[0]!.precision === 'containing-construct'
      )
    ).toBe(true);
  }
});

test('cross-paragraph review coverage detects a fully omitted intermediate paragraph', async () => {
  const before = paragraph('coverage-before', 'A');
  const omitted = paragraph('coverage-omitted', '');
  const omittedLine = omitted.lines[0]! as unknown as {
    range: { paragraphId: string; start: number; end: number };
    spans: unknown[];
    drawings: unknown[];
  };
  omittedLine.range = { paragraphId: 'coverage-omitted', start: 0, end: 1 };
  omittedLine.spans = [];
  omittedLine.drawings = [
    {
      kind: 'inlineDrawing',
      paragraphId: 'coverage-omitted',
      ownerPartName: '/word/document.xml',
      start: 0,
      accessibility: { label: '' },
      hyperlinkHref: null,
    },
  ];
  const after = paragraph('coverage-after', 'B');
  const artifact = {
    ...comment('cross-omission', 'coverage-before', 0, 1),
    occurrences: [
      {
        ...comment('cross-omission', 'coverage-before', 0, 1).occurrences[0],
        source: {
          partName: '/word/document.xml',
          start: { paragraphId: 'coverage-before', offset: 0 },
          end: { paragraphId: 'coverage-after', offset: 1 },
        },
      },
    ],
  };
  const result = await exportMarkdownFrom(
    session({
      revision: 19,
      pages: [{ id: 'page-a', index: 0, fragments: [before, omitted, after] }],
      reviewArtifacts: [artifact],
    } as unknown as SemanticLayout)
  );

  expect(result.markdown).toBe('A\n\n\n\nB');
  const bindings = result.reviewBindings.filter(
    (binding) => binding.artifactId === 'cross-omission'
  );
  expect(bindings).toHaveLength(2);
  expect(bindings.every((binding) => binding.coverage === 'partial')).toBe(true);
  expect(bindings.every((binding) => binding.ranges.length === 2)).toBe(true);
});

test('cross-paragraph review bindings retain visible text after an omitted start', async () => {
  const omitted = paragraph('omitted-start', '');
  const omittedLine = omitted.lines[0]! as unknown as {
    range: { paragraphId: string; start: number; end: number };
    spans: unknown[];
    drawings: unknown[];
  };
  omittedLine.range = { paragraphId: 'omitted-start', start: 0, end: 1 };
  omittedLine.spans = [];
  omittedLine.drawings = [
    {
      kind: 'inlineDrawing',
      paragraphId: 'omitted-start',
      ownerPartName: '/word/document.xml',
      start: 0,
      accessibility: { label: '' },
      hyperlinkHref: null,
    },
  ];
  const visible = paragraph('visible-end', 'B');
  const base = comment('omitted-start-binding', 'omitted-start', 0, 1);
  const artifact = {
    ...base,
    occurrences: [
      {
        ...base.occurrences[0],
        source: {
          partName: '/word/document.xml',
          start: { paragraphId: 'omitted-start', offset: 0 },
          end: { paragraphId: 'visible-end', offset: 1 },
        },
      },
    ],
  };
  const result = await exportMarkdownFrom(
    session({
      revision: 20,
      pages: [{ id: 'page-a', index: 0, fragments: [omitted, visible] }],
      reviewArtifacts: [artifact],
    } as unknown as SemanticLayout)
  );

  const bindings = result.reviewBindings.filter(
    (binding) => binding.artifactId === 'omitted-start-binding'
  );
  expect(bindings).toHaveLength(2);
  expect(bindings.every((binding) => binding.coverage === 'partial')).toBe(true);
  expect(
    bindings.every(
      (binding) =>
        binding.ranges.length === 1 &&
        result.markdown.slice(binding.ranges[0]!.start, binding.ranges[0]!.end) === 'B'
    )
  ).toBe(true);
});

test('cross-paragraph review bindings seek past an omitted start-paragraph tail', async () => {
  const partial = paragraph('partial-start', 'A');
  const partialLine = partial.lines[0]! as unknown as {
    range: { paragraphId: string; start: number; end: number };
  };
  partialLine.range = { paragraphId: 'partial-start', start: 0, end: 2 };
  const visible = paragraph('partial-end', 'B');
  const base = comment('omitted-tail-binding', 'partial-start', 1, 2);
  const artifact = {
    ...base,
    occurrences: [
      {
        ...base.occurrences[0],
        source: {
          partName: '/word/document.xml',
          start: { paragraphId: 'partial-start', offset: 1 },
          end: { paragraphId: 'partial-end', offset: 1 },
        },
      },
    ],
  };
  const result = await exportMarkdownFrom(
    session({
      revision: 21,
      pages: [{ id: 'page-a', index: 0, fragments: [partial, visible] }],
      reviewArtifacts: [artifact],
    } as unknown as SemanticLayout)
  );

  const bindings = result.reviewBindings.filter(
    (binding) => binding.artifactId === 'omitted-tail-binding'
  );
  expect(bindings).toHaveLength(2);
  expect(bindings.every((binding) => binding.coverage === 'partial')).toBe(true);
  expect(
    bindings.every(
      (binding) =>
        binding.ranges.length === 1 &&
        result.markdown.slice(binding.ranges[0]!.start, binding.ranges[0]!.end) === 'B'
    )
  ).toBe(true);
});

test('keeps identical paragraph ids isolated across body and note source parts', async () => {
  const body = paragraph('DUP', 'Body');
  const reference = paragraph('reference-p', '');
  const referenceSpan = reference.lines[0]!.spans[0]! as unknown as { noteNav: unknown };
  referenceSpan.noteNav = { direction: 'to-note', scopeId: 'footnote:1' };
  const noteArtifact = {
    kind: 'comment' as const,
    id: 'note-duplicate-id',
    author: 'Ada',
    initials: 'AL',
    text: 'Note only',
    resolved: false,
    replyIds: [],
    orphaned: false,
    occurrences: [
      {
        pageIndex: 0,
        physicalPageNumber: 1,
        story: 'footnote' as const,
        rootStory: 'footnote' as const,
        textboxPath: [],
        noteScopeId: 'footnote:1',
        noteAreaKind: 'footnotes' as const,
        source: {
          partName: '/word/footnotes.xml',
          start: { paragraphId: 'DUP', offset: 0 },
          end: { paragraphId: 'DUP', offset: 4 },
        },
      },
    ],
  };
  const result = await exportMarkdownFrom(
    session({
      revision: 19,
      pages: [
        {
          id: 'page-a',
          index: 0,
          fragments: [body, reference],
          footnotes: {
            notes: [{ scopeId: 'footnote:1', fragments: [paragraph('DUP', 'Note')] }],
          },
        },
      ],
      reviewArtifacts: [comment('body-duplicate-id', 'DUP', 0, 4), noteArtifact],
    } as unknown as SemanticLayout)
  );

  expect(selectedPageText(result, 'body-duplicate-id')).toBe('Body');
  expect(selectedPageText(result, 'note-duplicate-id')).toBe('Note');
  for (const artifactId of ['body-duplicate-id', 'note-duplicate-id']) {
    const bindings = result.reviewBindings.filter((binding) => binding.artifactId === artifactId);
    expect(bindings).toHaveLength(2);
    expect(bindings.every((binding) => binding.coverage === 'complete')).toBe(true);
  }
});

test('keeps bindings exact through list and multi-block table syntax transforms', async () => {
  const listed = paragraph('list-p', 'List*');
  (listed as unknown as { marker: unknown }).marker = {
    numId: 'list',
    level: 0,
    numFmt: 'bullet',
  };
  const table = {
    kind: 'table',
    id: 'table:f0',
    tableId: 'table',
    fragmentIndex: 0,
    columnEdges: [0, 100],
    rows: [
      {
        id: 'row',
        isHeaderRow: true,
        isHeaderRepeat: false,
        cells: [
          {
            gridColumn: 0,
            gridSpan: 1,
            vMergeContinue: false,
            blocks: [paragraph('cell-a', 'A|😀'), paragraph('cell-b', 'B&')],
          },
        ],
      },
    ],
  } as unknown as TableFragmentRecord;
  const result = await exportMarkdownFrom(
    session({
      revision: 16,
      pages: [{ id: 'page-a', index: 0, fragments: [listed, table] }],
      reviewArtifacts: [
        comment('list-selection', 'list-p', 0, 5),
        comment('cell-a-selection', 'cell-a', 0, 4),
        comment('cell-b-selection', 'cell-b', 0, 2),
      ],
    } as unknown as SemanticLayout)
  );

  expect(result.markdown).toBe('- List\\*\n\n| A\\|😀<br>B&amp; |\n| --- |');
  expect(selectedPageText(result, 'list-selection')).toBe('List\\*');
  expect(selectedPageText(result, 'cell-a-selection')).toBe('A\\|😀');
  expect(selectedPageText(result, 'cell-b-selection')).toBe('B&amp;');
});
