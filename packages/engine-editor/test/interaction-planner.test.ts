import { describe, expect, test } from 'bun:test';
import type {
  InteractionFrame,
  InteractionHostMetrics,
  SemanticSelection,
} from '@docx-editor.dev/core-contract/interaction';
import { publishFrame, selectionForBlock } from './interaction-test-helpers.ts';
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

  test('returns unsupported for geometry keyboard intents after preconditions pass', () => {
    const frame = publishFrame();
    const plan = planInteraction(plannerContext(frame), {
      kind: 'geometryKeyboard',
      frameId: frame.id,
      key: 'ArrowDown',
      shiftKey: false,
    });
    expect(plan.effects[0]).toMatchObject({ kind: 'reject', code: 'unsupported' });
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
