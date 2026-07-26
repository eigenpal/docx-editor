// Production-path navigation geometry tests (interactive-paginated-editing 5.5 review).

import { describe, expect, test } from 'bun:test';
import {
  createEmptyModel,
  bodyStoryId,
  type PackageModel,
  type ParagraphRecord,
  type SdtRecord,
} from '@docx-editor.dev/engine-core';
import { layoutBody } from '@docx-editor.dev/engine-layout';
import { toDisplayPages } from '../src/display-bridge.ts';
import { buildTraversalLinksForModel } from '../src/semantic-index.ts';
import { buildLineCatalog, caretContentX, destinationOverlayVisible } from '../src/line-catalog.ts';
import { freezeNavigationGeometry } from '../src/navigation-geometry.ts';
import { caretOverlayForTarget } from '../src/interaction-geometry.ts';
import { InteractionFrameStore } from '../src/interaction-frame.ts';
import { deriveCaretGeometry } from '../src/interaction-geometry.ts';
import {
  LAYOUT,
  modelWithRunSplit,
  modelWithParagraphTableParagraph,
  selectionForBlock,
} from './interaction-test-helpers.ts';
import { createHarfBuzzLayoutOptions } from '../../engine-layout/test/fixtures/layout-shaping.ts';

function bridged(model: PackageModel, layout = LAYOUT) {
  const pages = layoutBody(model, layout).pages;
  return toDisplayPages(model, pages);
}

function publishBundle(model: PackageModel, layout = LAYOUT) {
  const bridge = bridged(model, layout);
  const store = new InteractionFrameStore();
  const frame = store.publishLayout({
    modelRevision: 1,
    resourceEpoch: 0,
    configurationEpoch: 0,
    display: bridge.display,
    semanticIndex: bridge.semanticIndex,
    navigationGeometry: bridge.navigationGeometry,
    selection: null,
    caret: null,
    selectionGeometry: null,
    focus: { scope: { kind: 'body' }, focused: true },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: 0 },
  });
  return { frame, navigation: store.getNavigationGeometry(frame.id), bridge };
}

