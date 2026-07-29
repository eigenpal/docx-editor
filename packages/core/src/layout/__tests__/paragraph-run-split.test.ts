// Paragraph run-split layout invariant tests (task 5.5 review).

import { describe, expect, test } from 'bun:test';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
} from '@docx-editor.dev/core-contract/store';
import { layoutBody } from '../layout.ts';
import type { ParagraphRecord } from '@docx-editor.dev/core-contract/store';
import type { CaretEdgeItem, TextItem } from '../display-item.ts';
import { createDeterministicLayoutShaping, type LayoutOptions } from '../index.ts';
import { createHarfBuzzLayoutOptions } from './fixtures/layout-shaping.ts';

const LAYOUT = createHarfBuzzLayoutOptions({
  pageWidth: 2800,
  pageHeight: 15840,
  margin: 1440,
});
const HUMAN = ORIGIN_IDS.mutationHuman;

function paragraphLayout(text: string, runs: string[]) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) =>
    c.apply({
      op: 'setParagraphRuns',
      paragraphId: first,
      runs: runs.map((part) => ({ text: part })),
    })
  );
  void text;
  return layoutBody(store.currentModel, LAYOUT);
}

function signature(pages: ReturnType<typeof layoutBody>['pages']) {
  const edges = pages.flatMap((p) =>
    p.items.filter((i): i is CaretEdgeItem => i.type === 'caretEdge' && i.navigable)
  );
  const texts = pages.flatMap((p) => p.items.filter((i): i is TextItem => i.type === 'text'));
  const lineIds = [...new Set(edges.map((e) => e.line.lineId))].sort();
  const breakOffsets = edges
    .filter((e) => e.graphemeOffset === 0 || edges.some((o) => o.line.lineId !== e.line.lineId))
    .map((e) => e.graphemeOffset);
  return {
    lineCount: lineIds.length,
    lineIds,
    edgeOffsets: edges.map((e) => e.graphemeOffset),
    edgeXs: edges.map((e) => e.x),
    textAnchors: texts.map((t) => ({
      offset: t.anchor.offset,
      len: t.text.length,
      lineId: t.line.lineId,
    })),
  };
}

function fontSlotLayout(runs: ParagraphRecord['runs']) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const paragraphId = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (commands) =>
    commands.apply({ op: 'setParagraphRuns', paragraphId, runs })
  );
  return layoutBody(store.currentModel, {
    pageWidth: 12240,
    pageHeight: 15840,
    margin: 1440,
    shaping: createDeterministicLayoutShaping({
      family: 'Latin Face',
      families: ['Han Face'],
    }),
  })
    .pages.flatMap((page) => page.items)
    .filter((item): item is TextItem => item.type === 'text')
    .sort((left, right) => left.anchor.offset - right.anchor.offset);
}

