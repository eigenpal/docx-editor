import { describe, expect, test } from 'bun:test';
import type {
  InteractionFrame,
  InteractionHostMetrics,
  SemanticSelection,
} from '@docx-editor.dev/core-contract/interaction';
import {
  clientPointForStackedText,
  modelWithTableCell,
  publishFrame,
  publishFrameBundle,
  selectionForBlock,
  stackedFrame,
} from './interaction-test-helpers.ts';
import { planInteraction, type InteractionPlannerContext } from '../src/interaction-planner.ts';

const METRICS: InteractionHostMetrics = {
  clientOrigin: { x: 0, y: 0 },
  scrollOffset: { x: 0, y: 0 },
  zoom: 1,
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

describe('interaction planner (task 5.1)', () => {
  test('rejects stale frame identity', () => {
    const frame = publishFrame();
    const plan = planInteraction(plannerContext(frame), {
      kind: 'semanticSelection',
      frameId: { value: frame.id.value - 1 },
      selection: selectionForBlock(frame, frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId, 0, 0),
    });
    expect(plan.effects).toEqual([
      {
        kind: 'reject',
        code: 'staleFrame',
        reason: 'interaction intent targets a superseded interaction frame',
        frameId: frame.id,
      },
    ]);
  });

  test('rejects pending layout frame', () => {
    const frame = publishFrame();
    const pending: InteractionFrame = {
      ...frame,
      completeness: { kind: 'pending', awaiting: 'layout', targetModelRevision: 2 },
    };
    const plan = planInteraction(plannerContext(pending), {
      kind: 'focus',
      frameId: pending.id,
    });
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'pendingLayout' });
  });

  test('rejects read-only context', () => {
    const frame = publishFrame();
    const plan = planInteraction(plannerContext(frame, { readOnly: true }), {
      kind: 'semanticSelection',
      frameId: frame.id,
      selection: selectionForBlock(frame, frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId, 0, 0),
    });
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'readOnly' });
  });

  test('rejects pointer intents without coordinate metrics', () => {
    const frame = publishFrame();
    const plan = planInteraction(plannerContext(frame, { hostMetrics: undefined }), {
      kind: 'pointerDown',
      frameId: frame.id,
      clientPoint: { x: 10, y: 20 },
      pointerId: 1,
    });
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'invalidTarget' });
  });

  test('rejects geometry keyboard intents without coordinate metrics before unsupported', () => {
    const frame = publishFrame();
    const plan = planInteraction(plannerContext(frame, { hostMetrics: undefined }), {
      kind: 'geometryKeyboard',
      frameId: frame.id,
      key: 'ArrowDown',
    });
    expect(plan.effects).toEqual([
      {
        kind: 'reject',
        code: 'invalidTarget',
        reason: 'explicit InteractionHostMetrics are required',
        frameId: frame.id,
      },
    ]);
    expect(plan.effects[0]).not.toMatchObject({ code: 'unsupported' });
  });

  test('returns unsupported for pointer semantics after preconditions pass', () => {
    const frame = publishFrame();
    const plan = planInteraction(plannerContext(frame), {
      kind: 'pointerDown',
      frameId: frame.id,
      clientPoint: { x: 10, y: 20 },
      pointerId: 1,
    });
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
  });

  test('plans geometry keyboard through shared preconditions when frame is focused', () => {
    const { frame, navigation } = publishFrameBundle();
    const focused = {
      ...frame,
      focus: { scope: { kind: 'body' as const }, focused: true },
      selection: selectionForBlock(frame, frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId, 0, 0),
    };
    const unfocused = planInteraction({ ...plannerContext(frame), navigationGeometry: navigation }, {
      kind: 'geometryKeyboard',
      frameId: frame.id,
      key: 'ArrowRight',
    });
    expect(unfocused.effects[0]).toMatchObject({
      kind: 'reject',
      code: 'invalidTarget',
      reason: 'geometry keyboard navigation requires a focused interaction frame',
    });
    const planned = planInteraction(
      {
        ...plannerContext(focused),
        navigationGeometry: navigation,
        documentGeneration: 1,
        resolveParagraphText: (identity) => 'hello',
      },
      {
        kind: 'geometryKeyboard',
        frameId: focused.id,
        key: 'ArrowRight',
      },
    );
    expect(planned.effects.some((e) => e.kind === 'syncSelection')).toBe(true);
    expect(planned.effects.some((e) => e.kind === 'focus')).toBe(false);
  });

  test('plans semantic selection sync then focus on one frame', () => {
    const frame = publishFrame();
    const selection = selectionForBlock(frame, frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId, 0, 3);
    const plan = planInteraction(plannerContext(frame), {
      kind: 'semanticSelection',
      frameId: frame.id,
      selection,
    });
    expect(plan.frameId).toEqual(frame.id);
    expect(plan.effects).toEqual([
      { kind: 'syncSelection', frameId: frame.id, selection },
      { kind: 'focus', frameId: frame.id },
    ]);
  });

  test('plans passthrough host effects for capture, release, and scroll control intents', () => {
    const frame = publishFrame();
    expect(
      planInteraction(plannerContext(frame), { kind: 'capturePointer', frameId: frame.id, pointerId: 7 }).effects,
    ).toEqual([{ kind: 'capturePointer', pointerId: 7 }]);
    expect(
      planInteraction(plannerContext(frame), { kind: 'releasePointer', frameId: frame.id, pointerId: 7 }).effects,
    ).toEqual([{ kind: 'releasePointer', pointerId: 7 }]);
    expect(
      planInteraction(plannerContext(frame), { kind: 'scroll', frameId: frame.id, delta: { x: 0, y: 12 } }).effects,
    ).toEqual([{ kind: 'scroll', delta: { x: 0, y: 12 } }]);
  });

  test('plans blur, command, and native-input delegation engine effects', () => {
    const frame = publishFrame();
    expect(planInteraction(plannerContext(frame), { kind: 'blur', frameId: frame.id }).effects).toEqual([
      { kind: 'blur' },
    ]);
    expect(
      planInteraction(plannerContext(frame), {
        kind: 'command',
        frameId: frame.id,
        command: { type: 'undo' },
      }).effects,
    ).toEqual([{ kind: 'execCommand', frameId: frame.id, command: { type: 'undo' } }]);
    expect(
      planInteraction(plannerContext(frame), { kind: 'delegateNativeInput', frameId: frame.id }).effects,
    ).toEqual([{ kind: 'delegateNativeInput', frameId: frame.id }]);
  });

  test('planner calls are deterministic and do not retain prior selection', () => {
    const frame = publishFrame();
    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const intent = {
      kind: 'semanticSelection' as const,
      frameId: frame.id,
      selection: selectionForBlock(frame, blockId, 0, 1),
    };
    const first = planInteraction(plannerContext(frame), intent);
    const second = planInteraction(plannerContext(frame), intent);
    const alternate = planInteraction(plannerContext(frame), {
      kind: 'semanticSelection',
      frameId: frame.id,
      selection: selectionForBlock(frame, blockId, 2, 2),
    });
    expect(first.effects).toEqual(second.effects);
    expect(first.effects).not.toEqual(alternate.effects);
  });
});

