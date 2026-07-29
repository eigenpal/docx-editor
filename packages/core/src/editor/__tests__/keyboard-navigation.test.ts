// Keyboard navigation geometry and planner tests (interactive-paginated-editing 5.5).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import type {
  InteractionFrame,
  InteractionHostMetrics,
  SemanticSelection,
} from '@docx-editor.dev/core-contract/contracts/interaction';
import { layoutBody } from '@docx-editor.dev/engine-layout';
import { toDisplayPages } from '../display-bridge.ts';
import { InteractionFrameStore } from '../interaction-frame.ts';
import { deriveCaretGeometry, deriveSelectionGeometry } from '../interaction-geometry.ts';
import { buildLineCatalog, caretContentX, pageRelativeY } from '../line-catalog.ts';
import { planKeyboardNavigation, selectionCollapsed } from '../keyboard-navigation.ts';
import { horizontalTransitionStopsForBlock } from '../navigation-stops.ts';
import { commitNavigationSessionAfterExecution } from '../navigation-session.ts';
import { planInteraction } from '../interaction-planner.ts';
import { executeInteractionPlan } from '../interaction-executor.ts';
import type { NavigationGeometry } from '../navigation-geometry.ts';
import { emptyNavigationGeometry } from '../navigation-geometry.ts';
import { createTestEditor as createEditor } from './create-test-editor.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/contracts/editor';
import { createEditableParagraphFixture } from '../../../../engine-editor/browser/fixtures.ts';
import {
  LAYOUT,
  modelWith,
  modelWithParagraphTableParagraph,
  selectionForBlock,
} from './interaction-test-helpers.ts';

const METRICS: InteractionHostMetrics = {
  clientOrigin: { x: 0, y: 0 },
  scrollOffset: { x: 0, y: 0 },
  zoom: 1,
};

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

interface FrameBundle {
  readonly frame: InteractionFrame;
  readonly navigation: NavigationGeometry;
}

function frameWithSelection(
  texts: string[],
  headOffset: number,
  anchorOffset = headOffset,
  layout: Parameters<typeof layoutBody>[1] = LAYOUT
): FrameBundle {
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
  const selection = selectionForBlock(base, blockId, anchorOffset, headOffset);
  const caret = deriveCaretGeometry(base, selection.head);
  const selectionGeometry = deriveSelectionGeometry(base, selection);
  const frame = store.publishSelection({
    modelRevision: 1,
    layoutRevision: base.revisions.layoutRevision,
    selection,
    caret: caret ?? null,
    selectionGeometry: selectionGeometry.ok ? selectionGeometry.value : null,
    focus: { scope: { kind: 'body' }, focused: true },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: caret?.pageIndex ?? 0 },
  });
  return { frame, navigation: store.getNavigationGeometry(frame.id) };
}

function multiBlockFrame(
  texts: readonly string[],
  blockIndex: number,
  offset: number
): FrameBundle {
  const model = modelWith([...texts]);
  const layoutResult = layoutBody(model, LAYOUT);
  const bridged = toDisplayPages(model, layoutResult.pages);
  const blockId = bridged.semanticIndex.stories[0]!.blocks[blockIndex]!.identity.blockId;
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
  const caret = deriveCaretGeometry(base, selection.head);
  const frame = store.publishSelection({
    modelRevision: 1,
    layoutRevision: base.revisions.layoutRevision,
    selection,
    caret: caret ?? null,
    selectionGeometry: null,
    focus: { scope: { kind: 'body' }, focused: true },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: caret?.pageIndex ?? 0 },
  });
  return { frame, navigation: store.getNavigationGeometry(frame.id) };
}

