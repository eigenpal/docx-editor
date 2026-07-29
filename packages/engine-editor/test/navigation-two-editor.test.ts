// Two-editor production vertical navigation (task 5.5 review).

import { describe, expect, test } from 'bun:test';
import type { EditorHost } from '@docx-editor.dev/core-contract/contracts/editor';
import { createTestEditor as createEditor } from './create-test-editor.ts';
import { createEditableFixtureWithTexts } from '../browser/fixtures.ts';
import { modelWith, publishFrameBundle, selectionForBlock } from './interaction-test-helpers.ts';
import { planKeyboardNavigation } from '../src/keyboard-navigation.ts';

const METRICS = { clientOrigin: { x: 0, y: 0 }, scrollOffset: { x: 0, y: 0 }, zoom: 1 };

function planArrowDown(
  bundle: ReturnType<typeof publishFrameBundle>,
  blockId: string,
  offset: number,
  words: string
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
    intent: { kind: 'geometryKeyboard', frameId: frame.id, key: 'ArrowDown', shiftKey: false },
    priorSession: null,
    documentGeneration: 1,
    modelRevision: 1,
    paragraphText: () => words,
  });
}

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

describe('two-editor vertical navigation (task 5.5 review)', () => {
  test('distinct seeded X landings stay exact across two geometry-valid editors', async () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
    const doc = createEditableFixtureWithTexts([words]);
    const bundle = publishFrameBundle(modelWith([words]));
    const blockId = bundle.frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const seedOffset1 = 15;
    const seedOffset2 = 10;
    const planned1 = planArrowDown(bundle, blockId, seedOffset1, words);
    const planned2 = planArrowDown(bundle, blockId, seedOffset2, words);
    const sync1 = planned1.plan.effects.find((e) => e.kind === 'syncSelection');
    const sync2 = planned2.plan.effects.find((e) => e.kind === 'syncSelection');
    expect(sync1?.kind).toBe('syncSelection');
    expect(sync2?.kind).toBe('syncSelection');
    if (sync1?.kind !== 'syncSelection' || sync2?.kind !== 'syncSelection') throw new Error('sync');
    const expectedOffset1 = sync1.selection.head.graphemeOffset;
    const expectedOffset2 = sync2.selection.head.graphemeOffset;
    expect(expectedOffset1).not.toBe(expectedOffset2);

    const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
    if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

    const body1 = document.createElement('div');
    const body2 = document.createElement('div');
    document.body.append(body1, body2);
    const editor1 = createEditor({ host: hostWith(body1), document: doc, accessibleName: 'A' });
    const editor2 = createEditor({ host: hostWith(body2), document: doc, accessibleName: 'B' });
    const block1 = editor1.getAccessibilityObservation().entries[0]!.identity.blockId;
    const block2 = editor2.getAccessibilityObservation().entries[0]!.identity.blockId;
    editor1.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: editor1.getInteractionFrame().id,
      selection: selectionForBlock(editor1.getInteractionFrame(), block1, seedOffset1, seedOffset1),
    });
    editor2.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: editor2.getInteractionFrame().id,
      selection: selectionForBlock(editor2.getInteractionFrame(), block2, seedOffset2, seedOffset2),
    });
    const down1 = editor1.dispatchInteraction({
      kind: 'geometryKeyboard',
      frameId: editor1.getInteractionFrame().id,
      key: 'ArrowDown',
    });
    const down2 = editor2.dispatchInteraction({
      kind: 'geometryKeyboard',
      frameId: editor2.getInteractionFrame().id,
      key: 'ArrowDown',
    });
    expect(down1.outcome.ok).toBe(true);
    expect(down2.outcome.ok).toBe(true);
    expect(editor1.getAccessibilityObservation().selection?.head.graphemeOffset).toBe(
      expectedOffset1
    );
    expect(editor2.getAccessibilityObservation().selection?.head.graphemeOffset).toBe(
      expectedOffset2
    );
    expect(editor1.getCaretGeometry()).not.toBeNull();
    expect(editor2.getCaretGeometry()).not.toBeNull();
    expect(editor1.getInteractionFrame().selection).not.toBeNull();
    expect(editor2.getInteractionFrame().selection).not.toBeNull();
    editor1.destroy();
    editor2.destroy();
    body1.remove();
    body2.remove();
  });
});
