// Double-click word and triple-click block planner tests (interactive-paginated-editing 5.3).

import { describe, expect, test } from 'bun:test';
import type { InteractionFrame, InteractionHostMetrics } from '@docx-editor.dev/core-contract/interaction';
import { contentToClient, IDENTITY_HOST_METRICS } from '../src/coordinate-mapper.ts';
import { deriveCaretGeometry } from '../src/interaction-geometry.ts';
import { InteractionFrameStore } from '../src/interaction-frame.ts';
import {
  clientPointForStackedText,
  modelWith,
  modelWithRunSplit,
  modelWithTableCell,
  publishFrame,
  stackedFrame,
} from './interaction-test-helpers.ts';
import { planInteraction, type InteractionPlannerContext } from '../src/interaction-planner.ts';
import { hitTestPointer } from '../src/interaction-geometry.ts';
import { endpointsOnGraphemeBoundaries, wordSelectionFromHit } from '../src/word-selection.ts';

const METRICS: InteractionHostMetrics = {
  clientOrigin: { x: 40, y: 60 },
  scrollOffset: { x: 12, y: 8 },
  zoom: 1.5,
};

function plannerContext(
  frame: InteractionFrame,
  overrides: Partial<InteractionPlannerContext> = {},
): InteractionPlannerContext {
  return { frame, editable: true, readOnly: false, hostMetrics: METRICS, ...overrides };
}

function clickIntent(
  frame: InteractionFrame,
  clientPoint: { x: number; y: number },
  overrides: Partial<{ shiftKey: boolean; clickCount: number; buttons: number; button: number }> = {},
) {
  return { kind: 'click' as const, frameId: frame.id, clientPoint, ...overrides };
}

function clientOnCluster(
  frame: InteractionFrame,
  pageIndex: number,
  cluster: { box: { x: number; y: number; width: number; height: number } },
  xRatio = 0.5,
) {
  return clientPointForStackedText(
    frame,
    pageIndex,
    { x: cluster.box.x + cluster.box.width * xRatio, y: cluster.box.y + cluster.box.height / 2 },
    METRICS,
  );
}

function expectRejectOnly(plan: ReturnType<typeof planInteraction>, code?: string) {
  expect(plan.effects).toHaveLength(1);
  expect(plan.effects[0]).toMatchObject({ kind: 'reject', ...(code ? { code } : {}) });
  expect(plan.effects.some((effect) => effect.kind === 'syncSelection' || effect.kind === 'focus')).toBe(false);
}

function syncSelection(plan: ReturnType<typeof planInteraction>) {
  const effect = plan.effects[0];
  if (effect?.kind !== 'syncSelection') throw new Error('expected syncSelection');
  return effect.selection;
}

function whitespaceRegion(frame: InteractionFrame, blockId?: string) {
  const id = blockId ?? frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
  return frame.semanticIndex.ownershipRegions.find(
    (r) => r.kind === 'lineWhitespace' && r.identity.blockId === id && r.box,
  );
}

function pointInWhitespaceBox(
  frame: InteractionFrame,
  region: NonNullable<ReturnType<typeof whitespaceRegion>>,
  xRatio = 0.25,
) {
  const box = region.box!;
  return clientPointForStackedText(
    frame,
    region.pageIndex ?? 0,
    { x: box.x + box.width * xRatio, y: box.y + box.height / 2 },
    METRICS,
  );
}

function blockForTarget(frame: InteractionFrame, blockId: string) {
  return frame.semanticIndex.stories.flatMap((s) => s.blocks).find((b) => b.identity.blockId === blockId)!;
}

function clusterCovering(item: { clusters: readonly { graphemeFrom: number; graphemeTo: number; box: { x: number; y: number; width: number; height: number } }[] }, graphemeIndex: number) {
  return (
    item.clusters.find((c) => c.graphemeFrom <= graphemeIndex && graphemeIndex < c.graphemeTo) ??
    item.clusters.find((c) => c.graphemeFrom === graphemeIndex) ??
    item.clusters[graphemeIndex]!
  );
}

function expectedDoubleClick(frame: InteractionFrame, clientPoint: { x: number; y: number }) {
  const hit = hitTestPointer(frame, clientPoint, METRICS);
  if (!hit.ok || hit.value.target.kind !== 'text') throw new Error('editable text hit required');
  const block = blockForTarget(frame, hit.value.target.identity.blockId);
  return wordSelectionFromHit(hit.value.target, block.wordSegments, block.graphemeCount);
}

