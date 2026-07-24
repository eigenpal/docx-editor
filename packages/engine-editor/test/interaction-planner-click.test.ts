// Click caret placement and shift-click extension (interactive-paginated-editing 5.2).

import { describe, expect, test } from 'bun:test';
import type { InteractionFrame, InteractionHostMetrics, SemanticSelection } from '@docx-editor.dev/core-contract/interaction';
import { contentToClient, IDENTITY_HOST_METRICS } from '../src/coordinate-mapper.ts';
import { deriveCaretGeometry, hitTestPointer } from '../src/interaction-geometry.ts';
import { InteractionFrameStore } from '../src/interaction-frame.ts';
import {
  LAYOUT,
  clientPointForStackedText,
  modelWith,
  modelWithTableCell,
  publishFrame,
  selectionForBlock,
  stackedFrame,
} from './interaction-test-helpers.ts';
import { planInteraction, type InteractionPlannerContext } from '../src/interaction-planner.ts';

const METRICS: InteractionHostMetrics = {
  clientOrigin: { x: 40, y: 60 },
  scrollOffset: { x: 12, y: 8 },
  zoom: 1.5,
};

function plannerContext(
  frame: InteractionFrame,
  overrides: Partial<InteractionPlannerContext> = {},
): InteractionPlannerContext {
  return {
    frame,
    editable: true,
    readOnly: false,
    hostMetrics: METRICS,
    ...overrides,
  };
}

function clickIntent(
  frame: InteractionFrame,
  clientPoint: { x: number; y: number },
  overrides: Partial<{ shiftKey: boolean; button: number; clickCount: number; buttons: number }> = {},
) {
  return {
    kind: 'click' as const,
    frameId: frame.id,
    clientPoint,
    ...overrides,
  };
}

function clientOnCluster(
  frame: InteractionFrame,
  pageIndex: number,
  cluster: { box: { x: number; y: number; width: number; height: number } },
  xRatio = 0.5,
  metrics = METRICS,
) {
  return clientPointForStackedText(
    frame,
    pageIndex,
    { x: cluster.box.x + cluster.box.width * xRatio, y: cluster.box.y + cluster.box.height / 2 },
    metrics,
  );
}

function expectRejectOnly(plan: ReturnType<typeof planInteraction>, code?: string) {
  expect(plan.effects).toHaveLength(1);
  expect(plan.effects[0]).toMatchObject({ kind: 'reject', ...(code ? { code } : {}) });
  expect(plan.effects.some((effect) => effect.kind === 'syncSelection' || effect.kind === 'focus')).toBe(false);
}

function frameWithSelection(frame: InteractionFrame, selection: SemanticSelection): InteractionFrame {
  const store = new InteractionFrameStore();
  store.publishLayout({
    modelRevision: frame.revisions.modelRevision,
    resourceEpoch: frame.revisions.resourceEpoch,
    configurationEpoch: frame.revisions.configurationEpoch,
    display: frame.display,
    semanticIndex: frame.semanticIndex,
    pageGapPx: frame.scrollGeometry.pageGapPx,
    selection: null,
    caret: null,
    selectionGeometry: null,
    focus: frame.focus,
    composition: frame.composition,
    currentPage: frame.currentPage,
  });
  return store.publishSelection({
    modelRevision: frame.revisions.modelRevision,
    layoutRevision: frame.revisions.layoutRevision,
    selection,
    caret: null,
    selectionGeometry: null,
    focus: { scope: selection.scope, focused: true },
    composition: frame.composition,
    currentPage: frame.currentPage,
  });
}