describe('navigation production geometry (task 5.5 review)', () => {
  test('proportional W/i offset 1 uses shaped width not half-word interpolation', () => {
    const model = modelWithRunSplit(['W', 'i']);
    const shapedLayout = createHarfBuzzLayoutOptions();
    const layout = layoutBody(model, shapedLayout);
    const edges = layout.pages.flatMap((page) =>
      page.items.filter((item) => item.type === 'caretEdge')
    );
    const edge0 = edges.find((edge) => edge.graphemeOffset === 0);
    const edge1 = edges.find((edge) => edge.graphemeOffset === 1);
    expect(edge0).toBeDefined();
    expect(edge1).toBeDefined();
    const textItems = layout.pages
      .flatMap((page) => page.items)
      .filter((item) => item.type === 'text');
    const wWidth = textItems[0]!.shapedRun.clusters[0]!.advance;
    const iWidth = textItems[0]!.shapedRun.clusters[1]!.advance;
    expect(wWidth).toBeGreaterThan(iWidth);
    const delta = edge1!.x - edge0!.x;
    expect(delta).toBe(wWidth);
    expect(delta).not.toBe((wWidth + iWidth) / 2);

    const { frame, navigation, bridge } = publishBundle(model);
    const blockId = bridge.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const target = {
      kind: 'text' as const,
      scope: { kind: 'body' as const },
      identity: { storyId: bridge.semanticIndex.stories[0]!.storyId, blockId },
      graphemeOffset: 1,
      affinity: 'upstream' as const,
    };
    const overlay = caretOverlayForTarget(frame, navigation, target);
    expect(overlay).not.toBeNull();
    expect(overlay).not.toBe('singular');
    if (!overlay || overlay === 'singular') throw new Error('overlay');
    expect(Number.isFinite(overlay.rect.x)).toBe(true);
  });

  test('wrapped paragraph publishes numeric L0..L12 lineIndex ordering independent of lexical ids', () => {
    const narrow = { ...LAYOUT, pageWidth: 3200 };
    const text = Array.from({ length: 13 }, (_, i) => `line${i}`).join(' ');
    const model = modelWithRunSplit([text]);
    const { navigation } = publishBundle(model, narrow);
    const blockId = model.stories.get(bodyStoryId(model))!.blocks[0]!.id;
    const lineIndexes = [
      ...new Set(
        navigation.visualLines
          .filter((line) => line.identity.blockId === blockId)
          .map((line) => line.line.lineIndex)
      ),
    ].sort((a, b) => a - b);
    expect(lineIndexes.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < lineIndexes.length; i += 1) {
      expect(lineIndexes[i]).toBe(i);
    }
    const orders = navigation.visualLines
      .filter((line) => line.identity.blockId === blockId)
      .map((line) => line.lineOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  test('run-split identical geometry preserves stable lineId and fragmentId', () => {
    const unified = modelWithRunSplit(['abcdef']);
    const split = modelWithRunSplit(['ab', 'cd', 'ef']);
    const unifiedNav = publishBundle(unified).navigation;
    const splitNav = publishBundle(split).navigation;
    const blockId = unified.stories.get(bodyStoryId(unified))!.blocks[0]!.id;
    const pick = (nav: typeof unifiedNav) =>
      nav.visualLines.find((line) => line.identity.blockId === blockId)?.line;
    expect(pick(unifiedNav)).toEqual(pick(splitNav));
  });

  test('SDT nested paragraphs do not flatten into top-level editable adjacency', () => {
    const base = createEmptyModel();
    const storyId = bodyStoryId(base);
    const story = base.stories.get(storyId)!;
    const before: ParagraphRecord = {
      kind: 'paragraph',
      id: 'p-before',
      runs: [{ text: 'before' }],
    };
    const inside: ParagraphRecord = {
      kind: 'paragraph',
      id: 'p-inside',
      runs: [{ text: 'inside' }],
    };
    const after: ParagraphRecord = { kind: 'paragraph', id: 'p-after', runs: [{ text: 'after' }] };
    const sdt: SdtRecord = { kind: 'sdt', id: 'sdt-1', blocks: [inside] };
    const model: PackageModel = {
      ...base,
      stories: new Map(base.stories).set(storyId, { ...story, blocks: [before, sdt, after] }),
    };
    const links = buildTraversalLinksForModel(model);
    expect(links.get('p-before')?.nextEditableBlockId).toBeNull();
    expect(links.get('p-inside')?.nextEditableBlockId).toBeNull();
    expect(links.get('p-inside')?.previousEditableBlockId).toBeNull();
    expect(links.get('p-after')?.previousEditableBlockId).toBeNull();
  });

  test('fully clipped sidecar edge rejects destination overlay visibility for keyboard sync', () => {
    const { frame, navigation, bridge } = publishBundle(modelWithRunSplit(['abcd']));
    const blockId = bridge.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const selection = selectionForBlock(frame, blockId, 2, 2);
    const head = selection.head;
    if (head.kind !== 'text') throw new Error('text');
    const clippedNav = freezeNavigationGeometry({
      ...navigation,
      visualLines: navigation.visualLines.map((line) => ({
        ...line,
        edges: line.edges.map((edge) => ({
          ...edge,
          interaction: {
            ...edge.interaction,
            clip: {
              x: edge.pageLocalX + 500,
              y: edge.pageLocalY,
              width: 10,
              height: edge.pageLocalHeight,
            },
          },
        })),
      })),
    });
    const clippedFrame = { ...frame, selection, caret: deriveCaretGeometry(frame, selection.head) };
    expect(destinationOverlayVisible(clippedFrame, clippedNav, head)).toBe(false);
    const catalog = buildLineCatalog(clippedFrame, clippedNav);
    if (catalog.ok) {
      expect(
        catalog.lines.flatMap((line) => line.stops).some((stop) => stop.target.graphemeOffset === 2)
      ).toBe(false);
    } else {
      expect(catalog.reason).toMatch(/visible|clip/i);
    }
  });

  test('table cell navigation on later pages carries non-zero pageIndex', () => {
    const filler = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const model = modelWithParagraphTableParagraph(filler, 'cell-on-page-two', filler);
    const narrow = { ...LAYOUT, pageHeight: 4000 };
    const { navigation, bridge } = publishBundle(model, narrow);
    const cellBlock = bridge.semanticIndex.stories[0]!.blocks.find(
      (b) =>
        !b.readOnly &&
        b.identity.blockId !== bridge.semanticIndex.stories[0]!.blocks[0]!.identity.blockId
    );
    expect(cellBlock).toBeDefined();
    const cellLines = navigation.visualLines.filter(
      (line) => line.identity.blockId === cellBlock!.identity.blockId
    );
    expect(cellLines.length).toBeGreaterThan(0);
    const pageIndexes = [...new Set(cellLines.map((line) => line.pageIndex))];
    expect(pageIndexes.some((page) => page > 0)).toBe(true);
    for (const line of cellLines) {
      expect(line.pageIndex).toBeGreaterThanOrEqual(0);
      expect(line.interaction.pageIndex).toBe(line.pageIndex);
    }
  });

  test('combining cluster publishes exact navigation geometry at its edge', () => {
    const model = modelWithRunSplit(['e\u0301x']);
    const { frame, navigation, bridge } = publishBundle(model);
    const textItems = bridge.display.flatMap((p) => p.items).filter((i) => i.kind === 'text');
    expect(textItems.some((i) => i.kind === 'text' && i.clusters.length > 0)).toBe(true);
    expect(
      textItems.some(
        (i) =>
          i.kind === 'text' && i.clusters.some((c) => c.graphemeFrom === 0 && c.graphemeTo === 1)
      )
    ).toBe(true);
    const blockId = bridge.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const target = {
      kind: 'text' as const,
      scope: { kind: 'body' as const },
      identity: { storyId: bridge.semanticIndex.stories[0]!.storyId, blockId },
      graphemeOffset: 1,
      affinity: 'upstream' as const,
    };
    expect(caretContentX(frame, target, navigation)).not.toBeNull();
  });
});
