// Line catalog semantics (interactive-paginated-editing 5.5).

import { describe, expect, test } from 'bun:test';
import type { InteractionFrame } from '@docx-editor.dev/core-contract/interaction';
import { layoutBody } from '@docx-editor.dev/engine-layout';
import { toDisplayPages } from '../src/display-bridge.ts';
import { InteractionFrameStore } from '../src/interaction-frame.ts';
import { deriveCaretGeometry } from '../src/interaction-geometry.ts';
import { buildLineCatalog, lineForTarget, stopsForBlock, type LineCaretStop } from '../src/line-catalog.ts';
import type { NavigationGeometry } from '../src/navigation-geometry.ts';
import { freezeNavigationGeometry } from '../src/navigation-geometry.ts';
import { LAYOUT, modelWith, selectionForBlock } from './interaction-test-helpers.ts';
import { createEmptyModel, bodyStoryId } from '@docx-editor.dev/engine-core';

function modelWithBlockIds(texts: string[], ids: string[]) {
  const base = createEmptyModel();
  const storyId = bodyStoryId(base);
  const story = base.stories.get(storyId)!;
  const blocks = texts.map((text, index) => ({
    kind: 'paragraph' as const,
    id: ids[index]!,
    runs: [{ text }],
  }));
  return {
    ...base,
    stories: new Map(base.stories).set(storyId, { ...story, blocks }),
  };
}

function frameWithSelection(texts: string[], offset: number, layout = LAYOUT): { frame: InteractionFrame; navigation: NavigationGeometry } {
  const model = modelWith(texts);
  const layoutResult = layoutBody(model, layout);
  const bridged = toDisplayPages(model, layoutResult.pages);
  const blockId = bridged.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
  const store = new InteractionFrameStore();
  const base = store.publishLayout({
    modelRevision: 1,
    resourceEpoch: 0,
    configurationEpoch: 0,
    display: bridged.display,
    semanticIndex: bridged.semanticIndex,
    navigationGeometry: bridged.navigationGeometry,
    selection: null,
    caret: null,
    selectionGeometry: null,
    focus: { scope: { kind: 'body' }, focused: true },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: 0 },
  });
  const selection = selectionForBlock(base, blockId, offset, offset);
  const frame = store.publishSelection({
    modelRevision: 1,
    layoutRevision: base.revisions.layoutRevision,
    selection,
    caret: deriveCaretGeometry(base, selection.head),
    selectionGeometry: null,
    focus: { scope: { kind: 'body' }, focused: true },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: 0 },
  });
  return { frame, navigation: store.getNavigationGeometry(frame.id) };
}

