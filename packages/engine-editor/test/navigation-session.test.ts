// Navigation session commit and reset tests (interactive-paginated-editing 5.5).

import { describe, expect, test } from 'bun:test';
import type { InteractionFrame } from '@docx-editor.dev/core-contract/interaction';
import { layoutBody } from '@docx-editor.dev/engine-layout';
import { toDisplayPages } from '../src/display-bridge.ts';
import { InteractionFrameStore } from '../src/interaction-frame.ts';
import { deriveCaretGeometry } from '../src/interaction-geometry.ts';
import { planKeyboardNavigation } from '../src/keyboard-navigation.ts';
import type { NavigationGeometry } from '../src/navigation-geometry.ts';
import {
  buildNavigationSession,
  commitNavigationSessionAfterExecution,
  navigationSessionClearsOnSuccess,
  sessionMatchesSelection,
} from '../src/navigation-session.ts';
import { executeInteractionPlan } from '../src/interaction-executor.ts';
import { LAYOUT, modelWith, selectionForBlock } from './interaction-test-helpers.ts';

const DOC_GEN = 1;

interface FrameBundle {
  readonly frame: InteractionFrame;
  readonly navigation: NavigationGeometry;
}

function plan(bundle: FrameBundle, key: string, session = null, texts: string[] = ['probe']) {
  const textByBlock = new Map<string, string>();
  bundle.frame.semanticIndex.stories[0]?.blocks.forEach((block, index) => {
    textByBlock.set(block.identity.blockId, texts[index] ?? texts[0] ?? '');
  });
  return planKeyboardNavigation({
    frame: bundle.frame,
    navigation: bundle.navigation,
    intent: { kind: 'geometryKeyboard', frameId: bundle.frame.id, key },
    priorSession: session,
    documentGeneration: DOC_GEN,
    modelRevision: bundle.frame.revisions.modelRevision,
    paragraphText: (identity) => textByBlock.get(identity.blockId) ?? texts[0] ?? '',
  });
}

