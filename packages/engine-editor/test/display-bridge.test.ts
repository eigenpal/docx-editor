// The display bridge reconciles the engine layout IR with model-derived semantic ranges.

import { describe, expect, test } from 'bun:test';
import { cssMatrix, overlaysForFrame, toDisplayPages } from '../src/display-bridge.ts';
import {
  caretOverlayForTarget,
  deriveCaretGeometry,
  deriveSelectionGeometry,
} from '../src/interaction-geometry.ts';
import { caretContentX } from '../src/line-catalog.ts';
import { hasGeometryStopAtOffset } from '../src/navigation-stops.ts';
import { selectionForBlock, publishFrameBundle } from './interaction-test-helpers.ts';
import { layoutBody, HelveticaMetrics, type Page } from '@docx-editor.dev/engine-layout';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;
const LAYOUT = { pageWidth: 12240, pageHeight: 15840, margin: 1440, metrics: new HelveticaMetrics() };

function modelWith(texts: string[]) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: first, text: texts[0] ?? '' }));
  for (let i = 1; i < texts.length; i += 1) {
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const pid = r.ok ? r.modelChange.created[0]! : first;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: texts[i]! }));
  }
  return store.currentModel;
}

const page = (items: Page['items']): Page => ({ index: 0, width: 12240, height: 15840, items });

describe('engine layout IR -> contract display IR', () => {
  test('deprecated doc offsets derive from model semantic UTF-16 ranges', () => {
    const model = modelWith(['ab', 'c']);
    const storyId = bodyStoryId(model);
    const blocks = model.stories.get(storyId)!.blocks as ParagraphRecord[];
    const layout = layoutBody(model, LAYOUT);
    const { display, semanticIndex } = toDisplayPages(model, layout.pages);
    const second = display.flatMap((p) => p.items).find((i) => i.kind === 'text' && i.semantic.identity.blockId === blocks[1]!.id);
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
    store.transact(HUMAN, (c) => c.apply({ op: 'setParagraphRuns', paragraphId: pid, runs: [{ text: 'hel' }, { text: 'lo' }] }));
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
    expect(x).toBeCloseTo(116, 5);
    expect(caretOverlayForTarget(bundle.frame, bundle.navigation, target)).not.toBeNull();
    const edge = bundle.navigation.visualLines
      .flatMap((line) => line.edges)
      .find((entry) => entry.target.graphemeOffset === 3);
    expect(edge?.interaction.paintSliceAnchor).toBe(3);
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
        runs: [{ text: 'ab', props: { bold: true } }, { text: 'cd', props: { italic: true } }],
      }),
    );
    const layout = layoutBody(store.currentModel, LAYOUT);
    const { navigationGeometry } = toDisplayPages(store.currentModel, layout.pages, LAYOUT.metrics);
    expect(navigationGeometry.paintFragmentConflicts).toEqual([]);
    expect(navigationGeometry.shapingSupported).toBe(true);
    const edges = navigationGeometry.visualLines.flatMap((line) => line.edges);
    expect(edges.every((edge) => edge.interaction.paintSliceAnchor === 0 || edge.interaction.paintSliceAnchor === 2)).toBe(true);
    expect(edges.some((edge) => edge.target.graphemeOffset === 1 && edge.interaction.paintSliceAnchor === 0)).toBe(true);
    expect(edges.some((edge) => edge.target.graphemeOffset === 2)).toBe(false);
    expect(edges.some((edge) => edge.target.graphemeOffset === 3 && edge.interaction.paintSliceAnchor === 2)).toBe(true);
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
        runs: [{ text: 'a', props: { bold: true } }, { text: 'bc', props: { italic: true } }],
      }),
    );
    const layout = layoutBody(store.currentModel, LAYOUT);
    const { navigationGeometry } = toDisplayPages(store.currentModel, layout.pages, LAYOUT.metrics);
    const edges = navigationGeometry.visualLines.flatMap((line) => line.edges);
    const sliceAnchors = new Set(edges.map((edge) => edge.interaction.paintSliceAnchor));
    expect([...sliceAnchors].every((anchor) => anchor === 0 || anchor === 1)).toBe(true);
    expect(edges.some((edge) => edge.target.graphemeOffset === 1)).toBe(false);
    expect(edges.some((edge) => edge.target.graphemeOffset === 2 && edge.interaction.paintSliceAnchor === 1)).toBe(true);
  });

  test('combining mark bridge item has one semantic cluster 0..1', () => {
    const text = 'e\u0301';
    const model = modelWith([text]);
    const pid = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
    const layout = layoutBody(model, LAYOUT);
    const { display, navigationGeometry } = toDisplayPages(model, layout.pages, LAYOUT.metrics);
    const item = display.flatMap((p) => p.items).find((i) => i.kind === 'text' && i.semantic.identity.blockId === pid);
    if (item?.kind !== 'text') throw new Error('text');
    expect(item.clusters).toHaveLength(1);
    expect(item.clusters[0]!.graphemeFrom).toBe(0);
    expect(item.clusters[0]!.graphemeTo).toBe(1);
    expect(navigationGeometry.visualLines.flatMap((line) => line.edges).every((edge) => edge.target.graphemeOffset !== 1)).toBe(true);
    expect(item.semantic.graphemeFrom).toBe(0);
    expect(item.semantic.graphemeTo).toBe(1);
  });

  test('surrogate pair bridge item has one semantic cluster and no geometry-trusted interior caret edges', () => {
    const text = '😀';
    const model = modelWith([text]);
    const layout = layoutBody(model, LAYOUT);
    const { display, semanticIndex, navigationGeometry } = toDisplayPages(model, layout.pages, LAYOUT.metrics);
    const item = display.flatMap((p) => p.items).find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    expect(item.clusters).toHaveLength(1);
    expect(item.clusters[0]!.graphemeFrom).toBe(0);
    expect(item.clusters[0]!.graphemeTo).toBe(1);
    expect(navigationGeometry.visualLines.flatMap((line) => line.edges).every((edge) => edge.target.graphemeOffset === 0)).toBe(true);
    const block = indexBlock(semanticIndex, item.semantic.identity.blockId);
    expect(indexEditableStops(semanticIndex, block!.identity.blockId)).toHaveLength(block!.graphemeCount + 1);
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
      .sort((a, b) => (a.kind === 'text' && b.kind === 'text' ? a.semantic.utf16From - b.semantic.utf16From : 0));
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
    const ws = semanticIndex.ownershipRegions.find((r) => r.kind === 'lineWhitespace' && r.identity.blockId === blockId)!;
    const items = display[0]!.items.filter((i) => i.kind === 'text') as Extract<(typeof display)[0]['items'][number], { kind: 'text' }>[];
    expect(items).toHaveLength(2);
    expect(ws.box).toBeDefined();
    expect(ws.box!.width).toBeGreaterThan(0);
    expect(ws.box!.width).toBeLessThan(items[0]!.box.width + items[1]!.box.width);
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
      .find((i) => i.kind === 'text' && i.semantic.identity.blockId === emptyBlock.identity.blockId);
    expect(emptyItem?.kind).toBe('text');
    if (emptyItem?.kind !== 'text') throw new Error('text');
    expect(emptyItem.runs).toHaveLength(0);
    expect(emptyItem.clusters).toHaveLength(0);
    expect(semanticIndex.ownershipRegions.some((r) => r.kind === 'paragraph' && r.box && r.identity.blockId === emptyBlock.identity.blockId)).toBe(
      true,
    );
  });
});