describe('body-paragraph interaction subset (task 5.6a)', () => {
  function clickAt(frame: InteractionFrame, clientPoint: { x: number; y: number }) {
    return planInteraction(plannerContext(frame), {
      kind: 'click',
      frameId: frame.id,
      clientPoint,
    });
  }

  test('editable body text accepts a caret and focuses the input host', () => {
    const frame = publishFrame();
    const textItem = frame.display[0]!.items.find((item) => item.kind === 'text')!;
    const point = clientPointForStackedText(
      frame,
      0,
      { x: textItem.box.x + textItem.box.width / 2, y: textItem.box.y + textItem.box.height / 2 },
      METRICS,
    );
    const plan = clickAt(frame, point);
    expect(plan.effects.map((e) => e.kind)).toEqual(['syncSelection', 'focus']);
  });

  test('page background and margin clicks return a typed outcome without changing selection', () => {
    const frame = stackedFrame(2);
    const point = clientPointForStackedText(frame, 0, { x: 400, y: 900 }, METRICS);
    const plan = clickAt(frame, point);
    expect(plan.effects).toHaveLength(1);
    expect(plan.effects[0]).toMatchObject({
      kind: 'reject',
      code: 'invalidTarget',
      frameId: frame.id,
    });
    expect((plan.effects[0] as { reason: string }).reason).toContain('page background');
    expect((plan.effects[0] as { reason: string }).reason).toContain('margin');
    expect(plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
  });

  test('inter-page gap clicks return their own typed reason and move no selection', () => {
    const frame = stackedFrame(2, 24, 1056, 816);
    const pageOne = frame.pageGeometry.find((p) => p.index === 0)!.box;
    const gapPoint = { x: pageOne.x + 400, y: pageOne.y + pageOne.height + 12 };
    const plan = clickAt(frame, gapPoint);
    expect(plan.effects).toHaveLength(1);
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'invalidTarget' });
    expect((plan.effects[0] as { reason: string }).reason).toContain('inter-page gap');
    expect(plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
  });

  test('clicks outside published page geometry stay invalidTarget', () => {
    const frame = stackedFrame(2);
    const plan = clickAt(frame, { x: 5000, y: 5000 });
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'invalidTarget' });
  });

  test('read-only body text fails closed and never yields an editable caret', () => {
    const frame = publishFrame(modelWithTableCell('cell text'));
    const cellItem = frame.display[0]!.items.find(
      (item) => item.kind === 'text' && item.semantic.identity.blockId === 'p-cell',
    )!;
    const point = clientPointForStackedText(
      frame,
      0,
      { x: cellItem.box.x + cellItem.box.width / 2, y: cellItem.box.y + cellItem.box.height / 2 },
      METRICS,
    );
    for (const clickCount of [1, 2, 3]) {
      const plan = planInteraction(plannerContext(frame), {
        kind: 'click',
        frameId: frame.id,
        clientPoint: point,
        clickCount,
      });
      expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'readOnly' });
      expect(plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
    }
  });

  test('declared control and annotation roles fail closed as unsupported', () => {
    const base = publishFrame();
    for (const role of ['control', 'annotation', 'atomicObject', 'background'] as const) {
      const frame: InteractionFrame = {
        ...base,
        semanticIndex: {
          ...base.semanticIndex,
          caretStops: base.semanticIndex.caretStops.map((stop) => ({ ...stop, role })),
        },
      };
      const textItem = frame.display[0]!.items.find((item) => item.kind === 'text')!;
      const point = clientPointForStackedText(
        frame,
        0,
        { x: textItem.box.x + 1, y: textItem.box.y + textItem.box.height / 2 },
        METRICS,
      );
      const plan = clickAt(frame, point);
      expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
      expect(plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
    }
  });

  test('native input and commands fail closed when the selection sits in read-only text', () => {
    const base = publishFrame(modelWithTableCell('cell text'));
    const frame: InteractionFrame = {
      ...base,
      selection: selectionForBlock(base, 'p-cell', 0, 2),
    };
    expect(
      planInteraction(plannerContext(frame), { kind: 'delegateNativeInput', frameId: frame.id }).effects[0],
    ).toMatchObject({ kind: 'reject', code: 'readOnly' });
    expect(
      planInteraction(plannerContext(frame), {
        kind: 'command',
        frameId: frame.id,
        command: { type: 'toggleMark', mark: 'bold' },
      }).effects[0],
    ).toMatchObject({ kind: 'reject', code: 'readOnly' });
  });

  test('history and selection commands stay available over a read-only selection (5.6a)', () => {
    const base = publishFrame(modelWithTableCell('cell text'));
    const frame: InteractionFrame = {
      ...base,
      selection: selectionForBlock(base, 'p-cell', 0, 2),
    };
    for (const command of [{ type: 'undo' as const }, { type: 'redo' as const }]) {
      expect(
        planInteraction(plannerContext(frame), { kind: 'command', frameId: frame.id, command }).effects,
      ).toEqual([{ kind: 'execCommand', frameId: frame.id, command }]);
    }
  });

  test('native input and commands still pass through for editable body selections', () => {
    const base = publishFrame();
    const blockId = base.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const frame: InteractionFrame = { ...base, selection: selectionForBlock(base, blockId, 0, 2) };
    expect(
      planInteraction(plannerContext(frame), { kind: 'delegateNativeInput', frameId: frame.id }).effects,
    ).toEqual([{ kind: 'delegateNativeInput', frameId: frame.id }]);
    expect(
      planInteraction(plannerContext(frame), {
        kind: 'command',
        frameId: frame.id,
        command: { type: 'undo' },
      }).effects,
    ).toEqual([{ kind: 'execCommand', frameId: frame.id, command: { type: 'undo' } }]);
  });
});

