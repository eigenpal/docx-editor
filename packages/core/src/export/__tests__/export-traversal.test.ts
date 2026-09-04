import { expect, test } from 'bun:test';
import type {
  ParagraphFragmentRecord,
  SemanticLayout,
  StyleSpanRecord,
  TableFragmentRecord,
} from '../../layout/semantic-records.ts';
import { everyStoryOrder } from '../../layout/document-order.ts';
import {
  forEachSemanticDrawing,
  forEachSemanticSpan,
  forEachSemanticStory,
  isSemanticTraversalCheckpoint,
  iterateSemanticFillHosts,
  iterateSemanticPaintHosts,
  iterateSemanticParagraphOrder,
  iterateSemanticSpans,
  MAX_STORY_DRAWING_WALK_DEPTH,
  SEMANTIC_TRAVERSAL_CHECKPOINT_BATCH,
} from '../../layout/export-traversal.ts';

function span(paragraphId: string, text: string, projected = false): StyleSpanRecord {
  return {
    range: { paragraphId, start: 0, end: text.length },
    text,
    style: {},
    box: { x: 1, y: 2, width: Math.max(1, text.length), height: 10 },
    ...(projected ? { projected: true } : {}),
  } as unknown as StyleSpanRecord;
}

function paragraph(
  paragraphId: string,
  spans: readonly StyleSpanRecord[],
  lineParagraphId = paragraphId
): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    paragraphId,
    lines: [
      {
        range: { paragraphId: lineParagraphId, start: 0, end: 1 },
        spans,
        drawings: [],
      },
    ],
  } as unknown as ParagraphFragmentRecord;
}

test('traverses canonical story segments and exposes authored identities through repeats', () => {
  const merged = paragraph(
    'survivor',
    [span('absorbed', 'A'), span('survivor', 'B', true)],
    'absorbed'
  );
  const headerParagraph = paragraph('header-p', [span('header-p', 'H')]);
  const table = (fragmentIndex: number, repeat: boolean): TableFragmentRecord =>
    ({
      kind: 'table',
      tableId: 'table',
      fragmentIndex,
      rows: [
        {
          id: 'header-row',
          isHeaderRow: true,
          isHeaderRepeat: repeat,
          cells: [{ gridColumn: 0, gridSpan: 1, blocks: [headerParagraph] }],
        },
      ],
    }) as unknown as TableFragmentRecord;
  const layout = {
    pages: [
      { index: 0, fragments: [merged, table(0, false)] },
      { index: 1, fragments: [table(1, true)] },
    ],
  } as unknown as SemanticLayout;
  const visits: Array<{ paragraphId: string; projected: boolean; sourceRange: unknown }> = [];

  forEachSemanticSpan(layout, ({ paragraphId, span: current, sourceRange }) => {
    visits.push({ paragraphId, projected: current.projected === true, sourceRange });
  });

  expect(visits.map((visit) => visit.paragraphId)).toEqual([
    'absorbed',
    'survivor',
    'header-p',
    'header-p',
  ]);
  expect(visits[0]?.sourceRange).toEqual({ paragraphId: 'absorbed', start: 0, end: 1 });
  expect(visits[1]).toMatchObject({ paragraphId: 'survivor', projected: true, sourceRange: null });

  const iterated: string[] = [];
  for (const item of iterateSemanticSpans(layout)) {
    if (isSemanticTraversalCheckpoint(item)) continue;
    iterated.push(item.paragraphId);
  }
  expect(iterated).toEqual(visits.map((visit) => visit.paragraphId));
  const first = iterateSemanticSpans(layout).next();
  expect(first.done).toBe(false);
  expect(isSemanticTraversalCheckpoint(first.value!)).toBe(false);
  if (!isSemanticTraversalCheckpoint(first.value!)) {
    expect(first.value.paragraphId).toBe('absorbed');
  }
});

