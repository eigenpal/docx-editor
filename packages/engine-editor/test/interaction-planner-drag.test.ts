// Pointer-drag selection planner and session reducer (interactive-paginated-editing 5.4).

import { describe, expect, test } from 'bun:test';
import type { InteractionFrame, InteractionHostMetrics } from '@docx-editor.dev/core-contract/interaction';
import { deriveSelectionGeometry, hitTestPointer } from '../src/interaction-geometry.ts';
import { InteractionFrameStore } from '../src/interaction-frame.ts';
import { layoutBody } from '@docx-editor.dev/engine-layout';
import { toDisplayPages } from '../src/display-bridge.ts';
import {
  LAYOUT,
  clientPointForStackedText,
  frameWithoutBlock,
  modelWith,
  modelWithParagraphTableParagraph,
  modelWithTableCell,
  publishFrame,
  selectionForBlock,
} from './interaction-test-helpers.ts';
import { planPointerDragInteraction, validateEditableDragSpan, type DragInteractionPlan, type PointerDragSession } from '../src/drag-session.ts';
import { commitDragSessionAfterExecution } from '../src/drag-dispatch.ts';
import { planInteraction, type InteractionPlannerContext } from '../src/interaction-planner.ts';
import { executeInteractionPlan } from '../src/interaction-executor.ts';
import { IDENTITY_HOST_METRICS } from '../src/coordinate-mapper.ts';

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
    modelRevision: frame.revisions.modelRevision,
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

function pointerDown(frame: InteractionFrame, point: { x: number; y: number }, pointerId = 1) {
  return {
    kind: 'pointerDown' as const,
    frameId: frame.id,
    clientPoint: point,
    pointerId,
    button: 0,
    buttons: 1,
  };
}

function pointerMove(frame: InteractionFrame, point: { x: number; y: number }, pointerId = 1) {
  return {
    kind: 'pointerMove' as const,
    frameId: frame.id,
    clientPoint: point,
    pointerId,
    buttons: 1,
  };
}

function pointerUp(frame: InteractionFrame, point: { x: number; y: number }, pointerId = 1) {
  return {
    kind: 'pointerUp' as const,
    frameId: frame.id,
    clientPoint: point,
    pointerId,
    buttons: 0,
  };
}

function pointerCancel(frame: InteractionFrame, pointerId = 1) {
  return {
    kind: 'pointerCancel' as const,
    frameId: frame.id,
    pointerId,
  };
}

/** Simulates transactional session commit after successful effect execution. */
function commitDragSession(drag: DragInteractionPlan): PointerDragSession | null {
  return commitDragSessionAfterExecution(drag, {
    outcome: { ok: true, value: undefined, frameId: drag.plan.frameId },
    hostEffects: [],
  }).session;
}

function dragDownMoveUp(
  frame: InteractionFrame,
  downPoint: { x: number; y: number },
  movePoint: { x: number; y: number },
  upPoint = movePoint,
) {
  let session: PointerDragSession | null = null;
  const down = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, downPoint), session);
  session = commitDragSession(down);
  const move = planPointerDragInteraction(plannerContext(frame), pointerMove(frame, movePoint), session);
  session = commitDragSession(move);
  const up = planPointerDragInteraction(plannerContext(frame), pointerUp(frame, upPoint), session);
  return { down, move, up, session: commitDragSession(up) };
}

