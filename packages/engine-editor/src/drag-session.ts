// Private pointer-drag session reducer (interactive-paginated-editing 5.4).
// Session state is owned by createEditor; the reducer is pure given session + frame context.

import type {
  InteractionEffect,
  InteractionFrame,
  InteractionHostMetrics,
  InteractionOutcomeCode,
  InteractionPlan,
  PointerInteractionIntent,
  SemanticSelection,
  SemanticTarget,
} from '@docx-editor.dev/core-contract/interaction';
import type { ViewScope } from '@docx-editor.dev/core-contract/editor';
import { hitTestPointer } from './interaction-geometry.ts';
import { navigationSessionPlanForIntent, type NavigationSession, type NavigationSessionPlan } from './navigation-session.ts';

export interface PointerDragSession {
  readonly pointerId: number;
  readonly modelRevision: number;
  readonly scope: ViewScope;
  readonly anchor: Extract<SemanticTarget, { kind: 'text' }>;
  readonly lastValidHead: Extract<SemanticTarget, { kind: 'text' }>;
}

export interface DragPlannerContext {
  readonly frame: InteractionFrame;
  readonly editable: boolean;
  readonly readOnly: boolean;
  readonly hostMetrics?: InteractionHostMetrics;
  readonly modelRevision: number;
  readonly navigationSession?: NavigationSession | null;
}

export type DragTerminalIntent =
  | { readonly kind: 'none' }
  | { readonly kind: 'release'; readonly pointerId: number; readonly cause: 'pointerUp' | 'pointerCancel' | 'abort' };

export interface DragInteractionPlan {
  readonly plan: InteractionPlan;
  readonly priorSession: PointerDragSession | null;
  readonly nextSessionOnSuccess: PointerDragSession | null;
  readonly terminal: DragTerminalIntent;
  readonly navigation?: NavigationSessionPlan;
}

/** @deprecated Use DragInteractionPlan */
export type DragPlanResult = DragInteractionPlan;

function dragPlan(
  priorSession: PointerDragSession | null,
  plan: InteractionPlan,
  nextSessionOnSuccess: PointerDragSession | null,
  terminal: DragTerminalIntent = { kind: 'none' },
  navigation?: NavigationSessionPlan,
): DragInteractionPlan {
  return { priorSession, plan, nextSessionOnSuccess, terminal, navigation };
}

function navigationClearPlan(
  context: DragPlannerContext,
  kind: 'pointerDown' | 'pointerUp',
): NavigationSessionPlan | undefined {
  return navigationSessionPlanForIntent(context.navigationSession, kind);
}

type DragPointerIntent =
  | (PointerInteractionIntent & { readonly kind: 'pointerDown' })
  | (PointerInteractionIntent & { readonly kind: 'pointerMove' })
  | (PointerInteractionIntent & { readonly kind: 'pointerUp' })
  | (PointerInteractionIntent & { readonly kind: 'pointerCancel' });
type DragPointerHitIntent = Extract<DragPointerIntent, { kind: 'pointerDown' | 'pointerMove' | 'pointerUp' }>;

function rejectEffect(code: InteractionOutcomeCode, reason: string, frameId: InteractionFrame['id']): InteractionEffect {
  return { kind: 'reject', code, reason, frameId };
}

function releaseEffect(session: PointerDragSession): InteractionEffect {
  return { kind: 'releasePointer', pointerId: session.pointerId };
}

function storyForBlock(frame: InteractionFrame, blockId: string, storyId: string) {
  return frame.semanticIndex.stories.find(
    (story) => story.storyId === storyId && story.blocks.some((block) => block.identity.blockId === blockId),
  );
}

function blockRecord(frame: InteractionFrame, blockId: string, storyId: string) {
  return storyForBlock(frame, blockId, storyId)?.blocks.find((block) => block.identity.blockId === blockId);
}

function compareBlockOrder(
  frame: InteractionFrame,
  a: Extract<SemanticTarget, { kind: 'text' }>,
  b: Extract<SemanticTarget, { kind: 'text' }>,
): number | null {
  if (a.identity.storyId !== b.identity.storyId) return null;
  const anchorBlock = blockRecord(frame, a.identity.blockId, a.identity.storyId);
  const headBlock = blockRecord(frame, b.identity.blockId, b.identity.storyId);
  if (!anchorBlock || !headBlock) return null;
  return anchorBlock.orderIndex - headBlock.orderIndex;
}

