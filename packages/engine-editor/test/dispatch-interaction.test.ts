import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createTestEditor as createEditor } from './create-test-editor.ts';
import type { Editor, EditorHost } from '@docx-editor.dev/core-contract/editor';
import type { InteractionFrame } from '@docx-editor.dev/core-contract/interaction';
import { createEditableParagraphFixture } from '../browser/fixtures.ts';
import {
  clientPointForStackedText,
  publishFrame,
  selectionForBlock,
} from './interaction-test-helpers.ts';
import { contentToClient, IDENTITY_HOST_METRICS } from '../src/coordinate-mapper.ts';

function hostWith(body: HTMLElement, metrics = IDENTITY_HOST_METRICS): EditorHost {
  return {
    getBodyHostEl: () => body,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => null,
    getInteractionHostMetrics: () => metrics,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
}

function frameObservation(frame: InteractionFrame) {
  return {
    id: frame.id.value,
    selection: frame.selection,
    caret: frame.caret,
    selectionGeometry: frame.selectionGeometry,
    focus: frame.focus,
  };
}

function selectionEndpoints(
  selection:
    | {
        anchor: { identity: unknown; graphemeOffset: number };
        head: { identity: unknown; graphemeOffset: number };
      }
    | null
    | undefined
) {
  if (!selection) return null;
  return {
    anchor: {
      identity: selection.anchor.identity,
      graphemeOffset: selection.anchor.graphemeOffset,
    },
    head: { identity: selection.head.identity, graphemeOffset: selection.head.graphemeOffset },
  };
}

function editorInteractionSnapshot(editor: Editor) {
  const frame = editor.getInteractionFrame();
  const obs = editor.getAccessibilityObservation();
  return {
    revision: editor.getDocumentHandle().revision,
    semanticSelection: obs.selection,
    semanticFocus: obs.focus,
    frame: frameObservation(frame),
    inputHost: editor.getInputHostObservation(),
  };
}

describe('createEditor dispatchInteraction (task 5.1)', () => {
  test('applies engine effects, returns host effects, and leaves model revision unchanged for selection/focus', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const revisionBefore = editor.getDocumentHandle().revision;
    const frame = editor.getInteractionFrame();
    const blockId = editor.getAccessibilityObservation().entries[0]!.identity.blockId;
    const selection = selectionForBlock(frame, blockId, 0, 2);

    const dispatch = editor.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: frame.id,
      selection,
    });
    expect(dispatch.outcome.ok).toBe(true);
    if (dispatch.outcome.ok) {
      expect(dispatch.outcome.frameId).toEqual(editor.getInteractionFrame().id);
      expect(dispatch.outcome.frameId.value).toBeGreaterThan(frame.id.value);
    }
    expect(dispatch.hostEffects).toEqual([]);
    expect(editor.getDocumentHandle().revision).toBe(revisionBefore);
    expect(editor.getAccessibilityObservation().selection?.head).toMatchObject({
      kind: 'text',
      graphemeOffset: 2,
    });
    expect(editor.getInteractionFrame().focus.focused).toBe(true);

    editor.destroy();
    body.remove();
  });

  test('maps binding failures exactly without mutating revision, semantic/frame projection, or input host', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const storyId = editor.getAccessibilityObservation().entries[0]!.identity.storyId;
    const before = editorInteractionSnapshot(editor);
    const badSelection = {
      frameId: frame.id,
      scope: { kind: 'body' as const },
      anchor: {
        kind: 'text' as const,
        scope: { kind: 'body' as const },
        identity: { storyId, blockId: 'missing-block' },
        graphemeOffset: 0,
        affinity: 'upstream' as const,
      },
      head: {
        kind: 'text' as const,
        scope: { kind: 'body' as const },
        identity: { storyId, blockId: 'missing-block' },
        graphemeOffset: 0,
        affinity: 'upstream' as const,
      },
    };

    const dispatch = editor.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: frame.id,
      selection: badSelection,
    });
    const after = editorInteractionSnapshot(editor);

    expect(dispatch.outcome.ok).toBe(false);
    if (!dispatch.outcome.ok) expect(dispatch.outcome.code).toBe('invalidTarget');
    expect(dispatch.hostEffects).toEqual([]);
    expect(after.revision).toBe(before.revision);
    expect(after.semanticSelection).toEqual(before.semanticSelection);
    expect(after.semanticFocus).toEqual(before.semanticFocus);
    expect(after.frame).toEqual(before.frame);
    expect(after.inputHost).toEqual(before.inputHost);
    expect(
      editor
        .getAccessibilityObservation()
        .entries.some((entry) => entry.identity.blockId === 'missing-block')
    ).toBe(false);

    editor.destroy();
    body.remove();
  });

  test('stale, pending, read-only, and unsupported paths leave state unchanged', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const queue: Array<() => void> = [];
    const host: EditorHost = {
      getBodyHostEl: () => body,
      getHfHostEl: () => null,
      getPagesContainer: () => null,
      getScrollContainer: () => null,
      getInteractionHostMetrics: () => IDENTITY_HOST_METRICS,
      scheduleFrame: (cb) => {
        queue.push(cb);
        return () => {
          const idx = queue.indexOf(cb);
          if (idx >= 0) queue.splice(idx, 1);
        };
      },
    };
    const editor = createEditor({
      host,
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const blockId = editor.getAccessibilityObservation().entries[0]!.identity.blockId;
    const selection = selectionForBlock(frame, blockId, 0, 1);
    const before = editorInteractionSnapshot(editor);

    const stale = editor.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: { value: frame.id.value - 1 },
      selection,
    });
    expect(stale.outcome.ok).toBe(false);
    if (!stale.outcome.ok) expect(stale.outcome.code).toBe('staleFrame');
    expect(editorInteractionSnapshot(editor)).toEqual(before);

    editor.relayout({ sync: false });
    expect(editor.getInteractionFrame().completeness.kind).toBe('pending');
    const pendingSnapshot = editorInteractionSnapshot(editor);
    const pending = editor.dispatchInteraction({
      kind: 'focus',
      frameId: editor.getInteractionFrame().id,
    });
    expect(pending.outcome.ok).toBe(false);
    if (!pending.outcome.ok) expect(pending.outcome.code).toBe('pendingLayout');
    expect(editorInteractionSnapshot(editor)).toEqual(pendingSnapshot);

    queue.shift()?.();
    editor.relayout({ sync: true });
    const invalidDrag = editor.dispatchInteraction({
      kind: 'pointerDown',
      frameId: editor.getInteractionFrame().id,
      clientPoint: { x: 1, y: 1 },
      pointerId: 1,
    });
    expect(invalidDrag.outcome.ok).toBe(false);
    if (!invalidDrag.outcome.ok) expect(invalidDrag.outcome.code).toBe('invalidTarget');
    expect(editor.getDocumentHandle().revision).toBe(before.revision);

    editor.destroy();
    body.remove();

    const readOnlyBody = document.createElement('div');
    document.body.append(readOnlyBody);
    const readOnly = createEditor({
      host: hostWith(readOnlyBody),
      document: createEditableParagraphFixture(),
      mode: 'view',
    });
    const roFrame = readOnly.getInteractionFrame();
    const roBlock = readOnly.getAccessibilityObservation().entries[0]!.identity.blockId;
    const roSelection = selectionForBlock(roFrame, roBlock, 0, 1);
    const roBefore = editorInteractionSnapshot(readOnly);
    const ro = readOnly.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: roFrame.id,
      selection: roSelection,
    });
    expect(ro.outcome.ok).toBe(false);
    if (!ro.outcome.ok) expect(ro.outcome.code).toBe('readOnly');
    expect(editorInteractionSnapshot(readOnly)).toEqual(roBefore);
    readOnly.destroy();
    readOnlyBody.remove();
  });

  test('returns host passthrough effects for scroll control intent', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
    });
    const frame = editor.getInteractionFrame();
    const dispatch = editor.dispatchInteraction({
      kind: 'scroll',
      frameId: frame.id,
      delta: { x: 0, y: 16 },
    });
    expect(dispatch.outcome.ok).toBe(true);
    if (dispatch.outcome.ok) {
      expect(dispatch.outcome.frameId).toEqual(editor.getInteractionFrame().id);
    }
    expect(dispatch.hostEffects).toEqual([{ kind: 'scroll', delta: { x: 0, y: 16 } }]);
    editor.destroy();
    body.remove();
  });
});

