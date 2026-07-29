// Sixth review pass — trusted navigation, fragment identity, traversal barriers (task 5.5).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { layoutBody } from '@docx-editor.dev/engine-layout';
import {
  createEmptyModel,
  bodyStoryId,
  type PackageModel,
  type ParagraphRecord,
  type TableRecord,
  type SdtRecord,
} from '@docx-editor.dev/engine-core';
import { toDisplayPages } from '../src/display-bridge.ts';
import { freezeNavigationGeometry } from '../src/navigation-geometry.ts';
import { buildTraversalLinksForModel } from '../src/semantic-index.ts';
import { executeInteractionPlan } from '../src/interaction-executor.ts';
import { commitNavigationSessionAfterExecution } from '../src/navigation-session.ts';
import { InteractionFrameStore } from '../src/interaction-frame.ts';
import { caretOverlayForTarget, deriveCaretGeometry } from '../src/interaction-geometry.ts';
import { planKeyboardNavigation } from '../src/keyboard-navigation.ts';
import { caretContentX, pageRelativeY } from '../src/line-catalog.ts';
import { hasGeometryStopAtOffset, isHorizontalTransitionOffset } from '../src/navigation-stops.ts';
import { createTestEditor as createEditor } from './create-test-editor.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/editor';
import { createEditableParagraphFixture } from '../browser/fixtures.ts';
import {
  LAYOUT,
  modelWith,
  modelWithRunSplit,
  modelWithParagraphTableParagraph,
  publishFrameBundle,
  selectionForBlock,
} from './interaction-test-helpers.ts';
import { createHarfBuzzLayoutOptions } from '../../core/src/layout/__tests__/fixtures/layout-shaping.ts';

const METRICS = { clientOrigin: { x: 0, y: 0 }, scrollOffset: { x: 0, y: 0 }, zoom: 1 };