test('traverses textbox stories anchored from body and page furniture', () => {
  const textboxDrawing = (paragraphId: string, text: string) =>
    ({
      kind: 'anchoredDrawing',
      drawingNodeId: `${paragraphId}-owner`,
      x: 10,
      y: 20,
      paintBounds: { x: 9, y: 19, width: 12, height: 22 },
      hitBounds: { x: 10, y: 20, width: 10, height: 20 },
      behindDocument: false,
      textboxStory: {
        contentOffset: { x: 3, y: 4 },
        fragments: [paragraph(paragraphId, [span(paragraphId, text)])],
      },
    }) as unknown as NonNullable<SemanticLayout['pages'][number]['anchoredDrawings']>[number];
  const layout = {
    pages: [
      {
        index: 0,
        box: { x: 0, y: 100, width: 600, height: 800 },
        contentBox: { x: 50, y: 160, width: 500, height: 680 },
        fragments: [],
        anchoredDrawings: [textboxDrawing('body-textbox', 'B')],
        header: {
          box: { x: 7, y: 8, width: 500, height: 40 },
          fragments: [],
          anchoredDrawings: [
            {
              ...textboxDrawing('header-textbox', 'H'),
              horizontalFrame: 'page',
              verticalFrame: 'paragraph',
              horizontalFrameOrigin: -50,
              verticalFrameOrigin: 0,
            },
          ],
        },
        footer: {
          box: { x: 9, y: 700, width: 500, height: 40 },
          fragments: [],
          anchoredDrawings: [
            {
              ...textboxDrawing('footer-textbox', 'F'),
              horizontalFrame: 'column',
              verticalFrame: 'page',
              horizontalFrameOrigin: 0,
              verticalFrameOrigin: -60,
            },
          ],
        },
      },
    ],
  } as unknown as SemanticLayout;
  const visits: Array<{
    story: string;
    rootStory: string;
    textboxDepth: number;
    paragraphId: string;
    storyOrigin: Readonly<{ x: number; y: number }>;
    absoluteBox: unknown;
    owner: unknown;
  }> = [];

  forEachSemanticSpan(
    layout,
    ({ story, rootStory, textboxDepth, paragraphId, textboxOwner, storyOrigin, absoluteBox }) =>
      visits.push({
        story,
        rootStory,
        textboxDepth,
        paragraphId,
        storyOrigin,
        absoluteBox,
        owner: textboxOwner,
      })
  );

  expect(visits).toEqual([
    {
      story: 'textbox',
      rootStory: 'body',
      textboxDepth: 1,
      paragraphId: 'body-textbox',
      storyOrigin: { x: 63, y: 184 },
      absoluteBox: { x: 64, y: 186, width: 1, height: 10 },
      owner: layout.pages[0]!.anchoredDrawings![0],
    },
    {
      story: 'textbox',
      rootStory: 'header',
      textboxDepth: 1,
      paragraphId: 'header-textbox',
      storyOrigin: { x: 63, y: 32 },
      absoluteBox: { x: 64, y: 34, width: 1, height: 10 },
      owner: layout.pages[0]!.header!.anchoredDrawings![0],
    },
    {
      story: 'textbox',
      rootStory: 'footer',
      textboxDepth: 1,
      paragraphId: 'footer-textbox',
      storyOrigin: { x: 22, y: 184 },
      absoluteBox: { x: 23, y: 186, width: 1, height: 10 },
      owner: layout.pages[0]!.footer!.anchoredDrawings![0],
    },
  ]);

  const drawingOrigins: Array<{ rootStory: string; origin: unknown }> = [];
  forEachSemanticDrawing(layout, (visit) => {
    if (visit.textboxDepth === 0) {
      drawingOrigins.push({ rootStory: visit.rootStory, origin: visit.drawingOrigin });
    }
  });
  expect(drawingOrigins).toEqual([
    { rootStory: 'body', origin: { x: 60, y: 180 } },
    { rootStory: 'header', origin: { x: 60, y: 28 } },
    { rootStory: 'footer', origin: { x: 19, y: 180 } },
  ]);
});