describe('line catalog (task 5.5)', () => {
  test('ab cd single-space offset 3 and ab  cd whitespace stops appear in line catalog', () => {
    for (const [text, offset] of [
      ['ab cd', 3],
      ['ab  cd', 3],
    ] as const) {
      const { frame, navigation } = frameWithSelection([text], 2);
      const catalog = buildLineCatalog(frame, navigation);
      expect(catalog.ok).toBe(true);
      if (!catalog.ok) throw new Error('catalog');
      const stops = catalog.lines.flatMap((line) => line.stops);
      expect(stops.some((stop) => stop.target.graphemeOffset === offset)).toBe(true);
    }
    const double = frameWithSelection(['ab  cd'], 2);
    const whitespace = double.frame.semanticIndex.ownershipRegions.find((r) => r.kind === 'lineWhitespace');
    expect(whitespace).toBeDefined();
    const doubleStops = buildLineCatalog(double.frame, double.navigation);
    expect(doubleStops.ok).toBe(true);
    if (!doubleStops.ok) throw new Error('catalog');
    expect(
      doubleStops.lines
        .flatMap((line) => line.stops)
        .some((stop) => stop.target.graphemeOffset === whitespace!.graphemeFrom),
    ).toBe(true);
  });

  test('line catalog is deeply frozen against mutation', () => {
    const { frame, navigation } = frameWithSelection(['abcd'], 2);
    const catalog = buildLineCatalog(frame, navigation);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error('catalog');
    expect(Object.isFrozen(catalog.lines)).toBe(true);
    const line = catalog.lines[0]!;
    expect(Object.isFrozen(line)).toBe(true);
    expect(Object.isFrozen(line.stops)).toBe(true);
    expect(() => {
      (line.stops as LineCaretStop[]).push(line.stops[0]!);
    }).toThrow();
    expect(() => {
      (line.stops[0]!.target as { graphemeOffset: number }).graphemeOffset = 99;
    }).toThrow();
  });

  test('line order follows semantic block order not lexical block ids', () => {
    const model = modelWithBlockIds(['first', 'second'], ['z-block', 'a-block']);
    const layoutResult = layoutBody(model, LAYOUT);
    const bridged = toDisplayPages(model, layoutResult.pages);
    const store = new InteractionFrameStore();
    const frame = store.publishLayout({
      modelRevision: 1,
      resourceEpoch: 0,
      configurationEpoch: 0,
      display: bridged.display,
      semanticIndex: bridged.semanticIndex,
      navigationGeometry: bridged.navigationGeometry,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: true },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });
    const navigation = store.getNavigationGeometry(frame.id);
    const catalog = buildLineCatalog(frame, navigation);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error('catalog');
    const zBlock = bridged.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const aBlock = bridged.semanticIndex.stories[0]!.blocks[1]!.identity.blockId;
    expect(zBlock).toBe('z-block');
    expect(aBlock).toBe('a-block');
    const zIndex = catalog.lines.findIndex((line) => line.blockId === zBlock);
    const aIndex = catalog.lines.findIndex((line) => line.blockId === aBlock);
    expect(zIndex).toBeGreaterThanOrEqual(0);
    expect(aIndex).toBeGreaterThan(zIndex);
  });

  test('same Y blocks remain separate lines with distinct block identity', () => {
    const model = modelWith(['aaa', 'bbb']);
    const layoutResult = layoutBody(model, LAYOUT);
    const bridged = toDisplayPages(model, layoutResult.pages);
    const store = new InteractionFrameStore();
    const frame = store.publishLayout({
      modelRevision: 1,
      resourceEpoch: 0,
      configurationEpoch: 0,
      display: bridged.display,
      semanticIndex: bridged.semanticIndex,
      navigationGeometry: bridged.navigationGeometry,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: true },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });
    const navigation = store.getNavigationGeometry(frame.id);
    const catalog = buildLineCatalog(frame, navigation);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error('catalog');
    const blocks = frame.semanticIndex.stories[0]!.blocks;
    const blockLines = blocks.map((block) => stopsForBlock(catalog.lines, block.identity.storyId, block.identity.blockId));
    expect(blockLines[0]!.length).toBeGreaterThan(0);
    expect(blockLines[1]!.length).toBeGreaterThan(0);
    expect(new Set(catalog.lines.map((line) => line.blockId)).size).toBe(2);
  });

  test('affinity duplicates resolve exact affinity match first', () => {
    const { frame, navigation } = frameWithSelection(['ab'], 1);
    const catalog = buildLineCatalog(frame, navigation);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error('catalog');
    const head = frame.selection!.head;
    if (head.kind !== 'text') throw new Error('text');
    const upstream = { ...head, affinity: 'upstream' as const };
    const downstream = { ...head, affinity: 'downstream' as const };
    const upLine = lineForTarget(catalog.lines, upstream, frame, navigation);
    const downLine = lineForTarget(catalog.lines, downstream, frame, navigation);
    expect(upLine).not.toBeNull();
    expect(downLine).toBeNull();
  });

  test('clip intersection rejects non-invertible clipped geometry from catalog', () => {
    const { frame, navigation } = frameWithSelection(['abcd'], 2);
    const clippedNav = freezeNavigationGeometry({
      ...navigation,
      visualLines: navigation.visualLines.map((line) => ({
        ...line,
        edges: line.edges.map((edge) => ({
          ...edge,
          interaction: {
            ...edge.interaction,
            clip: { x: edge.pageLocalX + 500, y: edge.pageLocalY, width: 10, height: edge.pageLocalHeight },
          },
        })),
      })),
    });
    const catalog = buildLineCatalog(frame, clippedNav);
    const head = frame.selection!.head;
    if (head.kind !== 'text') throw new Error('text');
    if (catalog.ok) {
      expect(lineForTarget(catalog.lines, head, frame, clippedNav)).toBeNull();
    } else {
      expect(catalog.reason).toMatch(/visible|clip/i);
    }
  });
});