describe('paragraph run-split invariant (task 5.5 review)', () => {
  test('narrow x abcdef unsplit matches runs x ab + cdef for lines, ids, and caret edges', () => {
    const unsplit = paragraphLayout('x abcdef', ['x ', 'abcdef']);
    const split = paragraphLayout('x abcdef', ['x ab', 'cdef']);
    const boldSplit = paragraphLayout('x abcdef', ['x ', 'abc', 'def']);
    const a = signature(unsplit.pages);
    const b = signature(split.pages);
    const c = signature(boldSplit.pages);
    expect(b.lineCount).toBe(a.lineCount);
    expect(c.lineCount).toBe(a.lineCount);
    expect(b.lineIds).toEqual(a.lineIds);
    expect(c.lineIds).toEqual(a.lineIds);
    expect(b.edgeOffsets).toEqual(a.edgeOffsets);
    expect(c.edgeOffsets).toEqual(a.edgeOffsets);
    expect(b.edgeXs).toEqual(a.edgeXs);
    expect(c.edgeXs).toEqual(a.edgeXs);
  });

  test('identically resolved authored runs shape as one span across their boundary', () => {
    const model = createEmptyModel();
    const storyId = bodyStoryId(model);
    const store = new DocumentStore(model);
    const paragraphId = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    store.transact(HUMAN, (commands) =>
      commands.apply({
        op: 'setParagraphRuns',
        paragraphId,
        runs: [{ text: 'A' }, { text: 'V' }],
      })
    );

    const result = layoutBody(store.currentModel, createHarfBuzzLayoutOptions());
    const textItems = result.pages[0]!.items.filter(
      (item): item is TextItem => item.type === 'text'
    );
    expect(textItems).toHaveLength(1);
    expect(textItems[0]!.text).toBe('AV');
    expect(textItems[0]!.shapedRun.text).toBe('AV');
  });

  test('omitted and explicit default properties coalesce before shaping', () => {
    const model = createEmptyModel();
    const storyId = bodyStoryId(model);
    const store = new DocumentStore(model);
    const paragraphId = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    store.transact(HUMAN, (commands) =>
      commands.apply({
        op: 'setParagraphRuns',
        paragraphId,
        runs: [
          { text: 'A' },
          { text: 'V', props: { sizeHalfPoints: 24, bold: false, italic: false } },
        ],
      })
    );

    const result = layoutBody(store.currentModel, createHarfBuzzLayoutOptions());
    const textItems = result.pages[0]!.items.filter(
      (item): item is TextItem => item.type === 'text'
    );
    expect(textItems).toHaveLength(1);
    expect(textItems[0]!.shapedRun.text).toBe('AV');
  });

  test('resolves paragraph styles and theme fonts before selecting the actual face', () => {
    const base = createEmptyModel();
    const storyId = bodyStoryId(base);
    const paragraph: ParagraphRecord = {
      kind: 'paragraph',
      id: 'styled',
      props: { styleId: 'Heading' },
      runs: [{ text: 'Heading' }],
    };
    const model = {
      ...base,
      styles: [
        ...base.styles,
        {
          id: 'Heading',
          name: 'Heading',
          type: 'paragraph' as const,
          runProps: {
            fonts: { asciiTheme: 'majorHAnsi' },
            sizeHalfPoints: 36,
            bold: true,
          },
        },
      ],
      themeFonts: { majorLatin: 'DejaVu Sans' },
      stories: new Map(base.stories).set(storyId, {
        ...base.stories.get(storyId)!,
        blocks: [paragraph],
      }),
    };

    const result = layoutBody(model, createHarfBuzzLayoutOptions());
    const item = result.pages[0]!.items.find((candidate) => candidate.type === 'text');
    if (item?.type !== 'text') throw new Error('expected text item');
    expect(item.bold).toBe(true);
    expect(item.shapedRun.fontSpans[0]!.font.request).toEqual({
      family: 'DejaVu Sans',
      weight: 700,
      style: 'normal',
    });
    expect(item.height).toBe(419);
  });

  test('uses only a declared font substitution and retains its provenance', () => {
    const base = createEmptyModel();
    const storyId = bodyStoryId(base);
    const paragraph: ParagraphRecord = {
      kind: 'paragraph',
      id: 'fallback',
      runs: [{ text: 'fallback', props: { fonts: { ascii: 'Missing' } } }],
    };
    const model = {
      ...base,
      stories: new Map(base.stories).set(storyId, {
        ...base.stories.get(storyId)!,
        blocks: [paragraph],
      }),
    };
    const result = layoutBody(model, createHarfBuzzLayoutOptions());
    const item = result.pages[0]!.items.find((candidate) => candidate.type === 'text');
    if (item?.type !== 'text') throw new Error('expected text item');
    expect(item.shapedRun.fontSpans[0]!.font.substitution).toEqual({
      requested: { family: 'Missing', weight: 400, style: 'normal' },
      resolved: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
    });
  });

  test('itemizes one authored run into ASCII, high-ANSI, and Han font slots', () => {
    const base = createEmptyModel();
    const storyId = bodyStoryId(base);
    const paragraph: ParagraphRecord = {
      kind: 'paragraph',
      id: 'mixed-han',
      runs: [
        {
          text: 'Aé漢',
          props: {
            fonts: {
              ascii: 'ASCII Face',
              hAnsi: 'High ANSI Face',
              eastAsia: 'Han Face',
            },
          },
        },
      ],
    };
    const model = {
      ...base,
      stories: new Map(base.stories).set(storyId, {
        ...base.stories.get(storyId)!,
        blocks: [paragraph],
      }),
    };
    const layout: LayoutOptions = {
      pageWidth: 12240,
      pageHeight: 15840,
      margin: 1440,
      shaping: createDeterministicLayoutShaping({
        family: 'ASCII Face',
        families: ['High ANSI Face', 'Han Face'],
      }),
    };
    const items = layoutBody(model, layout)
      .pages[0]!.items.filter((item): item is TextItem => item.type === 'text')
      .sort((left, right) => left.anchor.offset - right.anchor.offset);
    expect(items.map((item) => item.text)).toEqual(['A', 'é', '漢']);
    expect(items.map((item) => item.shapedRun.fontSpans[0]!.font.request.family)).toEqual([
      'ASCII Face',
      'High ANSI Face',
      'Han Face',
    ]);
  });

  test('itemizes Latin and Arabic slots without splitting Arabic joining context', () => {
    const base = createEmptyModel();
    const storyId = bodyStoryId(base);
    const paragraph: ParagraphRecord = {
      kind: 'paragraph',
      id: 'mixed-arabic',
      runs: [
        {
          text: 'AسلامB',
          props: {
            fonts: {
              ascii: 'Latin Face',
              hAnsi: 'Latin Face',
              cs: 'Arabic Face',
            },
          },
        },
      ],
    };
    const model = {
      ...base,
      stories: new Map(base.stories).set(storyId, {
        ...base.stories.get(storyId)!,
        blocks: [paragraph],
      }),
    };
    const layout: LayoutOptions = {
      pageWidth: 12240,
      pageHeight: 15840,
      margin: 1440,
      shaping: createDeterministicLayoutShaping({
        family: 'Latin Face',
        families: ['Arabic Face'],
      }),
    };
    const items = layoutBody(model, layout)
      .pages[0]!.items.filter((item): item is TextItem => item.type === 'text')
      .sort((left, right) => left.anchor.offset - right.anchor.offset);
    expect(items.map((item) => item.text)).toEqual(['A', 'سلام', 'B']);
    expect(items.map((item) => item.shapedRun.fontSpans[0]!.font.request.family)).toEqual([
      'Latin Face',
      'Arabic Face',
      'Latin Face',
    ]);
    expect(items[1]!.shapedRun.direction).toBe('rtl');
  });

  test('inherits Common punctuation from compatible Han context across authored runs', () => {
    const props = {
      fonts: { ascii: 'Latin Face', hAnsi: 'Latin Face', eastAsia: 'Han Face' },
    } as const;
    const unsplit = fontSlotLayout([{ text: '漢.字', props }]);
    const split = fontSlotLayout([
      { text: '漢', props },
      { text: '.', props: { ...props, sizeHalfPoints: 24 } },
      { text: '字', props: { ...props, italic: false } },
    ]);
    const projection = (items: readonly TextItem[]) =>
      items.map((item) => ({
        text: item.text,
        family: item.shapedRun.fontSpans[0]!.font.request.family,
        width: item.width,
      }));
    expect(projection(unsplit)).toEqual([
      { text: '漢.字', family: 'Han Face', width: unsplit[0]!.width },
    ]);
    expect(projection(split)).toEqual(projection(unsplit));
  });

  test('resolves conflicting Common context deterministically to the preceding strong script', () => {
    const props = {
      fonts: { ascii: 'Latin Face', hAnsi: 'Latin Face', eastAsia: 'Han Face' },
    } as const;
    const unsplit = fontSlotLayout([{ text: '漢.A', props }]);
    const split = fontSlotLayout([
      { text: '漢', props },
      { text: '.', props: { ...props, sizeHalfPoints: 24 } },
      { text: 'A', props: { ...props, italic: false } },
    ]);
    const projection = (items: readonly TextItem[]) =>
      items.map((item) => [item.text, item.shapedRun.fontSpans[0]!.font.request.family]);
    expect(projection(unsplit)).toEqual([
      ['漢.', 'Han Face'],
      ['A', 'Latin Face'],
    ]);
    expect(projection(split)).toEqual(projection(unsplit));
  });
});
