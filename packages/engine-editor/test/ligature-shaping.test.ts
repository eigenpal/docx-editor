// Ligature shaping capability tests (task 5.5 review).

import { describe, expect, test } from 'bun:test';
import { layoutBody, HelveticaMetrics, PER_GRAPHEME_SHAPING, UNSUPPORTED_SHAPING } from '@docx-editor.dev/engine-layout';
import type { MetricsPort } from '@docx-editor.dev/engine-layout';
import { toDisplayPages } from '../src/display-bridge.ts';
import { createEmptyModel, bodyStoryId, DocumentStore, ORIGIN_IDS } from '@docx-editor.dev/engine-core';
import type { ParagraphRecord } from '@docx-editor.dev/engine-core';

const LAYOUT_BASE = { pageWidth: 12240, pageHeight: 15840, margin: 1440 };

class OpaqueLigatureMetrics implements MetricsPort {
  readonly lineHeight = 240;
  readonly spaceWidth = 60;
  readonly shaping = { caretEdges: 'per-grapheme-advance' as const, ligatures: 'opaque' as const };
  ligatureInteriorCaret = (fullText: string, graphemeOffset: number) =>
    fullText === 'fi' && graphemeOffset === 1;

  advance(char: string): number {
    if (char === 'f') return 120;
    if (char === 'i') return 80;
    return 100;
  }
}

class UnsupportedCaretMetrics implements MetricsPort {
  readonly lineHeight = 240;
  readonly spaceWidth = 60;
  readonly shaping = UNSUPPORTED_SHAPING;
  advance(): number {
    return 100;
  }
}

function layoutWith(metrics: MetricsPort, text: string) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const pid = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(ORIGIN_IDS.mutationHuman, (c) => c.apply({ op: 'insertText', paragraphId: pid, text }));
  return layoutBody(store.currentModel, { ...LAYOUT_BASE, metrics });
}

describe('ligature shaping capability (task 5.5 review)', () => {
  test('opaque ligature fixture fi hides interior navigable offset 1', () => {
    const pages = layoutWith(new OpaqueLigatureMetrics(), 'fi').pages;
    const edges = pages.flatMap((p) => p.items.filter((i) => i.type === 'caretEdge'));
    const navigableOffsets = edges.filter((e) => e.navigable).map((e) => e.graphemeOffset);
    expect(navigableOffsets).toContain(0);
    expect(navigableOffsets).toContain(2);
    expect(navigableOffsets).not.toContain(1);
    const horizontalOffsets = [...new Set(edges.filter((e) => e.horizontalNavigable).map((e) => e.graphemeOffset))].sort((a, b) => a - b);
    expect(horizontalOffsets).toEqual([0, 2]);
  });

  test('opaque fi bridge emits one semantic cluster 0..2 never internal 1', () => {
    const metrics = new OpaqueLigatureMetrics();
    const layout = layoutWith(metrics, 'fi');
    const model = createEmptyModel();
    const storyId = bodyStoryId(model);
    const store = new DocumentStore(model);
    const pid = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    store.transact(ORIGIN_IDS.mutationHuman, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: 'fi' }));
    const bridged = toDisplayPages(store.currentModel, layout.pages, metrics);
    const item = bridged.display.flatMap((p) => p.items).find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    expect(item.clusters).toHaveLength(1);
    expect(item.clusters[0]!.graphemeFrom).toBe(0);
    expect(item.clusters[0]!.graphemeTo).toBe(2);
    expect(item.clusters.some((c) => c.graphemeFrom === 1 || c.graphemeTo === 1)).toBe(false);
  });

  test('disabled-per-grapheme Helvetica exposes fi interior offset 1', () => {
    const metrics = new HelveticaMetrics();
    expect(metrics.shaping.ligatures).toBe('disabled-per-grapheme');
    const pages = layoutWith(metrics, 'fi').pages;
    const model = createEmptyModel();
    const storyId = bodyStoryId(model);
    const store = new DocumentStore(model);
    const pid = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    store.transact(ORIGIN_IDS.mutationHuman, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: 'fi' }));
    const bridged = toDisplayPages(store.currentModel, pages);
    expect(bridged.navigationGeometry.shapingSupported).toBe(true);
    const interior = bridged.navigationGeometry.visualLines
      .flatMap((l) => l.edges)
      .some((e) => e.target.graphemeOffset === 1);
    expect(interior).toBe(true);
  });

  test('unsupported shaping marks navigation unsupported', () => {
    const pages = layoutWith(new UnsupportedCaretMetrics(), 'abc').pages;
    const edges = pages.flatMap((p) => p.items.filter((i) => i.type === 'caretEdge'));
    expect(edges.every((e) => !e.navigable)).toBe(true);
  });
});
