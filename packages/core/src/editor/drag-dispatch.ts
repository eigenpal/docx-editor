// Drag dispatch finalizer (interactive-paginated-editing 5.4).
// Commits ephemeral session state only after effect execution succeeds.

import type {
  InteractionDispatchResult,
  InteractionHostEffect,
} from '@docx-editor.dev/core-contract/contracts/interaction';
import type { DragInteractionPlan, PointerDragSession } from './drag-session.ts';

/** Commits or reverts drag session state based on executed plan outcome. */
export function commitDragSessionAfterExecution(
  drag: DragInteractionPlan,
  execution: InteractionDispatchResult
): { session: PointerDragSession | null; supplementalHostEffects: InteractionHostEffect[] } {
  const supplementalHostEffects: InteractionHostEffect[] = [];

  if (execution.outcome.ok) {
    return { session: drag.nextSessionOnSuccess, supplementalHostEffects };
  }

  if (drag.terminal.kind === 'release') {
    const { pointerId } = drag.terminal;
    const alreadyReleased = execution.hostEffects.some(
      (effect) => effect.kind === 'releasePointer' && effect.pointerId === pointerId
    );
    if (!alreadyReleased) {
      supplementalHostEffects.push({ kind: 'releasePointer', pointerId });
    }
    return { session: null, supplementalHostEffects };
  }

  return { session: drag.priorSession, supplementalHostEffects };
}
