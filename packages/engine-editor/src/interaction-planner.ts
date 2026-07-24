// Pure PM-free interaction planner (interactive-paginated-editing 5.1).

import type {
  InteractionEffect,
  InteractionFrame,
  InteractionHostMetrics,
  InteractionIntent,
  InteractionOutcomeCode,
  InteractionPlan,
} from '@docx-editor.dev/core-contract/interaction';

export interface InteractionPlannerContext {
  readonly frame: InteractionFrame;
  readonly editable: boolean;
  readonly readOnly: boolean;
  readonly hostMetrics?: InteractionHostMetrics;
}

function rejectEffect(code: InteractionOutcomeCode, reason: string, frameId: InteractionFrame['id']): InteractionEffect {
  return { kind: 'reject', code, reason, frameId };
}

function requiresCoordinateMetrics(intent: InteractionIntent): boolean {
  return intent.kind === 'pointerDown' || intent.kind === 'pointerMove' || intent.kind === 'pointerUp' || intent.kind === 'click' || intent.kind === 'geometryKeyboard';
}

function validatePreconditions(
  context: InteractionPlannerContext,
  intent: InteractionIntent,
): InteractionEffect | null {
  const { frame } = context;
  if ('frameId' in intent && intent.frameId.value !== frame.id.value) {
    return rejectEffect('staleFrame', 'interaction intent targets a superseded interaction frame', frame.id);
  }
  if (frame.completeness.kind === 'pending') {
    return rejectEffect('pendingLayout', 'layout for the current model revision is not yet published', frame.id);
  }
  if (context.readOnly || !context.editable) {
    return rejectEffect('readOnly', 'interaction rejected because the editor is read-only', frame.id);
  }
  if (requiresCoordinateMetrics(intent) && !context.hostMetrics) {
    return rejectEffect('invalidTarget', 'explicit InteractionHostMetrics are required', frame.id);
  }
  return null;
}

/** Pure planner: maps one intent and frame context to an ordered effect plan. */
export function planInteraction(context: InteractionPlannerContext, intent: InteractionIntent): InteractionPlan {
  const rejection = validatePreconditions(context, intent);
  if (rejection) {
    return { frameId: context.frame.id, effects: [rejection] };
  }

  const frameId = context.frame.id;

  switch (intent.kind) {
    case 'semanticSelection':
      return {
        frameId,
        effects: [
          { kind: 'syncSelection', frameId, selection: intent.selection },
          { kind: 'focus', frameId },
        ],
      };
    case 'focus':
      return { frameId, effects: [{ kind: 'focus', frameId }] };
    case 'blur':
      return { frameId, effects: [{ kind: 'blur' }] };
    case 'command':
      return { frameId, effects: [{ kind: 'execCommand', frameId, command: intent.command }] };
    case 'delegateNativeInput':
      return { frameId, effects: [{ kind: 'delegateNativeInput', frameId }] };
    case 'capturePointer':
      return { frameId, effects: [{ kind: 'capturePointer', pointerId: intent.pointerId }] };
    case 'releasePointer':
      return { frameId, effects: [{ kind: 'releasePointer', pointerId: intent.pointerId }] };
    case 'scroll':
      return { frameId, effects: [{ kind: 'scroll', delta: intent.delta }] };
    case 'pointerDown':
    case 'pointerMove':
    case 'pointerUp':
    case 'click':
    case 'geometryKeyboard':
      return {
        frameId,
        effects: [
          rejectEffect(
            'unsupported',
            intent.kind === 'geometryKeyboard'
              ? 'geometry-aware keyboard interaction is not implemented yet (task 5.5+)'
              : 'pointer interaction semantics are not implemented yet (task 5.2+)',
            frameId,
          ),
        ],
      };
  }
}