describe('interaction planner click (task 5.2)', () => {
  test('plain click on editable text at cluster edges produces collapsed syncSelection then focus', () => {
    const frame = publishFrame(modelWith(['ab']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const left = item.clusters[0]!;
    const right = item.clusters[1]!;

    const leading = planInteraction(
      plannerContext(frame),
      clickIntent(frame, clientOnCluster(frame, 0, left, 0.05)),
    );
    expect(leading.effects).toEqual([
      {
        kind: 'syncSelection',
        frameId: frame.id,
        selection: {
          frameId: frame.id,
          scope: { kind: 'body' },
          anchor: {
            kind: 'text',
            scope: { kind: 'body' },
            identity: item.semantic.identity,
            graphemeOffset: 0,
            affinity: 'downstream',
          },
          head: {
            kind: 'text',
            scope: { kind: 'body' },
            identity: item.semantic.identity,
            graphemeOffset: 0,
            affinity: 'downstream',
          },
        },
      },
      { kind: 'focus', frameId: frame.id },
    ]);

    const trailing = planInteraction(
      plannerContext(frame),
      clickIntent(frame, clientOnCluster(frame, 0, right, 0.95)),
    );
    expect(trailing.effects[0]).toMatchObject({
      kind: 'syncSelection',
      selection: {
        anchor: { graphemeOffset: 2, affinity: 'downstream' },
        head: { graphemeOffset: 2, affinity: 'downstream' },
      },
    });
    expect(trailing.effects[1]).toEqual({ kind: 'focus', frameId: frame.id });
  });

  test('shift-click extends from anchor preserving forward and backward direction', () => {
    const frame = publishFrame(modelWith(['abcd']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const blockId = item.semantic.identity.blockId;

    const forwardBase = selectionForBlock(frame, blockId, 0, 1);
    const forwardFrame = frameWithSelection(frame, forwardBase);
    const forwardHeadCluster = item.clusters[3]!;
    const forward = planInteraction(
      plannerContext(forwardFrame),
      clickIntent(forwardFrame, clientOnCluster(forwardFrame, 0, forwardHeadCluster, 0.95), { shiftKey: true }),
    );
    expect(forward.effects[0]).toMatchObject({
      kind: 'syncSelection',
      selection: {
        anchor: forwardBase.anchor,
        head: { graphemeOffset: 4, affinity: 'downstream' },
      },
    });

    const backwardBase = selectionForBlock(frame, blockId, 3, 1);
    const backwardFrame = frameWithSelection(frame, backwardBase);
    const backwardHeadCluster = item.clusters[0]!;
    const backward = planInteraction(
      plannerContext(backwardFrame),
      clickIntent(backwardFrame, clientOnCluster(backwardFrame, 0, backwardHeadCluster, 0.05), { shiftKey: true }),
    );
    expect(backward.effects[0]).toMatchObject({
      kind: 'syncSelection',
      selection: {
        anchor: backwardBase.anchor,
        head: { graphemeOffset: 0, affinity: 'downstream' },
      },
    });
    expect(backward.effects[0]?.kind === 'syncSelection' && backward.effects[0].selection.anchor).not.toEqual(
      backwardBase.head,
    );
  });

  test('shift-click after non-collapsed selection preserves anchor not prior head', () => {
    const frame = publishFrame(modelWith(['abcdef']));
    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const ranged = selectionForBlock(frame, blockId, 1, 4);
    const rangedFrame = frameWithSelection(frame, ranged);
    const item = rangedFrame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const headCluster = item.clusters[5]!;
    const plan = planInteraction(
      plannerContext(rangedFrame),
      clickIntent(rangedFrame, clientOnCluster(rangedFrame, 0, headCluster, 0.95), { shiftKey: true }),
    );
    expect(plan.effects[0]).toMatchObject({
      kind: 'syncSelection',
      selection: {
        anchor: ranged.anchor,
        head: { graphemeOffset: 6, affinity: 'downstream' },
      },
    });
  });

  test('empty and trailing paragraph ownership produce valid offset-0 and end carets', () => {
    const emptyFrame = publishFrame(modelWith(['']));
    const emptyRegion = emptyFrame.semanticIndex.ownershipRegions.find(
      (r) => r.kind === 'paragraph' && r.box,
    );
    if (!emptyRegion?.box) throw new Error('empty ownership');
    const emptyPoint = clientPointForStackedText(
      emptyFrame,
      emptyRegion.pageIndex ?? 0,
      { x: emptyRegion.box.x + emptyRegion.box.width / 2, y: emptyRegion.box.y + emptyRegion.box.height / 2 },
      METRICS,
    );
    const emptyPlan = planInteraction(plannerContext(emptyFrame), clickIntent(emptyFrame, emptyPoint));
    expect(emptyPlan.effects[0]).toMatchObject({
      kind: 'syncSelection',
      selection: { anchor: { graphemeOffset: 0 }, head: { graphemeOffset: 0 } },
    });

    const trailingFrame = publishFrame(modelWith(['tail']));
    const block = trailingFrame.semanticIndex.stories[0]!.blocks[0]!;
    const trailingRegion = trailingFrame.semanticIndex.ownershipRegions.find((r) => r.kind === 'trailing');
    if (!trailingRegion?.box) throw new Error('trailing ownership');
    const trailingPoint = clientPointForStackedText(
      trailingFrame,
      trailingRegion.pageIndex ?? 0,
      { x: trailingRegion.box.x + trailingRegion.box.width - 1, y: trailingRegion.box.y + 2 },
      METRICS,
    );
    const trailingPlan = planInteraction(plannerContext(trailingFrame), clickIntent(trailingFrame, trailingPoint));
    expect(trailingPlan.effects[0]).toMatchObject({
      kind: 'syncSelection',
      selection: {
        anchor: { graphemeOffset: block.graphemeCount },
        head: { graphemeOffset: block.graphemeCount },
      },
    });
  });

  test('normalized primary click accepts buttons 0/1 and rejects secondary bitmask conflicts', () => {
    const frame = publishFrame(modelWith(['x']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[0]!);

    expect(planInteraction(plannerContext(frame), clickIntent(frame, point)).effects[0]).toMatchObject({
      kind: 'syncSelection',
    });
    expect(planInteraction(plannerContext(frame), clickIntent(frame, point, { buttons: 0 })).effects[0]).toMatchObject({
      kind: 'syncSelection',
    });
    expect(planInteraction(plannerContext(frame), clickIntent(frame, point, { buttons: 1 })).effects[0]).toMatchObject({
      kind: 'syncSelection',
    });

    expectRejectOnly(planInteraction(plannerContext(frame), clickIntent(frame, point, { buttons: 2 })), 'unsupported');
    expectRejectOnly(planInteraction(plannerContext(frame), clickIntent(frame, point, { buttons: 4 })), 'unsupported');
    expectRejectOnly(
      planInteraction(plannerContext(frame), clickIntent(frame, point, { button: 0, buttons: 2 })),
      'unsupported',
    );

    for (const buttons of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectRejectOnly(planInteraction(plannerContext(frame), clickIntent(frame, point, { buttons })), 'unsupported');
    }
  });

  test('clickCount accepts undefined or 1 and rejects other normalized values', () => {
    const frame = publishFrame(modelWith(['x']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[0]!);

    expect(planInteraction(plannerContext(frame), clickIntent(frame, point, { clickCount: 1 })).effects[0]).toMatchObject({
      kind: 'syncSelection',
    });

    for (const clickCount of [0, -1, 2, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expectRejectOnly(
        planInteraction(plannerContext(frame), clickIntent(frame, point, { clickCount })),
        'unsupported',
      );
    }
  });

  test('click geometry uses hitTestPointer for transform clip gap and zoom metrics', () => {
    const frame = publishFrame(modelWith(['clip']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const clip = { x: item.box.x + 5, y: item.box.y, width: 20, height: item.box.height };
    const clipped = {
      ...item,
      interaction: { ...item.interaction!, clip, zOrder: item.interaction!.zOrder },
    };
    const display = [{ ...frame.display[0]!, items: [clipped] }];
    const patched = { ...frame, display };

    const insidePoint = clientPointForStackedText(patched, 0, { x: clip.x + 2, y: clip.y + 2 }, METRICS);
    const insideHit = hitTestPointer(patched, insidePoint, METRICS);
    expect(insideHit.ok).toBe(true);
    if (!insideHit.ok || insideHit.value.target.kind !== 'text') throw new Error('inside hit');
    const insidePlan = planInteraction(plannerContext(patched), clickIntent(patched, insidePoint));
    expect(insidePlan.effects[0]).toMatchObject({
      kind: 'syncSelection',
      selection: {
        anchor: insideHit.value.target,
        head: insideHit.value.target,
      },
    });

    const outsidePoint = clientPointForStackedText(
      patched,
      0,
      { x: item.box.x + 1, y: item.box.y + 2 },
      METRICS,
    );
    expectRejectOnly(planInteraction(plannerContext(patched), clickIntent(patched, outsidePoint)), 'invalidTarget');

    const rotFrame = publishFrame(modelWith(['rot']));
    const rotItem = rotFrame.display[0]!.items.find((i) => i.kind === 'text');
    if (rotItem?.kind !== 'text') throw new Error('rot text');
    const transform = { a: 1, b: 0.2, c: 0, d: 1, tx: 8, ty: 4 };
    const transformed = {
      ...rotItem,
      interaction: { ...rotItem.interaction!, transform, zOrder: rotItem.interaction!.zOrder },
    };
    const rotDisplay = [{ ...rotFrame.display[0]!, items: [transformed] }];
    const rotPatched = { ...rotFrame, display: rotDisplay };
    const transformPoint = clientPointForStackedText(
      rotPatched,
      0,
      { x: rotItem.box.x + 10, y: rotItem.box.y + 5 },
      METRICS,
    );
    const transformHit = hitTestPointer(rotPatched, transformPoint, METRICS);
    expect(transformHit.ok).toBe(true);
    if (!transformHit.ok || transformHit.value.target.kind !== 'text') throw new Error('transform hit');
    expect(planInteraction(plannerContext(rotPatched), clickIntent(rotPatched, transformPoint)).effects[0]).toMatchObject({
      kind: 'syncSelection',
      selection: {
        anchor: transformHit.value.target,
        head: transformHit.value.target,
      },
    });

    const singular = {
      ...rotItem,
      interaction: {
        ...rotItem.interaction!,
        transform: { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 },
      },
    };
    const singularFrame = { ...rotFrame, display: [{ ...rotFrame.display[0]!, items: [singular] }] };
    const singularPoint = clientPointForStackedText(
      singularFrame,
      0,
      { x: rotItem.box.x + 1, y: rotItem.box.y + 1 },
      METRICS,
    );
    expectRejectOnly(
      planInteraction(plannerContext(singularFrame), clickIntent(singularFrame, singularPoint)),
      'invalidTarget',
    );

    const gapFrame = stackedFrame(2, 24);
    const gapY = gapFrame.scrollGeometry.pageTops[0]! + 1056 + 10;
    const gapClient = contentToClient({ x: 100, y: gapY }, IDENTITY_HOST_METRICS);
    if (!gapClient.ok) throw new Error('gap client');
    expectRejectOnly(
      planInteraction(plannerContext(gapFrame, { hostMetrics: IDENTITY_HOST_METRICS }), clickIntent(gapFrame, gapClient.value)),
      'invalidTarget',
    );
  });

  test('stale pending missing metrics read-only atomic and invalid clicks reject before sync/focus', () => {
    const frame = publishFrame(modelWith(['x']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[0]!);

    const stale = planInteraction(plannerContext(frame), {
      ...clickIntent(frame, point),
      frameId: { value: frame.id.value - 1 },
    });
    expect(stale.effects[0]).toMatchObject({ kind: 'reject', code: 'staleFrame' });

    const pending: InteractionFrame = {
      ...frame,
      completeness: { kind: 'pending', awaiting: 'layout', targetModelRevision: 2 },
    };
    expect(planInteraction(plannerContext(pending), clickIntent(pending, point)).effects[0]).toMatchObject({
      kind: 'reject',
      code: 'pendingLayout',
    });

    expect(
      planInteraction(plannerContext(frame, { hostMetrics: undefined }), clickIntent(frame, point)).effects[0],
    ).toMatchObject({ kind: 'reject', code: 'invalidTarget' });

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
    expect(planInteraction(plannerContext(readOnlyCell), clickIntent(readOnlyCell, cellPoint)).effects[0]).toMatchObject({
      kind: 'reject',
      code: 'readOnly',
    });

    expect(planInteraction(plannerContext(frame, { readOnly: true }), clickIntent(frame, point)).effects[0]).toMatchObject({
      kind: 'reject',
      code: 'readOnly',
    });

    expectRejectOnly(planInteraction(plannerContext(frame), clickIntent(frame, point, { button: 2 })), 'unsupported');
    expectRejectOnly(planInteraction(plannerContext(frame), clickIntent(frame, point, { clickCount: 2 })), 'unsupported');

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
    expect(planInteraction(plannerContext(atomicFrame), clickIntent(atomicFrame, atomicPoint)).effects[0]).toMatchObject({
      kind: 'reject',
      code: 'unsupported',
    });
  });

  test('shift-click without compatible frame selection rejects without sync or focus', () => {
    const frame = publishFrame(modelWith(['abc']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[1]!);

    expectRejectOnly(planInteraction(plannerContext(frame), clickIntent(frame, point, { shiftKey: true })), 'invalidTarget');

    const staleSelection = selectionForBlock(frame, item.semantic.identity.blockId, 0, 1);
    const selectedFrame = frameWithSelection(frame, staleSelection);
    const staleFrame = {
      ...selectedFrame,
      selection: { ...staleSelection, frameId: { value: selectedFrame.id.value - 1 } },
    };
    expectRejectOnly(
      planInteraction(plannerContext(staleFrame), clickIntent(staleFrame, point, { shiftKey: true })),
      'invalidTarget',
    );

    const incompatibleStory = {
      ...staleSelection,
      anchor: {
        ...staleSelection.anchor,
        identity: { ...staleSelection.anchor.identity, storyId: 'other-story' },
      },
    };
    const incompatibleFrame = frameWithSelection(frame, incompatibleStory);
    expectRejectOnly(
      planInteraction(plannerContext(incompatibleFrame), clickIntent(incompatibleFrame, point, { shiftKey: true })),
      'invalidTarget',
    );
  });

  test('pointerDown remains unsupported for task 5.4 while click is handled separately', () => {
    const frame = publishFrame(modelWith(['x']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[0]!);
    expect(
      planInteraction(plannerContext(frame), {
        kind: 'pointerDown',
        frameId: frame.id,
        clientPoint: point,
        pointerId: 1,
      }).effects[0],
    ).toMatchObject({
      kind: 'reject',
      code: 'unsupported',
      reason: expect.stringContaining('task 5.4+'),
    });
    expect(planInteraction(plannerContext(frame), clickIntent(frame, point)).effects[0]).toMatchObject({
      kind: 'syncSelection',
    });
  });

  test('planner calls remain stateless across repeated clicks', () => {
    const frame = publishFrame(modelWith(['xy']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const firstPoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.05);
    const secondPoint = clientOnCluster(frame, 0, item.clusters[1]!, 0.95);
    const first = planInteraction(plannerContext(frame), clickIntent(frame, firstPoint));
    const second = planInteraction(plannerContext(frame), clickIntent(frame, secondPoint));
    expect(first.effects).not.toEqual(second.effects);
    expect(planInteraction(plannerContext(frame), clickIntent(frame, firstPoint)).effects).toEqual(first.effects);
  });

  test('hit targets align with deriveCaretGeometry for collapsed click selection', () => {
    const frame = publishFrame(modelWith(['ab']), { layout: LAYOUT });
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[1]!, 0.95);
    const plan = planInteraction(plannerContext(frame), clickIntent(frame, point));
    const sync = plan.effects[0];
    if (sync?.kind !== 'syncSelection') throw new Error('sync');
    const caret = deriveCaretGeometry(frame, sync.selection.head);
    expect(caret).not.toBeNull();
    expect(caret!.frameId).toEqual(frame.id);
  });
});