function frameWithSelection(texts: string[], offset: number, layout = LAYOUT): FrameBundle {
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

describe('navigation session (task 5.5)', () => {
  test('horizontal navigation clears visual-advance session on success', () => {
    const narrow = { ...LAYOUT, pageWidth: 3500 };
    const bundle = frameWithSelection(['The quick brown fox jumps over'], 10, narrow);
    const down = plan(bundle, 'ArrowDown', null, ['The quick brown fox jumps over']);
    expect(down.navigation.nextSessionOnSuccess).not.toBeNull();
    const right = plan(bundle, 'ArrowRight', down.navigation.nextSessionOnSuccess, ['The quick brown fox jumps over']);
    expect(right.navigation.nextSessionOnSuccess).toBeNull();
  });

  test('failed navigation retains prior session through commit helper', () => {
    const bundle = frameWithSelection(['abc'], 1);
    const prior = buildNavigationSession(bundle.frame, bundle.frame.selection!, 42, DOC_GEN, 1);
    const planned = plan(bundle, 'PageUp', prior, ['abc']);
    const commit = commitNavigationSessionAfterExecution(planned.navigation, {
      outcome: { ok: false, code: 'invalidTarget', reason: 'test', frameId: bundle.frame.id },
      hostEffects: [],
    });
    expect(commit.session?.visualAdvanceX).toBe(42);
  });

  test('layout-only frame replacement preserves session when selection identity matches', () => {
    const text = ['vertical session probe text here'];
    const model = modelWith(text);
    const store = new InteractionFrameStore();
    const narrow = layoutBody(model, { ...LAYOUT, pageWidth: 3500 });
    const narrowBridged = toDisplayPages(model, narrow.pages);
    const narrowFrame = store.publishLayout({
      modelRevision: 1,
      resourceEpoch: 0,
      configurationEpoch: 0,
      display: narrowBridged.display,
      semanticIndex: narrowBridged.semanticIndex,
      navigationGeometry: narrowBridged.navigationGeometry,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: true },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });
    const narrowNav = store.getNavigationGeometry(narrowFrame.id);
    const blockId = narrowFrame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const selection = selectionForBlock(narrowFrame, blockId, 4, 4);
    const seeded = store.publishSelection({
      modelRevision: 1,
      layoutRevision: narrowFrame.revisions.layoutRevision,
      selection,
      caret: deriveCaretGeometry(narrowFrame, selection.head),
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: true },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });
    const down = plan({ frame: seeded, navigation: narrowNav }, 'ArrowDown', null, text);
    expect(down.navigation.nextSessionOnSuccess).not.toBeNull();
    const wide = layoutBody(model, LAYOUT);
    const wideBridged = toDisplayPages(model, wide.pages);
    const wideFrame = store.publishLayout({
      modelRevision: 1,
      resourceEpoch: 0,
      configurationEpoch: 0,
      display: wideBridged.display,
      semanticIndex: wideBridged.semanticIndex,
      navigationGeometry: wideBridged.navigationGeometry,
      selection: null,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: true },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });
    const wideNav = store.getNavigationGeometry(wideFrame.id);
    const downSync = down.plan.effects.find((e) => e.kind === 'syncSelection');
    const reboundSelection =
      downSync?.kind === 'syncSelection'
        ? { ...downSync.selection, frameId: wideFrame.id }
        : { ...selection, frameId: wideFrame.id };
    const rebound = store.publishSelection({
      modelRevision: 1,
      layoutRevision: wideFrame.revisions.layoutRevision,
      selection: reboundSelection,
      caret: null,
      selectionGeometry: null,
      focus: { scope: { kind: 'body' }, focused: true },
      composition: { active: false, scope: null },
      currentPage: { viewport: 0, caret: 0 },
    });
    const downAgain = plan({ frame: rebound, navigation: wideNav }, 'ArrowDown', down.navigation.nextSessionOnSuccess, text);
    expect(downAgain.navigation.nextSessionOnSuccess?.visualAdvanceX).toBe(
      down.navigation.nextSessionOnSuccess?.visualAdvanceX,
    );
  });

  test('document generation mismatch prevents session reuse', () => {
    const bundle = frameWithSelection(['abc'], 1);
    const session = buildNavigationSession(bundle.frame, bundle.frame.selection!, 10, DOC_GEN, 1);
    expect(sessionMatchesSelection(session, bundle.frame.selection!, bundle.frame, DOC_GEN + 1, 1)).toBe(false);
  });

  test('model revision mismatch prevents session reuse', () => {
    const bundle = frameWithSelection(['abc'], 1);
    const session = buildNavigationSession(bundle.frame, bundle.frame.selection!, 10, DOC_GEN, 1);
    expect(sessionMatchesSelection(session, bundle.frame.selection!, bundle.frame, DOC_GEN, 2)).toBe(false);
  });

  test('semantic selection and pointer intents reset session policy', () => {
    expect(navigationSessionClearsOnSuccess('semanticSelection')).toBe(true);
    expect(navigationSessionClearsOnSuccess('click')).toBe(true);
    expect(navigationSessionClearsOnSuccess('pointerDown')).toBe(true);
    expect(navigationSessionClearsOnSuccess('pointerUp')).toBe(true);
    expect(navigationSessionClearsOnSuccess('geometryKeyboard')).toBe(false);
  });

  test('rejected click intent leaves navigation session unchanged via executor commit', () => {
    const bundle = frameWithSelection(['abc'], 1);
    const prior = buildNavigationSession(bundle.frame, bundle.frame.selection!, 99, DOC_GEN, 1);
    const navigation = { priorSession: prior, nextSessionOnSuccess: null };
    const execution = executeInteractionPlan(
      {
        syncSemanticSelection: () => ({ ok: false, code: 'invalidTarget', reason: 'test', frameId: bundle.frame.id }),
        focus: () => ({ ok: false, code: 'unsupported', reason: 'focus failed', frameId: bundle.frame.id }),
        blur: () => {},
        execCommand: () => ({ ok: false, code: 'unsupported', reason: 'no' }),
        delegateNativeInput: () => ({ ok: true, value: undefined, frameId: bundle.frame.id }),
        publishSelectionOverlay: () => {},
        currentFrameId: () => bundle.frame.id,
      },
      {
        frameId: bundle.frame.id,
        effects: [
          { kind: 'syncSelection', frameId: bundle.frame.id, selection: bundle.frame.selection! },
          { kind: 'focus', frameId: bundle.frame.id },
        ],
        navigation,
      },
    );
    expect(execution.outcome.ok).toBe(false);
    expect(commitNavigationSessionAfterExecution(navigation, execution).session?.visualAdvanceX).toBe(99);
  });

  test('scope identity mismatch prevents session reuse', () => {
    const bundle = frameWithSelection(['abc'], 1);
    const session = buildNavigationSession(bundle.frame, bundle.frame.selection!, 10, DOC_GEN, 1);
    const otherScope = { ...bundle.frame.selection!, scope: { kind: 'note' as const, id: 'n1' } };
    expect(sessionMatchesSelection(session, otherScope, bundle.frame, DOC_GEN, 1)).toBe(false);
  });
});