function textTargetUsable(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>,
): { ok: true } | { ok: false; effect: InteractionEffect } {
  const block = blockRecord(frame, target.identity.blockId, target.identity.storyId);
  if (!block) {
    return {
      ok: false,
      effect: rejectEffect('invalidTarget', 'drag target block is missing from semantic index', frame.id),
    };
  }
  if (block.readOnly) {
    return { ok: false, effect: rejectEffect('readOnly', 'drag target is read-only text', frame.id) };
  }
  if (target.graphemeOffset < 0 || target.graphemeOffset > block.graphemeCount) {
    return { ok: false, effect: rejectEffect('invalidTarget', 'drag target grapheme offset is out of range', frame.id) };
  }
  return { ok: true };
}

/** Validate anchor/head story, canonical order, and editable blocks across the full span before sync. */
export function validateEditableDragSpan(
  frame: InteractionFrame,
  anchor: Extract<SemanticTarget, { kind: 'text' }>,
  head: Extract<SemanticTarget, { kind: 'text' }>,
): { ok: true } | { ok: false; effect: InteractionEffect } {
  const frameId = frame.id;
  if (anchor.identity.storyId !== head.identity.storyId) {
    return { ok: false, effect: rejectEffect('invalidTarget', 'drag span crosses stories', frameId) };
  }
  const story = storyForBlock(frame, anchor.identity.blockId, anchor.identity.storyId);
  if (!story) {
    return { ok: false, effect: rejectEffect('invalidTarget', 'drag anchor story is missing from semantic index', frameId) };
  }
  const anchorBlock = blockRecord(frame, anchor.identity.blockId, anchor.identity.storyId);
  const headBlock = blockRecord(frame, head.identity.blockId, head.identity.storyId);
  if (!anchorBlock || !headBlock) {
    return {
      ok: false,
      effect: rejectEffect('invalidTarget', 'drag span endpoint block is missing from semantic index', frameId),
    };
  }
  if (anchorBlock.readOnly || headBlock.readOnly) {
    return { ok: false, effect: rejectEffect('readOnly', 'drag span endpoint is read-only', frameId) };
  }
  const order = compareBlockOrder(frame, anchor, head);
  if (order === null) {
    return { ok: false, effect: rejectEffect('unsupported', 'drag span block order is not available', frameId) };
  }
  const startBlock = order <= 0 ? anchorBlock : headBlock;
  const endBlock = order <= 0 ? headBlock : anchorBlock;
  for (const block of story.blocks) {
    if (block.orderIndex < startBlock.orderIndex || block.orderIndex > endBlock.orderIndex) continue;
    if (block.readOnly) {
      return {
        ok: false,
        effect: rejectEffect(
          'unsupported',
          'drag span crosses a read-only or unsupported block boundary',
          frameId,
        ),
      };
    }
  }
  const anchorUsable = textTargetUsable(frame, anchor);
  if (!anchorUsable.ok) return anchorUsable;
  const headUsable = textTargetUsable(frame, head);
  if (!headUsable.ok) return headUsable;
  return { ok: true };
}

function rebindTarget(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>,
): Extract<SemanticTarget, { kind: 'text' }> {
  return { ...target, scope: frame.selection?.scope ?? target.scope };
}

function selectionFromSession(
  frame: InteractionFrame,
  session: PointerDragSession,
  head: Extract<SemanticTarget, { kind: 'text' }>,
): SemanticSelection {
  return {
    frameId: frame.id,
    scope: session.scope,
    anchor: rebindTarget(frame, session.anchor),
    head: rebindTarget(frame, head),
  };
}

function validatePointerIdentity(
  pointerId: number | undefined,
  frameId: InteractionFrame['id'],
): InteractionEffect | null {
  if (pointerId === undefined) {
    return rejectEffect('invalidTarget', 'pointerId is required for pointer drag', frameId);
  }
  if (!Number.isFinite(pointerId) || !Number.isInteger(pointerId)) {
    return rejectEffect('unsupported', 'pointerId must be a finite integer', frameId);
  }
  return null;
}