function frameBundleFromPublish(
  model: Parameters<typeof publishFrame>[0],
  options?: Parameters<typeof publishFrame>[1]
): FrameBundle {
  const layout = layoutBody(model, options?.layout ?? LAYOUT);
  const bridged = toDisplayPages(model, layout.pages);
  const store = new InteractionFrameStore();
  const frame = store.publishLayout({
    modelRevision: 1,
    resourceEpoch: 0,
    configurationEpoch: 0,
    display: bridged.display,
    semanticIndex: bridged.semanticIndex,
    navigationGeometry: bridged.navigationGeometry,
    pageGapPx: options?.pageGapPx,
    selection: null,
    caret: null,
    selectionGeometry: null,
    focus: { scope: { kind: 'body' }, focused: false },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: 0 },
  });
  return { frame, navigation: store.getNavigationGeometry(frame.id) };
}

function keyboardIntent(key: string, frame: InteractionFrame, shiftKey = false) {
  return {
    kind: 'geometryKeyboard' as const,
    frameId: frame.id,
    key,
    shiftKey,
  };
}

function plan(
  bundle: FrameBundle,
  key: string,
  shiftKey = false,
  session: import('../navigation-session.ts').NavigationSession | null = null,
  texts: string[] = ['']
) {
  const textByBlock = new Map<string, string>();
  const blocks = bundle.frame.semanticIndex.stories[0]?.blocks ?? [];
  blocks.forEach((block, index) => {
    textByBlock.set(block.identity.blockId, texts[index] ?? texts[0] ?? '');
  });
  return planKeyboardNavigation({
    frame: bundle.frame,
    navigation: bundle.navigation,
    intent: keyboardIntent(key, bundle.frame, shiftKey),
    priorSession: session,
    documentGeneration: 1,
    modelRevision: bundle.frame.revisions.modelRevision,
    paragraphText: (identity) => textByBlock.get(identity.blockId) ?? texts[0] ?? '',
  });
}