describe('pointer drag session reducer (task 5.4)', () => {
  test('pointer down prefers browser-realized bold text target over approximate layout hit', () => {
    const frame = publishFrame(modelWith(['abcdef']));
    const item = frame.display[0]!.items.find((candidate) => candidate.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const approximatePoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.1);
    const realizedTextTarget = {
      kind: 'text' as const,
      scope: item.semantic.scope,
      identity: item.semantic.identity,
      graphemeOffset: 4,
      affinity: 'downstream' as const,
    };

    const down = planPointerDragInteraction(
      { ...plannerContext(frame), realizedTextTarget },
      pointerDown(frame, approximatePoint),
      null,
    );

    expect(down.nextSessionOnSuccess?.anchor).toEqual(realizedTextTarget);
  });

  test('trailing click preserves the browser-realized bold text target', () => {
    const frame = publishFrame(modelWith(['abcdef']));
    const item = frame.display[0]!.items.find((candidate) => candidate.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const approximatePoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.1);
    const realizedTextTarget = {
      kind: 'text' as const,
      scope: item.semantic.scope,
      identity: item.semantic.identity,
      graphemeOffset: 4,
      affinity: 'downstream' as const,
    };

    const click = planInteraction(
      { ...plannerContext(frame), realizedTextTarget },
      {
        kind: 'click',
        frameId: frame.id,
        clientPoint: approximatePoint,
        button: 0,
        clickCount: 1,
      },
    );
    const sync = click.effects.find((effect) => effect.kind === 'syncSelection');

    expect(sync?.kind === 'syncSelection' ? sync.selection.head : null).toEqual(
      realizedTextTarget,
    );
  });

  test('down → move → up on one line: capture, fixed anchor, moving head, release', () => {
    const frame = publishFrame(modelWith(['abcdef']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const downPoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.1);
    const movePoint = clientOnCluster(frame, 0, item.clusters[3] ?? item.clusters[item.clusters.length - 1]!, 0.9);
    const { down, move, up } = dragDownMoveUp(frame, downPoint, movePoint);

    expect(down.nextSessionOnSuccess).not.toBeNull();
    expect(down.plan.effects.some((e) => e.kind === 'capturePointer')).toBe(true);
    expect(down.plan.effects.some((e) => e.kind === 'syncSelection')).toBe(true);
    expect(down.plan.effects.some((e) => e.kind === 'focus')).toBe(true);

    const downSync = down.plan.effects.find((e) => e.kind === 'syncSelection');
    const moveSync = move.plan.effects.find((e) => e.kind === 'syncSelection');
    if (downSync?.kind !== 'syncSelection' || moveSync?.kind !== 'syncSelection') throw new Error('sync');
    expect(moveSync.selection.anchor).toEqual(downSync.selection.anchor);
    expect(moveSync.selection.head).not.toEqual(downSync.selection.head);
    expect(move.plan.effects.some((e) => e.kind === 'focus')).toBe(false);
    expect(move.plan.effects.some((e) => e.kind === 'publishSelectionOverlay')).toBe(true);

    expect(up.nextSessionOnSuccess).toBeNull();
    expect(up.plan.effects.some((e) => e.kind === 'releasePointer')).toBe(true);
  });

  test('forward drag across multiple body paragraphs extends selection in story order', () => {
    const frame = publishFrame(modelWith(['first line', 'second line']));
    const blocks = frame.semanticIndex.stories[0]!.blocks;
    const firstItem = frame.display[0]!.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId === blocks[0]!.identity.blockId,
    );
    const secondItem = frame.display[0]!.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId === blocks[1]!.identity.blockId,
    );
    if (firstItem?.kind !== 'text' || secondItem?.kind !== 'text') throw new Error('text');
    const downPoint = clientOnCluster(frame, 0, firstItem.clusters[0]!, 0.2);
    const movePoint = clientOnCluster(frame, 0, secondItem.clusters[1] ?? secondItem.clusters[0]!, 0.8);
    const { move } = dragDownMoveUp(frame, downPoint, movePoint);
    const sync = move.plan.effects.find((e) => e.kind === 'syncSelection');
    if (sync?.kind !== 'syncSelection') throw new Error('sync');
    expect(sync.selection.anchor.identity.blockId).toBe(blocks[0]!.identity.blockId);
    expect(sync.selection.head.identity.blockId).toBe(blocks[1]!.identity.blockId);
    const geometry = deriveSelectionGeometry(frame, sync.selection);
    expect(geometry.ok).toBe(true);
  });

  test('cross-page drag produces ordered visible rects on multiple pages', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const frame = publishFrame(modelWith([words]), { layout: { ...LAYOUT, pageHeight: 4000 } });
    expect(frame.display.length).toBeGreaterThan(1);
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const page1Item = frame.display[1]!.items.find((i) => i.kind === 'text');
    if (page1Item?.kind !== 'text') throw new Error('text page1');
    const downPoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.1);
    const movePoint = clientOnCluster(frame, 1, page1Item.clusters[0]!, 0.5);
    const { move } = dragDownMoveUp(frame, downPoint, movePoint);
    const sync = move.plan.effects.find((e) => e.kind === 'syncSelection');
    if (sync?.kind !== 'syncSelection') throw new Error('sync');
    const geometry = deriveSelectionGeometry(frame, sync.selection);
    expect(geometry.ok).toBe(true);
    if (!geometry.ok) throw new Error('geometry');
    expect(geometry.value.pageIndices.some((i) => i > 0)).toBe(true);
    expect(geometry.value.selection.head.graphemeOffset).toBeGreaterThan(sync.selection.anchor.graphemeOffset);
  });

  test('move after selection-only frame replacement succeeds with preserved anchor', () => {
    const frame = publishFrame(modelWith(['drag me']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const downPoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.1);
    const movePoint = clientOnCluster(frame, 0, item.clusters[item.clusters.length - 1]!, 0.9);
    const down = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, downPoint), null);
    expect(down.nextSessionOnSuccess).not.toBeNull();

    const store = new InteractionFrameStore();
    store.publishLayout({
      modelRevision: frame.revisions.modelRevision,
      resourceEpoch: 0,
      configurationEpoch: 0,
      display: frame.display,
      semanticIndex: frame.semanticIndex,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: false },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });
    const syncEffect = down.plan.effects.find((e) => e.kind === 'syncSelection');
    if (syncEffect?.kind !== 'syncSelection') throw new Error('sync');
    const selectionOnly = store.publishSelection({
      modelRevision: frame.revisions.modelRevision,
      layoutRevision: frame.revisions.layoutRevision,
      selection: syncEffect.selection,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: true },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });
    const replaced = store.publishSelection({
      modelRevision: frame.revisions.modelRevision,
      layoutRevision: frame.revisions.layoutRevision,
      selection: syncEffect.selection,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: true },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });

    const move = planPointerDragInteraction(
      plannerContext(replaced),
      pointerMove(replaced, movePoint),
      down.nextSessionOnSuccess,
    );
    expect(move.plan.effects[0]?.kind).not.toBe('reject');
    const moveSync = move.plan.effects.find((e) => e.kind === 'syncSelection');
    if (moveSync?.kind !== 'syncSelection') throw new Error('move sync');
    expect(moveSync.selection.anchor).toEqual(syncEffect.selection.anchor);
    expect(moveSync.selection.frameId).toEqual(replaced.id);
    expect(selectionOnly.id.value).toBeLessThan(replaced.id.value);
  });

  test('pending frame, invalid targets, and model revision drift reject without mutating selection', () => {
    const frame = publishFrame(modelWith(['abc']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const downPoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.1);
    const movePoint = clientOnCluster(frame, 0, item.clusters[item.clusters.length - 1]!, 0.9);
    const down = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, downPoint), null);
    const session = down.nextSessionOnSuccess!;

    const pending: InteractionFrame = {
      ...frame,
      completeness: { kind: 'pending', awaiting: 'layout', targetModelRevision: 2 },
    };
    const pendingMove = planPointerDragInteraction(plannerContext(pending), pointerMove(pending, movePoint), session);
    expect(pendingMove.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'pendingLayout' });
    expect(pendingMove.nextSessionOnSuccess).toEqual(session);

    const drift = planPointerDragInteraction(
      plannerContext(frame, { modelRevision: frame.revisions.modelRevision + 1 }),
      pointerMove(frame, movePoint),
      session,
    );
    expect(drift.plan.effects.some((e) => e.kind === 'releasePointer')).toBe(true);
    expect(drift.nextSessionOnSuccess).toBeNull();
    expect(drift.terminal).toMatchObject({ kind: 'release', pointerId: 1 });

    const gapMove = planPointerDragInteraction(
      plannerContext(frame),
      pointerMove(frame, { x: -9999, y: -9999 }),
      session,
    );
    expect(gapMove.plan.effects.every((e) => e.kind !== 'syncSelection')).toBe(true);
    expect(gapMove.nextSessionOnSuccess).toEqual(session);
  });

  test('invalid terminal up releases capture and clears session with typed failure', () => {
    const frame = publishFrame(modelWith(['abc']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const downPoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.1);
    const down = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, downPoint), null);
    const session = down.nextSessionOnSuccess!;
    const up = planPointerDragInteraction(
      plannerContext(frame),
      pointerUp(frame, { x: -9999, y: -9999 }),
      session,
    );
    expect(up.nextSessionOnSuccess).toBeNull();
    expect(up.plan.effects.some((e) => e.kind === 'releasePointer')).toBe(true);
    expect(up.plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
    expect(up.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'invalidTarget' });
  });

  test('pointerCancel releases capture without changing selection', () => {
    const frame = publishFrame(modelWith(['abc']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const downPoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.1);
    const down = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, downPoint), null);
    const cancel = planPointerDragInteraction(plannerContext(frame), pointerCancel(frame), down.nextSessionOnSuccess);
    expect(cancel.nextSessionOnSuccess).toBeNull();
    expect(cancel.terminal).toMatchObject({ kind: 'release', cause: 'pointerCancel' });
    expect(cancel.plan.effects).toEqual([{ kind: 'releasePointer', pointerId: 1 }]);
    expect(cancel.plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
  });

  test('wrong pointer ID and second pointer cannot steal session', () => {
    const frame = publishFrame(modelWith(['abc']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[0]!, 0.5);
    const down = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, point, 1), null);
    const wrongMove = planPointerDragInteraction(plannerContext(frame), pointerMove(frame, point, 2), down.nextSessionOnSuccess);
    expect(wrongMove.plan.effects.every((e) => e.kind !== 'syncSelection' && e.kind !== 'capturePointer')).toBe(true);
    expect(wrongMove.nextSessionOnSuccess).toEqual(down.nextSessionOnSuccess);

    const stealDown = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, point, 2), down.nextSessionOnSuccess);
    expect(stealDown.plan.effects[0]).toMatchObject({ kind: 'reject' });
    expect(stealDown.nextSessionOnSuccess).toEqual(down.nextSessionOnSuccess);
  });

  test('non-primary button and malformed buttons reject before capture', () => {
    const frame = publishFrame(modelWith(['x']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[0]!, 0.5);
    const secondary = planPointerDragInteraction(
      plannerContext(frame),
      { ...pointerDown(frame, point), button: 2 },
      null,
    );
    expect(secondary.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
    expect(secondary.nextSessionOnSuccess).toBeNull();

    const badButtons = planPointerDragInteraction(
      plannerContext(frame),
      { ...pointerDown(frame, point), buttons: 3 },
      null,
    );
    expect(badButtons.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
  });

  test('move-only sync publishes overlay through executor without focus', () => {
    const frame = publishFrame(modelWith(['abcd']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const downPoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.1);
    const movePoint = clientOnCluster(frame, 0, item.clusters[item.clusters.length - 1]!, 0.9);
    const down = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, downPoint), null);
    const move = planPointerDragInteraction(plannerContext(frame), pointerMove(frame, movePoint), down.nextSessionOnSuccess);
    const calls: string[] = [];
    executeInteractionPlan(
      {
        syncSemanticSelection: () => {
          calls.push('sync');
          return { ok: true, value: undefined, frameId: frame.id };
        },
        focus: () => {
          calls.push('focus');
          return { ok: true, value: undefined, frameId: frame.id };
        },
        publishSelectionOverlay: () => calls.push('overlay'),
        blur: () => {},
        execCommand: () => ({ ok: true, changed: false }),
        delegateNativeInput: () => ({ ok: true, value: undefined, frameId: frame.id }),
        currentFrameId: () => frame.id,
      },
      move.plan,
    );
    expect(calls).toEqual(['sync', 'overlay']);
  });

  test('planner sessions are independent per reducer call chain', () => {
    const frame = publishFrame(modelWith(['ab', 'cd']));
    const blocks = frame.semanticIndex.stories[0]!.blocks;
    const itemA = frame.display[0]!.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId === blocks[0]!.identity.blockId,
    );
    const itemB = frame.display[0]!.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId === blocks[1]!.identity.blockId,
    );
    if (itemA?.kind !== 'text' || itemB?.kind !== 'text') throw new Error('text');
    const first = dragDownMoveUp(
      frame,
      clientOnCluster(frame, 0, itemA.clusters[0]!, 0.1),
      clientOnCluster(frame, 0, itemA.clusters[itemA.clusters.length - 1]!, 0.9),
    );
    const second = dragDownMoveUp(
      frame,
      clientOnCluster(frame, 0, itemB.clusters[0]!, 0.1),
      clientOnCluster(frame, 0, itemB.clusters[itemB.clusters.length - 1]!, 0.9),
    );
    expect(first.up.nextSessionOnSuccess).toBeNull();
    expect(second.up.nextSessionOnSuccess).toBeNull();
    const firstSync = first.move.plan.effects.find((e) => e.kind === 'syncSelection');
    const secondSync = second.move.plan.effects.find((e) => e.kind === 'syncSelection');
    if (firstSync?.kind !== 'syncSelection' || secondSync?.kind !== 'syncSelection') throw new Error('sync');
    expect(firstSync.selection.anchor.identity.blockId).not.toBe(secondSync.selection.anchor.identity.blockId);
  });

  test('click behavior remains handled separately from drag pointerDown', () => {
    const frame = publishFrame(modelWith(['x']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[0]!, 0.5);
    expect(
      planInteraction(plannerContext(frame), {
        kind: 'click',
        frameId: frame.id,
        clientPoint: point,
      }).effects[0],
    ).toMatchObject({ kind: 'syncSelection' });
    expect(
      planPointerDragInteraction(plannerContext(frame), pointerDown(frame, point), null).plan.effects.some(
        (e) => e.kind === 'capturePointer',
      ),
    ).toBe(true);
  });

  test('pointerCancel and pointerUp stay releasable during pending layout and read-only context', () => {
    const frame = publishFrame(modelWith(['abc']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const downPoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.1);
    const down = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, downPoint), null);
    const session = down.nextSessionOnSuccess!;

    const pending: InteractionFrame = {
      ...frame,
      completeness: { kind: 'pending', awaiting: 'layout', targetModelRevision: 2 },
    };
    const pendingCancel = planPointerDragInteraction(plannerContext(pending), pointerCancel(pending), session);
    expect(pendingCancel.nextSessionOnSuccess).toBeNull();
    expect(pendingCancel.plan.effects).toEqual([{ kind: 'releasePointer', pointerId: 1 }]);
    expect(pendingCancel.plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);

    const down2 = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, downPoint), null);
    const session2 = down2.nextSessionOnSuccess!;
    const pendingUp = planPointerDragInteraction(
      plannerContext(pending),
      pointerUp(pending, { x: -1, y: -1 }),
      session2,
    );
    expect(pendingUp.nextSessionOnSuccess).toBeNull();
    expect(pendingUp.plan.effects.at(-1)).toEqual({ kind: 'releasePointer', pointerId: 1 });
    expect(pendingUp.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'pendingLayout' });
    expect(pendingUp.plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);

    const down3 = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, downPoint), null);
    const readOnlyCancel = planPointerDragInteraction(
      plannerContext(frame, { readOnly: true, editable: false }),
      pointerCancel(frame),
      down3.nextSessionOnSuccess,
    );
    expect(readOnlyCancel.nextSessionOnSuccess).toBeNull();
    expect(readOnlyCancel.plan.effects).toEqual([{ kind: 'releasePointer', pointerId: 1 }]);
  });

  test('move after layout-only frame replacement hit-tests current geometry and preserves anchor', () => {
    const model = modelWith(['layout drag anchor']);
    const store = new InteractionFrameStore();
    const narrowLayout = layoutBody(model, { ...LAYOUT, pageWidth: 6000 });
    const narrowBridged = toDisplayPages(model, narrowLayout.pages);
    const narrow = store.publishLayout({
      modelRevision: 1,
      resourceEpoch: 0,
      configurationEpoch: 0,
      display: narrowBridged.display,
      semanticIndex: narrowBridged.semanticIndex,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: false },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });
    const wideLayout = layoutBody(model, { ...LAYOUT, pageWidth: 12240 });
    const wideBridged = toDisplayPages(model, wideLayout.pages);
    const wide = store.publishLayout({
      modelRevision: 1,
      resourceEpoch: 0,
      configurationEpoch: 0,
      display: wideBridged.display,
      semanticIndex: wideBridged.semanticIndex,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: false },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });
    expect(wide.revisions.modelRevision).toBe(narrow.revisions.modelRevision);
    expect(wide.revisions.layoutRevision).toBeGreaterThan(narrow.revisions.layoutRevision);
    expect(wide.id.value).toBeGreaterThan(narrow.id.value);

    const narrowItem = narrow.display[0]!.items.find((i) => i.kind === 'text');
    const wideItem = wide.display[0]!.items.find((i) => i.kind === 'text');
    if (narrowItem?.kind !== 'text' || wideItem?.kind !== 'text') throw new Error('text');
    const downPoint = clientOnCluster(narrow, 0, narrowItem.clusters[0]!, 0.05);
    const down = planPointerDragInteraction(plannerContext(narrow), pointerDown(narrow, downPoint), null);
    const syncEffect = down.plan.effects.find((e) => e.kind === 'syncSelection');
    if (syncEffect?.kind !== 'syncSelection') throw new Error('sync');
    const movePoint = clientOnCluster(wide, 0, wideItem.clusters[wideItem.clusters.length - 1]!, 0.95);

    const move = planPointerDragInteraction(
      plannerContext(wide),
      { ...pointerMove(narrow, movePoint), frameId: narrow.id },
      down.nextSessionOnSuccess,
    );
    const moveSync = move.plan.effects.find((e) => e.kind === 'syncSelection');
    if (moveSync?.kind !== 'syncSelection') throw new Error('move sync');
    expect(moveSync.selection.anchor).toEqual(syncEffect.selection.anchor);
    expect(moveSync.selection.frameId).toEqual(wide.id);
    expect(moveSync.selection.head.graphemeOffset).toBeGreaterThan(moveSync.selection.anchor.graphemeOffset);
  });

  test('drag across table-in-body and read-only cell boundaries fails closed without sync', () => {
    const frame = publishFrame(modelWithParagraphTableParagraph('before table', 'cell text', 'after table'));
    const blocks = frame.semanticIndex.stories[0]!.blocks;
    const beforeItem = frame.display[0]!.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId === blocks[0]!.identity.blockId,
    );
    const afterItem = frame.display[0]!.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId === blocks[blocks.length - 1]!.identity.blockId,
    );
    if (beforeItem?.kind !== 'text' || afterItem?.kind !== 'text') throw new Error('text');
    const downPoint = clientOnCluster(frame, 0, beforeItem.clusters[0]!, 0.2);
    const movePoint = clientOnCluster(frame, 0, afterItem.clusters.at(-1) ?? afterItem.clusters[0]!, 0.8);
    const down = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, downPoint), null);
    const move = planPointerDragInteraction(plannerContext(frame), pointerMove(frame, movePoint), down.nextSessionOnSuccess);
    expect(move.plan.effects.every((e) => e.kind !== 'syncSelection')).toBe(true);
    expect(move.nextSessionOnSuccess).toEqual(down.nextSessionOnSuccess);

    const cellFrame = publishFrame(modelWithTableCell('locked cell'));
    const cellItem = cellFrame.display[0]!.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId === 'p-cell',
    );
    if (cellItem?.kind !== 'text' || cellItem.clusters.length === 0) throw new Error('cell text');
    const cellPoint = clientOnCluster(cellFrame, 0, cellItem.clusters[0]!, 0.5);
    const cellDown = planPointerDragInteraction(plannerContext(cellFrame), pointerDown(cellFrame, cellPoint), null);
    expect(cellDown.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'readOnly' });
  });

  test('cross-story span validation rejects before sync', () => {
    const frame = publishFrame(modelWith(['one']));
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const anchor = {
      kind: 'text' as const,
      scope: { kind: 'body' as const },
      identity: block.identity,
      graphemeOffset: 0,
      affinity: 'downstream' as const,
    };
    const head = {
      kind: 'text' as const,
      scope: { kind: 'body' as const },
      identity: { storyId: 'other-story', blockId: block.identity.blockId },
      graphemeOffset: 1,
      affinity: 'downstream' as const,
    };
    expect(validateEditableDragSpan(frame, anchor, head).ok).toBe(false);
  });

  test('deleted anchor during active session fails on move/up with release and no guessed target', () => {
    const frame = publishFrame(modelWith(['keep anchor']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const downPoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.1);
    const movePoint = clientOnCluster(frame, 0, item.clusters.at(-1) ?? item.clusters[0]!, 0.9);
    const down = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, downPoint), null);
    const session = down.nextSessionOnSuccess!;
    const anchorBlockId = session.anchor.identity.blockId;
    const deleted = frameWithoutBlock(frame, anchorBlockId);

    const move = planPointerDragInteraction(plannerContext(deleted), pointerMove(deleted, movePoint), session);
    expect(move.plan.effects.some((e) => e.kind === 'releasePointer')).toBe(true);
    expect(move.plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
    expect(move.nextSessionOnSuccess).toBeNull();
    expect(move.terminal).toMatchObject({ kind: 'release' });

    const down2 = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, downPoint), null);
    const up = planPointerDragInteraction(plannerContext(deleted), pointerUp(deleted, movePoint), down2.nextSessionOnSuccess);
    expect(up.plan.effects.at(-1)).toEqual({ kind: 'releasePointer', pointerId: 1 });
    expect(up.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'invalidTarget' });
    expect(up.plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
    expect(up.nextSessionOnSuccess).toBeNull();
  });

  test('wrapped-line drag produces multiple ordered line rects within one paragraph', () => {
    const frame = publishFrame(modelWith(['alpha beta gamma delta epsilon zeta']), {
      layout: { ...LAYOUT, pageWidth: 5000 },
    });
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    expect(item.clusters.length).toBeGreaterThan(2);
    const downPoint = clientOnCluster(frame, 0, item.clusters[0]!, 0.1);
    const movePoint = clientOnCluster(frame, 0, item.clusters.at(-1) ?? item.clusters[0]!, 0.9);
    const { move } = dragDownMoveUp(frame, downPoint, movePoint);
    const sync = move.plan.effects.find((e) => e.kind === 'syncSelection');
    if (sync?.kind !== 'syncSelection') throw new Error('sync');
    const geometry = deriveSelectionGeometry(frame, sync.selection);
    expect(geometry.ok).toBe(true);
    if (!geometry.ok) throw new Error('geometry');
    expect(geometry.value.rects.length).toBeGreaterThan(1);
    for (let i = 1; i < geometry.value.rects.length; i += 1) {
      expect(geometry.value.rects[i]!.y).toBeGreaterThanOrEqual(geometry.value.rects[i - 1]!.y - 0.01);
    }
  });

  test('three-paragraph drag includes intermediate full-block geometry and ordered page indices', () => {
    const frame = publishFrame(modelWith(['aaa', 'bbbb', 'ccccc']));
    const blocks = frame.semanticIndex.stories[0]!.blocks;
    const firstItem = frame.display[0]!.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId === blocks[0]!.identity.blockId,
    );
    const lastItem = frame.display[0]!.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId === blocks[2]!.identity.blockId,
    );
    if (firstItem?.kind !== 'text' || lastItem?.kind !== 'text') throw new Error('text');
    const { move } = dragDownMoveUp(
      frame,
      clientOnCluster(frame, 0, firstItem.clusters[0]!, 0.2),
      clientOnCluster(frame, 0, lastItem.clusters.at(-1) ?? lastItem.clusters[0]!, 0.8),
    );
    const sync = move.plan.effects.find((e) => e.kind === 'syncSelection');
    if (sync?.kind !== 'syncSelection') throw new Error('sync');
    const geometry = deriveSelectionGeometry(frame, sync.selection);
    expect(geometry.ok).toBe(true);
    if (!geometry.ok) throw new Error('geometry');
    expect(geometry.value.rects.length).toBeGreaterThanOrEqual(3);
    expect(geometry.value.pageIndices[0]).toBeLessThanOrEqual(geometry.value.pageIndices.at(-1)!);
  });

  test('backward drag across multiple body paragraphs extends selection with reversed anchor/head', () => {
    const frame = publishFrame(modelWith(['first line', 'second line']));
    const blocks = frame.semanticIndex.stories[0]!.blocks;
    const firstItem = frame.display[0]!.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId === blocks[0]!.identity.blockId,
    );
    const secondItem = frame.display[0]!.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId === blocks[1]!.identity.blockId,
    );
    if (firstItem?.kind !== 'text' || secondItem?.kind !== 'text') throw new Error('text');
    const downPoint = clientOnCluster(frame, 0, secondItem.clusters.at(-1) ?? secondItem.clusters[0]!, 0.8);
    const movePoint = clientOnCluster(frame, 0, firstItem.clusters[0]!, 0.2);
    const { move } = dragDownMoveUp(frame, downPoint, movePoint);
    const sync = move.plan.effects.find((e) => e.kind === 'syncSelection');
    if (sync?.kind !== 'syncSelection') throw new Error('sync');
    expect(sync.selection.anchor.identity.blockId).toBe(blocks[1]!.identity.blockId);
    expect(sync.selection.head.identity.blockId).toBe(blocks[0]!.identity.blockId);
    expect(sync.selection.anchor.graphemeOffset).toBeGreaterThan(sync.selection.head.graphemeOffset);
    const geometry = deriveSelectionGeometry(frame, sync.selection);
    expect(geometry.ok).toBe(true);
  });

  test('malformed pointerId and modified move buttons reject before capture or sync', () => {
    const frame = publishFrame(modelWith(['x']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[0]!, 0.5);
    const badId = planPointerDragInteraction(
      plannerContext(frame),
      { ...pointerDown(frame, point), pointerId: Number.NaN },
      null,
    );
    expect(badId.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
    expect(badId.nextSessionOnSuccess).toBeNull();

    const down = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, point), null);
    const modifiedMove = planPointerDragInteraction(
      plannerContext(frame),
      { ...pointerMove(frame, point), shiftKey: true },
      down.nextSessionOnSuccess,
    );
    expect(modifiedMove.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
    expect(modifiedMove.nextSessionOnSuccess).toEqual(down.nextSessionOnSuccess);
  });

  test('read-only move/up/down preserve session until terminal up without extending selection', () => {
    const cellFrame = publishFrame(modelWithTableCell('a b c'));
    const cellItem = cellFrame.display[0]!.items.find(
      (i) => i.kind === 'text' && i.semantic.identity.blockId === 'p-cell',
    );
    if (cellItem?.kind !== 'text' || cellItem.clusters.length === 0) throw new Error('cell text');
    const editableFrame = publishFrame(modelWith(['editable start']));
    const editableItem = editableFrame.display[0]!.items.find((i) => i.kind === 'text');
    if (editableItem?.kind !== 'text') throw new Error('editable');
    const downPoint = clientOnCluster(editableFrame, 0, editableItem.clusters[0]!, 0.2);
    const down = planPointerDragInteraction(plannerContext(editableFrame), pointerDown(editableFrame, downPoint), null);
    const session = down.nextSessionOnSuccess!;
    const cellPoint = clientOnCluster(cellFrame, 0, cellItem.clusters[1] ?? cellItem.clusters[0]!, 0.5);

    const readOnlyMove = planPointerDragInteraction(plannerContext(cellFrame), pointerMove(cellFrame, cellPoint), session);
    expect(readOnlyMove.plan.effects.every((e) => e.kind !== 'syncSelection')).toBe(true);
    expect(readOnlyMove.nextSessionOnSuccess).toEqual(session);

    const readOnlyUp = planPointerDragInteraction(
      plannerContext(cellFrame),
      pointerUp(cellFrame, cellPoint),
      session,
    );
    expect(readOnlyUp.plan.effects.at(-1)).toEqual({ kind: 'releasePointer', pointerId: 1 });
    expect(readOnlyUp.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'readOnly' });
    expect(readOnlyUp.plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
    expect(readOnlyUp.nextSessionOnSuccess).toBeNull();
  });

  test('wrong pointer cancel/up cannot clear an active session', () => {
    const frame = publishFrame(modelWith(['abc']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientOnCluster(frame, 0, item.clusters[0]!, 0.5);
    const down = planPointerDragInteraction(plannerContext(frame), pointerDown(frame, point, 1), null);
    const wrongCancel = planPointerDragInteraction(plannerContext(frame), pointerCancel(frame, 2), down.nextSessionOnSuccess);
    expect(wrongCancel.nextSessionOnSuccess).toEqual(down.nextSessionOnSuccess);
    expect(wrongCancel.plan.effects).toEqual([]);
    const wrongUp = planPointerDragInteraction(plannerContext(frame), pointerUp(frame, point, 2), down.nextSessionOnSuccess);
    expect(wrongUp.nextSessionOnSuccess).toEqual(down.nextSessionOnSuccess);
    expect(wrongUp.plan.effects).toEqual([]);
  });
});
