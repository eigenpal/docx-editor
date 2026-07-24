// Internal interaction plan executor (interactive-paginated-editing 5.1).

import type { EditorCommand } from '@docx-editor.dev/core-contract/editor';
import type {
  InteractionDispatchResult,
  InteractionFrameId,
  InteractionHostEffect,
  InteractionOutcome,
  InteractionPlan,
  SemanticSelection,
} from '@docx-editor.dev/core-contract/interaction';
import type { ExecResult } from '@docx-editor.dev/core-contract/types';

export interface InteractionExecutionContext {
  syncSemanticSelection(request: { frameId: InteractionFrameId; selection: SemanticSelection }): InteractionOutcome<void>;
  focus(request: { frameId: InteractionFrameId }): InteractionOutcome<void>;
  blur(): void;
  execCommand(command: EditorCommand): ExecResult;
  delegateNativeInput(request: { frameId: InteractionFrameId }): InteractionOutcome<void>;
  publishSelectionOverlay(selection: SemanticSelection): void;
  /** Current interaction-frame identity after any overlay publication during execution. */
  currentFrameId(): InteractionFrameId;
}

function rejectFromPlan(plan: InteractionPlan): InteractionDispatchResult | null {
  const first = plan.effects[0];
  if (first?.kind !== 'reject') return null;
  return {
    outcome: {
      ok: false,
      code: first.code,
      reason: first.reason,
      frameId: first.frameId ?? plan.frameId,
    },
    hostEffects: [],
  };
}

/** Apply one controller plan; host effects are returned for adapter passthrough. */
export function executeInteractionPlan(
  ctx: InteractionExecutionContext,
  plan: InteractionPlan,
): InteractionDispatchResult {
  const early = rejectFromPlan(plan);
  if (early) return early;

  const hostEffects: InteractionHostEffect[] = [];
  let lastSelection: SemanticSelection | null = null;

  for (const effect of plan.effects) {
    switch (effect.kind) {
      case 'reject':
        return {
          outcome: {
            ok: false,
            code: effect.code,
            reason: effect.reason,
            frameId: effect.frameId ?? plan.frameId,
          },
          hostEffects: [],
        };
      case 'syncSelection': {
        const outcome = ctx.syncSemanticSelection({ frameId: effect.frameId, selection: effect.selection });
        if (!outcome.ok) return { outcome, hostEffects: [] };
        lastSelection = effect.selection;
        break;
      }
      case 'focus': {
        const outcome = ctx.focus({ frameId: effect.frameId });
        if (!outcome.ok) return { outcome, hostEffects: [] };
        if (lastSelection) ctx.publishSelectionOverlay(lastSelection);
        break;
      }
      case 'blur':
        ctx.blur();
        break;
      case 'execCommand': {
        const result = ctx.execCommand(effect.command);
        if (!result.ok) {
          return {
            outcome: {
              ok: false,
              code: result.code === 'locked' ? 'readOnly' : 'unsupported',
              reason: result.reason,
              frameId: plan.frameId,
            },
            hostEffects: [],
          };
        }
        break;
      }
      case 'delegateNativeInput': {
        const outcome = ctx.delegateNativeInput({ frameId: effect.frameId });
        if (!outcome.ok) return { outcome, hostEffects: [] };
        break;
      }
      case 'capturePointer':
        hostEffects.push({ kind: 'capturePointer', pointerId: effect.pointerId });
        break;
      case 'releasePointer':
        hostEffects.push({ kind: 'releasePointer', pointerId: effect.pointerId });
        break;
      case 'scroll':
        hostEffects.push({ kind: 'scroll', delta: effect.delta });
        break;
    }
  }

  return {
    outcome: { ok: true, value: undefined, frameId: ctx.currentFrameId() },
    hostEffects,
  };
}
