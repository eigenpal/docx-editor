// Pure PM-free interaction planner (interactive-paginated-editing 5.1–5.2).

import type {
  InteractionEffect,
  InteractionFrame,
  InteractionHostMetrics,
  InteractionIntent,
  InteractionOutcomeCode,
  InteractionPlan,
  PointerInteractionIntent,
  SemanticSelection,
  SemanticTarget,
  WordSegmentRecord,
} from '@docx-editor.dev/core-contract/interaction';
import { hitTestPointer } from './interaction-geometry.ts';
import { blockSelectionFromHit, wordSelectionFromHit } from './word-selection.ts';

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

function targetScopeCompatible(current: SemanticSelection, head: SemanticTarget): boolean {
  if (current.scope.kind !== head.scope.kind) return false;
  if (current.anchor.kind === 'text' && head.kind === 'text') {
    return current.anchor.identity.storyId === head.identity.storyId;
  }
  return true;
}

function selectionFromEditableTextHit(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>,
  shiftKey: boolean | undefined,
): { ok: true; selection: SemanticSelection } | { ok: false; effect: InteractionEffect } {
  if (shiftKey) {
    const current = frame.selection;
    if (!current) {
      return { ok: false, effect: rejectEffect('invalidTarget', 'shift-click requires a current semantic selection', frame.id) };
    }
    if (current.frameId.value !== frame.id.value) {
      return {
        ok: false,
        effect: rejectEffect('invalidTarget', 'shift-click anchor is not projected on the current interaction frame', frame.id),
      };
    }
    if (!targetScopeCompatible(current, target)) {
      return {
        ok: false,
        effect: rejectEffect('invalidTarget', 'shift-click target is incompatible with the current semantic selection', frame.id),
      };
    }
    return {
      ok: true,
      selection: {
        frameId: frame.id,
        scope: current.scope,
        anchor: current.anchor,
        head: target,
      },
    };
  }
  return {
    ok: true,
    selection: {
      frameId: frame.id,
      scope: target.scope,
      anchor: target,
      head: target,
    },
  };
}

type ClickInteractionIntent = PointerInteractionIntent & { readonly kind: 'click' };

function validateNormalizedClickIntent(
  intent: ClickInteractionIntent,
  frameId: InteractionFrame['id'],
): InteractionEffect | null {
  if (intent.button !== undefined && intent.button !== 0) {
    return rejectEffect('unsupported', 'non-primary click button is not supported', frameId);
  }
  if (intent.buttons !== undefined) {
    if (!Number.isFinite(intent.buttons) || !Number.isInteger(intent.buttons) || intent.buttons < 0) {
      return rejectEffect('unsupported', 'click buttons bitmask is not a finite non-negative integer', frameId);
    }
    if ((intent.buttons & ~1) !== 0) {
      return rejectEffect('unsupported', 'non-primary click buttons are not supported', frameId);
    }
  }
  if (intent.clickCount !== undefined) {
    if (
      !Number.isFinite(intent.clickCount) ||
      !Number.isInteger(intent.clickCount) ||
      intent.clickCount < 1 ||
      intent.clickCount > 3
    ) {
      return rejectEffect('unsupported', 'clickCount must be 1, 2, or 3', frameId);
    }
  }
  if (intent.clickCount !== undefined && intent.clickCount > 1 && intent.shiftKey) {
    return rejectEffect('unsupported', 'shift-modified multi-click is not supported', frameId);
  }
  return null;
}

function blockRecordForTarget(frame: InteractionFrame, target: Extract<SemanticTarget, { kind: 'text' }>) {
  return frame.semanticIndex.stories
    .flatMap((story) => story.blocks)
    .find(
      (block) =>
        block.identity.storyId === target.identity.storyId &&
        block.identity.blockId === target.identity.blockId,
    );
}

function selectionFromWordHit(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>,
  wordSegments: readonly WordSegmentRecord[],
  paragraphGraphemeCount: number,
): SemanticSelection {
  const { anchor, head } = wordSelectionFromHit(target, wordSegments, paragraphGraphemeCount);
  return { frameId: frame.id, scope: target.scope, anchor, head };
}

function selectionFromBlockHit(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>,
  paragraphGraphemeCount: number,
): SemanticSelection {
  const { anchor, head } = blockSelectionFromHit(target, paragraphGraphemeCount);
  return { frameId: frame.id, scope: target.scope, anchor, head };
}

function planClick(context: InteractionPlannerContext, intent: ClickInteractionIntent): InteractionPlan {
  const frameId = context.frame.id;
  const clickRejection = validateNormalizedClickIntent(intent, frameId);
  if (clickRejection) {
    return { frameId, effects: [clickRejection] };
  }

  const hit = hitTestPointer(context.frame, intent.clientPoint, context.hostMetrics, { frameId: intent.frameId });
  if (!hit.ok) {
    return { frameId, effects: [rejectEffect(hit.code, hit.reason, hit.frameId ?? frameId)] };
  }

  if (hit.value.role === 'selectableText') {
    return { frameId, effects: [rejectEffect('readOnly', 'hit target is read-only text', frameId)] };
  }
  if (hit.value.role !== 'editableText') {
    return {
      frameId,
      effects: [
        rejectEffect(
          'unsupported',
          `hit target role ${hit.value.role} is not supported for click selection (task 5.6+)`,
          frameId,
        ),
      ],
    };
  }
  if (hit.value.target.kind !== 'text') {
    return {
      frameId,
      effects: [rejectEffect('unsupported', 'only editable text targets may create a caret or range', frameId)],
    };
  }

  const clickCount = intent.clickCount ?? 1;

  if (clickCount === 2) {
    const block = blockRecordForTarget(context.frame, hit.value.target);
    if (!block) {
      return {
        frameId,
        effects: [rejectEffect('invalidTarget', 'word selection target block is missing from semantic index', frameId)],
      };
    }
    return {
      frameId,
      effects: [
        {
          kind: 'syncSelection',
          frameId,
          selection: selectionFromWordHit(context.frame, hit.value.target, block.wordSegments, block.graphemeCount),
        },
        { kind: 'focus', frameId },
      ],
    };
  }

  if (clickCount === 3) {
    const block = blockRecordForTarget(context.frame, hit.value.target);
    if (!block) {
      return {
        frameId,
        effects: [rejectEffect('invalidTarget', 'block selection target block is missing from semantic index', frameId)],
      };
    }
    return {
      frameId,
      effects: [
        {
          kind: 'syncSelection',
          frameId,
          selection: selectionFromBlockHit(context.frame, hit.value.target, block.graphemeCount),
        },
        { kind: 'focus', frameId },
      ],
    };
  }

  const selectionOutcome = selectionFromEditableTextHit(context.frame, hit.value.target, intent.shiftKey);
  if (!selectionOutcome.ok) {
    return { frameId, effects: [selectionOutcome.effect] };
  }

  return {
    frameId,
    effects: [
      { kind: 'syncSelection', frameId, selection: selectionOutcome.selection },
      { kind: 'focus', frameId },
    ],
  };
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
    case 'click':
      return planClick(context, intent as ClickInteractionIntent);
    case 'pointerDown':
    case 'pointerMove':
    case 'pointerUp':
    case 'geometryKeyboard':
      return {
        frameId,
        effects: [
          rejectEffect(
            'unsupported',
            intent.kind === 'geometryKeyboard'
              ? 'geometry-aware keyboard interaction is not implemented yet (task 5.5+)'
              : 'pointer interaction semantics are not implemented yet (task 5.4+)',
            frameId,
          ),
        ],
      };
  }
}
