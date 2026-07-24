// The display bridge reconciles the engine layout IR with model-derived semantic ranges.

import { describe, expect, test } from 'bun:test';
import { deriveLineWhitespaceBox, toDisplayPages } from '../src/display-bridge.ts';
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

  test('combining mark bridge item has one cluster, full UTF-16 span, paragraph affinity', () => {
    const text = 'e\u0301';
    const model = modelWith([text]);
    const pid = (model.stories.get(bodyStoryId(model))!.blocks[0] as ParagraphRecord).id;
    const layout = layoutBody(model, LAYOUT);
    const { display } = toDisplayPages(model, layout.pages);
    const item = display.flatMap((p) => p.items).find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    expect(item.clusters).toHaveLength(1);
    expect(item.clusters[0]!.utf16To - item.clusters[0]!.utf16From).toBe(text.length);
    expect(item.clusters[0]!.affinity).toBe('downstream');
    expect(item.semantic.graphemeFrom).toBe(0);
    expect(item.semantic.graphemeTo).toBe(1);
    expect(item.semantic.identity.blockId).toBe(pid);
  });

  test('surrogate pair bridge item has one cluster and no internal caret granularity', () => {
    const text = '😀';
    const model = modelWith([text]);
    const layout = layoutBody(model, LAYOUT);
    const { display, semanticIndex } = toDisplayPages(model, layout.pages);
    const item = display.flatMap((p) => p.items).find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    expect(item.clusters).toHaveLength(1);
    expect(item.clusters[0]!.utf16To - item.clusters[0]!.utf16From).toBe(2);
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

  test('lineWhitespace regions receive precise gap boxes between painted slices', () => {
    const model = modelWith(['ab cd']);
    const layout = layoutBody(model, LAYOUT);
    const { display, semanticIndex } = toDisplayPages(model, layout.pages);
    const blockId = semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const ws = semanticIndex.ownershipRegions.find((r) => r.kind === 'lineWhitespace' && r.identity.blockId === blockId)!;
    const items = display[0]!.items.filter((i) => i.kind === 'text') as Extract<(typeof display)[0]['items'][number], { kind: 'text' }>[];
    expect(items).toHaveLength(2);
    const derived = deriveLineWhitespaceBox(ws, items, 5);
    expect(derived).toEqual(ws.box);
    expect(derived!.width).toBeLessThan(items[0]!.box.width + items[1]!.box.width);
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
