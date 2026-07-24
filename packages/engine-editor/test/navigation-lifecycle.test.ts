// createEditor / InteractionFrameStore navigation lifecycle (task 5.5 review).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createEditor } from '../src/create-editor.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/editor';
import { createEmptyModel, writeDocx } from '@docx-editor.dev/engine-core';
import { frameMembersCoherent } from '../src/interaction-frame.ts';
import { createEditableFixtureWithTexts } from '../browser/fixtures.ts';
import { modelWith, selectionForBlock } from './interaction-test-helpers.ts';

const METRICS = { clientOrigin: { x: 0, y: 0 }, scrollOffset: { x: 0, y: 0 }, zoom: 1 };

function makeSyncHost(body: HTMLElement | null = null): EditorHost {
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

function makeControllableHost(body: HTMLElement | null = null) {
  const queue: Array<() => void> = [];
  let cancel: (() => void) | null = null;
  const host: EditorHost = {
    getBodyHostEl: () => body,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => null,
    scheduleFrame: (cb) => {
      cancel?.();
      queue.push(cb);
      const thisCancel = () => {
        const idx = queue.indexOf(cb);
        if (idx >= 0) queue.splice(idx, 1);
      };
      cancel = thisCancel;
      return thisCancel;
    },
  };
  return {
    host,
    flush: () => {
      queue.shift()?.();
    },
    pendingCount: () => queue.length,
  };
}

describe('createEditor navigation lifecycle (task 5.5 review)', () => {
  test('load clears sidecar state and rejects stale frame intents', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const editor = createEditor({ host: makeSyncHost(), document: createEditableFixtureWithTexts([words]) });
    const staleFrameId = editor.getInteractionFrame().id;
    const blockId = editor.getInteractionFrame().semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    editor.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: staleFrameId,
      selection: selectionForBlock(editor.getInteractionFrame(), blockId, 8, 8),
    });
    editor.dispatchInteraction({ kind: 'geometryKeyboard', frameId: staleFrameId, key: 'ArrowDown' });
    editor.load(writeDocx(createEmptyModel()));
    const stale = editor.dispatchInteraction({ kind: 'geometryKeyboard', frameId: staleFrameId, key: 'ArrowDown' });
    expect(stale.outcome.ok).toBe(false);
    if (!stale.outcome.ok) expect(stale.outcome.code).toBe('staleFrame');
    expect(frameMembersCoherent(editor.getInteractionFrame())).toBe(true);
    editor.destroy();
  });

  test('scope change to headerFooter resets retained visual-advance session', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const editor = createEditor({ host: makeSyncHost(body), document: createEditableFixtureWithTexts([words]) });
    const blockId = editor.getAccessibilityObservation().entries[0]!.identity.blockId;
    const seed = 10;
    const seedSelection = () => selectionForBlock(editor.getInteractionFrame(), blockId, seed, seed);

    editor.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: editor.getInteractionFrame().id,
      selection: seedSelection(),
    });
    editor.dispatchInteraction({
      kind: 'geometryKeyboard',
      frameId: editor.getInteractionFrame().id,
      key: 'ArrowDown',
    });
    const firstLanding = editor.getAccessibilityObservation().selection?.head.graphemeOffset;
    editor.dispatchInteraction({
      kind: 'geometryKeyboard',
      frameId: editor.getInteractionFrame().id,
      key: 'ArrowDown',
    });
    const retainedLanding = editor.getAccessibilityObservation().selection?.head.graphemeOffset;
    expect(firstLanding).toBeDefined();
    expect(retainedLanding).toBeDefined();
    expect(retainedLanding).not.toBe(firstLanding);

    editor.setActiveScope({ kind: 'headerFooter', rId: 'rId-header' });
    expect(editor.getActiveScope()).toEqual({ kind: 'headerFooter', rId: 'rId-header' });
    editor.setActiveScope({ kind: 'body' });
    editor.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: editor.getInteractionFrame().id,
      selection: seedSelection(),
    });
    editor.dispatchInteraction({
      kind: 'geometryKeyboard',
      frameId: editor.getInteractionFrame().id,
      key: 'ArrowDown',
    });
    expect(editor.getAccessibilityObservation().selection?.head.graphemeOffset).toBe(firstLanding);
    expect(editor.getAccessibilityObservation().selection?.head.graphemeOffset).not.toBe(retainedLanding);
    editor.destroy();
    body.remove();
  });

  test('geometry keyboard rejects unchanged while layout is pending', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const { host, pendingCount } = makeControllableHost(body);
    const editor = createEditor({ host, document: writeDocx(modelWith(['hello world'])) });
    const frame = editor.getInteractionFrame();
    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const selection = selectionForBlock(frame, blockId, 2, 2);
    editor.dispatchInteraction({ kind: 'semanticSelection', frameId: frame.id, selection });
    editor.relayout({ sync: false });
    expect(editor.getInteractionFrame().completeness.kind).toBe('pending');
    expect(pendingCount()).toBe(1);
    const before = {
      selection: editor.getInteractionFrame().selection,
      layoutRevision: editor.getInteractionFrame().revisions.layoutRevision,
      completeness: editor.getInteractionFrame().completeness,
    };
    const keyboard = editor.dispatchInteraction({
      kind: 'geometryKeyboard',
      frameId: editor.getInteractionFrame().id,
      key: 'ArrowDown',
    });
    expect(keyboard.outcome.ok).toBe(false);
    if (!keyboard.outcome.ok) expect(keyboard.outcome.code).toBe('pendingLayout');
    expect(editor.getInteractionFrame().selection).toEqual(before.selection);
    expect(editor.getInteractionFrame().revisions.layoutRevision).toBe(before.layoutRevision);
    expect(editor.getInteractionFrame().completeness).toEqual(before.completeness);
    editor.destroy();
    body.remove();
  });

  test('load cancels queued pending callback so flush cannot publish late frame', () => {
    const { host, flush, pendingCount } = makeControllableHost();
    const editor = createEditor({ host, document: writeDocx(modelWith(['hello world'])) });
    let displayEmits = 0;
    editor.on('display', () => {
      displayEmits += 1;
    });
    const frameBefore = editor.getInteractionFrame();
    editor.relayout({ sync: false });
    expect(pendingCount()).toBe(1);
    expect(editor.getInteractionFrame().completeness.kind).toBe('pending');
    expect(editor.getInteractionFrame().id).toEqual(frameBefore.id);
    editor.load(writeDocx(createEmptyModel()));
    const frameAfterLoad = editor.getInteractionFrame();
    expect(frameAfterLoad.id.value).not.toBe(frameBefore.id.value);
    const emitsAfterLoad = displayEmits;
    flush();
    expect(displayEmits).toBe(emitsAfterLoad);
    expect(editor.getInteractionFrame().id).toEqual(frameAfterLoad.id);
    expect(editor.getInteractionFrame().completeness.kind).toBe('complete');
    editor.destroy();
  });

  test('destroy cancels queued pending callback so flush cannot publish late frame', () => {
    const { host, flush, pendingCount } = makeControllableHost();
    const editor = createEditor({ host, document: writeDocx(modelWith(['hello world'])) });
    let displayEmits = 0;
    editor.on('display', () => {
      displayEmits += 1;
    });
    const emitsAfterCreate = displayEmits;
    editor.relayout({ sync: false });
    expect(pendingCount()).toBe(1);
    editor.destroy();
    flush();
    expect(displayEmits).toBe(emitsAfterCreate);
  });

  test('destroy clears state and late dispatch rejects', () => {
    const editor = createEditor({ host: makeSyncHost(), document: writeDocx(createEmptyModel()) });
    const frameId = editor.getInteractionFrame().id;
    editor.destroy();
    const late = editor.dispatchInteraction({ kind: 'geometryKeyboard', frameId, key: 'ArrowDown' });
    expect(late.outcome.ok).toBe(false);
    if (!late.outcome.ok) expect(late.outcome.code).toBe('unsupported');
  });
});