test('enumerates every root story through one page authority', () => {
  const story = { fragments: [] };
  const layout = {
    pages: [
      {
        index: 0,
        fragments: [],
        header: story,
        footer: story,
        footnotes: {
          separator: story,
          notes: [{ noteKind: 'footnote', scopeId: 'footnote:1', fragments: [] }],
        },
        endnotes: {
          separator: story,
          notes: [{ noteKind: 'endnote', scopeId: 'endnote:2', fragments: [] }],
        },
      },
    ],
  } as unknown as SemanticLayout;
  const visits: Array<[string, string | null]> = [];

  forEachSemanticStory(layout, ({ story: kind, noteScopeId }) => {
    visits.push([kind, noteScopeId]);
  });

  expect(visits).toEqual([
    ['body', null],
    ['header', null],
    ['footer', null],
    ['note-separator', null],
    ['footnote', 'footnote:1'],
    ['note-separator', null],
    ['endnote', 'endnote:2'],
  ]);
});

test('drawing traversal preserves root story, textbox ownership, paragraph, and line', () => {
  const nestedParagraph = paragraph('textbox-p', [span('textbox-p', 'T')]);
  const nestedInline = {
    kind: 'inlineDrawing',
    drawingNodeId: 'nested-inline',
    paragraphId: 'textbox-p',
    x: 5,
    y: 6,
    paintBounds: { x: 4, y: 5, width: 8, height: 9 },
    hitBounds: { x: 5, y: 6, width: 7, height: 8 },
    resource: { kind: 'missing' },
  };
  (nestedParagraph.lines[0]!.drawings as unknown as unknown[]).push(nestedInline);
  const owner = {
    kind: 'anchoredDrawing',
    drawingNodeId: 'textbox-owner',
    x: 10,
    y: 20,
    paintBounds: { x: 9, y: 19, width: 12, height: 22 },
    hitBounds: { x: 10, y: 20, width: 10, height: 20 },
    resource: { kind: 'missing' },
    behindDocument: true,
    textboxStory: { contentOffset: { x: 3, y: 4 }, fragments: [nestedParagraph] },
  };
  const layout = {
    pages: [
      {
        index: 0,
        box: { x: 0, y: 100, width: 600, height: 800 },
        contentBox: { x: 50, y: 160, width: 500, height: 680 },
        fragments: [],
        anchoredDrawings: [owner],
      },
    ],
  } as unknown as SemanticLayout;
  const visits: Array<Record<string, unknown>> = [];

  forEachSemanticDrawing(layout, (visit) => {
    visits.push({
      id: visit.drawing.drawingNodeId,
      story: visit.story,
      rootStory: visit.rootStory,
      root: visit.root,
      storyOrigin: visit.storyOrigin,
      drawingOrigin: visit.drawingOrigin,
      absolutePaintBounds: visit.absolutePaintBounds,
      paintLayer: visit.paintLayer,
      depth: visit.textboxDepth,
      owner: visit.textboxOwner,
      path: visit.textboxPath,
      paragraph: visit.paragraph,
      line: visit.line,
    });
  });

  expect(visits[0]).toMatchObject({
    id: 'textbox-owner',
    story: 'body',
    rootStory: 'body',
    root: {
      host: layout.pages[0],
      box: layout.pages[0]!.contentBox,
      origin: { x: 50, y: 160 },
    },
    paintLayer: 'behind-text',
    storyOrigin: { x: 50, y: 160 },
    drawingOrigin: { x: 60, y: 180 },
    absolutePaintBounds: { x: 59, y: 179, width: 12, height: 22 },
    depth: 0,
    owner: null,
    path: [],
    paragraph: null,
    line: null,
  });
  expect(visits[1]).toMatchObject({
    id: 'nested-inline',
    story: 'textbox',
    rootStory: 'body',
    root: {
      host: layout.pages[0],
      box: layout.pages[0]!.contentBox,
      origin: { x: 50, y: 160 },
    },
    paintLayer: 'inline',
    storyOrigin: { x: 63, y: 184 },
    drawingOrigin: { x: 68, y: 190 },
    absolutePaintBounds: { x: 67, y: 189, width: 8, height: 9 },
    depth: 1,
    owner,
    path: [owner],
    paragraph: nestedParagraph,
    line: nestedParagraph.lines[0],
  });
});