function validatePointerButton(intent: DragPointerIntent, frameId: InteractionFrame['id']): InteractionEffect | null {
  if (intent.kind === 'pointerDown') {
    if (intent.button !== undefined && intent.button !== 0) {
      return rejectEffect('unsupported', 'non-primary pointer button is not supported', frameId);
    }
    if (intent.buttons !== undefined) {
      if (!Number.isFinite(intent.buttons) || !Number.isInteger(intent.buttons) || intent.buttons < 0) {
        return rejectEffect('unsupported', 'pointer buttons bitmask is not a finite non-negative integer', frameId);
      }
      if ((intent.buttons & ~1) !== 0) {
        return rejectEffect('unsupported', 'non-primary pointer buttons are not supported', frameId);
      }
    }
    if (intent.shiftKey || intent.ctrlKey || intent.metaKey || intent.altKey) {
      return rejectEffect('unsupported', 'modified pointer drag is not supported', frameId);
    }
  }
  if (intent.kind === 'pointerMove' || intent.kind === 'pointerUp') {
    if (intent.shiftKey || intent.ctrlKey || intent.metaKey || intent.altKey) {
      return rejectEffect('unsupported', 'modified pointer drag is not supported', frameId);
    }
    if (intent.buttons !== undefined) {
      if (!Number.isFinite(intent.buttons) || !Number.isInteger(intent.buttons) || intent.buttons < 0) {
        return rejectEffect('unsupported', 'pointer buttons bitmask is not a finite non-negative integer', frameId);
      }
      if (intent.kind === 'pointerMove' && (intent.buttons & ~1) !== 0) {
        return rejectEffect('unsupported', 'non-primary pointer buttons are not supported', frameId);
      }
    }
  }
  return null;
}

function intentFrameStale(context: DragPlannerContext, intent: DragPointerIntent, session: PointerDragSession | null): boolean {
  if (intent.frameId.value === context.frame.id.value) return false;
  if (session && context.modelRevision === session.modelRevision) return false;
  return true;
}

function validateActiveDragPreconditions(
  context: DragPlannerContext,
  intent: DragPointerIntent,
  session: PointerDragSession | null,
): InteractionEffect | null {
  const { frame } = context;
  if (intentFrameStale(context, intent, session)) {
    return rejectEffect('staleFrame', 'interaction intent targets a superseded interaction frame', frame.id);
  }
  if (frame.completeness.kind === 'pending') {
    return rejectEffect('pendingLayout', 'layout for the current model revision is not yet published', frame.id);
  }
  if (context.readOnly || !context.editable) {
    return rejectEffect('readOnly', 'interaction rejected because the editor is read-only', frame.id);
  }
  if ((intent.kind === 'pointerDown' || intent.kind === 'pointerMove' || intent.kind === 'pointerUp') && !context.hostMetrics) {
    return rejectEffect('invalidTarget', 'explicit InteractionHostMetrics are required', frame.id);
  }
  return null;
}

function matchingPointer(session: PointerDragSession, intent: DragPointerIntent): boolean {
  if (intent.pointerId === undefined) return true;
  return intent.pointerId === session.pointerId;
}

function resolveEditableTextHit(
  context: DragPlannerContext,
  intent: DragPointerHitIntent,
): { ok: true; target: Extract<SemanticTarget, { kind: 'text' }> } | { ok: false; effect: InteractionEffect } {
  const hit = hitTestPointer(context.frame, intent.clientPoint, context.hostMetrics, { frameId: context.frame.id });
  if (!hit.ok) {
    return {
      ok: false,
      effect: rejectEffect(hit.code, hit.reason, hit.frameId ?? context.frame.id),
    };
  }
  if (hit.value.role === 'selectableText') {
    return { ok: false, effect: rejectEffect('readOnly', 'hit target is read-only text', context.frame.id) };
  }
  if (hit.value.role !== 'editableText') {
    return {
      ok: false,
      effect: rejectEffect(
        'unsupported',
        `hit target role ${hit.value.role} is not supported for drag selection (task 5.6+)`,
        context.frame.id,
      ),
    };
  }
  if (hit.value.target.kind !== 'text') {
    return {
      ok: false,
      effect: rejectEffect('unsupported', 'only editable text targets may extend a drag selection', context.frame.id),
    };
  }
  const usable = textTargetUsable(context.frame, hit.value.target);
  if (!usable.ok) return usable;
  return { ok: true, target: hit.value.target };
}

function anchorStillValid(frame: InteractionFrame, session: PointerDragSession): boolean {
  const anchorBlock = blockRecord(frame, session.anchor.identity.blockId, session.anchor.identity.storyId);
  if (!anchorBlock || anchorBlock.readOnly) return false;
  return session.anchor.graphemeOffset >= 0 && session.anchor.graphemeOffset <= anchorBlock.graphemeCount;
}

function terminalRejectAndRelease(
  context: DragPlannerContext,
  session: PointerDragSession,
  effect: InteractionEffect,
  cause: 'pointerUp' | 'abort' = 'abort',
): DragInteractionPlan {
  return dragPlan(
    session,
    { frameId: context.frame.id, effects: [effect, releaseEffect(session)] },
    null,
    { kind: 'release', pointerId: session.pointerId, cause },
  );
}