function hostWith(body: HTMLElement): EditorHost {
  return {
    getBodyHostEl: () => body,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => null,
    getInteractionHostMetrics: () => METRICS,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
}

function modelWithRepeatingHeaderTable(): PackageModel {
  const base = createEmptyModel();
  const storyId = bodyStoryId(base);
  const story = base.stories.get(storyId)!;
  const headerRow = {
    id: 'hdr-row',
    props: { isHeader: true as const },
    cells: [
      {
        id: 'hdr-cell',
        blocks: [{ kind: 'paragraph' as const, id: 'p-hdr', runs: [{ text: 'HDR' }] }],
      },
    ],
  };
  const bodyRows = Array.from({ length: 12 }, (_, i) => ({
    id: `row-${i}`,
    cells: [
      {
        id: `cell-${i}`,
        blocks: [{ kind: 'paragraph' as const, id: `p-${i}`, runs: [{ text: `R${i}` }] }],
      },
    ],
  }));
  const table: TableRecord = { kind: 'table', id: 'tbl-1', rows: [headerRow, ...bodyRows] };
  return { ...base, stories: new Map(base.stories).set(storyId, { ...story, blocks: [table] }) };
}

function publishBundle(model: PackageModel, layout = LAYOUT) {
  const pages = layoutBody(model, layout).pages;
  const bridge = toDisplayPages(model, pages);
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
  return { frame, navigation: store.getNavigationGeometry(frame.id), bridge, store };
}

function planArrowAt(
  bundle: ReturnType<typeof publishFrameBundle>,
  key: string,
  blockId: string,
  offset: number,
  paragraphText: string
) {
  const selection = selectionForBlock(bundle.frame, blockId, offset, offset);
  const frame = {
    ...bundle.frame,
    selection,
    focus: { scope: { kind: 'body' as const }, focused: true },
  };
  return planKeyboardNavigation({
    frame,
    navigation: bundle.navigation,
    intent: { kind: 'geometryKeyboard', frameId: frame.id, key, shiftKey: false },
    priorSession: null,
    documentGeneration: 1,
    modelRevision: 1,
    paragraphText: () => paragraphText,
  });
}

function planArrow(bundle: ReturnType<typeof publishBundle>, key: string, text: string) {
  const blockId = bundle.bridge.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
  const selection = selectionForBlock(bundle.frame, blockId, 0, 0);
  const frame = {
    ...bundle.frame,
    selection,
    focus: { scope: { kind: 'body' as const }, focused: true },
  };
  return planKeyboardNavigation({
    frame,
    navigation: bundle.navigation,
    intent: { kind: 'geometryKeyboard', frameId: frame.id, key, shiftKey: false },
    priorSession: null,
    documentGeneration: 1,
    modelRevision: 1,
    paragraphText: () => text,
  });
}

describe('navigation review pass 6 (task 5.5)', () => {
  test('opaque fi ArrowRight from offset 0 lands on offset 2 never 1', () => {
    const model = modelWithRunSplit(['fi']);
    const layout = createHarfBuzzLayoutOptions();
    const bundle = publishBundle(model, layout);
    const blockId = bundle.bridge.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const selection = selectionForBlock(bundle.frame, blockId, 0, 0);
    const frame = {
      ...bundle.frame,
      selection,
      focus: { scope: { kind: 'body' as const }, focused: true },
    };
    const moved = planKeyboardNavigation({
      frame,
      navigation: bundle.navigation,
      intent: { kind: 'geometryKeyboard', frameId: frame.id, key: 'ArrowRight', shiftKey: false },
      priorSession: null,
      documentGeneration: 1,
      modelRevision: 1,
      paragraphText: () => 'fi',
    });
    const sync = moved.plan.effects.find((e) => e.kind === 'syncSelection');
    expect(sync?.kind).toBe('syncSelection');
    if (sync?.kind !== 'syncSelection') throw new Error('sync');
    expect(sync.selection.head.graphemeOffset).toBe(2);
    expect(sync.selection.head.graphemeOffset).not.toBe(1);
  });

  test('shaped combining cluster publishes exact geometry at its semantic edge', () => {
    const bundle = publishBundle(modelWithRunSplit(['e\u0301x']));
    const blockId = bundle.bridge.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const storyId = bundle.bridge.semanticIndex.stories[0]!.storyId;
    expect(hasGeometryStopAtOffset(bundle.navigation, storyId, blockId, 1)).toBe(true);
    expect(isHorizontalTransitionOffset(bundle.navigation, storyId, blockId, 1, 3)).toBe(true);
    const target = {
      kind: 'text' as const,
      scope: { kind: 'body' as const },
      identity: { storyId, blockId },
      graphemeOffset: 1,
      affinity: 'upstream' as const,
    };
    expect(caretContentX(bundle.frame, target, bundle.navigation)).not.toBeNull();
    const moved = planArrowAt(bundle, 'ArrowRight', blockId, 0, 'e\u0301x');
    const sync = moved.plan.effects.find((e) => e.kind === 'syncSelection');
    expect(sync?.kind).toBe('syncSelection');
    if (sync?.kind !== 'syncSelection') throw new Error('sync');
    expect(sync.selection.head.graphemeOffset).toBe(1);
  });

  test('emoji ArrowRight 0 to 1 uses exact shaped grapheme edges', () => {
    const bundle = publishBundle(modelWithRunSplit(['a😀b']));
    const blockId = bundle.bridge.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const storyId = bundle.bridge.semanticIndex.stories[0]!.storyId;
    expect(hasGeometryStopAtOffset(bundle.navigation, storyId, blockId, 1)).toBe(true);
    expect(hasGeometryStopAtOffset(bundle.navigation, storyId, blockId, 2)).toBe(true);
    expect(isHorizontalTransitionOffset(bundle.navigation, storyId, blockId, 1, 3)).toBe(true);
    expect(bundle.navigation.semanticHorizontalBoundariesByBlockId[blockId]).toEqual([0, 1, 2, 3]);
    const moved = planArrowAt(bundle, 'ArrowRight', blockId, 0, 'a😀b');
    const sync = moved.plan.effects.find((e) => e.kind === 'syncSelection');
    expect(sync?.kind).toBe('syncSelection');
    if (sync?.kind !== 'syncSelection') throw new Error('sync');
    expect(sync.selection.head.graphemeOffset).toBe(1);
  });

  test('shaped emoji runs publish exact geometry at every grapheme edge', () => {
    for (const [text, graphemeCount] of [
      ['😀', 1],
      ['a😀', 2],
      ['a😀b', 3],
    ] as const) {
      const bundle = publishBundle(modelWithRunSplit([text]));
      const blockId = bundle.bridge.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
      const storyId = bundle.bridge.semanticIndex.stories[0]!.storyId;
      for (let offset = 0; offset <= graphemeCount; offset += 1) {
        expect(hasGeometryStopAtOffset(bundle.navigation, storyId, blockId, offset)).toBe(true);
      }
    }
  });

  test('trusted combining provider exposes exact interior x for offset 1', () => {
    const model = modelWithRunSplit(['e\u0301x']);
    const layoutOpts = LAYOUT;
    const pages = layoutBody(model, layoutOpts).pages;
    const bridge = toDisplayPages(model, pages);
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
    const navigation = store.getNavigationGeometry(frame.id);
    const blockId = bridge.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const edge = pages
      .flatMap((p) => p.items)
      .find((i) => i.type === 'caretEdge' && i.graphemeOffset === 1 && i.navigable);
    expect(edge?.type).toBe('caretEdge');
    const target = {
      kind: 'text' as const,
      scope: { kind: 'body' as const },
      identity: { storyId: bridge.semanticIndex.stories[0]!.storyId, blockId },
      graphemeOffset: 1,
      affinity: 'upstream' as const,
    };
    const x = caretContentX(frame, target, navigation);
    expect(x).toBeCloseTo((edge as { x: number }).x / 15, 5);
  });

  test('exact sidecar fragment clip metadata rejects off-fragment tamper', () => {
    const bundle = publishBundle(modelWithRunSplit(['ab']));
    const line = bundle.navigation.visualLines[0]!;
    const target = line.edges.find((e) => e.target.graphemeOffset === 1)!.target;
    expect(caretOverlayForTarget(bundle.frame, bundle.navigation, target)).not.toBeNull();
    const tampered = freezeNavigationGeometry({
      ...bundle.navigation,
      visualLines: bundle.navigation.visualLines.map((record) => ({
        ...record,
        edges: record.edges.map((edge) => ({
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
    expect(caretOverlayForTarget(bundle.frame, tampered, target)).toBeNull();
  });

  test('traversal barriers reset adjacency for table SDT and non-paragraph blocks', () => {
    const base = createEmptyModel();
    const storyId = bodyStoryId(base);
    const story = base.stories.get(storyId)!;
    const a: ParagraphRecord = { kind: 'paragraph', id: 'p-a', runs: [{ text: 'a' }] };
    const inside: ParagraphRecord = { kind: 'paragraph', id: 'p-in', runs: [{ text: 'in' }] };
    const b: ParagraphRecord = { kind: 'paragraph', id: 'p-b', runs: [{ text: 'b' }] };
    const table: TableRecord = {
      kind: 'table',
      id: 'tbl-1',
      rows: [{ id: 'r1', cells: [{ id: 'c1', blocks: [inside] }] }],
    };
    const sdt: SdtRecord = { kind: 'sdt', id: 'sdt-1', blocks: [inside] };
    for (const blocks of [
      [a, table, b],
      [a, sdt, b],
    ] as const) {
      const model: PackageModel = {
        ...base,
        stories: new Map(base.stories).set(storyId, { ...story, blocks: [...blocks] }),
      };
      const links = buildTraversalLinksForModel(model);
      expect(links.get('p-a')?.nextEditableBlockId).toBeNull();
      expect(links.get('p-b')?.previousEditableBlockId).toBeNull();
    }
  });

  test('valid keyboard plan executes binding callback rejection without mutating session', () => {
    const { frame, navigation } = publishFrameBundle();
    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const selection = selectionForBlock(frame, blockId, 0, 0);
    const focused = {
      ...frame,
      selection,
      focus: { scope: { kind: 'body' as const }, focused: true },
    };
    const planned = planKeyboardNavigation({
      frame: focused,
      navigation,
      intent: { kind: 'geometryKeyboard', frameId: focused.id, key: 'ArrowRight', shiftKey: false },
      priorSession: null,
      documentGeneration: 1,
      modelRevision: 1,
      paragraphText: () => 'hello',
    });
    expect(planned.plan.effects.some((e) => e.kind === 'syncSelection')).toBe(true);
    const execution = executeInteractionPlan(
      {
        syncSemanticSelection: () => ({
          ok: false,
          code: 'invalidTarget',
          reason: 'binding rejected',
          frameId: focused.id,
        }),
        focus: () => ({ ok: true, value: undefined, frameId: focused.id }),
        blur: () => {},
        execCommand: () => ({ ok: false, code: 'unsupported', reason: 'no' }),
        delegateNativeInput: () => ({ ok: true, value: undefined, frameId: focused.id }),
        publishSelectionOverlay: () => {},
        currentFrameId: () => focused.id,
      },
      planned.plan
    );
    expect(execution.outcome.ok).toBe(false);
    expect(execution.outcome.code).toBe('invalidTarget');
    expect(commitNavigationSessionAfterExecution(planned.navigation, execution).session).toEqual(
      planned.navigation.priorSession
    );
    expect(focused.selection!.head.graphemeOffset).toBe(0);
  });

  test('PageDown preserves exact seed X and relative page Y on destination', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const bundle = publishFrameBundle(modelWith([words]), {
      layout: { ...LAYOUT, pageHeight: 4000 },
    });
    const blockId = bundle.frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const selection = selectionForBlock(bundle.frame, blockId, 120, 120);
    const frame = {
      ...bundle.frame,
      selection,
      focus: { scope: { kind: 'body' as const }, focused: true },
    };
    const caret = deriveCaretGeometry(frame, selection.head);
    expect(caret).not.toBeNull();
    const seedX = caretContentX(frame, selection.head, bundle.navigation);
    const seedRelativeY = pageRelativeY(
      frame,
      caret!.pageIndex,
      caret!.rect.y + caret!.rect.height / 2
    );
    expect(seedX).not.toBeNull();
    expect(seedRelativeY).not.toBeNull();
    const moved = planKeyboardNavigation({
      frame,
      navigation: bundle.navigation,
      intent: { kind: 'geometryKeyboard', frameId: frame.id, key: 'PageDown', shiftKey: false },
      priorSession: null,
      documentGeneration: 1,
      modelRevision: 1,
      paragraphText: () => words,
    });
    const sync = moved.plan.effects.find((e) => e.kind === 'syncSelection');
    expect(sync?.kind).toBe('syncSelection');
    expect(moved.navigation.nextSessionOnSuccess?.visualAdvanceX).toBe(seedX);
    const nextCaret = deriveCaretGeometry(
      frame,
      sync!.kind === 'syncSelection' ? sync.selection.head : selection.head
    );
    expect(nextCaret?.pageIndex).toBe(caret!.pageIndex + 1);
    const destRelativeY = pageRelativeY(
      frame,
      nextCaret!.pageIndex,
      nextCaret!.rect.y + nextCaret!.rect.height / 2
    );
    expect(destRelativeY).toBeCloseTo(seedRelativeY!, 5);
  });

  test('table top-level barrier rejects horizontal traversal forward and backward', () => {
    const bundle = publishFrameBundle(modelWithParagraphTableParagraph('ab', 'cell', 'cd'));
    const blocks = bundle.frame.semanticIndex.stories[0]!.blocks;
    const beforeId = blocks[0]!.identity.blockId;
    const afterId = blocks[blocks.length - 1]!.identity.blockId;
    const forward = planArrowAt(bundle, 'ArrowRight', beforeId, 2, 'ab');
    expect(forward.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
    const backward = planArrowAt(bundle, 'ArrowLeft', afterId, 0, 'cd');
    expect(backward.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
  });

  test('cross-story keyboard selection rejects before sync in both directions', () => {
    const bundle = publishFrameBundle(modelWith(['abc']));
    const blockId = bundle.frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const base = selectionForBlock(bundle.frame, blockId, 1, 1);
    for (const key of ['ArrowLeft', 'ArrowRight'] as const) {
      const crossStory = {
        ...base,
        head: { ...base.head, identity: { storyId: 'other-story', blockId } },
      };
      const frame = {
        ...bundle.frame,
        selection: crossStory,
        focus: { scope: { kind: 'body' as const }, focused: true },
      };
      const planned = planKeyboardNavigation({
        frame,
        navigation: bundle.navigation,
        intent: { kind: 'geometryKeyboard', frameId: frame.id, key, shiftKey: false },
        priorSession: null,
        documentGeneration: 1,
        modelRevision: 1,
        paragraphText: () => 'abc',
      });
      expect(planned.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
      expect(planned.plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
    }
  });

  test('tblHeader repeated row disambiguates by page and fragment provenance', () => {
    const layoutOpts = { ...LAYOUT, pageHeight: 3600 };
    const bundle = publishFrameBundle(modelWithRepeatingHeaderTable(), { layout: layoutOpts });
    expect(bundle.frame.display.length).toBeGreaterThan(1);
    const hdrBlock = bundle.frame.semanticIndex.stories[0]!.blocks.find(
      (b) => b.identity.blockId === 'p-hdr'
    );
    expect(hdrBlock?.readOnly).toBe(true);
    const hdrLines = bundle.navigation.visualLines.filter(
      (line) => line.identity.blockId === 'p-hdr'
    );
    expect(hdrLines.length).toBeGreaterThanOrEqual(2);
    expect(new Set(hdrLines.map((line) => line.pageIndex)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(hdrLines.map((line) => `${line.pageIndex}:${line.line.fragmentId}`)).size).toBe(
      hdrLines.length
    );
    for (const line of hdrLines) {
      expect(line.interaction.pageIndex).toBe(line.pageIndex);
      expect(
        caretOverlayForTarget(bundle.frame, bundle.navigation, line.edges[0]!.target)
      ).toBeNull();
    }
    const reject = planArrowAt(bundle, 'ArrowRight', 'p-hdr', 0, 'HDR');
    expect(reject.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'readOnly' });
  });

  test('multi-page table cell lines carry honest page provenance', () => {
    const filler = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const bundle = publishFrameBundle(
      modelWithParagraphTableParagraph(filler, 'cell-on-later-page', filler),
      {
        layout: { ...LAYOUT, pageHeight: 4000 },
      }
    );
    const cellBlock = bundle.frame.semanticIndex.stories[0]!.blocks.find(
      (b) =>
        !b.readOnly &&
        b.identity.blockId !== bundle.frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId
    );
    expect(cellBlock).toBeDefined();
    const cellLines = bundle.navigation.visualLines.filter(
      (line) => line.identity.blockId === cellBlock!.identity.blockId
    );
    expect(cellLines.some((line) => line.pageIndex > 0)).toBe(true);
    expect(cellLines.every((line) => line.interaction.pageIndex === line.pageIndex)).toBe(true);
  });

  test('production pointer down move up and cancel lifecycle on createEditor', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Ptr',
    });
    const frame = editor.getInteractionFrame();
    const textItem = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const downPoint = {
      x: textItem.clusters[0]!.box.x + 2,
      y: textItem.clusters[0]!.box.y + textItem.clusters[0]!.box.height / 2,
    };
    const lastCluster = textItem.clusters.at(-1) ?? textItem.clusters[0]!;
    const movePoint = {
      x: lastCluster.box.x + lastCluster.box.width * 0.8,
      y: lastCluster.box.y + lastCluster.box.height / 2,
    };
    const down = editor.dispatchInteraction({
      kind: 'pointerDown',
      frameId: frame.id,
      clientPoint: downPoint,
      pointerId: 3,
      button: 0,
      buttons: 1,
    });
    expect(down.outcome.ok).toBe(true);
    expect(down.hostEffects).toEqual([{ kind: 'capturePointer', pointerId: 3 }]);
    const move = editor.dispatchInteraction({
      kind: 'pointerMove',
      frameId: editor.getInteractionFrame().id,
      clientPoint: movePoint,
      pointerId: 3,
      buttons: 1,
    });
    expect(move.outcome.ok).toBe(true);
    const cancel = editor.dispatchInteraction({
      kind: 'pointerCancel',
      frameId: editor.getInteractionFrame().id,
      clientPoint: movePoint,
      pointerId: 3,
    });
    expect(cancel.outcome.ok).toBe(true);
    expect(cancel.hostEffects).toEqual([{ kind: 'releasePointer', pointerId: 3 }]);
    const down2 = editor.dispatchInteraction({
      kind: 'pointerDown',
      frameId: editor.getInteractionFrame().id,
      clientPoint: downPoint,
      pointerId: 4,
      button: 0,
      buttons: 1,
    });
    expect(down2.outcome.ok).toBe(true);
    const up = editor.dispatchInteraction({
      kind: 'pointerUp',
      frameId: editor.getInteractionFrame().id,
      clientPoint: movePoint,
      pointerId: 4,
      buttons: 0,
    });
    expect(up.outcome.ok).toBe(true);
    expect(up.hostEffects).toEqual([{ kind: 'releasePointer', pointerId: 4 }]);
    editor.destroy();
    body.remove();
  });
});
