// Drag session transactional commit (interactive-paginated-editing 5.4).

import { describe, expect, test } from 'bun:test';
import type { InteractionDispatchResult } from '@docx-editor.dev/core-contract/interaction';
import { commitDragSessionAfterExecution } from '../src/drag-dispatch.ts';
import type { DragInteractionPlan, PointerDragSession } from '../src/drag-session.ts';

const FRAME_ID = { value: 1 };

function session(pointerId = 1): PointerDragSession {
  const target = {
    kind: 'text' as const,
    scope: { kind: 'body' as const },
    identity: { storyId: 's1', blockId: 'b1' },
    graphemeOffset: 0,
    affinity: 'downstream' as const,
  };
  return {
    pointerId,
    modelRevision: 1,
    scope: { kind: 'body' },
    anchor: target,
    lastValidHead: target,
  };
}

function dragPlan(
  prior: PointerDragSession | null,
  next: PointerDragSession | null,
  terminal: DragInteractionPlan['terminal'] = { kind: 'none' },
): DragInteractionPlan {
  return {
    priorSession: prior,
    nextSessionOnSuccess: next,
    terminal,
    plan: { frameId: FRAME_ID, effects: [] },
  };
}

function execution(
  ok: boolean,
  hostEffects: InteractionDispatchResult['hostEffects'] = [],
  code = 'unsupported' as const,
): InteractionDispatchResult {
  if (ok) {
    return { outcome: { ok: true, value: undefined, frameId: FRAME_ID }, hostEffects };
  }
  return {
    outcome: { ok: false, code, reason: 'test failure', frameId: FRAME_ID },
    hostEffects,
  };
}

describe('commitDragSessionAfterExecution (task 5.4)', () => {
  test('successful execution commits nextSessionOnSuccess', () => {
    const prior = session();
    const next = { ...session(), lastValidHead: { ...session().lastValidHead, graphemeOffset: 3 } };
    const result = commitDragSessionAfterExecution(dragPlan(prior, next), execution(true));
    expect(result.session).toEqual(next);
    expect(result.supplementalHostEffects).toEqual([]);
  });

  test('pointerDown failure keeps prior null session without supplemental host effects', () => {
    const result = commitDragSessionAfterExecution(dragPlan(null, null), execution(false, [], 'invalidTarget'));
    expect(result.session).toBeNull();
    expect(result.supplementalHostEffects).toEqual([]);
  });

  test('pointerMove sync failure reverts to priorSession', () => {
    const prior = session();
    const next = { ...prior, lastValidHead: { ...prior.lastValidHead, graphemeOffset: 2 } };
    const result = commitDragSessionAfterExecution(dragPlan(prior, next), execution(false, [], 'unsupported'));
    expect(result.session).toEqual(prior);
    expect(result.supplementalHostEffects).toEqual([]);
  });

  test('terminal pointerUp execution failure clears session and adds release when executor omitted it', () => {
    const prior = session(7);
    const result = commitDragSessionAfterExecution(
      dragPlan(prior, null, { kind: 'release', pointerId: 7, cause: 'pointerUp' }),
      execution(false, [], 'unsupported'),
    );
    expect(result.session).toBeNull();
    expect(result.supplementalHostEffects).toEqual([{ kind: 'releasePointer', pointerId: 7 }]);
  });

  test('terminal pointerCancel execution failure does not duplicate releasePointer from executor', () => {
    const prior = session(3);
    const result = commitDragSessionAfterExecution(
      dragPlan(prior, null, { kind: 'release', pointerId: 3, cause: 'pointerCancel' }),
      execution(false, [{ kind: 'releasePointer', pointerId: 3 }], 'unsupported'),
    );
    expect(result.session).toBeNull();
    expect(result.supplementalHostEffects).toEqual([]);
  });

  test('terminal abort drift adds release only for matching active pointer', () => {
    const prior = session(5);
    const result = commitDragSessionAfterExecution(
      dragPlan(prior, null, { kind: 'release', pointerId: 5, cause: 'abort' }),
      execution(false, [], 'staleFrame'),
    );
    expect(result.session).toBeNull();
    expect(result.supplementalHostEffects).toEqual([{ kind: 'releasePointer', pointerId: 5 }]);
  });

  test('non-terminal rejection with empty executor host effects stays empty', () => {
    const prior = session();
    const result = commitDragSessionAfterExecution(
      dragPlan(prior, prior),
      execution(false, [], 'pendingLayout'),
    );
    expect(result.session).toEqual(prior);
    expect(result.supplementalHostEffects).toEqual([]);
  });
});
