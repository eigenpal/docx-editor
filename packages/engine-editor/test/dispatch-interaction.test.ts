import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createEditor } from '../src/create-editor.ts';
import type { Editor, EditorHost } from '@docx-editor.dev/core-contract/editor';
import type { InteractionFrame } from '@docx-editor.dev/core-contract/interaction';
import { createEditableParagraphFixture } from '../browser/fixtures.ts';
import { publishFrame, selectionForBlock } from './interaction-test-helpers.ts';
import { IDENTITY_HOST_METRICS } from '../src/coordinate-mapper.ts';

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
