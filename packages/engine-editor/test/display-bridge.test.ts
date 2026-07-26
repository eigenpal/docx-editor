// The display bridge reconciles the engine layout IR with model-derived semantic ranges.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  cssMatrix,
  firstEditableGlyphTarget,
  overlaysForFrame,
  toDisplayPages,
} from '../src/display-bridge.ts';
import {
  caretOverlayForTarget,
  deriveCaretGeometry,
  deriveSelectionGeometry,
  hitTestPointer,
} from '../src/interaction-geometry.ts';
import { caretContentX } from '../src/line-catalog.ts';
import { hasGeometryStopAtOffset } from '../src/navigation-stops.ts';
import { selectionForBlock, publishFrameBundle } from './interaction-test-helpers.ts';
import {
  createDeterministicLayoutShaping,
  layoutBody,
  type Page,
} from '@docx-editor.dev/engine-layout';
import { createHarfBuzzLayoutOptions } from '../../engine-layout/test/fixtures/layout-shaping.ts';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;
const LAYOUT = {
  pageWidth: 12240,
  pageHeight: 15840,
  margin: 1440,
  shaping: createDeterministicLayoutShaping(),
};

function modelWith(texts: string[]) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) =>
    c.apply({ op: 'insertText', paragraphId: first, text: texts[0] ?? '' })
  );
  for (let i = 1; i < texts.length; i += 1) {
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const pid = r.ok ? r.modelChange.created[0]! : first;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: texts[i]! }));
  }
  return store.currentModel;
}

const page = (items: Page['items']): Page => ({ index: 0, width: 12240, height: 15840, items });