describe('synchronous stale-frame protection (task 5.7a)', () => {
  function planSelection(frame: InteractionFrame, selection: SemanticSelection) {
    return planInteraction(plannerContext(frame), {
      kind: 'semanticSelection',
      frameId: frame.id,
      selection,
    });
  }

  test('a selection minted on a superseded frame cannot mutate the current frame', () => {
    const frame = publishFrame();
    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const stale: SemanticSelection = {
      ...selectionForBlock(frame, blockId, 0, 1),
      frameId: { value: frame.id.value - 1 },
    };
    const plan = planSelection(frame, stale);
    expect(plan.effects).toHaveLength(1);
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'staleFrame', frameId: frame.id });
    expect(plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
  });

  test('grapheme offsets beyond current canonical state are refused, not clamped', () => {
    const frame = publishFrame();
    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const graphemeCount = frame.semanticIndex.stories[0]!.blocks[0]!.graphemeCount;
    const plan = planSelection(frame, selectionForBlock(frame, blockId, graphemeCount + 1, graphemeCount + 4));
    expect(plan.effects).toHaveLength(1);
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'invalidTarget' });
    expect(plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
  });

  test('an offset exactly at the trailing caret stop stays valid', () => {
    const frame = publishFrame();
    const block = frame.semanticIndex.stories[0]!.blocks[0]!;
    const plan = planSelection(frame, selectionForBlock(frame, block.identity.blockId, 0, block.graphemeCount));
    expect(plan.effects.map((e) => e.kind)).toEqual(['syncSelection', 'focus']);
  });

  test('a block deleted from canonical state cannot receive a selection', () => {
    const frame = publishFrame();
    const source = selectionForBlock(frame, frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId, 0, 1);
    const ghostTarget = (endpoint: SemanticSelection['anchor']) => ({
      ...(endpoint as Extract<SemanticSelection['anchor'], { kind: 'text' }>),
      identity: { storyId: 'st-1', blockId: 'deleted-block' },
    });
    const plan = planSelection(frame, {
      ...source,
      anchor: ghostTarget(source.anchor),
      head: ghostTarget(source.head),
    });
    expect(plan.effects).toHaveLength(1);
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'invalidTarget' });
    expect(plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
  });

  test('a story absent from canonical state cannot receive a selection', () => {
    const frame = publishFrame();
    const source = selectionForBlock(frame, frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId, 0, 1);
    const ghostStory = (endpoint: SemanticSelection['anchor']) => ({
      ...(endpoint as Extract<SemanticSelection['anchor'], { kind: 'text' }>),
      identity: { storyId: 'st-missing', blockId: 'p-1' },
    });
    const plan = planSelection(frame, {
      ...source,
      anchor: ghostStory(source.anchor),
      head: ghostStory(source.head),
    });
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'invalidTarget' });
  });

  test('negative and non-integer offsets fail closed', () => {
    const frame = publishFrame();
    const blockId = frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    for (const offset of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const plan = planSelection(frame, selectionForBlock(frame, blockId, offset, 1));
      expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'invalidTarget' });
      expect(plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
    }
  });

  test('resolution reads the frame handed to the planner, not a retained one', () => {
    const first = publishFrame();
    const blockId = first.semanticIndex.stories[0]!.blocks[0]!.identity.blockId;
    const shrunk: InteractionFrame = {
      ...first,
      id: { value: first.id.value + 1 },
      semanticIndex: {
        ...first.semanticIndex,
        stories: first.semanticIndex.stories.map((story) => ({
          ...story,
          blocks: story.blocks.map((block) => ({ ...block, graphemeCount: 1 })),
        })),
      },
    };
    const wasValid = selectionForBlock(first, blockId, 0, 4);
    expect(planSelection(first, wasValid).effects.map((e) => e.kind)).toEqual(['syncSelection', 'focus']);
    const rebound: SemanticSelection = { ...wasValid, frameId: shrunk.id };
    expect(planSelection(shrunk, rebound).effects[0]).toMatchObject({
      kind: 'reject',
      code: 'invalidTarget',
    });
  });
});