function expectDoubleClickAtGrapheme(frame: InteractionFrame, graphemeIndex: number) {
  const item = frame.display[0]!.items.find((i) => i.kind === 'text');
  if (item?.kind !== 'text') throw new Error('text');
  const cluster = clusterCovering(item, graphemeIndex);
  const point = clientOnCluster(frame, 0, cluster, 0.5);
  const expected = expectedDoubleClick(frame, point);
  const sel = syncSelection(planInteraction(plannerContext(frame), clickIntent(frame, point, { clickCount: 2 })));
  expect(sel.anchor.graphemeOffset).toBe(expected.anchor.graphemeOffset);
  expect(sel.head.graphemeOffset).toBe(expected.head.graphemeOffset);
  expect(endpointsOnGraphemeBoundaries(blockForTarget(frame, item.semantic.identity.blockId).graphemeCount, sel.anchor.graphemeOffset, sel.head.graphemeOffset)).toBe(true);
}

describe('interaction planner word/block click (task 5.3)', () => {
  test('double-click selects Unicode word segments without splitting grapheme clusters', () => {
    const frame = publishFrame(modelWith(['cafe']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;

    const cafeCluster = item.clusters[0]!;
    const cafePlan = planInteraction(
      plannerContext(frame),
      clickIntent(frame, clientOnCluster(frame, 0, cafeCluster), { clickCount: 2 }),
    );
    const cafeSel = syncSelection(cafePlan);
    expect(cafeSel.anchor.graphemeOffset).toBeLessThan(cafeSel.head.graphemeOffset);
    expect(endpointsOnGraphemeBoundaries(block.graphemeCount, cafeSel.anchor.graphemeOffset, cafeSel.head.graphemeOffset)).toBe(
      true,
    );

    const untrustedFrame = publishFrame(modelWith(['café']));
    const untrustedItem = untrustedFrame.display[0]!.items.find((i) => i.kind === 'text');
    if (untrustedItem?.kind !== 'text') throw new Error('text');
    expect(untrustedItem.clusters).toHaveLength(4);
    expect(untrustedItem.clusters.every((c) => c.graphemeTo - c.graphemeFrom === 1)).toBe(true);
    expect(untrustedItem.clusters.map((c) => c.graphemeFrom)).toEqual([0, 1, 2, 3]);
  });

  test('double-click on run-split paragraph uses canonical model word spans', () => {
    const frame = publishFrame(modelWithRunSplit(['hel', 'lo world']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const midCluster = item.clusters[2]!;
    const plan = planInteraction(
      plannerContext(frame),
      clickIntent(frame, clientOnCluster(frame, 0, midCluster), { clickCount: 2 }),
    );
    const sel = syncSelection(plan);
    expect(sel.anchor.graphemeOffset).toBe(0);
    expect(sel.head.graphemeOffset).toBe(5);
  });

  test('triple-click selects full editable paragraph including empty paragraphs', () => {
    const emptyFrame = publishFrame(modelWith(['']));
    const emptyRegion = emptyFrame.semanticIndex.ownershipRegions.find((r) => r.kind === 'paragraph' && r.box);
    if (!emptyRegion?.box) throw new Error('empty ownership');
    const emptyPoint = clientPointForStackedText(
      emptyFrame,
      emptyRegion.pageIndex ?? 0,
      { x: emptyRegion.box.x + 2, y: emptyRegion.box.y + 2 },
      METRICS,
    );
    const emptyPlan = planInteraction(plannerContext(emptyFrame), clickIntent(emptyFrame, emptyPoint, { clickCount: 3 }));
    expect(syncSelection(emptyPlan)).toMatchObject({
      anchor: { graphemeOffset: 0 },
      head: { graphemeOffset: 0 },
    });

    const frame = publishFrame(modelWith(['alpha beta', 'gamma']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const cluster = item.clusters[3] ?? item.clusters[0]!;
    const plan = planInteraction(
      plannerContext(frame),
      clickIntent(frame, clientOnCluster(frame, 0, cluster), { clickCount: 3 }),
    );
    const sel = syncSelection(plan);
    expect(sel.anchor.graphemeOffset).toBe(0);
    expect(sel.head.graphemeOffset).toBe(block.graphemeCount);
    expect(sel.anchor.identity.blockId).toBe(block.identity.blockId);
  });

  test('clickCount accepts 2 and 3 while rejecting malformed values before hit testing side effects', () => {
    const frame = publishFrame(modelWith(['word']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[0]!);

    expect(planInteraction(plannerContext(frame), clickIntent(frame, point, { clickCount: 2 })).effects[0]).toMatchObject({
      kind: 'syncSelection',
    });
    expect(planInteraction(plannerContext(frame), clickIntent(frame, point, { clickCount: 3 })).effects[0]).toMatchObject({
      kind: 'syncSelection',
    });

    for (const clickCount of [0, -1, 4, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expectRejectOnly(planInteraction(plannerContext(frame), clickIntent(frame, point, { clickCount })), 'unsupported');
    }
  });

  test('shift-modified double and triple click reject without sync or focus', () => {
    const frame = publishFrame(modelWith(['abc']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[1] ?? item.clusters[0]!);
    expectRejectOnly(planInteraction(plannerContext(frame), clickIntent(frame, point, { clickCount: 2, shiftKey: true })));
    expectRejectOnly(planInteraction(plannerContext(frame), clickIntent(frame, point, { clickCount: 3, shiftKey: true })));
  });

  test('read-only table cell and atomic hits reject multi-click without sync/focus', () => {
    const readOnlyCell = publishFrame(modelWithTableCell('locked'));
    const cellItem = readOnlyCell.display
      .flatMap((p) => p.items)
      .find((i) => i.kind === 'text' && i.semantic.identity.blockId === 'p-cell');
    if (cellItem?.kind !== 'text') throw new Error('cell text');
    const cellPage = readOnlyCell.display.find((p) => p.items.includes(cellItem))!.index;
    const cellPoint = clientPointForStackedText(
      readOnlyCell,
      cellPage,
      { x: cellItem.box.x + 2, y: cellItem.box.y + 2 },
      METRICS,
    );
    expectRejectOnly(
      planInteraction(plannerContext(readOnlyCell), clickIntent(readOnlyCell, cellPoint, { clickCount: 2 })),
      'readOnly',
    );
    expectRejectOnly(
      planInteraction(plannerContext(readOnlyCell), clickIntent(readOnlyCell, cellPoint, { clickCount: 3 })),
      'readOnly',
    );

    const imageFrame = publishFrame(modelWith(['before']));
    const page = imageFrame.display[0]!;
    const textItem = page.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const imageItem = {
      kind: 'image' as const,
      box: textItem.box,
      src: 'embedded',
      semantic: { scope: { kind: 'body' as const }, objectId: 'img-1' },
      scope: { kind: 'body' as const },
      docFrom: 0,
      docTo: 0,
      blockId: 1,
      interaction: {
        pageIndex: 0,
        zOrder: 200,
        role: 'atomicObject' as const,
        writingDirection: 'ltr' as const,
        writingMode: 'horizontal-tb' as const,
      },
    };
    const atomicFrame = { ...imageFrame, display: [{ ...page, items: [textItem, imageItem] }] };
    const atomicPoint = clientPointForStackedText(
      atomicFrame,
      0,
      { x: imageItem.box.x + 2, y: imageItem.box.y + 2 },
      METRICS,
    );
    expectRejectOnly(
      planInteraction(plannerContext(atomicFrame), clickIntent(atomicFrame, atomicPoint, { clickCount: 2 })),
      'unsupported',
    );
    expectRejectOnly(
      planInteraction(plannerContext(atomicFrame), clickIntent(atomicFrame, atomicPoint, { clickCount: 3 })),
      'unsupported',
    );
  });

  test('stale pending page-gap and missing metrics reject multi-click without mutation path', () => {
    const frame = publishFrame(modelWith(['x']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[0]!);

    expect(
      planInteraction(plannerContext(frame), { ...clickIntent(frame, point, { clickCount: 2 }), frameId: { value: frame.id.value - 1 } })
        .effects[0],
    ).toMatchObject({ kind: 'reject', code: 'staleFrame' });

    const pending: InteractionFrame = {
      ...frame,
      completeness: { kind: 'pending', awaiting: 'layout', targetModelRevision: 2 },
    };
    expectRejectOnly(
      planInteraction(plannerContext(pending), clickIntent(pending, point, { clickCount: 3 })),
      'pendingLayout',
    );

    expectRejectOnly(
      planInteraction(plannerContext(frame, { hostMetrics: undefined }), clickIntent(frame, point, { clickCount: 2 })),
      'invalidTarget',
    );

    const gapFrame = stackedFrame(2, 24);
    const gapY = gapFrame.scrollGeometry.pageTops[0]! + 1056 + 10;
    const gapClient = contentToClient({ x: 100, y: gapY }, IDENTITY_HOST_METRICS);
    if (!gapClient.ok) throw new Error('gap client');
    expectRejectOnly(
      planInteraction(
        plannerContext(gapFrame, { hostMetrics: IDENTITY_HOST_METRICS }),
        clickIntent(gapFrame, gapClient.value, { clickCount: 2 }),
      ),
      'invalidTarget',
    );
  });

  test('multi-click remains stateless and reads word spans from the current frame only', () => {
    const firstFrame = publishFrame(modelWith(['one two']));
    const item = firstFrame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(firstFrame, 0, item.clusters[2] ?? item.clusters[0]!);
    const firstPlan = planInteraction(plannerContext(firstFrame), clickIntent(firstFrame, point, { clickCount: 2 }));

    const store = new InteractionFrameStore();
    const relayout = store.publishLayout({
      modelRevision: 2,
      resourceEpoch: 0,
      configurationEpoch: 0,
      display: publishFrame(modelWith(['changed words'])).display,
      semanticIndex: publishFrame(modelWith(['changed words'])).semanticIndex,
      pageGapPx: firstFrame.scrollGeometry.pageGapPx,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: firstFrame.focus,
      composition: firstFrame.composition,
      currentPage: firstFrame.currentPage,
    });
    const relayoutItem = relayout.display[0]!.items.find((i) => i.kind === 'text');
    if (relayoutItem?.kind !== 'text') throw new Error('relayout text');
    const relayoutPoint = clientOnCluster(relayout, 0, relayoutItem.clusters[0]!, 0.1);
    const secondPlan = planInteraction(plannerContext(relayout), clickIntent(relayout, relayoutPoint, { clickCount: 2 }));

    expect(firstPlan.effects).not.toEqual(secondPlan.effects);
    expect(planInteraction(plannerContext(firstFrame), clickIntent(firstFrame, point, { clickCount: 2 })).effects).toEqual(
      firstPlan.effects,
    );
  });

  test('double-click selection endpoints align with caret geometry projection', () => {
    const frame = publishFrame(modelWith(['abcd']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const plan = planInteraction(
      plannerContext(frame),
      clickIntent(frame, clientOnCluster(frame, 0, item.clusters[1]!, 0.5), { clickCount: 2 }),
    );
    const sel = syncSelection(plan);
    expect(deriveCaretGeometry(frame, sel.head)).not.toBeNull();
    expect(deriveCaretGeometry(frame, sel.anchor)).not.toBeNull();
  });

  test('single-click behavior from task 5.2 remains unchanged', () => {
    const frame = publishFrame(modelWith(['xy']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[0]!, 0.05);
    const plan = planInteraction(plannerContext(frame), clickIntent(frame, point));
    expect(plan.effects[0]).toMatchObject({
      kind: 'syncSelection',
      selection: {
        anchor: { graphemeOffset: 0 },
        head: { graphemeOffset: 0 },
      },
    });
  });

  describe('planner double-click selection coverage', () => {
    test('Latin punctuation and whitespace select non-word segments', () => {
      expectDoubleClickAtGrapheme(publishFrame(modelWith(['ab,cd'])), 2);

      const frame = publishFrame(modelWith(['ab cd']));
      const ws = whitespaceRegion(frame)!;
      expect(ws).toMatchObject({ graphemeFrom: 2, graphemeTo: 3 });
      const sel = syncSelection(
        planInteraction(
          plannerContext(frame),
          clickIntent(frame, pointInWhitespaceBox(frame, ws), { clickCount: 2 }),
        ),
      );
      expect(sel.anchor.graphemeOffset).toBe(2);
      expect(sel.head.graphemeOffset).toBe(3);
    });

    test('contraction apostrophe stays in one word selection', () => {
      expectDoubleClickAtGrapheme(publishFrame(modelWith(["don't stop"])), 2);
    });

    test('combining-mark word emits semantic clusters without geometry-trusted interior caret', () => {
      const frame = publishFrame(modelWith(['e\u0301té la']));
      const item = frame.display[0]!.items.find((i) => i.kind === 'text');
      if (item?.kind !== 'text') throw new Error('text');
      expect(item.clusters.some((c) => c.graphemeFrom === 0 && c.graphemeTo === 1)).toBe(true);
      expect(item.clusters.every((c) => c.graphemeTo - c.graphemeFrom >= 1)).toBe(true);
    });

    test('emoji and ZWJ sequences omit untrusted display clusters (fail closed)', () => {
      for (const text of ['a😀b', '❤️ ok', '👨‍👩‍👧']) {
        const frame = publishFrame(modelWith([text]));
        const item = frame.display[0]!.items.find((i) => i.kind === 'text');
        if (item?.kind !== 'text') throw new Error('text');
        expect(item.clusters.every((c) => c.graphemeTo - c.graphemeFrom <= 1)).toBe(true);
      }
    });

    test('RTL Arabic and Hebrew emit semantic clusters while bidi keyboard remains fail-closed elsewhere', () => {
      for (const text of ['مرحبا', 'שלום']) {
        const frame = publishFrame(modelWith([text]));
        const item = frame.display[0]!.items.find((i) => i.kind === 'text');
        if (item?.kind !== 'text') throw new Error('text');
        expect(item.clusters.length).toBeGreaterThan(0);
        expect(item.clusters.every((c) => c.graphemeTo - c.graphemeFrom === 1)).toBe(true);
      }
    });

    test('CJK and mixed-script paragraphs follow Intl word segments', () => {
      expectDoubleClickAtGrapheme(publishFrame(modelWith(['hello日本語'])), 3);
      expectDoubleClickAtGrapheme(publishFrame(modelWith(['café 日本'])), 0);
    });

    test('run-split paragraphs use canonical model word spans', () => {
      expectDoubleClickAtGrapheme(publishFrame(modelWithRunSplit(['hel', 'lo'])), 2);
    });

    test('segment boundary affinity matches hit-test upstream/downstream policy', () => {
      const frame = publishFrame(modelWith(['foo,bar']));
      const item = frame.display[0]!.items.find((i) => i.kind === 'text');
      if (item?.kind !== 'text') throw new Error('text');
      const boundaryCluster = clusterCovering(item, 3);
      const leftPoint = clientOnCluster(frame, 0, boundaryCluster, 0.05);
      const rightPoint = clientOnCluster(frame, 0, boundaryCluster, 0.95);
      const left = syncSelection(planInteraction(plannerContext(frame), clickIntent(frame, leftPoint, { clickCount: 2 })));
      const right = syncSelection(planInteraction(plannerContext(frame), clickIntent(frame, rightPoint, { clickCount: 2 })));
      expect(left.anchor.graphemeOffset).toBe(0);
      expect(left.head.graphemeOffset).toBe(3);
      expect(right.anchor.graphemeOffset).toBe(3);
      expect(right.head.graphemeOffset).toBe(4);
    });

    test('end-of-paragraph trailing hit selects preceding word segment', () => {
      const frame = publishFrame(modelWith(['tail']));
      const block = frame.semanticIndex.stories[0]!.blocks[0]!;
      const trailing = frame.semanticIndex.ownershipRegions.find((r) => r.kind === 'trailing' && r.box);
      if (!trailing?.box) throw new Error('trailing');
      const point = clientPointForStackedText(
        frame,
        trailing.pageIndex ?? 0,
        { x: trailing.box.x + trailing.box.width - 1, y: trailing.box.y + 2 },
        METRICS,
      );
      const sel = syncSelection(planInteraction(plannerContext(frame), clickIntent(frame, point, { clickCount: 2 })));
      expect(sel.anchor.graphemeOffset).toBe(0);
      expect(sel.head.graphemeOffset).toBe(block.graphemeCount);
    });

    test('empty paragraph double-click remains collapsed 0..0', () => {
      const frame = publishFrame(modelWith(['']));
      const region = frame.semanticIndex.ownershipRegions.find((r) => r.kind === 'paragraph' && r.box);
      if (!region?.box) throw new Error('empty');
      const point = clientPointForStackedText(frame, region.pageIndex ?? 0, { x: region.box.x + 2, y: region.box.y + 2 }, METRICS);
      const sel = syncSelection(planInteraction(plannerContext(frame), clickIntent(frame, point, { clickCount: 2 })));
      expect(sel.anchor.graphemeOffset).toBe(0);
      expect(sel.head.graphemeOffset).toBe(0);
    });
  });
});