test('span iteration yields checkpoints before the paragraph-order map is complete', () => {
  const count = SEMANTIC_TRAVERSAL_CHECKPOINT_BATCH + 2;
  const host = {
    kind: 'paragraph',
    paragraphId: 'host',
    lines: Array.from({ length: count }, (_, index) => ({
      range: { paragraphId: `p${index}`, start: 0, end: 0 },
      spans: [],
      drawings: [],
    })),
  } as unknown as ParagraphFragmentRecord;
  const layout = {
    pages: [{ index: 0, fragments: [host] }],
  } as unknown as SemanticLayout;
  const first = iterateSemanticSpans(layout).next();
  expect(first.done).toBe(false);
  expect(isSemanticTraversalCheckpoint(first.value!)).toBe(true);

  const items = [...iterateSemanticSpans(layout)];
  const checkpoints = items.filter((item) => isSemanticTraversalCheckpoint(item));
  expect(checkpoints).toHaveLength(1);
  const callbackIds: string[] = [];
  forEachSemanticSpan(layout, (visit) => callbackIds.push(visit.paragraphId));
  expect(callbackIds).toEqual([]);
});

test('order checkpoints count duplicate lines for one paragraph id on a cold cache', () => {
  const count = SEMANTIC_TRAVERSAL_CHECKPOINT_BATCH + 2;
  const duplicate = {
    kind: 'paragraph',
    paragraphId: 'dup',
    lines: Array.from({ length: count }, (_, index) => ({
      range: { paragraphId: 'dup', start: 0, end: 0 },
      spans: [],
      drawings: [],
      box: { x: 0, y: index, width: 10, height: 1 },
    })),
  } as unknown as ParagraphFragmentRecord;
  const empty = {
    kind: 'paragraph',
    paragraphId: 'empty',
    lines: [],
  } as unknown as ParagraphFragmentRecord;
  const layout = {
    pages: [{ index: 0, fragments: [duplicate, empty] }],
  } as unknown as SemanticLayout;
  const uncached = {
    pages: [{ index: 0, fragments: [duplicate, empty] }],
  } as unknown as SemanticLayout;
  const first = iterateSemanticParagraphOrder(layout).next();
  expect(first.done).toBe(false);
  expect(first.value).toEqual({ kind: 'checkpoint' });

  const walk = iterateSemanticParagraphOrder(layout);
  let checkpoints = 0;
  let order: ReadonlyMap<string, number> | undefined;
  for (;;) {
    const step = walk.next();
    if (step.done) {
      order = step.value;
      break;
    }
    checkpoints += 1;
  }
  expect(checkpoints).toBe(1);
  expect([...order!.keys()]).toEqual(['dup', 'empty']);
  expect([...order!.keys()]).toEqual(everyStoryOrder(layout));

  const spanFirst = iterateSemanticSpans(uncached).next();
  expect(spanFirst.done).toBe(false);
  expect(isSemanticTraversalCheckpoint(spanFirst.value!)).toBe(true);
});