describe('shift-click anchor re-resolution (task 5.7a)', () => {
  test('a retained anchor beyond current canonical state cannot extend a range', () => {
    const base = publishFrame();
    const block = base.semanticIndex.stories[0]!.blocks[0]!;
    const frame: InteractionFrame = {
      ...base,
      selection: selectionForBlock(base, block.identity.blockId, block.graphemeCount + 6, block.graphemeCount + 6),
    };
    const textItem = frame.display[0]!.items.find((item) => item.kind === 'text')!;
    const point = clientPointForStackedText(
      frame,
      0,
      { x: textItem.box.x + textItem.box.width / 2, y: textItem.box.y + textItem.box.height / 2 },
      METRICS,
    );
    const plan = planInteraction(plannerContext(frame), {
      kind: 'click',
      frameId: frame.id,
      clientPoint: point,
      shiftKey: true,
    });
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'invalidTarget' });
    expect(plan.effects.some((e) => e.kind === 'syncSelection')).toBe(false);
  });

  test('a valid retained anchor still extends a range', () => {
    const base = publishFrame();
    const block = base.semanticIndex.stories[0]!.blocks[0]!;
    const frame: InteractionFrame = {
      ...base,
      selection: selectionForBlock(base, block.identity.blockId, 0, 0),
    };
    const textItem = frame.display[0]!.items.find((item) => item.kind === 'text')!;
    const point = clientPointForStackedText(
      frame,
      0,
      { x: textItem.box.x + textItem.box.width / 2, y: textItem.box.y + textItem.box.height / 2 },
      METRICS,
    );
    const plan = planInteraction(plannerContext(frame), {
      kind: 'click',
      frameId: frame.id,
      clientPoint: point,
      shiftKey: true,
    });
    expect(plan.effects.map((e) => e.kind)).toEqual(['syncSelection', 'focus']);
  });
});