function planPointerDown(
  context: DragPlannerContext,
  intent: Extract<DragPointerIntent, { kind: 'pointerDown' }>,
  session: PointerDragSession | null,
): DragInteractionPlan {
  const frameId = context.frame.id;
  if (session) {
    return dragPlan(
      session,
      { frameId, effects: [rejectEffect('unsupported', 'pointer drag session is already active', frameId)] },
      session,
    );
  }
  const pointerRejection = validatePointerIdentity(intent.pointerId, frameId);
  if (pointerRejection) {
    return dragPlan(null, { frameId, effects: [pointerRejection] }, null);
  }
  const buttonRejection = validatePointerButton(intent, frameId);
  if (buttonRejection) {
    return dragPlan(null, { frameId, effects: [buttonRejection] }, null);
  }
  const hit = resolveEditableTextHit(context, intent);
  if (!hit.ok) {
    return dragPlan(null, { frameId, effects: [hit.effect] }, null);
  }
  const pointerId = intent.pointerId!;
  const nextSession: PointerDragSession = {
    pointerId,
    modelRevision: context.modelRevision,
    scope: hit.target.scope,
    anchor: hit.target,
    lastValidHead: hit.target,
  };
  const selection = selectionFromSession(context.frame, nextSession, hit.target);
  return dragPlan(
    null,
    {
      frameId,
      effects: [
        { kind: 'capturePointer', pointerId },
        { kind: 'syncSelection', frameId, selection },
        { kind: 'focus', frameId },
      ],
    },
    nextSession,
    { kind: 'none' },
    navigationClearPlan(context, 'pointerDown'),
  );
}

function planPointerMove(
  context: DragPlannerContext,
  intent: Extract<DragPointerIntent, { kind: 'pointerMove' }>,
  session: PointerDragSession | null,
): DragInteractionPlan {
  const frameId = context.frame.id;
  if (!session) {
    return dragPlan(
      null,
      { frameId, effects: [rejectEffect('invalidTarget', 'pointer move without an active drag session', frameId)] },
      null,
    );
  }
  if (!matchingPointer(session, intent)) {
    return dragPlan(session, { frameId, effects: [] }, session);
  }
  const buttonRejection = validatePointerButton(intent, frameId);
  if (buttonRejection) {
    return dragPlan(session, { frameId, effects: [buttonRejection] }, session);
  }
  if (context.modelRevision !== session.modelRevision) {
    return terminalRejectAndRelease(
      context,
      session,
      rejectEffect('staleFrame', 'model revision changed during pointer capture; drag cancelled', frameId),
    );
  }
  const rejection = validateActiveDragPreconditions(context, intent, session);
  if (rejection) {
    return dragPlan(session, { frameId, effects: [rejection] }, session);
  }
  if (!anchorStillValid(context.frame, session)) {
    return terminalRejectAndRelease(
      context,
      session,
      rejectEffect('invalidTarget', 'drag anchor is no longer valid', frameId),
    );
  }
  const hit = resolveEditableTextHit(context, intent);
  if (!hit.ok) {
    return dragPlan(session, { frameId, effects: [] }, session);
  }
  const span = validateEditableDragSpan(context.frame, session.anchor, hit.target);
  if (!span.ok) {
    return dragPlan(session, { frameId, effects: [] }, session);
  }
  const nextSession: PointerDragSession = { ...session, lastValidHead: hit.target };
  const selection = selectionFromSession(context.frame, nextSession, hit.target);
  return dragPlan(
    session,
    {
      frameId,
      effects: [
        { kind: 'syncSelection', frameId, selection },
        { kind: 'publishSelectionOverlay', frameId, selection },
      ],
    },
    nextSession,
  );
}