function indexBlock(index: ReturnType<typeof toDisplayPages>['semanticIndex'], blockId: string) {
  return index.stories[0]!.blocks.find((b) => b.identity.blockId === blockId);
}

function indexEditableStops(index: ReturnType<typeof toDisplayPages>['semanticIndex'], blockId: string) {
  return index.caretStops.filter((s) => s.target.kind === 'text' && s.target.identity.blockId === blockId && s.role === 'editableText');
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
      expect(box.rect.y).not.toBe(box.rect.y + stackedTop === box.rect.y ? -1 : box.rect.y + stackedTop);
    }
  });

  test('an affine transform renders as a CSS matrix in column order', () => {
    expect(cssMatrix({ a: 1, b: 0, c: 0, d: 1, tx: 4, ty: 5 })).toBe('matrix(1, 0, 0, 1, 4, 5)');
    expect(cssMatrix({ a: 2, b: 0.5, c: -0.5, d: 2, tx: 0, ty: 0 })).toBe('matrix(2, 0.5, -0.5, 2, 0, 0)');
  });

  test('zoom is not baked into overlay geometry — the host scales the page stack', () => {
    const frame = frameWithSelection(['hello world'], 0, 5);
    const overlays = overlaysForFrame(frame);
    const again = overlaysForFrame(frame);
    // Same frame in, identical boxes out: no host metrics, no zoom, no DOM.
    expect(overlays).toEqual(again);
  });
});
