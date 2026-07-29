// Adversarial interaction-frame coherence (interactive-paginated-editing 2.5).
// Proves deep immutability, selection-only frames, pending retention, cancellation,
// epoch/model/selection dimensions, and that adapter reads never observe mixed revisions.

import { describe, expect, test } from 'bun:test';
import {
  InteractionFrameStore,
  emptyInteractionFrame,
  emptySemanticIndex,
  frameMembersCoherent,
  deepFreezeFrame,
  deepFreezeValue,
  adapterReadSnapshot,
  readsAreCoherent,
  type PublishLayoutInput,
  type PublishSelectionInput,
} from '../interaction-frame.ts';
import type { DisplayPage } from '@docx-editor.dev/core-contract/contracts/geometry';
import type {
  InteractionFrameId,
  SemanticPositionIndex,
} from '@docx-editor.dev/core-contract/contracts/interaction';
import { buildSemanticIndex } from '../semantic-index.ts';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type ParagraphRecord,
} from '@docx-editor.dev/core-contract/store';

const HUMAN = ORIGIN_IDS.mutationHuman;

function sampleSemanticIndex(): SemanticPositionIndex {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const pid = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: 'Hello' }));
  return buildSemanticIndex(store.currentModel);
}

const RICH_PAGE: DisplayPage = {
  index: 0,
  box: { x: 0, y: 0, width: 816, height: 1056 },
  items: [
    {
      kind: 'text',
      box: { x: 72, y: 96, width: 200, height: 20 },
      runs: [
        {
          text: 'Hello',
          box: { x: 72, y: 96, width: 50, height: 20 },
          fontFamily: 'Helvetica',
          fontSizePx: 16,
          color: { kind: 'auto' },
        },
      ],
      semantic: {
        scope: { kind: 'body' },
        identity: { storyId: 'story-1', blockId: 'block-1' },
        graphemeFrom: 0,
        graphemeTo: 5,
        utf16From: 0,
        utf16To: 5,
      },
      clusters: [],
      scope: { kind: 'body' },
      docFrom: 0,
      docTo: 5,
      blockId: 1,
    },
  ],
};

const PAGE: DisplayPage = {
  index: 0,
  box: { x: 0, y: 0, width: 816, height: 1056 },
  items: [],
};

function layoutInput(
  modelRevision: number,
  over: Partial<PublishLayoutInput> = {},
  display: readonly DisplayPage[] = [PAGE],
  semanticIndex: SemanticPositionIndex = emptySemanticIndex('story-1')
): PublishLayoutInput {
  return {
    modelRevision,
    resourceEpoch: 0,
    configurationEpoch: 0,
    display,
    semanticIndex,
    selection: null,
    caret: null,
    selectionGeometry: null,
    focus: { scope: { kind: 'body' }, focused: false },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: 0 },
    ...over,
  };
}

function textTarget() {
  return {
    kind: 'text' as const,
    scope: { kind: 'body' as const },
    identity: { storyId: 'story-1', blockId: 'block-1' },
    graphemeOffset: 3,
    affinity: 'downstream' as const,
  };
}

function syntheticSelectionInput(
  layout: ReturnType<InteractionFrameStore['publishLayout']>,
  modelRevision = layout.revisions.modelRevision
): PublishSelectionInput {
  const target = textTarget();
  const frameId: InteractionFrameId = layout.id;
  return {
    modelRevision,
    layoutRevision: layout.revisions.layoutRevision,
    selection: {
      frameId,
      scope: { kind: 'body' },
      anchor: target,
      head: target,
    },
    caret: {
      frameId,
      rect: { x: 72, y: 96, width: 1, height: 20 },
      pageIndex: 0,
      writingDirection: 'ltr',
    },
    selectionGeometry: {
      frameId,
      selection: {
        frameId,
        scope: { kind: 'body' },
        anchor: target,
        head: target,
      },
      rects: [{ x: 72, y: 96, width: 40, height: 20 }],
      pageIndices: [0],
      collapsed: true,
    },
    focus: { scope: { kind: 'body' }, focused: true },
    composition: { active: true, scope: { kind: 'body' } },
    currentPage: { viewport: 0, caret: 0 },
  };
}

