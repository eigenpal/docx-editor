// Internal interaction plan executor (interactive-paginated-editing 5.1).

import type { EditorCommand } from '@docx-editor.dev/core-contract/contracts/editor';
import type {
  InteractionDispatchResult,
  InteractionFrameId,
  InteractionHostEffect,
  InteractionOutcome,
  InteractionPlan,
  SemanticSelection,
} from '@docx-editor.dev/core-contract/contracts/interaction';
import type { ExecResult } from '@docx-editor.dev/core-contract/contracts/types';

export interface InteractionExecutionContext {
  syncSemanticSelection(request: {
    frameId: InteractionFrameId;
    selection: SemanticSelection;
  }): InteractionOutcome<void>;
  focus(request: { frameId: InteractionFrameId }): InteractionOutcome<void>;
  blur(): void;
  execCommand(command: EditorCommand): ExecResult;
  delegateNativeInput(request: { frameId: InteractionFrameId }): InteractionOutcome<void>;
  publishSelectionOverlay(selection: SemanticSelection): void;
  /** Current interaction-frame identity after any overlay publication during execution. */
  currentFrameId(): InteractionFrameId;
}

function hostEffectFromPlan(plan: InteractionPlan): InteractionHostEffect[] {
  const hostEffects: InteractionHostEffect[] = [];
  for (const effect of plan.effects) {
    if (effect.kind === 'capturePointer')
      hostEffects.push({ kind: 'capturePointer', pointerId: effect.pointerId });
    if (effect.kind === 'releasePointer')
      hostEffects.push({ kind: 'releasePointer', pointerId: effect.pointerId });
    if (effect.kind === 'scroll') hostEffects.push({ kind: 'scroll', delta: effect.delta });
  }
  return hostEffects;
}

function rejectOnlyPlan(plan: InteractionPlan): InteractionDispatchResult | null {
  const reject = plan.effects.find((effect) => effect.kind === 'reject');
  if (!reject || reject.kind !== 'reject') return null;
  const hostEffects = hostEffectFromPlan(plan);
  const engineEffects = plan.effects.filter(
    (effect) =>
      effect.kind !== 'reject' &&
      effect.kind !== 'capturePointer' &&
      effect.kind !== 'releasePointer' &&
      effect.kind !== 'scroll'
  );
  if (engineEffects.length > 0) return null;
  return {
    outcome: {
      ok: false,
      code: reject.code,
      reason: reject.reason,
      frameId: reject.frameId ?? plan.frameId,
    },
    hostEffects,
  };
}

/** Apply one controller plan; host effects are returned for adapter passthrough. */
export function executeInteractionPlan(
  ctx: InteractionExecutionContext,
  plan: InteractionPlan
): InteractionDispatchResult {
  const rejectOnly = rejectOnlyPlan(plan);
  if (rejectOnly) return rejectOnly;

  const hostEffects: InteractionHostEffect[] = [];
  let lastSelection: SemanticSelection | null = null;
  let terminalReject: InteractionOutcome<void> | null = null;

  for (const effect of plan.effects) {
    if (terminalReject) {
      if (effect.kind === 'capturePointer')
        hostEffects.push({ kind: 'capturePointer', pointerId: effect.pointerId });
      if (effect.kind === 'releasePointer')
        hostEffects.push({ kind: 'releasePointer', pointerId: effect.pointerId });
      if (effect.kind === 'scroll') hostEffects.push({ kind: 'scroll', delta: effect.delta });
      continue;
    }

    switch (effect.kind) {
      case 'reject':
        terminalReject = {
          ok: false,
          code: effect.code,
          reason: effect.reason,
          frameId: effect.frameId ?? plan.frameId,
        };
        break;
      case 'syncSelection': {
        const outcome = ctx.syncSemanticSelection({
          frameId: effect.frameId,
          selection: effect.selection,
        });
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
      case 'publishSelectionOverlay':
        ctx.publishSelectionOverlay(effect.selection);
        lastSelection = effect.selection;
        break;
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

  if (terminalReject) {
    return { outcome: terminalReject, hostEffects };
  }

  return {
    outcome: { ok: true, value: undefined, frameId: ctx.currentFrameId() },
    hostEffects,
  };
}