function planTerminalPointerUp(
  context: DragPlannerContext,
  intent: Extract<DragPointerIntent, { kind: 'pointerUp' }>,
  session: PointerDragSession,
): DragInteractionPlan {
  const frameId = context.frame.id;
  if (intentFrameStale(context, intent, session)) {
    return terminalRejectAndRelease(
      context,
      session,
      rejectEffect('staleFrame', 'interaction intent targets a superseded interaction frame', frameId),
      'pointerUp',
    );
  }
  if (context.modelRevision !== session.modelRevision) {
    return terminalRejectAndRelease(
      context,
      session,
      rejectEffect('staleFrame', 'model revision changed during pointer capture; drag cancelled', frameId),
      'pointerUp',
    );
  }
  if (context.frame.completeness.kind === 'pending') {
    return terminalRejectAndRelease(
      context,
      session,
      rejectEffect('pendingLayout', 'layout for the current model revision is not yet published', frameId),
      'pointerUp',
    );
  }
  if (context.readOnly || !context.editable) {
    return terminalRejectAndRelease(
      context,
      session,
      rejectEffect('readOnly', 'interaction rejected because the editor is read-only', frameId),
      'pointerUp',
    );
  }
  if (!context.hostMetrics) {
    return terminalRejectAndRelease(
      context,
      session,
      rejectEffect('invalidTarget', 'explicit InteractionHostMetrics are required', frameId),
      'pointerUp',
    );
  }
  if (!anchorStillValid(context.frame, session)) {
    return terminalRejectAndRelease(
      context,
      session,
      rejectEffect('invalidTarget', 'drag anchor is no longer valid', frameId),
      'pointerUp',
    );
  }
  const hit = resolveEditableTextHit(context, intent);
  if (!hit.ok) {
    return terminalRejectAndRelease(context, session, hit.effect, 'pointerUp');
  }
  const span = validateEditableDragSpan(context.frame, session.anchor, hit.target);
  if (!span.ok) {
    return terminalRejectAndRelease(context, session, span.effect, 'pointerUp');
  }
  const selection = selectionFromSession(context.frame, session, hit.target);
  return dragPlan(
    session,
    {
      frameId,
      effects: [
        { kind: 'syncSelection', frameId, selection },
        { kind: 'publishSelectionOverlay', frameId, selection },
        releaseEffect(session),
      ],
    },
    null,
    { kind: 'release', pointerId: session.pointerId, cause: 'pointerUp' },
    navigationClearPlan(context, 'pointerUp'),
  );
}

function planPointerUp(
  context: DragPlannerContext,
  intent: Extract<DragPointerIntent, { kind: 'pointerUp' }>,
  session: PointerDragSession | null,
): DragInteractionPlan {
  const frameId = context.frame.id;
  if (!session) {
    return dragPlan(
      null,
      { frameId, effects: [rejectEffect('invalidTarget', 'pointer up without an active drag session', frameId)] },
      null,
    );
  }
  if (!matchingPointer(session, intent)) {
    return dragPlan(session, { frameId, effects: [] }, session);
  }
  const buttonRejection = validatePointerButton(intent, frameId);
  if (buttonRejection) {
    return dragPlan(session, { frameId, effects: [buttonRejection] }, session);
  }
  return planTerminalPointerUp(context, intent, session);
}

function planPointerCancel(
  context: DragPlannerContext,
  intent: Extract<DragPointerIntent, { kind: 'pointerCancel' }>,
  session: PointerDragSession | null,
): DragInteractionPlan {
  const frameId = context.frame.id;
  if (!session) {
    return dragPlan(null, { frameId, effects: [] }, null);
  }
  if (!matchingPointer(session, intent)) {
    return dragPlan(session, { frameId, effects: [] }, session);
  }
  return dragPlan(
    session,
    { frameId, effects: [releaseEffect(session)] },
    null,
    { kind: 'release', pointerId: session.pointerId, cause: 'pointerCancel' },
  );
}

/** Pure drag reducer: maps one pointer intent + optional session to a plan and session transition. */
export function planPointerDragInteraction(
  context: DragPlannerContext,
  intent: DragPointerIntent,
  session: PointerDragSession | null,
): DragInteractionPlan {
  if (session && (intent.kind === 'pointerMove' || intent.kind === 'pointerUp' || intent.kind === 'pointerCancel')) {
    if (intent.pointerId !== undefined && intent.pointerId !== session.pointerId) {
      return dragPlan(session, { frameId: context.frame.id, effects: [] }, session);
    }
  }

  if (intent.kind === 'pointerCancel') {
    return planPointerCancel(context, intent, session);
  }

  if (intent.kind === 'pointerUp' && session) {
    return planPointerUp(context, intent, session);
  }

  const rejection = validateActiveDragPreconditions(context, intent, session);
  if (rejection) {
    if (session && context.modelRevision !== session.modelRevision) {
      return terminalRejectAndRelease(context, session, rejection);
    }
    if (session && intent.kind === 'pointerMove') {
      return dragPlan(session, { frameId: context.frame.id, effects: [rejection] }, session);
    }
    return dragPlan(session, { frameId: context.frame.id, effects: [rejection] }, session);
  }

  switch (intent.kind) {
    case 'pointerDown':
      return planPointerDown(context, intent, session);
    case 'pointerMove':
      return planPointerMove(context, intent, session);
    case 'pointerUp':
      return planPointerUp(context, intent, session);
  }
}