describe('createEditor dispatchInteraction click (task 5.2)', () => {
  test('click synchronizes PM, focuses host, publishes coherent frame, and leaves model revision unchanged', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const revisionBefore = editor.getDocumentHandle().revision;
    const frame = editor.getInteractionFrame();
    const textItem = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const cluster = textItem.clusters[2] ?? textItem.clusters[0]!;
    const clientPoint = clientPointForStackedText(frame, 0, {
      x: cluster.box.x + cluster.box.width * 0.5,
      y: cluster.box.y + cluster.box.height / 2,
    });

    const dispatch = editor.dispatchInteraction({
      kind: 'click',
      frameId: frame.id,
      clientPoint,
    });
    expect(dispatch.outcome.ok).toBe(true);
    if (dispatch.outcome.ok) {
      expect(dispatch.outcome.frameId).toEqual(editor.getInteractionFrame().id);
      expect(dispatch.outcome.frameId.value).toBeGreaterThan(frame.id.value);
    }
    expect(dispatch.hostEffects).toEqual([]);
    expect(editor.getDocumentHandle().revision).toBe(revisionBefore);
    expect(editor.getInteractionFrame().focus.focused).toBe(true);
    expect(editor.getInteractionFrame().selection?.head).toMatchObject({
      kind: 'text',
      identity: textItem.semantic.identity,
    });
    expect(editor.getInteractionFrame().caret).not.toBeNull();
    expect(editor.getInputHostObservation()?.attached).toBe(true);

    editor.destroy();
    body.remove();
  });

  test('second click plans from newly published frame without controller selection state', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const textItem = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const firstCluster = textItem.clusters[0]!;
    const lastCluster = textItem.clusters.at(-1)!;
    const firstPoint = clientPointForStackedText(frame, 0, {
      x: firstCluster.box.x + 1,
      y: firstCluster.box.y + firstCluster.box.height / 2,
    });
    const first = editor.dispatchInteraction({
      kind: 'click',
      frameId: frame.id,
      clientPoint: firstPoint,
    });
    expect(first.outcome.ok).toBe(true);
    const afterFirst = editor.getInteractionFrame();
    const secondPoint = clientPointForStackedText(afterFirst, 0, {
      x: lastCluster.box.x + lastCluster.box.width - 1,
      y: lastCluster.box.y + lastCluster.box.height / 2,
    });
    const second = editor.dispatchInteraction({
      kind: 'click',
      frameId: afterFirst.id,
      clientPoint: secondPoint,
    });
    expect(second.outcome.ok).toBe(true);
    if (second.outcome.ok) {
      expect(second.outcome.frameId).toEqual(editor.getInteractionFrame().id);
    }
    expect(editor.getInteractionFrame().selection?.head.graphemeOffset).toBeGreaterThan(
      afterFirst.selection?.head.graphemeOffset ?? -1
    );

    editor.destroy();
    body.remove();
  });

  test('failed click intents leave PM frame focus and model revision unchanged', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const textItem = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const cluster = textItem.clusters[1] ?? textItem.clusters[0]!;
    const validPoint = clientPointForStackedText(frame, 0, {
      x: cluster.box.x + cluster.box.width * 0.5,
      y: cluster.box.y + cluster.box.height / 2,
    });
    const gapY = frame.scrollGeometry.pageTops[0]! + frame.pageGeometry[0]!.box.height + 10;
    const gapClient = contentToClient({ x: 100, y: gapY }, IDENTITY_HOST_METRICS);
    if (!gapClient.ok) throw new Error('gap client');
    const before = editorInteractionSnapshot(editor);

    const gap = editor.dispatchInteraction({
      kind: 'click',
      frameId: frame.id,
      clientPoint: gapClient.value,
    });
    expect(gap.outcome.ok).toBe(false);
    if (!gap.outcome.ok) expect(gap.outcome.code).toBe('invalidTarget');
    expect(editorInteractionSnapshot(editor)).toEqual(before);

    const nonPrimary = editor.dispatchInteraction({
      kind: 'click',
      frameId: editor.getInteractionFrame().id,
      clientPoint: validPoint,
      buttons: 2,
    });
    expect(nonPrimary.outcome.ok).toBe(false);
    if (!nonPrimary.outcome.ok) expect(nonPrimary.outcome.code).toBe('unsupported');
    expect(editorInteractionSnapshot(editor)).toEqual(before);

    const badCount = editor.dispatchInteraction({
      kind: 'click',
      frameId: editor.getInteractionFrame().id,
      clientPoint: validPoint,
      clickCount: 0,
    });
    expect(badCount.outcome.ok).toBe(false);
    if (!badCount.outcome.ok) expect(badCount.outcome.code).toBe('unsupported');
    expect(editorInteractionSnapshot(editor)).toEqual(before);

    editor.destroy();
    body.remove();
  });

  test('shift-click with stale frame identity rejects and leaves PM/frame/model unchanged', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const textItem = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const cluster = textItem.clusters[1] ?? textItem.clusters[0]!;
    const clientPoint = clientPointForStackedText(frame, 0, {
      x: cluster.box.x + cluster.box.width * 0.5,
      y: cluster.box.y + cluster.box.height / 2,
    });
    const before = editorInteractionSnapshot(editor);

    const dispatch = editor.dispatchInteraction({
      kind: 'click',
      frameId: { value: frame.id.value - 1 },
      clientPoint,
      shiftKey: true,
    });
    const after = editorInteractionSnapshot(editor);

    expect(dispatch.outcome.ok).toBe(false);
    if (!dispatch.outcome.ok) expect(dispatch.outcome.code).toBe('staleFrame');
    expect(after).toEqual(before);

    editor.destroy();
    body.remove();
  });

  test('double-click and triple-click dispatch syncSelection, focus, overlay geometry, and preserve model revision', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const revisionBefore = editor.getDocumentHandle().revision;
    const frame = editor.getInteractionFrame();
    const textItem = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const block = frame.semanticIndex.stories[0]!.blocks.find(
      (b) => b.identity.blockId === textItem.semantic.identity.blockId
    )!;

    const wordCluster = textItem.clusters[2] ?? textItem.clusters[0]!;
    const doublePoint = clientPointForStackedText(frame, 0, {
      x: wordCluster.box.x + wordCluster.box.width * 0.5,
      y: wordCluster.box.y + wordCluster.box.height / 2,
    });
    const double = editor.dispatchInteraction({
      kind: 'click',
      frameId: frame.id,
      clientPoint: doublePoint,
      clickCount: 2,
    });
    expect(double.outcome.ok).toBe(true);
    if (double.outcome.ok) {
      expect(double.outcome.frameId).toEqual(editor.getInteractionFrame().id);
      expect(double.outcome.frameId.value).toBeGreaterThan(frame.id.value);
    }
    const afterDouble = editor.getInteractionFrame();
    expect(afterDouble.selection?.anchor.graphemeOffset).toBeLessThan(
      afterDouble.selection?.head.graphemeOffset ?? 0
    );
    expect(afterDouble.selectionGeometry).not.toBeNull();
    expect(afterDouble.focus.focused).toBe(true);
    expect(editor.getDocumentHandle().revision).toBe(revisionBefore);

    const triplePoint = clientPointForStackedText(afterDouble, 0, {
      x: textItem.clusters[0]!.box.x + 1,
      y: textItem.clusters[0]!.box.y + textItem.clusters[0]!.box.height / 2,
    });
    const triple = editor.dispatchInteraction({
      kind: 'click',
      frameId: afterDouble.id,
      clientPoint: triplePoint,
      clickCount: 3,
    });
    expect(triple.outcome.ok).toBe(true);
    if (triple.outcome.ok) {
      expect(triple.outcome.frameId).toEqual(editor.getInteractionFrame().id);
      expect(triple.outcome.frameId.value).toBeGreaterThan(afterDouble.id.value);
    }
    const afterTriple = editor.getInteractionFrame();
    expect(afterTriple.selection?.anchor).toMatchObject({
      graphemeOffset: 0,
      identity: block.identity,
    });
    expect(afterTriple.selection?.head).toMatchObject({
      graphemeOffset: block.graphemeCount,
      identity: block.identity,
    });
    expect(afterTriple.selectionGeometry).not.toBeNull();
    expect(afterTriple.caret).not.toBeNull();
    expect(afterTriple.focus.focused).toBe(true);
    expect(editor.getDocumentHandle().revision).toBe(revisionBefore);

    editor.destroy();
    body.remove();
  });

  test('failed double-click intents leave PM frame focus and model revision unchanged', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const textItem = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const cluster = textItem.clusters[1] ?? textItem.clusters[0]!;
    const validPoint = clientPointForStackedText(frame, 0, {
      x: cluster.box.x + cluster.box.width * 0.5,
      y: cluster.box.y + cluster.box.height / 2,
    });
    const before = editorInteractionSnapshot(editor);

    const shiftDouble = editor.dispatchInteraction({
      kind: 'click',
      frameId: editor.getInteractionFrame().id,
      clientPoint: validPoint,
      clickCount: 2,
      shiftKey: true,
    });
    expect(shiftDouble.outcome.ok).toBe(false);
    if (!shiftDouble.outcome.ok) expect(shiftDouble.outcome.code).toBe('unsupported');
    expect(editorInteractionSnapshot(editor)).toEqual(before);

    const badCount = editor.dispatchInteraction({
      kind: 'click',
      frameId: editor.getInteractionFrame().id,
      clientPoint: validPoint,
      clickCount: 4,
    });
    expect(badCount.outcome.ok).toBe(false);
    if (!badCount.outcome.ok) expect(badCount.outcome.code).toBe('unsupported');
    expect(editorInteractionSnapshot(editor)).toEqual(before);

    editor.destroy();
    body.remove();
  });

  test('pointer drag dispatch captures, extends selection, releases, and preserves model revision', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const revisionBefore = editor.getDocumentHandle().revision;
    const frame = editor.getInteractionFrame();
    const textItem = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const downPoint = clientPointForStackedText(frame, 0, {
      x: textItem.clusters[0]!.box.x + 2,
      y: textItem.clusters[0]!.box.y + textItem.clusters[0]!.box.height / 2,
    });
    const lastCluster = textItem.clusters.at(-1) ?? textItem.clusters[0]!;
    const movePoint = clientPointForStackedText(frame, 0, {
      x: lastCluster.box.x + lastCluster.box.width * 0.8,
      y: lastCluster.box.y + lastCluster.box.height / 2,
    });

    const down = editor.dispatchInteraction({
      kind: 'pointerDown',
      frameId: frame.id,
      clientPoint: downPoint,
      pointerId: 9,
      button: 0,
      buttons: 1,
    });
    expect(down.outcome.ok).toBe(true);
    expect(down.hostEffects).toEqual([{ kind: 'capturePointer', pointerId: 9 }]);
    expect(editor.getInteractionFrame().focus.focused).toBe(true);

    const move = editor.dispatchInteraction({
      kind: 'pointerMove',
      frameId: editor.getInteractionFrame().id,
      clientPoint: movePoint,
      pointerId: 9,
      buttons: 1,
    });
    expect(move.outcome.ok).toBe(true);
    expect(move.hostEffects).toEqual([]);
    expect(editor.getInteractionFrame().selectionGeometry).not.toBeNull();

    const up = editor.dispatchInteraction({
      kind: 'pointerUp',
      frameId: editor.getInteractionFrame().id,
      clientPoint: movePoint,
      pointerId: 9,
      buttons: 0,
    });
    expect(up.outcome.ok).toBe(true);
    expect(up.hostEffects).toEqual([{ kind: 'releasePointer', pointerId: 9 }]);
    expect(editor.getDocumentHandle().revision).toBe(revisionBefore);

    editor.destroy();
    body.remove();
  });

  test('destroy during drag clears session and rejects late pointer dispatch', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const textItem = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const point = clientPointForStackedText(frame, 0, {
      x: textItem.clusters[0]!.box.x + 2,
      y: textItem.clusters[0]!.box.y + textItem.clusters[0]!.box.height / 2,
    });
    editor.dispatchInteraction({
      kind: 'pointerDown',
      frameId: frame.id,
      clientPoint: point,
      pointerId: 4,
      button: 0,
      buttons: 1,
    });
    editor.destroy();
    const late = editor.dispatchInteraction({
      kind: 'pointerMove',
      frameId: frame.id,
      clientPoint: point,
      pointerId: 4,
      buttons: 1,
    });
    expect(late.outcome.ok).toBe(false);
    if (!late.outcome.ok) expect(late.outcome.code).toBe('unsupported');
    body.remove();
  });

  test('invalid move and pending terminal up leave snapshots unchanged and clear session', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const queue: Array<() => void> = [];
    const host: EditorHost = {
      getBodyHostEl: () => body,
      getHfHostEl: () => null,
      getPagesContainer: () => null,
      getScrollContainer: () => null,
      getInteractionHostMetrics: () => IDENTITY_HOST_METRICS,
      scheduleFrame: (cb) => {
        queue.push(cb);
        return () => {
          const idx = queue.indexOf(cb);
          if (idx >= 0) queue.splice(idx, 1);
        };
      },
    };
    const editor = createEditor({
      host,
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const textItem = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const goodPoint = clientPointForStackedText(frame, 0, {
      x: textItem.clusters[0]!.box.x + 2,
      y: textItem.clusters[0]!.box.y + textItem.clusters[0]!.box.height / 2,
    });
    editor.dispatchInteraction({
      kind: 'pointerDown',
      frameId: frame.id,
      clientPoint: goodPoint,
      pointerId: 6,
      button: 0,
      buttons: 1,
    });
    const afterDown = editorInteractionSnapshot(editor);

    const invalidMove = editor.dispatchInteraction({
      kind: 'pointerMove',
      frameId: editor.getInteractionFrame().id,
      clientPoint: { x: -5000, y: -5000 },
      pointerId: 6,
      buttons: 1,
    });
    expect(invalidMove.outcome.ok).toBe(true);
    expect(editorInteractionSnapshot(editor)).toEqual(afterDown);

    editor.relayout({ sync: false });
    const pendingUp = editor.dispatchInteraction({
      kind: 'pointerUp',
      frameId: editor.getInteractionFrame().id,
      clientPoint: goodPoint,
      pointerId: 6,
      buttons: 0,
    });
    expect(pendingUp.outcome.ok).toBe(false);
    if (!pendingUp.outcome.ok) expect(pendingUp.outcome.code).toBe('pendingLayout');
    expect(pendingUp.hostEffects).toEqual([{ kind: 'releasePointer', pointerId: 6 }]);
    expect(editorInteractionSnapshot(editor)).toEqual(afterDown);

    queue.shift()?.();
    editor.relayout({ sync: true });
    const afterRelease = editor.dispatchInteraction({
      kind: 'pointerMove',
      frameId: editor.getInteractionFrame().id,
      clientPoint: goodPoint,
      pointerId: 6,
      buttons: 1,
    });
    expect(afterRelease.outcome.ok).toBe(false);
    if (!afterRelease.outcome.ok) expect(afterRelease.outcome.code).toBe('invalidTarget');

    editor.destroy();
    body.remove();
  });

  test('two editor instances keep independent drag sessions and repeated drags start fresh', () => {
    const bodyA = document.createElement('div');
    const bodyB = document.createElement('div');
    document.body.append(bodyA, bodyB);
    const editorA = createEditor({
      host: hostWith(bodyA),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor A',
    });
    const editorB = createEditor({
      host: hostWith(bodyB),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor B',
    });
    const frameA = editorA.getInteractionFrame();
    const frameB = editorB.getInteractionFrame();
    const itemA = frameA.display[0]!.items.find((i) => i.kind === 'text');
    const itemB = frameB.display[0]!.items.find((i) => i.kind === 'text');
    if (itemA?.kind !== 'text' || itemB?.kind !== 'text') throw new Error('text');
    const pointA = clientPointForStackedText(frameA, 0, {
      x: itemA.clusters[0]!.box.x + 2,
      y: itemA.clusters[0]!.box.y + itemA.clusters[0]!.box.height / 2,
    });
    const pointB = clientPointForStackedText(frameB, 0, {
      x: itemB.clusters.at(-1)!.box.x + itemB.clusters.at(-1)!.box.width * 0.8,
      y: itemB.clusters.at(-1)!.box.y + itemB.clusters.at(-1)!.box.height / 2,
    });

    const downA = editorA.dispatchInteraction({
      kind: 'pointerDown',
      frameId: frameA.id,
      clientPoint: pointA,
      pointerId: 11,
      button: 0,
      buttons: 1,
    });
    const downB = editorB.dispatchInteraction({
      kind: 'pointerDown',
      frameId: frameB.id,
      clientPoint: pointB,
      pointerId: 22,
      button: 0,
      buttons: 1,
    });
    expect(downA.hostEffects).toEqual([{ kind: 'capturePointer', pointerId: 11 }]);
    expect(downB.hostEffects).toEqual([{ kind: 'capturePointer', pointerId: 22 }]);
    expect(editorA.getAccessibilityObservation().selection?.anchor.graphemeOffset).toBe(0);
    expect(editorB.getAccessibilityObservation().selection?.anchor.graphemeOffset).toBeGreaterThan(
      0
    );

    const moveA = clientPointForStackedText(frameA, 0, {
      x: itemA.clusters.at(-1)!.box.x + itemA.clusters.at(-1)!.box.width * 0.8,
      y: itemA.clusters.at(-1)!.box.y + itemA.clusters.at(-1)!.box.height / 2,
    });
    editorA.dispatchInteraction({
      kind: 'pointerMove',
      frameId: editorA.getInteractionFrame().id,
      clientPoint: moveA,
      pointerId: 11,
      buttons: 1,
    });
    expect(editorB.getAccessibilityObservation().selection?.head.graphemeOffset).toBe(
      editorB.getAccessibilityObservation().selection?.anchor.graphemeOffset
    );

    const upA = editorA.dispatchInteraction({
      kind: 'pointerUp',
      frameId: editorA.getInteractionFrame().id,
      clientPoint: moveA,
      pointerId: 11,
      buttons: 0,
    });
    expect(upA.hostEffects).toEqual([{ kind: 'releasePointer', pointerId: 11 }]);

    const secondDownA = editorA.dispatchInteraction({
      kind: 'pointerDown',
      frameId: editorA.getInteractionFrame().id,
      clientPoint: moveA,
      pointerId: 33,
      button: 0,
      buttons: 1,
    });
    expect(secondDownA.hostEffects).toEqual([{ kind: 'capturePointer', pointerId: 33 }]);

    editorA.destroy();
    editorB.destroy();
    bodyA.remove();
    bodyB.remove();
  });

  test('pointerDown failure keeps null session and returns no capture host effect', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const before = editorInteractionSnapshot(editor);
    const down = editor.dispatchInteraction({
      kind: 'pointerDown',
      frameId: frame.id,
      clientPoint: { x: -9000, y: -9000 },
      pointerId: 15,
      button: 0,
      buttons: 1,
    });
    expect(down.outcome.ok).toBe(false);
    if (!down.outcome.ok) expect(down.outcome.code).toBe('invalidTarget');
    expect(down.hostEffects).toEqual([]);
    expect(editorInteractionSnapshot(editor)).toEqual(before);

    const lateMove = editor.dispatchInteraction({
      kind: 'pointerMove',
      frameId: frame.id,
      clientPoint: { x: -9000, y: -9000 },
      pointerId: 15,
      buttons: 1,
    });
    expect(lateMove.outcome.ok).toBe(false);
    if (!lateMove.outcome.ok) expect(lateMove.outcome.code).toBe('invalidTarget');

    editor.destroy();
    body.remove();
  });

  test('pointerMove sync failure retains session anchor and last valid PM/frame selection', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const textItem = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const downPoint = clientPointForStackedText(frame, 0, {
      x: textItem.clusters[0]!.box.x + 2,
      y: textItem.clusters[0]!.box.y + textItem.clusters[0]!.box.height / 2,
    });
    const lastCluster = textItem.clusters.at(-1) ?? textItem.clusters[0]!;
    const movePoint = clientPointForStackedText(frame, 0, {
      x: lastCluster.box.x + lastCluster.box.width * 0.8,
      y: lastCluster.box.y + lastCluster.box.height / 2,
    });

    const down = editor.dispatchInteraction({
      kind: 'pointerDown',
      frameId: frame.id,
      clientPoint: downPoint,
      pointerId: 18,
      button: 0,
      buttons: 1,
    });
    expect(down.outcome.ok).toBe(true);
    const afterDownSelection = editor.getAccessibilityObservation().selection;
    const afterDownFrameSelection = editor.getInteractionFrame().selection;

    editor.setActiveScope({ kind: 'headerFooter', rId: 'rId-header' });
    const move = editor.dispatchInteraction({
      kind: 'pointerMove',
      frameId: editor.getInteractionFrame().id,
      clientPoint: movePoint,
      pointerId: 18,
      buttons: 1,
    });
    expect(move.outcome.ok).toBe(false);
    if (!move.outcome.ok) expect(move.outcome.code).toBe('unsupported');
    expect(move.hostEffects).toEqual([]);
    expect(selectionEndpoints(editor.getAccessibilityObservation().selection)).toEqual(
      selectionEndpoints(afterDownSelection)
    );
    expect(selectionEndpoints(editor.getInteractionFrame().selection)).toEqual(
      selectionEndpoints(afterDownFrameSelection)
    );

    editor.setActiveScope({ kind: 'body' });
    const recoverMove = editor.dispatchInteraction({
      kind: 'pointerMove',
      frameId: editor.getInteractionFrame().id,
      clientPoint: movePoint,
      pointerId: 18,
      buttons: 1,
    });
    expect(recoverMove.outcome.ok).toBe(true);
    expect(editor.getInteractionFrame().selectionGeometry).not.toBeNull();

    editor.destroy();
    body.remove();
  });

  test('terminal pointerUp sync failure clears session, releases once, preserves last valid selection', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const textItem = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (textItem?.kind !== 'text') throw new Error('text');
    const downPoint = clientPointForStackedText(frame, 0, {
      x: textItem.clusters[0]!.box.x + 2,
      y: textItem.clusters[0]!.box.y + textItem.clusters[0]!.box.height / 2,
    });
    const lastCluster = textItem.clusters.at(-1) ?? textItem.clusters[0]!;
    const movePoint = clientPointForStackedText(frame, 0, {
      x: lastCluster.box.x + lastCluster.box.width * 0.8,
      y: lastCluster.box.y + lastCluster.box.height / 2,
    });

    editor.dispatchInteraction({
      kind: 'pointerDown',
      frameId: frame.id,
      clientPoint: downPoint,
      pointerId: 21,
      button: 0,
      buttons: 1,
    });
    editor.dispatchInteraction({
      kind: 'pointerMove',
      frameId: editor.getInteractionFrame().id,
      clientPoint: movePoint,
      pointerId: 21,
      buttons: 1,
    });
    const afterMoveSelection = editor.getAccessibilityObservation().selection;
    const afterMoveFrameSelection = editor.getInteractionFrame().selection;
    const afterMoveGeometry = editor.getInteractionFrame().selectionGeometry;

    editor.setActiveScope({ kind: 'headerFooter', rId: 'rId-header' });
    const up = editor.dispatchInteraction({
      kind: 'pointerUp',
      frameId: editor.getInteractionFrame().id,
      clientPoint: movePoint,
      pointerId: 21,
      buttons: 0,
    });
    expect(up.outcome.ok).toBe(false);
    if (!up.outcome.ok) expect(up.outcome.code).toBe('unsupported');
    expect(up.hostEffects).toEqual([{ kind: 'releasePointer', pointerId: 21 }]);
    expect(selectionEndpoints(editor.getAccessibilityObservation().selection)).toEqual(
      selectionEndpoints(afterMoveSelection)
    );
    expect(selectionEndpoints(editor.getInteractionFrame().selection)).toEqual(
      selectionEndpoints(afterMoveFrameSelection)
    );
    expect(editor.getInteractionFrame().selectionGeometry).toEqual(afterMoveGeometry);

    editor.setActiveScope({ kind: 'body' });
    const staleMove = editor.dispatchInteraction({
      kind: 'pointerMove',
      frameId: editor.getInteractionFrame().id,
      clientPoint: movePoint,
      pointerId: 21,
      buttons: 1,
    });
    expect(staleMove.outcome.ok).toBe(false);
    if (!staleMove.outcome.ok) expect(staleMove.outcome.code).toBe('invalidTarget');

    editor.destroy();
    body.remove();
  });
});

describe('createEditor focus frame coherence (task 5.1)', () => {
  test('successful focus returns the published current interaction frame identity', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const beforeId = editor.getInteractionFrame().id.value;
    const focus = editor.focus();
    expect(focus.ok).toBe(true);
    if (focus.ok) {
      expect(focus.frameId).toEqual(editor.getInteractionFrame().id);
      expect(focus.frameId.value).toBeGreaterThan(beforeId);
    }
    editor.destroy();
    body.remove();
  });
});