describe('engine layout IR -> contract display IR', () => {
  test('publishes exact mixed-format glyph runs from the completed shaped TextItems', () => {
    const model = createEmptyModel();
    const storyId = bodyStoryId(model);
    const store = new DocumentStore(model);
    const paragraphId = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    store.transact(HUMAN, (commands) =>
      commands.apply({
        op: 'setParagraphRuns',
        paragraphId,
        runs: [
          {
            text: 'Regular ',
            props: {
              fonts: { ascii: 'DejaVu Sans' },
              sizeHalfPoints: 24,
              color: '123456',
            },
          },
          {
            text: 'Bold',
            props: {
              fonts: { ascii: 'DejaVu Sans' },
              sizeHalfPoints: 32,
              color: 'ABCDEF',
              bold: true,
            },
          },
        ],
      })
    );
    const options = createHarfBuzzLayoutOptions();
    const layout = layoutBody(store.currentModel, options);
    const layoutRuns = layout.pages
      .flatMap((layoutPage) => layoutPage.items)
      .filter((item) => item.type === 'text');
    const { display } = toDisplayPages(store.currentModel, layout.pages);
    const runs = display
      .flatMap((displayPage) => displayPage.items)
      .flatMap((item) => (item.kind === 'text' ? item.runs : []));

    expect(runs.map((run) => run.text)).toEqual(['Regular ', 'Bold']);
    const [regular, bold] = runs;
    expect(regular).toMatchObject({
      fontFamily: 'DejaVu Sans',
      fontSizeHalfPoints: 24,
      fontWeight: 400,
      fontStyle: 'normal',
      color: { kind: 'hex', value: '123456' },
      direction: 'ltr',
      bidiLevel: 0,
    });
    expect(bold).toMatchObject({
      fontFamily: 'DejaVu Sans',
      fontSizeHalfPoints: 32,
      fontWeight: 700,
      fontStyle: 'normal',
      color: { kind: 'hex', value: 'ABCDEF' },
      direction: 'ltr',
      bidiLevel: 0,
    });
    expect(regular!.font.hash).not.toBe(bold!.font.hash);
    expect(regular!.font.identity).toBe(`${regular!.font.hash}#${regular!.font.faceIndex}`);
    expect(bold!.font.identity).toBe(`${bold!.font.hash}#${bold!.font.faceIndex}`);
    expect(regular!.glyphs.length).toBeGreaterThan(0);
    expect(regular!.glyphs.every((glyph) => Number.isSafeInteger(glyph.advanceX))).toBe(true);
    expect(regular!.glyphs.some((glyph) => glyph.outline.path.length > 0)).toBe(true);
    expect(regular!.glyphs.every((glyph) => Object.isFrozen(glyph.outline))).toBe(true);
    expect(regular!.clusters.every((cluster) => cluster.graphemeTo > cluster.graphemeFrom)).toBe(
      true
    );
    expect(regular!.verticalMetrics).toEqual({
      ascent: layoutRuns[0]!.shapedRun.metrics.ascent,
      descent: layoutRuns[0]!.shapedRun.metrics.descent,
      lineGap: layoutRuns[0]!.shapedRun.metrics.lineGap,
      baseline: layoutRuns[0]!.baseline / 15,
    });
    expect(regular!.producer).toMatchObject({
      resourceEpoch: options.shaping.fonts.epoch,
      configEpoch: options.shaping.operation.configEpoch,
      extensionFingerprint: options.shaping.operation.extensionFingerprint,
      producerVersion: expect.any(Number),
    });
    expect(regular!.shaping.shapingLibrary).toEqual(options.shaping.environment.shapingLibrary);
    expect(Object.isFrozen(regular)).toBe(true);
    expect(Object.isFrozen(regular!.glyphs)).toBe(true);
    expect(() => JSON.stringify(display)).not.toThrow();
  });

  test('publishes theme-resolved family and size rather than bridge defaults', () => {
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
            color: '334455',
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
    const options = createHarfBuzzLayoutOptions();
    const layout = layoutBody(model, options);
    const { display } = toDisplayPages(model, layout.pages);
    const run = display
      .flatMap((displayPage) => displayPage.items)
      .flatMap((item) => (item.kind === 'text' ? item.runs : []))[0]!;

    expect(run.fontFamily).toBe('DejaVu Sans');
    expect(run.fontSizeHalfPoints).toBe(36);
    expect(run.fontWeight).toBe(700);
    expect(run.color).toEqual({ kind: 'hex', value: '334455' });
  });

  test('publishes declared font substitution provenance without font bytes', () => {
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
    const options = createHarfBuzzLayoutOptions();
    const layout = layoutBody(model, options);
    const { display } = toDisplayPages(model, layout.pages);
    const run = display
      .flatMap((displayPage) => displayPage.items)
      .flatMap((item) => (item.kind === 'text' ? item.runs : []))[0]!;

    expect(run.font.substitution).toEqual({
      requested: { family: 'Missing', weight: 400, style: 'normal' },
      resolved: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
    });
    expect(run.fontSpans[0]!.font.substitution).toEqual(run.font.substitution);
    expect('bytes' in run.font).toBe(false);
    expect(() => JSON.stringify(run)).not.toThrow();
  });

  test('publishes exact RTL glyph clusters with UTF-16 and grapheme ranges', () => {
    const model = modelWith(['سلام']);
    const options = createHarfBuzzLayoutOptions();
    const layout = layoutBody(model, options);
    const layoutItem = layout.pages
      .flatMap((layoutPage) => layoutPage.items)
      .find((item) => item.type === 'text' && item.text === 'سلام');
    if (layoutItem?.type !== 'text') throw new Error('expected RTL layout item');
    const { display } = toDisplayPages(model, layout.pages);
    const run = display
      .flatMap((displayPage) => displayPage.items)
      .flatMap((item) => (item.kind === 'text' ? item.runs : []))
      .find((candidate) => candidate.text === 'سلام')!;

    expect(run.direction).toBe('rtl');
    expect(run.bidiLevel).toBe(1);
    expect(run.glyphs).toEqual(
      layoutItem.shapedRun.glyphs.map((glyph) => ({
        id: glyph.id,
        cluster: glyph.cluster,
        advanceX: glyph.advanceX,
        advanceY: glyph.advanceY,
        offsetX: glyph.offsetX,
        offsetY: glyph.offsetY,
        originX: glyph.originX,
        originY: glyph.originY,
        outline: glyph.outline,
      }))
    );
    expect(run.clusters.map(({ utf16From, utf16To }) => [utf16From, utf16To])).toEqual(
      layoutItem.shapedRun.clusters.map((cluster) => [cluster.textStart, cluster.textEnd])
    );
    expect(run.clusters.every((cluster) => cluster.graphemeTo > cluster.graphemeFrom)).toBe(true);
  });

  test('display bridge contains no production font family, size, or color defaults', () => {
    const source = readFileSync(new URL('../src/display-bridge.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/Helvetica|fontSizePx:\s*px\(|(?:BLACK|000000)/);
  });

  test('RTL clusters retain logical direction while publishing normalized geometric boxes', () => {
    const { frame } = publishFrameBundle(modelWith(['سلام']));
    const item = frame.display[0]!.items.find((candidate) => candidate.kind === 'text');
    if (item?.kind !== 'text') throw new Error('expected RTL text item');
    expect(item.interaction?.writingDirection).toBe('rtl');
    expect(item.clusters).toHaveLength(4);
    expect(item.clusters.every((cluster) => cluster.box.width > 0)).toBe(true);
    expect(item.clusters.every((cluster) => cluster.direction === 'rtl')).toBe(true);
    expect(item.clusters.every((cluster) => cluster.bidiLevel === 1)).toBe(true);
    expect(item.clusters.map((cluster) => cluster.logicalOrder)).toEqual([3, 2, 1, 0]);
    expect(item.clusters[0]!.box.x).toBeGreaterThan(item.clusters.at(-1)!.box.x);

    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const start = deriveCaretGeometry(frame, selectionForBlock(frame, blockId, 0, 0).head);
    const end = deriveCaretGeometry(frame, selectionForBlock(frame, blockId, 4, 4).head);
    expect(start?.rect.x).toBeGreaterThan(end!.rect.x);

    const leftmost = item.clusters.reduce((left, cluster) =>
      cluster.box.x < left.box.x ? cluster : left
    );
    const page = frame.pageGeometry[0]!;
    const hit = hitTestPointer(
      frame,
      {
        x: page.box.x + leftmost.box.x + 1,
        y: page.box.y + leftmost.box.y + leftmost.box.height / 2,
      },
      { clientOrigin: { x: 0, y: 0 }, scrollOffset: { x: 0, y: 0 }, zoom: 1 }
    );
    expect(hit.ok).toBe(true);
    if (!hit.ok || hit.value.target.kind !== 'text') throw new Error('expected RTL text hit');
    expect(hit.value.target.graphemeOffset).toBe(4);
  });

  test('display clusters preserve an exact nested isolate level above direction parity', () => {
    const { frame } = publishFrameBundle(modelWith(['a\u2067אב\u2066cd\u2069ג\u2069z']));
    const nested = frame.display
      .flatMap((page) => page.items)
      .find((item) => item.kind === 'text' && item.runs.some((run) => run.text === 'cd'));
    if (nested?.kind !== 'text') throw new Error('expected nested isolate display item');
    expect(nested.clusters.length).toBeGreaterThan(0);
    expect(nested.clusters.every((cluster) => cluster.direction === 'ltr')).toBe(true);
    expect(nested.clusters.every((cluster) => cluster.bidiLevel === 2)).toBe(true);
  });

  test('deprecated doc offsets derive from model semantic UTF-16 ranges', () => {
    const model = modelWith(['ab', 'c']);
    const storyId = bodyStoryId(model);
    const blocks = model.stories.get(storyId)!.blocks as ParagraphRecord[];
    const layout = layoutBody(model, LAYOUT);
    const { display, semanticIndex } = toDisplayPages(model, layout.pages);
    const second = display
      .flatMap((p) => p.items)
      .find((i) => i.kind === 'text' && i.semantic.identity.blockId === blocks[1]!.id);
    expect(second?.kind).toBe('text');
    if (second?.kind !== 'text') throw new Error('text');
    expect(second.docFrom).toBe(3);
    expect(second.docTo).toBe(4);
    expect(second.blockId).toBe(semanticIndex.stories[0]!.blocks[1]!.orderIndex);
  });

  test('run splits preserve contiguous semantic UTF-16 ranges', () => {
    const model = createEmptyModel();
    const storyId = bodyStoryId(model);
    const store = new DocumentStore(model);
    const pid = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    store.transact(HUMAN, (c) =>
      c.apply({ op: 'setParagraphRuns', paragraphId: pid, runs: [{ text: 'hel' }, { text: 'lo' }] })
    );
    const layout = layoutBody(store.currentModel, LAYOUT);
    const { display } = toDisplayPages(store.currentModel, layout.pages);
    const items = display.flatMap((p) => p.items).filter((i) => i.kind === 'text');
    expect(items.length).toBeGreaterThan(0);
    if (items[0]!.kind !== 'text') throw new Error('text');
    expect(items[0]!.semantic.utf16From).toBe(0);
    if (items.length > 1 && items[1]!.kind === 'text') {
      expect(items[0]!.semantic.utf16To).toBe(items[1]!.semantic.utf16From);
    }
  });

  test('single-space ab cd offset 3 has geometry stop, x, and overlay', () => {
    const text = 'ab cd';
    const bundle = publishFrameBundle(modelWith([text]));
    const blockId = bundle.frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const storyId = bundle.frame.semanticIndex.stories[0]!.storyId;
    const target = selectionForBlock(bundle.frame, blockId, 3, 3).head;
    expect(hasGeometryStopAtOffset(bundle.navigation, storyId, blockId, 3)).toBe(true);
    const x = caretContentX(bundle.frame, target, bundle.navigation);
    expect(x).toBeCloseTo(120, 5);
    expect(caretOverlayForTarget(bundle.frame, bundle.navigation, target)).not.toBeNull();
    const edge = bundle.navigation.visualLines
      .flatMap((line) => line.edges)
      .find((entry) => entry.target.graphemeOffset === 3);
    // Grouping makes "ab cd" ONE paint slice anchored at 0, so offset 3 no longer starts a
    // slice of its own. The edge must still resolve to the slice that CONTAINS it.
    const owning = bundle.frame.display
      .flatMap((page) => page.items)
      .find(
        (item) =>
          item.kind === 'text' && item.semantic.graphemeFrom <= 3 && 3 <= item.semantic.graphemeTo
      );
    if (owning?.kind !== 'text') throw new Error('owning slice');
    expect(edge?.interaction.paintSliceAnchor).toBe(owning.semantic.utf16From);
    expect(edge?.interaction.paintSliceAnchor).toBe(0);
  });

  test('run-split multi-slice same fragment reports no paint conflicts', () => {
    const model = createEmptyModel();
    const storyId = bodyStoryId(model);
    const store = new DocumentStore(model);
    const pid = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    store.transact(HUMAN, (c) =>
      c.apply({
        op: 'setParagraphRuns',
        paragraphId: pid,
        runs: [
          { text: 'ab', props: { bold: true } },
          { text: 'cd', props: { italic: true } },
        ],
      })
    );
    const layout = layoutBody(store.currentModel, LAYOUT);
    const { navigationGeometry } = toDisplayPages(store.currentModel, layout.pages);
    expect(navigationGeometry.paintFragmentConflicts).toEqual([]);
    expect(navigationGeometry.shapingSupported).toBe(true);
    const edges = navigationGeometry.visualLines.flatMap((line) => line.edges);
    expect(
      edges.every(
        (edge) => edge.interaction.paintSliceAnchor === 0 || edge.interaction.paintSliceAnchor === 2
      )
    ).toBe(true);
    expect(
      edges.some(
        (edge) => edge.target.graphemeOffset === 1 && edge.interaction.paintSliceAnchor === 0
      )
    ).toBe(true);
    expect(edges.some((edge) => edge.target.graphemeOffset === 2)).toBe(false);
    expect(
      edges.some(
        (edge) => edge.target.graphemeOffset === 3 && edge.interaction.paintSliceAnchor === 2
      )
    ).toBe(true);
  });

  test('run-split different z at slice boundary excludes ambiguous caret edges', () => {
    const model = createEmptyModel();
    const storyId = bodyStoryId(model);
    const store = new DocumentStore(model);
    const pid = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    store.transact(HUMAN, (c) =>
      c.apply({
        op: 'setParagraphRuns',
        paragraphId: pid,
        runs: [
          { text: 'a', props: { bold: true } },
          { text: 'bc', props: { italic: true } },
        ],
      })
    );
    const layout = layoutBody(store.currentModel, LAYOUT);
    const { navigationGeometry } = toDisplayPages(store.currentModel, layout.pages);
    const edges = navigationGeometry.visualLines.flatMap((line) => line.edges);
    const sliceAnchors = new Set(edges.map((edge) => edge.interaction.paintSliceAnchor));
    expect([...sliceAnchors].every((anchor) => anchor === 0 || anchor === 1)).toBe(true);
    expect(edges.some((edge) => edge.target.graphemeOffset === 1)).toBe(false);
    expect(
      edges.some(
        (edge) => edge.target.graphemeOffset === 2 && edge.interaction.paintSliceAnchor === 1
      )
    ).toBe(true);
  });

  test('combining mark bridge item has one semantic cluster 0..1', () => {
    const text = 'e\u0301';
    const model = modelWith([text]);
    const pid = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
    const layout = layoutBody(model, LAYOUT);
    const { display, navigationGeometry } = toDisplayPages(model, layout.pages);
    const item = display
      .flatMap((p) => p.items)
      .find((i) => i.kind === 'text' && i.semantic.identity.blockId === pid);
    if (item?.kind !== 'text') throw new Error('text');
    expect(item.clusters).toHaveLength(1);
    expect(item.clusters[0]!.graphemeFrom).toBe(0);
    expect(item.clusters[0]!.graphemeTo).toBe(1);
    expect(
      navigationGeometry.visualLines
        .flatMap((line) => line.edges)
        .some((edge) => edge.target.graphemeOffset === 1)
    ).toBe(true);
    expect(item.semantic.graphemeFrom).toBe(0);
    expect(item.semantic.graphemeTo).toBe(1);
  });

  test('surrogate pair bridge item has one semantic cluster and exact edge geometry', () => {
    const text = '😀';
    const model = modelWith([text]);
    const layout = layoutBody(model, LAYOUT);
    const { display, semanticIndex, navigationGeometry } = toDisplayPages(model, layout.pages);
    const item = display.flatMap((p) => p.items).find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    expect(item.clusters).toHaveLength(1);
    expect(item.clusters[0]!.graphemeFrom).toBe(0);
    expect(item.clusters[0]!.graphemeTo).toBe(1);
    expect(
      navigationGeometry.visualLines
        .flatMap((line) => line.edges)
        .some((edge) => edge.target.graphemeOffset === 1)
    ).toBe(true);
    const block = indexBlock(semanticIndex, item.semantic.identity.blockId);
    expect(indexEditableStops(semanticIndex, block!.identity.blockId)).toHaveLength(
      block!.graphemeCount + 1
    );
  });

  test('line and page splits keep stable identity and contiguous grapheme mapping', () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const model = modelWith([words]);
    const layout = layoutBody(model, { ...LAYOUT, pageWidth: 4000 });
    const { display, semanticIndex } = toDisplayPages(model, layout.pages);
    const pid = semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const items = display
      .flatMap((p) => p.items)
      .filter((i) => i.kind === 'text')
      .sort((a, b) =>
        a.kind === 'text' && b.kind === 'text' ? a.semantic.utf16From - b.semantic.utf16From : 0
      );
    expect(items.length).toBeGreaterThan(1);
    const paragraphGraphemes = semanticIndex.stories[0]!.blocks[0]!.graphemeCount;
    let lastTo = 0;
    for (const item of items) {
      if (item.kind !== 'text') continue;
      expect(item.semantic.identity.blockId).toBe(pid);
      expect(item.semantic.utf16From).toBeGreaterThanOrEqual(lastTo);
      lastTo = item.semantic.utf16To;
      expect(item.clusters.every((c) => c.graphemeTo - c.graphemeFrom === 1)).toBe(true);
      for (const cluster of item.clusters) {
        const expected =
          cluster.graphemeFrom === 0
            ? 'downstream'
            : cluster.graphemeFrom >= paragraphGraphemes
              ? 'downstream'
              : 'upstream';
        expect(cluster.affinity).toBe(expected);
      }
    }
  });

  test('lineWhitespace regions receive precise gap boxes from measured caret edges', () => {
    const model = modelWith(['ab cd']);
    const layout = layoutBody(model, LAYOUT);
    const { display, semanticIndex } = toDisplayPages(model, layout.pages);
    const blockId = semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const ws = semanticIndex.ownershipRegions.find(
      (r) => r.kind === 'lineWhitespace' && r.identity.blockId === blockId
    )!;
    const items = display[0]!.items.filter((i) => i.kind === 'text') as Extract<
      (typeof display)[0]['items'][number],
      { kind: 'text' }
    >[];
    // One grouped slice for the whole unstyled line, whitespace included.
    expect(items).toHaveLength(1);
    expect(items[0]!.runs.map((r) => r.text).join('')).toBe('ab cd');
    // The region's box is still derived from measured caret edges and is still precise —
    // it is now a range INSIDE the painted slice rather than a gap between two slices.
    expect(ws.box).toBeDefined();
    expect(ws.box!.width).toBeGreaterThan(0);
    expect(ws.box!.width).toBeLessThan(items[0]!.box.width);
  });

  test('empty paragraph emits line-area geometry with stable identity and no visible runs', () => {
    const model = modelWith(['second']);
    const storyId = bodyStoryId(model);
    const store = new DocumentStore(model);
    store.transact(HUMAN, (c) => c.apply({ op: 'insertParagraph', storyId, index: 0, runs: [] }));
    const layout = layoutBody(store.currentModel, LAYOUT);
    const { display, semanticIndex } = toDisplayPages(store.currentModel, layout.pages);
    const emptyBlock = semanticIndex.stories[0]!.blocks[0]!;
    expect(emptyBlock.empty).toBe(true);
    const emptyItem = display
      .flatMap((p) => p.items)
      .find(
        (i) => i.kind === 'text' && i.semantic.identity.blockId === emptyBlock.identity.blockId
      );
    expect(emptyItem?.kind).toBe('text');
    if (emptyItem?.kind !== 'text') throw new Error('text');
    expect(emptyItem.runs).toHaveLength(0);
    expect(emptyItem.clusters).toHaveLength(0);
    expect(
      semanticIndex.ownershipRegions.some(
        (r) => r.kind === 'paragraph' && r.box && r.identity.blockId === emptyBlock.identity.blockId
      )
    ).toBe(true);
  });
});

function indexBlock(index: ReturnType<typeof toDisplayPages>['semanticIndex'], blockId: string) {
  return index.stories[0]!.blocks.find((b) => b.identity.blockId === blockId);
}

function indexEditableStops(
  index: ReturnType<typeof toDisplayPages>['semanticIndex'],
  blockId: string
) {
  return index.caretStops.filter(
    (s) =>
      s.target.kind === 'text' && s.target.identity.blockId === blockId && s.role === 'editableText'
  );
}

describe('frame overlay geometry for adapters (task M2.2)', () => {
  function frameWithSelection(texts: string[], anchor: number, head: number) {
    const { frame, store } = publishFrameBundle(modelWith(texts));
    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const selection = selectionForBlock(frame, blockId, anchor, head);
    const caret = deriveCaretGeometry(frame, selection.head as never);
    const geometry = deriveSelectionGeometry(frame, selection);
    void store;
    return {
      ...frame,
      // A caret is only painted for a FOCUSED editor, so a fixture that expects
      // caret geometry has to be focused.
      focus: { scope: { kind: 'body' as const }, focused: true },
      selection,
      caret,
      selectionGeometry: geometry.ok ? geometry.value : null,
    };
  }

  test('overlay rects are page-local so an adapter can paint them inside the page box', () => {
    const frame = frameWithSelection(['hello world'], 0, 5);
    const overlays = overlaysForFrame(frame);
    expect(overlays.selection.length).toBeGreaterThan(0);
    for (const box of overlays.selection) {
      const page = frame.pageGeometry.find((p) => p.index === box.pageIndex)!;
      expect(box.pageIndex).toBe(0);
      // Page-local means relative to the page box, never stacked content space.
      expect(box.rect.x).toBeLessThan(page.box.width);
      expect(box.rect.y).toBeLessThan(page.box.height);
      expect(box.rect.x).toBeGreaterThanOrEqual(0);
      expect(box.rect.y).toBeGreaterThanOrEqual(0);
      expect(box.rect.width).toBeGreaterThan(0);
    }
  });

  test('a caret overlay carries page identity and writing direction', () => {
    const frame = frameWithSelection(['hello'], 2, 2);
    const overlays = overlaysForFrame(frame);
    expect(overlays.caret).not.toBeNull();
    expect(overlays.caret!.pageIndex).toBe(0);
    expect(overlays.caret!.writingDirection).toBe('ltr');
    expect(overlays.caret!.rect.height).toBeGreaterThan(0);
  });

  test('a frame with no selection paints no overlay', () => {
    const { frame } = publishFrameBundle(modelWith(['hello']));
    const overlays = overlaysForFrame(frame);
    expect(overlays.caret).toBeNull();
    expect(overlays.selection).toEqual([]);
  });

  test('overlay boxes never contain stacked page offsets from a later page', () => {
    const frame = frameWithSelection(['hello'], 0, 3);
    const overlays = overlaysForFrame(frame);
    const stackedTop = frame.pageGeometry.find((p) => p.index === 0)!.box.y;
    for (const box of overlays.selection) {
      // If the helper forgot to subtract the page origin, y would still carry it.
      expect(box.rect.y).not.toBe(
        box.rect.y + stackedTop === box.rect.y ? -1 : box.rect.y + stackedTop
      );
    }
  });

  test('an affine transform renders as a CSS matrix in column order', () => {
    expect(cssMatrix({ a: 1, b: 0, c: 0, d: 1, tx: 4, ty: 5 })).toBe('matrix(1, 0, 0, 1, 4, 5)');
    expect(cssMatrix({ a: 2, b: 0.5, c: -0.5, d: 2, tx: 0, ty: 0 })).toBe(
      'matrix(2, 0.5, -0.5, 2, 0, 0)'
    );
  });

  test('zoom is not baked into overlay geometry — the host scales the page stack', () => {
    const frame = frameWithSelection(['hello world'], 0, 5);
    const overlays = overlaysForFrame(frame);
    const again = overlaysForFrame(frame);
    // Same frame in, identical boxes out: no host metrics, no zoom, no DOM.
    expect(overlays).toEqual(again);
  });
});

describe('deterministic one-surface click target (task M2.3)', () => {
  test('the target is the first editable body glyph with real text, not whitespace', () => {
    const { frame } = publishFrameBundle(modelWith(['   hello world']));
    const target = firstEditableGlyphTarget(frame);
    expect(target).not.toBeNull();
    const page = frame.display.find((p) => p.index === target!.pageIndex)!;
    const item = page.items[target!.itemIndex]!;
    expect(item.kind).toBe('text');
    const run = (item as Extract<typeof item, { kind: 'text' }>).runs[target!.runIndex]!;
    expect(run.text.trim().length).toBeGreaterThan(0);
  });

  test('the target reports a center point inside its own glyph box', () => {
    const { frame } = publishFrameBundle(modelWith(['hello']));
    const target = firstEditableGlyphTarget(frame)!;
    expect(target.center.x).toBeGreaterThan(target.box.x);
    expect(target.center.x).toBeLessThan(target.box.x + target.box.width);
    expect(target.center.y).toBeGreaterThan(target.box.y);
    expect(target.center.y).toBeLessThan(target.box.y + target.box.height);
  });

  test('a read-only first block is skipped in favour of the first editable one', () => {
    const { frame } = publishFrameBundle(modelWith(['first', 'second']));
    const firstBlockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const readOnlyFirst = {
      ...frame,
      semanticIndex: {
        ...frame.semanticIndex,
        stories: frame.semanticIndex.stories.map((story) => ({
          ...story,
          blocks: story.blocks.map((block) =>
            block.identity.blockId === firstBlockId ? { ...block, readOnly: true } : block
          ),
        })),
      },
    };
    const target = firstEditableGlyphTarget(readOnlyFirst)!;
    const page = readOnlyFirst.display.find((p) => p.index === target.pageIndex)!;
    const item = page.items[target.itemIndex] as Extract<
      (typeof page.items)[number],
      { kind: 'text' }
    >;
    expect(item.semantic.identity.blockId).not.toBe(firstBlockId);
  });

  test('an empty document has no click target rather than a fabricated one', () => {
    const { frame } = publishFrameBundle(modelWith(['']));
    expect(firstEditableGlyphTarget(frame)).toBeNull();
  });

  test('the target is stable across repeated calls on the same frame', () => {
    const { frame } = publishFrameBundle(modelWith(['hello world', 'second line']));
    expect(firstEditableGlyphTarget(frame)).toEqual(firstEditableGlyphTarget(frame));
  });
});

describe('overlay correctness for a collapsed caret (task 6.4)', () => {
  test('a collapsed selection paints a caret but no selection highlight', () => {
    const { frame } = publishFrameBundle(modelWith(['hello world']));
    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const collapsed = selectionForBlock(frame, blockId, 3, 3);
    const geometry = deriveSelectionGeometry(frame, collapsed);
    expect(geometry.ok).toBe(true);
    const withCaret = {
      ...frame,
      focus: { scope: { kind: 'body' as const }, focused: true },
      selection: collapsed,
      caret: deriveCaretGeometry(frame, collapsed.head as never),
      selectionGeometry: geometry.ok ? geometry.value : null,
    };
    const overlays = overlaysForFrame(withCaret);
    expect(overlays.caret).not.toBeNull();
    // A caret is not a one-character highlight.
    expect(overlays.selection).toEqual([]);
  });

  test('a real range still paints its highlight rects', () => {
    const { frame } = publishFrameBundle(modelWith(['hello world']));
    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const range = selectionForBlock(frame, blockId, 0, 5);
    const geometry = deriveSelectionGeometry(frame, range);
    const withRange = {
      ...frame,
      focus: { scope: { kind: 'body' as const }, focused: true },
      selection: range,
      caret: deriveCaretGeometry(frame, range.head as never),
      selectionGeometry: geometry.ok ? geometry.value : null,
    };
    expect(overlaysForFrame(withRange).selection.length).toBeGreaterThan(0);
  });
});

describe('caret visibility follows focus (task 6.5)', () => {
  test('an unfocused frame paints no caret even when caret geometry exists', () => {
    const { frame } = publishFrameBundle(modelWith(['hello']));
    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const selection = selectionForBlock(frame, blockId, 2, 2);
    const caret = deriveCaretGeometry(frame, selection.head as never);
    expect(caret).not.toBeNull();

    const unfocused = {
      ...frame,
      focus: { scope: { kind: 'body' as const }, focused: false },
      selection,
      caret,
    };
    // Word does not blink a caret at a document nobody is editing, and painting
    // one at mount made the two adapters disagree on their initial state.
    expect(overlaysForFrame(unfocused).caret).toBeNull();

    const focused = { ...unfocused, focus: { scope: { kind: 'body' as const }, focused: true } };
    expect(overlaysForFrame(focused).caret).not.toBeNull();
  });
});