describe('keyboard navigation (task 5.5)', () => {
  test('horizontal grapheme navigation skips surrogate/combining internal stops', () => {
    const combining = frameWithSelection(['e\u0301x'], 0);
    const combiningText = 'e\u0301x';
    const right = plan(combining, 'ArrowRight', false, null, [combiningText]);
    expect(right.plan.effects[0]?.kind).toBe('syncSelection');
    const emoji = frameWithSelection(['\uD83D\uDE00a'], 0);
    const zwj = frameWithSelection(['\uD83D\uDC68\u200D\uD83D\uDC69'], 0);
    for (const [seedFrame, text] of [
      [emoji, '\uD83D\uDE00a'],
      [zwj, '\uD83D\uDC68\u200D\uD83D\uDC69'],
    ] as const) {
      const block = seedFrame.frame.semanticIndex.stories[0]!.blocks[0]!;
      const storyId = seedFrame.frame.semanticIndex.stories[0]!.storyId;
      const stops = horizontalTransitionStopsForBlock(
        seedFrame.navigation,
        storyId,
        block.identity.blockId,
        block.graphemeCount
      ).map((s) => s.graphemeOffset);
      let currentFrame = seedFrame;
      for (let i = 1; i < stops.length; i += 1) {
        const result = plan(currentFrame, 'ArrowRight', false, null, [text]);
        const sync = result.plan.effects.find((e) => e.kind === 'syncSelection');
        expect(sync?.kind).toBe('syncSelection');
        if (sync?.kind !== 'syncSelection') throw new Error('sync');
        expect(sync.selection.head.graphemeOffset).toBe(stops[i]);
        currentFrame = withSelection(currentFrame, sync.selection);
      }
    }
  });

  test('block-edge continuation and read-only/table boundary rejection', () => {
    const twoPara = multiBlockFrame(['aaa', 'bbb'], 0, 3);
    const block0 = twoPara.frame.semanticIndex.stories[0]!.blocks[0]!;
    const forward = plan(twoPara, 'ArrowRight');
    const sync = forward.plan.effects.find((e) => e.kind === 'syncSelection');
    if (sync?.kind !== 'syncSelection') throw new Error('sync');
    expect(sync.selection.head.identity.blockId).toBe(
      twoPara.frame.semanticIndex.stories[0]!.blocks[1]!.identity.blockId
    );
    expect(sync.selection.head.graphemeOffset).toBe(0);

    const tableBundle = frameBundleFromPublish(
      modelWithParagraphTableParagraph('before', 'cell', 'after')
    );
    const beforeBlock = tableBundle.frame.semanticIndex.stories[0]!.blocks[0]!;
    const atEnd = selectionForBlock(tableBundle.frame, beforeBlock.identity.blockId, 6, 6);
    const withSel = withSelection(
      {
        ...tableBundle,
        frame: { ...tableBundle.frame, focus: { scope: { kind: 'body' }, focused: true } },
      },
      atEnd
    );
    const blocked = plan(withSel, 'ArrowRight');
    expect(blocked.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
  });

  test('non-collapsed collapse direction and shift anchor preservation', () => {
    const bundle = frameWithSelection(['abcd'], 1, 3);
    expect(selectionCollapsed(bundle.frame, bundle.frame.selection!)).toBe(false);
    const left = plan(bundle, 'ArrowLeft');
    const leftSync = left.plan.effects.find((e) => e.kind === 'syncSelection');
    if (leftSync?.kind !== 'syncSelection') throw new Error('sync');
    expect(leftSync.selection.anchor.graphemeOffset).toBe(1);
    expect(leftSync.selection.head.graphemeOffset).toBe(1);

    const right = plan(frameWithSelection(['abcd'], 1, 3), 'ArrowRight');
    const rightSync = right.plan.effects.find((e) => e.kind === 'syncSelection');
    if (rightSync?.kind !== 'syncSelection') throw new Error('sync');
    expect(rightSync.selection.head.graphemeOffset).toBe(3);

    const shift = plan(frameWithSelection(['abcd'], 1, 1), 'ArrowRight', true);
    const shiftSync = shift.plan.effects.find((e) => e.kind === 'syncSelection');
    if (shiftSync?.kind !== 'syncSelection') throw new Error('sync');
    expect(shiftSync.selection.anchor.graphemeOffset).toBe(1);
    expect(shiftSync.selection.head.graphemeOffset).toBe(2);
  });

  test('wrapped paragraph line catalog, Home/End target visual line edges not paragraph edges', () => {
    const narrow = { ...LAYOUT, pageWidth: 3500 };
    const text = 'The quick brown fox jumps over the lazy dog';
    const bundle = frameWithSelection([text], 12, 12, narrow);
    const catalog = buildLineCatalog(bundle.frame, bundle.navigation);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error('catalog');
    expect(catalog.lines.length).toBeGreaterThan(3);
    const block = bundle.frame.semanticIndex.stories[0]!.blocks[0]!;
    const home = plan(bundle, 'Home');
    const homeSync = home.plan.effects.find((e) => e.kind === 'syncSelection');
    if (homeSync?.kind !== 'syncSelection') throw new Error('home');
    expect(homeSync.selection.head.graphemeOffset).toBeLessThan(12);

    const end = plan(bundle, 'End');
    const endSync = end.plan.effects.find((e) => e.kind === 'syncSelection');
    if (endSync?.kind !== 'syncSelection') throw new Error('end');
    expect(endSync.selection.head.graphemeOffset).toBeLessThan(block.graphemeCount);
    expect(endSync.selection.head.graphemeOffset).toBeGreaterThan(12);
  });

  test('ArrowUp/Down retains visual x across uneven wrapped lines', () => {
    const narrow = { ...LAYOUT, pageWidth: 3500 };
    const bundle = frameWithSelection(['The quick brown fox jumps'], 12, 12, narrow);
    const firstX = caretContentX(bundle.frame, bundle.frame.selection!.head, bundle.navigation);
    expect(typeof firstX).toBe('number');
    const down1 = plan(bundle, 'ArrowDown');
    expect(down1.navigation.nextSessionOnSuccess?.visualAdvanceX).toBe(firstX);
    const downSync = down1.plan.effects.find((e) => e.kind === 'syncSelection');
    if (downSync?.kind !== 'syncSelection') throw new Error('down');
    const frame2 = withSelection(bundle, downSync.selection);
    const down2 = plan(frame2, 'ArrowDown', false, down1.navigation.nextSessionOnSuccess);
    expect(down2.navigation.nextSessionOnSuccess?.visualAdvanceX).toBe(firstX);
    const down2Sync = down2.plan.effects.find((e) => e.kind === 'syncSelection');
    if (down2Sync?.kind !== 'syncSelection') throw new Error('down2');
    const frame3 = withSelection(frame2, down2Sync.selection);
    const up = plan(frame3, 'ArrowUp', false, down2.navigation.nextSessionOnSuccess);
    expect(up.navigation.nextSessionOnSuccess?.visualAdvanceX).toBe(firstX);
  });

  test('PageUp/PageDown preserve relative page position and reject absent pages', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const bundle = frameWithSelection([words], 120, 120, { ...LAYOUT, pageHeight: 4000 });
    expect(bundle.frame.display.length).toBeGreaterThan(1);
    const caretPage =
      deriveCaretGeometry(bundle.frame, bundle.frame.selection!.head)?.pageIndex ?? 0;
    const seedX = caretContentX(bundle.frame, bundle.frame.selection!.head, bundle.navigation);
    const down = plan(bundle, 'PageDown');
    const downSync = down.plan.effects.find((e) => e.kind === 'syncSelection');
    if (downSync?.kind !== 'syncSelection') throw new Error('page down');
    expect(down.navigation.nextSessionOnSuccess?.visualAdvanceX).toBe(seedX);
    const nextCaret = deriveCaretGeometry(bundle.frame, downSync.selection.head);
    expect(nextCaret?.pageIndex).toBe(caretPage + 1);
    const seedRelativeY = pageRelativeY(
      bundle.frame,
      caretPage,
      deriveCaretGeometry(bundle.frame, bundle.frame.selection!.head)!.rect.y +
        deriveCaretGeometry(bundle.frame, bundle.frame.selection!.head)!.rect.height / 2
    );
    const destRelativeY = pageRelativeY(
      bundle.frame,
      nextCaret!.pageIndex,
      nextCaret!.rect.y + nextCaret!.rect.height / 2
    );
    expect(destRelativeY).toBeCloseTo(seedRelativeY!, 5);

    const stacked = frameBundleFromPublish(modelWith(['only']), { layout: LAYOUT });
    const top = withSelection(
      {
        ...stacked,
        frame: { ...stacked.frame, focus: { scope: { kind: 'body' }, focused: true } },
      },
      selectionForBlock(
        stacked.frame,
        stacked.frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId,
        0,
        0
      )
    );
    expect(plan(top, 'PageUp').plan.effects[0]).toMatchObject({
      kind: 'reject',
      code: 'invalidTarget',
    });
  });

  test('empty, trailing, and whitespace ownership lines remain navigable', () => {
    const empty = frameWithSelection([''], 0, 0);
    expect(plan(empty, 'ArrowRight').plan.effects[0]?.kind).toBe('syncSelection');
    const trailing = frameWithSelection(['ab '], 3, 3);
    expect(plan(trailing, 'ArrowLeft').plan.effects[0]?.kind).toBe('syncSelection');
    const ws = frameWithSelection(['ab  cd'], 2, 2);
    expect(plan(ws, 'Home').plan.effects[0]?.kind).toBe('syncSelection');
  });

  test('mixed-direction geometry rejects keyboard navigation fail-closed', () => {
    const bundle = frameWithSelection(['abc'], 1, 1);
    const page = bundle.frame.display[0]!;
    const mixed: FrameBundle = {
      navigation: bundle.navigation,
      frame: {
        ...bundle.frame,
        display: [
          {
            ...page,
            items: page.items.map((item) => {
              if (item.kind !== 'text') return item;
              return {
                ...item,
                clusters: item.clusters.map((cluster, index) => ({
                  ...cluster,
                  direction: index === 0 ? ('rtl' as const) : ('ltr' as const),
                })),
              };
            }),
          },
        ],
      },
    };
    const mixedSel = withSelection(mixed, mixed.frame.selection!);
    expect(plan(mixedSel, 'ArrowLeft').plan.effects[0]).toMatchObject({
      kind: 'reject',
      code: 'unsupported',
    });
  });

  test('rejection leaves selection/session unchanged through executor commit path', () => {
    const bundle = frameWithSelection(['abc'], 1, 1);
    const bad = plan(bundle, 'PageUp');
    const execution = executeInteractionPlan(
      {
        syncSemanticSelection: () => ({
          ok: false,
          code: 'invalidTarget',
          reason: 'test',
          frameId: bundle.frame.id,
        }),
        focus: () => ({ ok: true, value: undefined, frameId: bundle.frame.id }),
        blur: () => {},
        execCommand: () => ({ ok: false, code: 'unsupported', reason: 'no' }),
        delegateNativeInput: () => ({ ok: true, value: undefined, frameId: bundle.frame.id }),
        publishSelectionOverlay: () => {},
        currentFrameId: () => bundle.frame.id,
      },
      bad.plan
    );
    expect(execution.outcome.ok).toBe(false);
    expect(commitNavigationSessionAfterExecution(bad.navigation, execution).session).toEqual(
      bad.navigation.priorSession
    );
  });

  test('strong Hebrew and Arabic content rejects keyboard navigation fail-closed', () => {
    for (const text of ['\u05d0\u05d1\u05d2', '\u0627\u0644\u0633\u0644\u0627\u0645']) {
      const frame = frameWithSelection([text], 1);
      const result = plan(frame, 'ArrowLeft', false, null, [text]);
      expect(result.plan.effects[0]).toMatchObject({
        kind: 'reject',
        code: 'unsupported',
        reason: expect.stringContaining('strong RTL'),
      });
    }
  });

  test('uniform RTL cluster metadata still rejects strong RTL script fail-closed', () => {
    const text = '\u05d0\u05d1\u05d2';
    const bundle = frameWithSelection([text], 1);
    const page = bundle.frame.display[0]!;
    const rtlUniform: FrameBundle = {
      navigation: bundle.navigation,
      frame: {
        ...bundle.frame,
        display: [
          {
            ...page,
            items: page.items.map((item) => {
              if (item.kind !== 'text') return item;
              return {
                ...item,
                interaction: { ...item.interaction, writingDirection: 'rtl' as const },
                clusters: item.clusters.map((cluster) => ({
                  ...cluster,
                  direction: 'rtl' as const,
                })),
              };
            }),
          },
        ],
      },
    };
    const result = plan(
      withSelection(rtlUniform, rtlUniform.frame.selection!),
      'ArrowLeft',
      false,
      null,
      [text]
    );
    expect(result.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
    expect(result.plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
  });

  test('unfocused frame rejects geometry keyboard before sync', () => {
    const bundle = frameWithSelection(['abc'], 1);
    const unfocused: FrameBundle = {
      ...bundle,
      frame: { ...bundle.frame, focus: { scope: { kind: 'body' as const }, focused: false } },
    };
    const result = plan(unfocused, 'ArrowRight');
    expect(result.plan.effects[0]).toMatchObject({ kind: 'reject', code: 'invalidTarget' });
    expect(result.plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
  });

  test('planInteraction shared preconditions reject stale frame pending layout read-only and missing metrics', () => {
    const bundle = frameWithSelection(['abc'], 1);
    const base = {
      frame: bundle.frame,
      editable: true,
      readOnly: false,
      hostMetrics: METRICS,
      modelRevision: 1,
      activeScope: { kind: 'body' as const },
      navigationSession: null,
      documentGeneration: 1,
      resolveParagraphText: (identity: { blockId: string }) => 'abc',
      navigationGeometry: bundle.navigation,
    };
    const intent = {
      kind: 'geometryKeyboard' as const,
      frameId: bundle.frame.id,
      key: 'ArrowRight',
    };
    expect(
      planInteraction(base, { ...intent, frameId: { value: bundle.frame.id.value - 1 } }).effects[0]
    ).toMatchObject({ code: 'staleFrame' });

    const pending = {
      ...bundle.frame,
      completeness: { kind: 'pending' as const, targetModelRevision: 1 },
    };
    expect(planInteraction({ ...base, frame: pending }, intent).effects[0]).toMatchObject({
      code: 'pendingLayout',
    });
    expect(
      planInteraction({ ...base, readOnly: true, editable: false }, intent).effects[0]
    ).toMatchObject({
      code: 'readOnly',
    });
    expect(planInteraction({ ...base, hostMetrics: undefined }, intent).effects[0]).toMatchObject({
      code: 'invalidTarget',
    });
  });

  test('malformed keyboard modifiers reject unsupported', () => {
    const bundle = frameWithSelection(['abc'], 1);
    for (const intent of [
      {
        kind: 'geometryKeyboard' as const,
        frameId: bundle.frame.id,
        key: 'ArrowRight',
        ctrlKey: true,
      },
      {
        kind: 'geometryKeyboard' as const,
        frameId: bundle.frame.id,
        key: 'ArrowRight',
        metaKey: true,
      },
      {
        kind: 'geometryKeyboard' as const,
        frameId: bundle.frame.id,
        key: 'ArrowRight',
        altKey: true,
      },
      {
        kind: 'geometryKeyboard' as const,
        frameId: bundle.frame.id,
        key: 'ArrowRight',
        shiftKey: 'true' as unknown as boolean,
      },
      {
        kind: 'geometryKeyboard' as const,
        frameId: bundle.frame.id,
        key: 'ArrowRight',
        ctrlKey: 1 as unknown as boolean,
      },
      {
        kind: 'geometryKeyboard' as const,
        frameId: bundle.frame.id,
        key: 'ArrowRight',
        altKey: null as unknown as boolean,
      },
    ]) {
      const planned = planInteraction(
        {
          frame: bundle.frame,
          editable: true,
          readOnly: false,
          hostMetrics: METRICS,
          modelRevision: 1,
          activeScope: { kind: 'body' },
          navigationSession: null,
          documentGeneration: 1,
          resolveParagraphText: (identity: { blockId: string }) => identity.blockId,
          navigationGeometry: bundle.navigation,
        },
        intent
      );
      expect(planned.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
      expect(planned.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
    }
  });

  test('createEditor rejects read-only geometry keyboard with immutability', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      mode: 'view',
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const before = frame.id.value;
    const revision = editor.getDocumentHandle().revision;
    const result = editor.dispatchInteraction({
      kind: 'geometryKeyboard',
      frameId: frame.id,
      key: 'ArrowRight',
    });
    expect(result.outcome.ok).toBe(false);
    expect(result.outcome.code).toBe('readOnly');
    expect(editor.getInteractionFrame().id.value).toBe(before);
    expect(editor.getDocumentHandle().revision).toBe(revision);
    editor.destroy();
    body.remove();
  });

  test('createEditor binding failure leaves selection unchanged', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'E',
    });
    const frame = editor.getInteractionFrame();
    const blockId = editor.getAccessibilityObservation().entries[0]!.identity.blockId;
    editor.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: frame.id,
      selection: selectionForBlock(frame, blockId, 0, 0),
    });
    const offsetBefore = editor.getAccessibilityObservation().selection?.head.graphemeOffset;
    const stale = editor.dispatchInteraction({
      kind: 'geometryKeyboard',
      frameId: { value: editor.getInteractionFrame().id.value - 1 },
      key: 'ArrowRight',
    });
    expect(stale.outcome.ok).toBe(false);
    expect(editor.getAccessibilityObservation().selection?.head.graphemeOffset).toBe(offsetBefore);
    editor.destroy();
    body.remove();
  });

  test('dispatchInteraction end-to-end preserves model revision and publishes overlay', () => {
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
    editor.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: frame.id,
      selection: selectionForBlock(frame, blockId, 0, 0),
    });
    const before = editor.getInteractionFrame().id.value;
    const nav = editor.dispatchInteraction({
      kind: 'geometryKeyboard',
      frameId: editor.getInteractionFrame().id,
      key: 'ArrowRight',
    });
    expect(nav.outcome.ok).toBe(true);
    expect(editor.getDocumentHandle().revision).toBe(revisionBefore);
    expect(editor.getInteractionFrame().id.value).toBeGreaterThan(before);
    expect(editor.getAccessibilityObservation().selection?.head.graphemeOffset).toBe(1);
    editor.destroy();
    body.remove();
  });

  test('two editor instances retain independent visual-advance landings', () => {
    const body1 = document.createElement('div');
    const body2 = document.createElement('div');
    document.body.append(body1, body2);
    const narrowDoc = createEditableParagraphFixture();
    const editor1 = createEditor({
      host: hostWith(body1),
      document: narrowDoc,
      accessibleName: 'A',
    });
    const editor2 = createEditor({
      host: hostWith(body2),
      document: createEditableParagraphFixture(),
      accessibleName: 'B',
    });
    const frame1 = editor1.getInteractionFrame();
    const block1 = editor1.getAccessibilityObservation().entries[0]!.identity.blockId;
    editor1.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: frame1.id,
      selection: selectionForBlock(frame1, block1, 12, 12),
    });
    const xBefore1 = editor1.getCaretGeometry()?.rect.x;
    editor1.dispatchInteraction({
      kind: 'geometryKeyboard',
      frameId: editor1.getInteractionFrame().id,
      key: 'ArrowDown',
    });
    editor1.dispatchInteraction({
      kind: 'geometryKeyboard',
      frameId: editor1.getInteractionFrame().id,
      key: 'ArrowUp',
    });
    const xAfter1 = editor1.getCaretGeometry()?.rect.x;
    expect(xBefore1).toBeDefined();
    expect(xAfter1).toBe(xBefore1);

    const frame2 = editor2.getInteractionFrame();
    const block2 = editor2.getAccessibilityObservation().entries[0]!.identity.blockId;
    editor2.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: frame2.id,
      selection: selectionForBlock(frame2, block2, 0, 0),
    });
    const xBefore2 = editor2.getAccessibilityObservation().selection?.head.graphemeOffset;
    editor2.dispatchInteraction({
      kind: 'geometryKeyboard',
      frameId: editor2.getInteractionFrame().id,
      key: 'ArrowRight',
    });
    const xAfter2 = editor2.getAccessibilityObservation().selection?.head.graphemeOffset;
    expect(xAfter2).toBe(1);
    expect(xAfter2).not.toBe(12);

    editor1.destroy();
    editor2.destroy();
    body1.remove();
    body2.remove();
  });
});

function withSelection(bundle: FrameBundle, selection: SemanticSelection): FrameBundle {
  const nextId = { value: bundle.frame.id.value + 1 };
  const bound = { ...selection, frameId: nextId };
  const caret = deriveCaretGeometry(bundle.frame, bound.head);
  const selectionGeometry = deriveSelectionGeometry(bundle.frame, bound);
  return {
    navigation: bundle.navigation,
    frame: {
      ...bundle.frame,
      id: nextId,
      selection: bound,
      caret: caret ?? null,
      selectionGeometry: selectionGeometry.ok ? selectionGeometry.value : null,
      focus: bundle.frame.focus,
    },
  };
}