test('warm everyStoryOrder cache still checkpoints many unique ids', () => {
  const count = SEMANTIC_TRAVERSAL_CHECKPOINT_BATCH + 2;
  const host = {
    kind: 'paragraph',
    paragraphId: 'host',
    lines: Array.from({ length: count }, (_, index) => ({
      range: { paragraphId: `p${index}`, start: 0, end: 0 },
      spans: [],
      drawings: [],
    })),
  } as unknown as ParagraphFragmentRecord;
  const layout = {
    pages: [{ index: 0, fragments: [host] }],
  } as unknown as SemanticLayout;
  expect(everyStoryOrder(layout)).toHaveLength(count);
  const first = iterateSemanticParagraphOrder(layout).next();
  expect(first.done).toBe(false);
  expect(first.value).toEqual({ kind: 'checkpoint' });

  const walk = iterateSemanticParagraphOrder(layout);
  let checkpoints = 0;
  let order: ReadonlyMap<string, number> | undefined;
  for (;;) {
    const step = walk.next();
    if (step.done) {
      order = step.value;
      break;
    }
    checkpoints += 1;
  }
  expect(checkpoints).toBe(1);
  expect([...order!.keys()]).toHaveLength(count);
});

test('warm everyStoryOrder cache does not rescan duplicate lines', () => {
  const count = SEMANTIC_TRAVERSAL_CHECKPOINT_BATCH + 2;
  const duplicate = {
    kind: 'paragraph',
    paragraphId: 'dup',
    lines: Array.from({ length: count }, (_, index) => ({
      range: { paragraphId: 'dup', start: 0, end: 0 },
      spans: [],
      drawings: [],
      box: { x: 0, y: index, width: 10, height: 1 },
    })),
  } as unknown as ParagraphFragmentRecord;
  const layout = {
    pages: [{ index: 0, fragments: [duplicate] }],
  } as unknown as SemanticLayout;
  expect(everyStoryOrder(layout)).toEqual(['dup']);
  const walk = iterateSemanticParagraphOrder(layout);
  let checkpoints = 0;
  for (;;) {
    const step = walk.next();
    if (step.done) {
      expect([...step.value.keys()]).toEqual(['dup']);
      break;
    }
    checkpoints += 1;
  }
  expect(checkpoints).toBe(0);
});

test('fill hosts descend into textbox stories with the same origins as span visits', () => {
  const textboxDrawing = (paragraphId: string) =>
    ({
      kind: 'anchoredDrawing',
      drawingNodeId: `${paragraphId}-owner`,
      x: 10,
      y: 20,
      paintBounds: { x: 9, y: 19, width: 12, height: 22 },
      hitBounds: { x: 10, y: 20, width: 10, height: 20 },
      behindDocument: false,
      textboxStory: {
        contentOffset: { x: 3, y: 4 },
        fragments: [paragraph(paragraphId, [span(paragraphId, 'T')])],
      },
    }) as unknown as NonNullable<SemanticLayout['pages'][number]['anchoredDrawings']>[number];
  const layout = {
    pages: [
      {
        index: 0,
        box: { x: 0, y: 100, width: 600, height: 800 },
        contentBox: { x: 50, y: 160, width: 500, height: 680 },
        fragments: [],
        anchoredDrawings: [textboxDrawing('body-textbox')],
      },
    ],
  } as unknown as SemanticLayout;
  const hosts = [...iterateSemanticFillHosts(layout)].filter((host) => host.textboxDepth > 0);
  let spanOrigin: Readonly<{ x: number; y: number }> | undefined;
  let spanDepth = 0;
  for (const item of iterateSemanticSpans(layout)) {
    if (isSemanticTraversalCheckpoint(item)) continue;
    spanOrigin = item.storyOrigin;
    spanDepth = item.textboxDepth;
    break;
  }
  expect(hosts).toHaveLength(1);
  expect(hosts[0]).toMatchObject({
    story: 'textbox',
    rootStory: 'body',
    textboxDepth: 1,
    storyOrigin: { x: 63, y: 184 },
  });
  expect(spanOrigin).toEqual(hosts[0]!.storyOrigin);
  expect(spanDepth).toBe(1);
});

