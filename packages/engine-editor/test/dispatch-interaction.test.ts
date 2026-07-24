import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createEditor } from '../src/create-editor.ts';
import type { Editor, EditorHost } from '@docx-editor.dev/core-contract/editor';
import type { InteractionFrame } from '@docx-editor.dev/core-contract/interaction';
import { createEditableParagraphFixture } from '../browser/fixtures.ts';
import { clientPointForStackedText, publishFrame, selectionForBlock } from './interaction-test-helpers.ts';
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
    expect(editor.getAccessibilityObservation().selection?.head).toMatchObject({ kind: 'text', graphemeOffset: 2 });
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
    expect(editor.getAccessibilityObservation().entries.some((entry) => entry.identity.blockId === 'missing-block')).toBe(false);

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
    const pending = editor.dispatchInteraction({ kind: 'focus', frameId: editor.getInteractionFrame().id });
    expect(pending.outcome.ok).toBe(false);
    if (!pending.outcome.ok) expect(pending.outcome.code).toBe('pendingLayout');
    expect(editorInteractionSnapshot(editor)).toEqual(pendingSnapshot);

    queue.shift()?.();
    editor.relayout({ sync: true });
    const unsupported = editor.dispatchInteraction({
      kind: 'pointerDown',
      frameId: editor.getInteractionFrame().id,
      clientPoint: { x: 1, y: 1 },
      pointerId: 1,
    });
    expect(unsupported.outcome.ok).toBe(false);
    if (!unsupported.outcome.ok) expect(unsupported.outcome.code).toBe('unsupported');
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
    const first = editor.dispatchInteraction({ kind: 'click', frameId: frame.id, clientPoint: firstPoint });
    expect(first.outcome.ok).toBe(true);
    const afterFirst = editor.getInteractionFrame();
    const secondPoint = clientPointForStackedText(afterFirst, 0, {
      x: lastCluster.box.x + lastCluster.box.width - 1,
      y: lastCluster.box.y + lastCluster.box.height / 2,
    });
    const second = editor.dispatchInteraction({ kind: 'click', frameId: afterFirst.id, clientPoint: secondPoint });
    expect(second.outcome.ok).toBe(true);
    if (second.outcome.ok) {
      expect(second.outcome.frameId).toEqual(editor.getInteractionFrame().id);
    }
    expect(editor.getInteractionFrame().selection?.head.graphemeOffset).toBeGreaterThan(
      afterFirst.selection?.head.graphemeOffset ?? -1,
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