function expectMutationThrows(fn: () => void): void {
  expect(fn).toThrow();
}

describe('InteractionFrameStore — immutable coherent publication', () => {
  test('a complete layout publication replaces the frame atomically with one identity', () => {
    const store = new InteractionFrameStore();
    const frame = store.publishLayout(layoutInput(1));
    expect(frame.completeness).toEqual({ kind: 'complete' });
    expect(frame.revisions.modelRevision).toBe(1);
    expect(frame.revisions.layoutRevision).toBe(1);
    expect(frame.display).toEqual([expect.objectContaining({ index: 0 })]);
    expect(store.getFrame()?.id).toEqual(frame.id);
    expect(frameMembersCoherent(frame)).toBe(true);
  });

  test('published frames are deeply frozen including nested display/caret/selection members', () => {
    const store = new InteractionFrameStore();
    const layout = store.publishLayout(layoutInput(1, {}, [RICH_PAGE]));
    const frame = store.publishSelection(syntheticSelectionInput(layout));
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.display)).toBe(true);
    expect(Object.isFrozen(frame.display[0])).toBe(true);
    expect(Object.isFrozen(frame.display[0]!.box)).toBe(true);
    expect(Object.isFrozen(frame.display[0]!.items)).toBe(true);
    expect(Object.isFrozen(frame.display[0]!.items[0])).toBe(true);
    expect(Object.isFrozen(frame.display[0]!.items[0]!.box)).toBe(true);
    const run = RICH_PAGE.items[0]!.kind === 'text' ? RICH_PAGE.items[0]!.runs[0]! : null;
    expect(run).not.toBeNull();
    expect(
      Object.isFrozen(
        frame.display[0]!.items[0]!.kind === 'text' ? frame.display[0]!.items[0]!.runs : []
      )
    ).toBe(true);
    expect(Object.isFrozen(frame.caret)).toBe(true);
    expect(Object.isFrozen(frame.caret!.rect)).toBe(true);
    expect(Object.isFrozen(frame.selectionGeometry)).toBe(true);
    expect(Object.isFrozen(frame.selectionGeometry!.rects)).toBe(true);
    expect(Object.isFrozen(frame.selectionGeometry!.rects[0])).toBe(true);
    expect(Object.isFrozen(frame.selectionGeometry!.pageIndices)).toBe(true);
    expect(Object.isFrozen(frame.focus)).toBe(true);
    expect(Object.isFrozen(frame.composition)).toBe(true);
    expect(Object.isFrozen(frame.currentPage)).toBe(true);
    expect(Object.isFrozen(frame.completeness)).toBe(true);
    expectMutationThrows(() => {
      (frame.display as DisplayPage[]).push(PAGE);
    });
    expectMutationThrows(() => {
      (frame.display[0]!.items[0] as { box: { x: number } }).box.x = 999;
    });
    expectMutationThrows(() => {
      if (frame.display[0]!.items[0]!.kind === 'text') {
        (frame.display[0]!.items[0]!.runs[0] as { text: string }).text = 'x';
      }
    });
    expectMutationThrows(() => {
      (frame.caret!.rect as { x: number }).x = 999;
    });
    expectMutationThrows(() => {
      (frame.selectionGeometry!.pageIndices as number[]).push(9);
    });
    expectMutationThrows(() => {
      (frame.currentPage as { viewport: number }).viewport = 9;
    });
    expectMutationThrows(() => {
      (frame.completeness as { kind: string }).kind = 'x';
    });
  });

  test('selection-only publication reuses layout revision and display geometry', () => {
    const store = new InteractionFrameStore();
    const layout = store.publishLayout(layoutInput(1));
    const next = store.publishSelection(syntheticSelectionInput(layout));
    expect(next.revisions.layoutRevision).toBe(layout.revisions.layoutRevision);
    expect(next.revisions.modelRevision).toBe(1);
    expect(next.display).toBe(layout.display);
    expect(next.pageGeometry).toBe(layout.pageGeometry);
    expect(next.scrollGeometry).toBe(layout.scrollGeometry);
    expect(next.id.value).not.toBe(layout.id.value);
    expect(next.caret!.frameId).toEqual(next.id);
    expect(next.selection!.frameId).toEqual(next.id);
    expect(next.selectionGeometry!.frameId).toEqual(next.id);
    expect(frameMembersCoherent(next)).toBe(true);
  });

  test('model-revision commits publish a new layout revision atomically', () => {
    const store = new InteractionFrameStore();
    const first = store.publishLayout(layoutInput(1));
    const second = store.publishLayout(layoutInput(2));
    expect(second.revisions.modelRevision).toBe(2);
    expect(second.revisions.layoutRevision).toBeGreaterThan(first.revisions.layoutRevision);
    expect(second.id.value).not.toBe(first.id.value);
    expect(second.display).not.toBe(first.display);
  });

  test('resource and configuration epoch bumps produce new layout revisions', () => {
    const store = new InteractionFrameStore();
    const base = store.publishLayout(layoutInput(1));
    const resource = store.publishLayout(layoutInput(1, { resourceEpoch: 2 }));
    const config = store.publishLayout(layoutInput(1, { configurationEpoch: 3 }));
    expect(resource.revisions.resourceEpoch).toBe(2);
    expect(config.revisions.configurationEpoch).toBe(3);
    expect(config.revisions.layoutRevision).toBeGreaterThan(resource.revisions.layoutRevision);
    expect(config.revisions.layoutRevision).toBeGreaterThan(base.revisions.layoutRevision);
  });

  test('while layout is pending the last complete frame is retained with pending diagnostics', () => {
    const store = new InteractionFrameStore();
    const first = store.publishLayout(layoutInput(1));
    store.beginPendingLayout(2);
    const during = store.getFrame()!;
    expect(during.id).toEqual(first.id);
    expect(during.display).toBe(first.display);
    expect(during.completeness).toEqual({
      kind: 'pending',
      awaiting: 'layout',
      targetModelRevision: 2,
    });
    expect(during.revisions.modelRevision).toBe(1);
  });

  test('cancelled layout work does not partially publish a newer revision', () => {
    const store = new InteractionFrameStore();
    const first = store.publishLayout(layoutInput(1));
    store.beginPendingLayout(2);
    store.cancelPendingLayout();
    const attempted = store.tryCompletePendingLayout(layoutInput(2));
    expect(attempted).toBeNull();
    const still = store.getFrame()!;
    expect(still.id).toEqual(first.id);
    expect(still.revisions.modelRevision).toBe(1);
    expect(still.completeness.kind).toBe('complete');
  });

  test('stale completion for a superseded model revision cannot publish', () => {
    const store = new InteractionFrameStore();
    const first = store.publishLayout(layoutInput(1));
    store.beginPendingLayout(2);
    const stale = store.tryCompletePendingLayout(layoutInput(3));
    expect(stale).toBeNull();
    const still = store.getFrame()!;
    expect(still.id).toEqual(first.id);
    expect(still.revisions.modelRevision).toBe(1);
    expect(still.completeness.kind).toBe('complete');
    expect(store.getPendingTargetRevision()).toBeNull();
  });

  test('superseded pending layout is dropped when a newer model revision begins', () => {
    const store = new InteractionFrameStore();
    store.publishLayout(layoutInput(1));
    store.beginPendingLayout(2);
    store.beginPendingLayout(3);
    store.cancelPendingLayout();
    expect(store.tryCompletePendingLayout(layoutInput(2))).toBeNull();
    expect(store.getFrame()!.revisions.modelRevision).toBe(1);
  });

  test('interleaved adapter reads during pending, completion, and cancel stay coherent', () => {
    const store = new InteractionFrameStore();
    const layout = store.publishLayout(layoutInput(1, {}, [RICH_PAGE]));
    const pendingReads = [adapterReadSnapshot(layout)];
    store.beginPendingLayout(2);
    let frame = store.getFrame()!;
    for (let i = 0; i < 5; i++) pendingReads.push(adapterReadSnapshot(store.getFrame()!));
    expect(frame.completeness.kind).toBe('pending');
    expect(readsAreCoherent(frame, pendingReads)).toBe(true);

    const completed = store.tryCompletePendingLayout(layoutInput(2, {}, [RICH_PAGE]));
    expect(completed).not.toBeNull();
    frame = store.getFrame()!;
    const completedReads = [adapterReadSnapshot(frame), adapterReadSnapshot(frame)];
    expect(frame.revisions.modelRevision).toBe(2);
    expect(readsAreCoherent(frame, completedReads)).toBe(true);

    store.beginPendingLayout(3);
    const cancelReads = [adapterReadSnapshot(store.getFrame()!)];
    store.cancelPendingLayout();
    frame = store.getFrame()!;
    cancelReads.push(adapterReadSnapshot(frame));
    expect(frame.completeness.kind).toBe('complete');
    expect(readsAreCoherent(frame, cancelReads)).toBe(true);
  });

  test('interleaved selection changes never mix layout and overlay revisions', () => {
    const store = new InteractionFrameStore();
    const layout = store.publishLayout(layoutInput(1, {}, [RICH_PAGE]));
    for (let i = 0; i < 20; i++) {
      const input = syntheticSelectionInput(layout);
      input.caret!.rect = { x: 72 + i, y: 96, width: 1, height: 20 };
      const frame = store.publishSelection(input);
      expect(frame.caret!.frameId).toEqual(frame.id);
      expect(frame.selection!.frameId).toEqual(frame.id);
      expect(frame.selectionGeometry!.frameId).toEqual(frame.id);
      expect(frame.display).toBe(layout.display);
      expect(frameMembersCoherent(frame)).toBe(true);
    }
  });

  test('published semanticIndex is deeply frozen and rejects mutation', () => {
    const store = new InteractionFrameStore();
    const semanticIndex = sampleSemanticIndex();
    const frame = store.publishLayout(layoutInput(1, {}, [RICH_PAGE], semanticIndex));
    expect(frame.semanticIndex.caretStops.length).toBeGreaterThan(0);
    expect(frame.semanticIndex.ownershipRegions.length).toBeGreaterThan(0);
    expect(Object.isFrozen(frame.semanticIndex)).toBe(true);
    expect(Object.isFrozen(frame.semanticIndex.stories)).toBe(true);
    expect(Object.isFrozen(frame.semanticIndex.stories[0])).toBe(true);
    expect(Object.isFrozen(frame.semanticIndex.stories[0]!.blocks)).toBe(true);
    expect(Object.isFrozen(frame.semanticIndex.stories[0]!.blocks[0])).toBe(true);
    expect(Object.isFrozen(frame.semanticIndex.stories[0]!.blocks[0]!.identity)).toBe(true);
    expect(Object.isFrozen(frame.semanticIndex.caretStops)).toBe(true);
    expect(Object.isFrozen(frame.semanticIndex.caretStops[0])).toBe(true);
    expect(Object.isFrozen(frame.semanticIndex.ownershipRegions)).toBe(true);
    expect(Object.isFrozen(frame.semanticIndex.ownershipRegions[0])).toBe(true);
    expectMutationThrows(() => {
      (frame.semanticIndex.caretStops as unknown[]).push({} as never);
    });
    expectMutationThrows(() => {
      (frame.semanticIndex.ownershipRegions as unknown[]).push({} as never);
    });
    expectMutationThrows(() => {
      const stop = frame.semanticIndex.caretStops[0]!;
      if (stop.target.kind === 'text') {
        (stop.target.identity as { blockId: string }).blockId = 'mutated';
      }
    });
    expectMutationThrows(() => {
      (frame.semanticIndex.stories[0]!.blocks[0] as { empty: boolean }).empty = true;
    });
    expectMutationThrows(() => {
      (frame.semanticIndex.ownershipRegions[0] as { kind: string }).kind = 'mutated';
    });
  });

  test('deepFreezeFrame and deepFreezeValue are idempotent', () => {
    const store = new InteractionFrameStore();
    const frame = store.publishLayout(layoutInput(1, {}, [RICH_PAGE]));
    const again = deepFreezeFrame(frame);
    expect(again).toBe(frame);
    expect(deepFreezeValue(frame.revisions)).toBe(frame.revisions);
    expect(frameMembersCoherent(again)).toBe(true);
  });
});