test('paint-order fill hosts put behind-document textboxes before the owning story', () => {
  const textboxDrawing = (paragraphId: string, behindDocument: boolean) =>
    ({
      kind: 'anchoredDrawing',
      drawingNodeId: `${paragraphId}-owner`,
      x: 10,
      y: 20,
      paintBounds: { x: 9, y: 19, width: 12, height: 22 },
      hitBounds: { x: 10, y: 20, width: 10, height: 20 },
      behindDocument,
      textboxStory: {
        contentOffset: { x: 0, y: 0 },
        fragments: [paragraph(paragraphId, [span(paragraphId, paragraphId)])],
      },
    }) as unknown as NonNullable<SemanticLayout['pages'][number]['anchoredDrawings']>[number];
  const nestedBehind = textboxDrawing('nested-behind', true);
  const frontOwner = {
    ...textboxDrawing('front', false),
    textboxStory: {
      contentOffset: { x: 0, y: 0 },
      fragments: [paragraph('front', [span('front', 'F')])],
      anchoredDrawings: [nestedBehind],
    },
  } as unknown as NonNullable<SemanticLayout['pages'][number]['anchoredDrawings']>[number];
  const layout = {
    pages: [
      {
        index: 0,
        fragments: [paragraph('body', [span('body', 'B')])],
        anchoredDrawings: [frontOwner, textboxDrawing('behind', true)],
      },
    ],
  } as unknown as SemanticLayout;
  const paintIds = [...iterateSemanticPaintHosts(layout)].map((host) => {
    const first = host.fragments[0] as ParagraphFragmentRecord | undefined;
    return {
      id: first?.paragraphId ?? null,
      depth: host.textboxDepth,
      behind: host.behindDocument,
    };
  });
  expect(paintIds).toEqual([
    { id: 'behind', depth: 1, behind: true },
    { id: 'body', depth: 0, behind: false },
    { id: 'nested-behind', depth: 2, behind: true },
    { id: 'front', depth: 1, behind: false },
  ]);
  const documentIds = [...iterateSemanticFillHosts(layout)].map(
    (host) => (host.fragments[0] as ParagraphFragmentRecord | undefined)?.paragraphId ?? null
  );
  expect(documentIds).toEqual(['body', 'front', 'nested-behind', 'behind']);
});

test('fill-host walk stops at the nested textbox depth ceiling', () => {
  const leaf = paragraph('leaf', [span('leaf', 'L')]);
  let nested: NonNullable<SemanticLayout['pages'][number]['anchoredDrawings']>[number] | undefined;
  for (let depth = MAX_STORY_DRAWING_WALK_DEPTH + 1; depth >= 1; depth -= 1) {
    nested = {
      kind: 'anchoredDrawing',
      drawingNodeId: `tb-${depth}`,
      x: 1,
      y: 1,
      paintBounds: { x: 0, y: 0, width: 2, height: 2 },
      hitBounds: { x: 1, y: 1, width: 1, height: 1 },
      behindDocument: false,
      textboxStory: {
        contentOffset: { x: 0, y: 0 },
        fragments: depth === MAX_STORY_DRAWING_WALK_DEPTH + 1 ? [leaf] : [],
        ...(nested ? { anchoredDrawings: [nested] } : {}),
      },
    } as unknown as NonNullable<SemanticLayout['pages'][number]['anchoredDrawings']>[number];
  }
  const layout = {
    pages: [{ index: 0, fragments: [], anchoredDrawings: nested ? [nested] : [] }],
  } as unknown as SemanticLayout;
  const depths = [...iterateSemanticFillHosts(layout)].map((host) => host.textboxDepth);
  expect(Math.max(...depths)).toBe(MAX_STORY_DRAWING_WALK_DEPTH);
  expect(depths.filter((depth) => depth > 0)).toHaveLength(MAX_STORY_DRAWING_WALK_DEPTH);
});
