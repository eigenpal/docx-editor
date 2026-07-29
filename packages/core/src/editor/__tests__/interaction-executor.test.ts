import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createTestEditor as createEditor } from './create-test-editor.ts';
import type { Editor, EditorHost } from '@docx-editor.dev/core-contract/contracts/editor';
import type { InteractionFrame } from '@docx-editor.dev/core-contract/contracts/interaction';
import { createEditableParagraphFixture } from '../../../../engine-editor/browser/fixtures.ts';
import {
  executeInteractionPlan,
  type InteractionExecutionContext,
} from '../interaction-executor.ts';
import { planInteraction } from '../interaction-planner.ts';
import { publishFrame, selectionForBlock } from './interaction-test-helpers.ts';
import { IDENTITY_HOST_METRICS } from '../coordinate-mapper.ts';

function hostWith(body: HTMLElement): EditorHost {
  return {
    getBodyHostEl: () => body,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => null,
    getInteractionHostMetrics: () => IDENTITY_HOST_METRICS,
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

function mockExecutionContext(
  frame: ReturnType<typeof publishFrame>,
  overrides: Partial<InteractionExecutionContext> = {}
): InteractionExecutionContext {
  return {
    syncSemanticSelection: () => ({ ok: true, value: undefined, frameId: frame.id }),
    focus: () => ({ ok: true, value: undefined, frameId: frame.id }),
    publishSelectionOverlay: () => {},
    blur: () => {},
    execCommand: () => ({ ok: true, changed: false }),
    delegateNativeInput: () => ({ ok: true, value: undefined, frameId: frame.id }),
    currentFrameId: () => frame.id,
    ...overrides,
  };
}

describe('interaction executor (task 5.1)', () => {
  test('applies selection before focus and publishes overlay only on success', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Editor',
    });
    const frame = editor.getInteractionFrame();
    const blockId = editor.getAccessibilityObservation().entries[0]!.identity.blockId;
    const selection = selectionForBlock(frame, blockId, 0, 2);
    const plan = planInteraction(
      { frame, editable: true, readOnly: false, hostMetrics: IDENTITY_HOST_METRICS },
      { kind: 'semanticSelection', frameId: frame.id, selection }
    );

    const calls: string[] = [];
    const ctx: InteractionExecutionContext = {
      syncSemanticSelection: (request) => {
        calls.push('sync');
        return editor.exec({ type: 'setSelection', range: request.selection });
      },
      focus: () => {
        calls.push('focus');
        return editor.focus();
      },
      publishSelectionOverlay: () => {
        calls.push('overlay');
      },
      blur: () => {
        calls.push('blur');
      },
      execCommand: () => {
        calls.push('command');
        return { ok: true, changed: false };
      },
      delegateNativeInput: () => {
        calls.push('delegate');
        return { ok: true, value: undefined, frameId: frame.id };
      },
      currentFrameId: () => editor.getInteractionFrame().id,
    };

    const result = executeInteractionPlan(ctx, plan);
    expect(result.outcome.ok).toBe(true);
    if (result.outcome.ok) {
      expect(result.outcome.frameId).toEqual(editor.getInteractionFrame().id);
    }
    expect(calls).toEqual(['sync', 'focus', 'overlay']);
    expect(result.hostEffects).toEqual([]);
    expect(editor.getInteractionFrame().selection?.head).toMatchObject({
      kind: 'text',
      graphemeOffset: 2,
    });

    editor.destroy();
    body.remove();
  });

  test('rejection short-circuits subsequent effects', () => {
    const frame = publishFrame();
    const calls: string[] = [];
    const result = executeInteractionPlan(
      mockExecutionContext(frame, {
        syncSemanticSelection: () => {
          calls.push('sync');
          return { ok: true, value: undefined, frameId: frame.id };
        },
        focus: () => {
          calls.push('focus');
          return { ok: true, value: undefined, frameId: frame.id };
        },
        publishSelectionOverlay: () => calls.push('overlay'),
        blur: () => calls.push('blur'),
        execCommand: () => {
          calls.push('command');
          return { ok: true, changed: false };
        },
        delegateNativeInput: () => {
          calls.push('delegate');
          return { ok: true, value: undefined, frameId: frame.id };
        },
      }),
      {
        frameId: frame.id,
        effects: [
          { kind: 'reject', code: 'unsupported', reason: 'blocked', frameId: frame.id },
          {
            kind: 'syncSelection',
            frameId: frame.id,
            selection: selectionForBlock(
              frame,
              frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId,
              0,
              0
            ),
          },
          { kind: 'focus', frameId: frame.id },
        ],
      }
    );
    expect(result.outcome.ok).toBe(false);
    if (!result.outcome.ok) expect(result.outcome.code).toBe('unsupported');
    expect(calls).toEqual([]);
    expect(result.hostEffects).toEqual([]);
  });

  test('syncSelection failure prevents focus, overlay, and host effects', () => {
    const frame = publishFrame();
    const selection = selectionForBlock(
      frame,
      frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId,
      0,
      1
    );
    const calls: string[] = [];
    const result = executeInteractionPlan(
      mockExecutionContext(frame, {
        syncSemanticSelection: () => {
          calls.push('sync');
          return { ok: false, code: 'invalidTarget', reason: 'bad target', frameId: frame.id };
        },
        focus: () => {
          calls.push('focus');
          return { ok: true, value: undefined, frameId: frame.id };
        },
        publishSelectionOverlay: () => calls.push('overlay'),
      }),
      {
        frameId: frame.id,
        effects: [
          { kind: 'syncSelection', frameId: frame.id, selection },
          { kind: 'focus', frameId: frame.id },
        ],
      }
    );
    expect(result.outcome.ok).toBe(false);
    if (!result.outcome.ok) expect(result.outcome.code).toBe('invalidTarget');
    expect(calls).toEqual(['sync']);
    expect(result.hostEffects).toEqual([]);
  });

  test('focus failure after successful sync skips overlay and returns focus failure without host effects', () => {
    const frame = publishFrame();
    const selection = selectionForBlock(
      frame,
      frame.semanticIndex.stories[0]!.blocks[0]!.identity.blockId,
      0,
      1
    );
    const calls: string[] = [];
    const result = executeInteractionPlan(
      mockExecutionContext(frame, {
        syncSemanticSelection: () => {
          calls.push('sync');
          return { ok: true, value: undefined, frameId: frame.id };
        },
        focus: () => {
          calls.push('focus');
          return { ok: false, code: 'unsupported', reason: 'focus rejected', frameId: frame.id };
        },
        publishSelectionOverlay: () => calls.push('overlay'),
      }),
      {
        frameId: frame.id,
        effects: [
          { kind: 'syncSelection', frameId: frame.id, selection },
          { kind: 'focus', frameId: frame.id },
        ],
      }
    );
    expect(result.outcome.ok).toBe(false);
    if (!result.outcome.ok) {
      expect(result.outcome.code).toBe('unsupported');
      expect(result.outcome.reason).toBe('focus rejected');
    }
    expect(calls).toEqual(['sync', 'focus']);
    expect(result.hostEffects).toEqual([]);
  });

  test('returns host effects without executing them', () => {
    const frame = publishFrame();
    const result = executeInteractionPlan(mockExecutionContext(frame), {
      frameId: frame.id,
      effects: [
        { kind: 'capturePointer', pointerId: 3 },
        { kind: 'scroll', delta: { x: 0, y: 4 } },
      ],
    });
    expect(result.outcome.ok).toBe(true);
    expect(result.hostEffects).toEqual([
      { kind: 'capturePointer', pointerId: 3 },
      { kind: 'scroll', delta: { x: 0, y: 4 } },
    ]);
  });

  test('reject-only cleanup returns releasePointer exactly once with no engine effects', () => {
    const frame = publishFrame();
    const calls: string[] = [];
    const result = executeInteractionPlan(
      mockExecutionContext(frame, {
        syncSemanticSelection: () => {
          calls.push('sync');
          return { ok: true, value: undefined, frameId: frame.id };
        },
        focus: () => {
          calls.push('focus');
          return { ok: true, value: undefined, frameId: frame.id };
        },
        publishSelectionOverlay: () => calls.push('overlay'),
      }),
      {
        frameId: frame.id,
        effects: [
          {
            kind: 'reject',
            code: 'invalidTarget',
            reason: 'terminal drag cleanup',
            frameId: frame.id,
          },
          { kind: 'releasePointer', pointerId: 5 },
        ],
      }
    );
    expect(result.outcome.ok).toBe(false);
    if (!result.outcome.ok) expect(result.outcome.code).toBe('invalidTarget');
    expect(result.hostEffects).toEqual([{ kind: 'releasePointer', pointerId: 5 }]);
    expect(calls).toEqual([]);
  });

  test('ordinary 5.1 reject without cleanup emits no host effects', () => {
    const frame = publishFrame();
    const result = executeInteractionPlan(mockExecutionContext(frame), {
      frameId: frame.id,
      effects: [{ kind: 'reject', code: 'unsupported', reason: 'blocked', frameId: frame.id }],
    });
    expect(result.outcome.ok).toBe(false);
    expect(result.hostEffects).toEqual([]);
  });
});
