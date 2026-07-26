// Pure PM-free interaction planner (interactive-paginated-editing 5.1–5.2).

import type { ViewScope } from '@docx-editor.dev/core-contract/editor';
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
import type { Point } from '@docx-editor.dev/core-contract/types';
import type { NavigationGeometry } from './navigation-geometry.ts';
import { emptyNavigationGeometry } from './navigation-geometry.ts';
import type { ParagraphTextResolver } from './bidi-policy.ts';
import { clientToContent, contentToPageLocal, pointInRect } from './coordinate-mapper.ts';
import { hitTestPointer } from './interaction-geometry.ts';
import { planKeyboardNavigation } from './keyboard-navigation.ts';
import {
  navigationSessionPlanForIntent,
  type NavigationSession,
  type NavigationSessionPlan,
} from './navigation-session.ts';
import { blockSelectionFromHit, wordSelectionFromHit } from './word-selection.ts';

export interface InteractionPlannerContext {
  readonly frame: InteractionFrame;
  readonly editable: boolean;
  readonly readOnly: boolean;
  readonly hostMetrics?: InteractionHostMetrics;
  readonly realizedTextTarget?: Extract<SemanticTarget, { kind: 'text' }> | null;
  readonly modelRevision?: number;
  readonly activeScope?: ViewScope;
  readonly navigationSession?: NavigationSession | null;
  readonly documentGeneration?: number;
  readonly resolveParagraphText?: ParagraphTextResolver;
  readonly navigationGeometry?: NavigationGeometry;
  /**
   * Whether an IME composition is live right now.
   *
   * Read from the surface at dispatch time rather than from `frame.composition`:
   * the frame is an immutable snapshot published before the composition started, so
   * its composition field is stale exactly when this decision is made. The frame
   * still carries composition state for adapters that render it.
   */
  readonly compositionActive?: boolean;
}

/** Controller plan plus optional transactional navigation-session metadata (task 5.5). */
export interface PlannedInteraction extends InteractionPlan {
  readonly navigation?: NavigationSessionPlan;
}

function rejectEffect(
  code: InteractionOutcomeCode,
  reason: string,
  frameId: InteractionFrame['id']
): InteractionEffect {
  return { kind: 'reject', code, reason, frameId };
}

function requiresCoordinateMetrics(intent: InteractionIntent): boolean {
  return (
    intent.kind === 'pointerDown' ||
    intent.kind === 'pointerMove' ||
    intent.kind === 'pointerUp' ||
    intent.kind === 'click' ||
    intent.kind === 'geometryKeyboard'
  );
}

function validatePreconditions(
  context: InteractionPlannerContext,
  intent: InteractionIntent
): InteractionEffect | null {
  const { frame } = context;
  if ('frameId' in intent && intent.frameId.value !== frame.id.value) {
    return rejectEffect(
      'staleFrame',
      'interaction intent targets a superseded interaction frame',
      frame.id
    );
  }
  if (frame.completeness.kind === 'pending') {
    return rejectEffect(
      'pendingLayout',
      'layout for the current model revision is not yet published',
      frame.id
    );
  }
  if (context.readOnly || !context.editable) {
    return rejectEffect(
      'readOnly',
      'interaction rejected because the editor is read-only',
      frame.id
    );
  }
  if (requiresCoordinateMetrics(intent) && !context.hostMetrics) {
    return rejectEffect('invalidTarget', 'explicit InteractionHostMetrics are required', frame.id);
  }
  // A live IME composition owns the caret.
  //
  // Geometry keys were accepted during composition, and independent review
  // measured the result: with a composition live in one paragraph, ArrowDown
  // returned `ok: true` and moved the painted caret to a DIFFERENT paragraph while
  // the IME kept composing in the original one; the IME never saw the key, because
  // the bridge preventDefaults it. Text integrity survived (the binding protects
  // the composition anchor), but for the whole composition the visible caret
  // pointed somewhere the insertion point was not, and the engine reported success
  // for a move it had not really made.
  //
  // Refused rather than forwarded: the bridge owns these keys in capture phase, so
  // handing them to the IME is not on the table here, and a typed refusal is what
  // the outcome contract promises.
  if (
    intent.kind === 'geometryKeyboard' &&
    (context.compositionActive ?? frame.composition.active)
  ) {
    return rejectEffect(
      'unsupported',
      'geometry navigation is unavailable while an IME composition is active',
      frame.id
    );
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
  shiftKey: boolean | undefined
): { ok: true; selection: SemanticSelection } | { ok: false; effect: InteractionEffect } {
  if (shiftKey) {
    const current = frame.selection;
    if (!current) {
      return {
        ok: false,
        effect: rejectEffect(
          'invalidTarget',
          'shift-click requires a current semantic selection',
          frame.id
        ),
      };
    }
    if (current.frameId.value !== frame.id.value) {
      return {
        ok: false,
        effect: rejectEffect(
          'invalidTarget',
          'shift-click anchor is not projected on the current interaction frame',
          frame.id
        ),
      };
    }
    if (!targetScopeCompatible(current, target)) {
      return {
        ok: false,
        effect: rejectEffect(
          'invalidTarget',
          'shift-click target is incompatible with the current semantic selection',
          frame.id
        ),
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
  frameId: InteractionFrame['id']
): InteractionEffect | null {
  if (intent.button !== undefined && intent.button !== 0) {
    return rejectEffect('unsupported', 'non-primary click button is not supported', frameId);
  }
  if (intent.buttons !== undefined) {
    if (
      !Number.isFinite(intent.buttons) ||
      !Number.isInteger(intent.buttons) ||
      intent.buttons < 0
    ) {
      return rejectEffect(
        'unsupported',
        'click buttons bitmask is not a finite non-negative integer',
        frameId
      );
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

function blockRecordForTarget(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>
) {
  return frame.semanticIndex.stories
    .flatMap((story) => story.blocks)
    .find(
      (block) =>
        block.identity.storyId === target.identity.storyId &&
        block.identity.blockId === target.identity.blockId
    );
}

function selectionFromWordHit(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>,
  wordSegments: readonly WordSegmentRecord[],
  paragraphGraphemeCount: number
): SemanticSelection {
  const { anchor, head } = wordSelectionFromHit(target, wordSegments, paragraphGraphemeCount);
  return { frameId: frame.id, scope: target.scope, anchor, head };
}

function selectionFromBlockHit(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>,
  paragraphGraphemeCount: number
): SemanticSelection {
  const { anchor, head } = blockSelectionFromHit(target, paragraphGraphemeCount);
  return { frameId: frame.id, scope: target.scope, anchor, head };
}

function attachNavigation(
  plan: InteractionPlan,
  navigation: NavigationSessionPlan | undefined
): PlannedInteraction {
  return navigation ? { ...plan, navigation } : plan;
}

// ─── Body-paragraph interaction subset (task 5.6a) ───────────────────────────
// Declared behavior for the regions and roles inside the 5.6a gate. Everything
// outside the subset fails closed with a typed outcome; nothing here invents
// geometry — page boxes are read from the published frame only.

/**
 * True when the pointer is inside a published page box but no display item on
 * that page covers it — page background or a page margin. Separated from an
 * item that failed for its own reason (non-invertible transform, unsupported
 * writing mode), which keeps its original stricter outcome.
 *
 * Inter-page gaps are already reported by `contentToPageLocal` and reach the
 * caller through the hit-test outcome, so both regions stay `invalidTarget`
 * with a distinct reason: the spec's page-gap scenario is "return no target and
 * do not move the selection", not a capability gap.
 */
function pointerOnPageBackground(
  frame: InteractionFrame,
  clientPoint: Point,
  metrics: InteractionHostMetrics | undefined
): boolean {
  if (!metrics) return false;
  const content = clientToContent(clientPoint, metrics);
  if (!content.ok) return false;
  const pageLocal = contentToPageLocal(content.value, frame);
  if (!pageLocal.ok) return false;
  const page = frame.display.find((candidate) => candidate.index === pageLocal.value.pageIndex);
  if (!page) return false;
  return !page.items.some((item) => 'box' in item && pointInRect(pageLocal.value.local, item.box));
}

/**
 * History and selection commands are document-scoped, not insertions, so a
 * caret parked in read-only text must not wedge them.
 */
const NON_MUTATING_COMMANDS = new Set(['undo', 'redo', 'setSelection']);

// ─── Synchronous stale-frame protection (task 5.7a) ──────────────────────────
// A selection is only as trustworthy as the frame it was minted on. Every
// endpoint is re-resolved against the semantic index of the frame being acted
// on, synchronously, before any effect is planned. A superseded frame or an
// offset the current canonical state no longer contains is refused with a typed
// outcome — never clamped, never applied at a stale numeric offset.

function resolveTextTargetAgainstCanonicalState(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>
): InteractionEffect | null {
  const story = frame.semanticIndex.stories.find(
    (candidate) => candidate.storyId === target.identity.storyId
  );
  if (!story) {
    return rejectEffect(
      'invalidTarget',
      'selection story is not present in current canonical state',
      frame.id
    );
  }
  const block = story.blocks.find(
    (candidate) => candidate.identity.blockId === target.identity.blockId
  );
  if (!block) {
    return rejectEffect(
      'invalidTarget',
      'selection block is not present in current canonical state',
      frame.id
    );
  }
  if (!Number.isInteger(target.graphemeOffset)) {
    return rejectEffect('invalidTarget', 'selection grapheme offset is not an integer', frame.id);
  }
  if (target.graphemeOffset < 0 || target.graphemeOffset > block.graphemeCount) {
    return rejectEffect(
      'invalidTarget',
      'selection grapheme offset is outside current canonical state',
      frame.id
    );
  }
  return null;
}

/**
 * Re-resolve a frame-bound selection against the frame it will be applied to.
 * Returns a typed rejection, or null when every endpoint still exists.
 */
export function resolveSelectionAgainstCanonicalState(
  frame: InteractionFrame,
  selection: SemanticSelection
): InteractionEffect | null {
  if (selection.frameId.value !== frame.id.value) {
    return rejectEffect(
      'staleFrame',
      'selection was minted on a superseded interaction frame',
      frame.id
    );
  }
  for (const endpoint of [selection.anchor, selection.head]) {
    if (endpoint.kind !== 'text') continue;
    const rejection = resolveTextTargetAgainstCanonicalState(frame, endpoint);
    if (rejection) return rejection;
  }
  return null;
}

function readOnlyBlockInSelection(
  frame: InteractionFrame,
  selection: SemanticSelection | null
): boolean {
  if (!selection) return false;
  const endpoints = [selection.anchor, selection.head];
  return endpoints.some((endpoint) => {
    if (endpoint.kind !== 'text') return false;
    return blockRecordForTarget(frame, endpoint)?.readOnly === true;
  });
}

function planClick(
  context: InteractionPlannerContext,
  intent: ClickInteractionIntent
): PlannedInteraction {
  const frameId = context.frame.id;
  const clickRejection = validateNormalizedClickIntent(intent, frameId);
  const nav = navigationSessionPlanForIntent(context.navigationSession, 'click');
  if (clickRejection) {
    return attachNavigation({ frameId, effects: [clickRejection] }, nav);
  }

  let textTarget = context.realizedTextTarget ?? null;
  if (!textTarget) {
    const hit = hitTestPointer(context.frame, intent.clientPoint, context.hostMetrics, {
      frameId: intent.frameId,
    });
    if (!hit.ok) {
      if (
        hit.code === 'invalidTarget' &&
        pointerOnPageBackground(context.frame, intent.clientPoint, context.hostMetrics)
      ) {
        return attachNavigation(
          {
            frameId,
            effects: [
              rejectEffect(
                'invalidTarget',
                'pointer is on page background or a page margin, which owns no caret position',
                frameId
              ),
            ],
          },
          nav
        );
      }
      return attachNavigation(
        { frameId, effects: [rejectEffect(hit.code, hit.reason, hit.frameId ?? frameId)] },
        nav
      );
    }
    if (hit.value.role === 'selectableText') {
      return attachNavigation(
        { frameId, effects: [rejectEffect('readOnly', 'hit target is read-only text', frameId)] },
        nav
      );
    }
    if (hit.value.role !== 'editableText') {
      return attachNavigation(
        {
          frameId,
          effects: [
            rejectEffect(
              'unsupported',
              `hit target role ${hit.value.role} is not supported for click selection (task 5.6+)`,
              frameId
            ),
          ],
        },
        nav
      );
    }
    if (hit.value.target.kind !== 'text') {
      return attachNavigation(
        {
          frameId,
          effects: [
            rejectEffect(
              'unsupported',
              'only editable text targets may create a caret or range',
              frameId
            ),
          ],
        },
        nav
      );
    }
    textTarget = hit.value.target;
  }

  const clickCount = intent.clickCount ?? 1;

  if (clickCount === 2) {
    const block = blockRecordForTarget(context.frame, textTarget);
    if (!block) {
      return attachNavigation(
        {
          frameId,
          effects: [
            rejectEffect(
              'invalidTarget',
              'word selection target block is missing from semantic index',
              frameId
            ),
          ],
        },
        nav
      );
    }
    return attachNavigation(
      {
        frameId,
        effects: [
          {
            kind: 'syncSelection',
            frameId,
            selection: selectionFromWordHit(
              context.frame,
              textTarget,
              block.wordSegments,
              block.graphemeCount
            ),
          },
          { kind: 'focus', frameId },
        ],
      },
      nav
    );
  }

  if (clickCount === 3) {
    const block = blockRecordForTarget(context.frame, textTarget);
    if (!block) {
      return attachNavigation(
        {
          frameId,
          effects: [
            rejectEffect(
              'invalidTarget',
              'block selection target block is missing from semantic index',
              frameId
            ),
          ],
        },
        nav
      );
    }
    return attachNavigation(
      {
        frameId,
        effects: [
          {
            kind: 'syncSelection',
            frameId,
            selection: selectionFromBlockHit(context.frame, textTarget, block.graphemeCount),
          },
          { kind: 'focus', frameId },
        ],
      },
      nav
    );
  }

  const selectionOutcome = selectionFromEditableTextHit(
    context.frame,
    textTarget,
    intent.shiftKey
  );
  if (!selectionOutcome.ok) {
    return attachNavigation({ frameId, effects: [selectionOutcome.effect] }, nav);
  }
  // Shift-click composes a range from the frame's retained anchor, so the
  // composed selection is re-resolved before it can reach the store (task 5.7a).
  const staleAnchor = resolveSelectionAgainstCanonicalState(
    context.frame,
    selectionOutcome.selection
  );
  if (staleAnchor) {
    return attachNavigation({ frameId, effects: [staleAnchor] }, nav);
  }

  return attachNavigation(
    {
      frameId,
      effects: [
        { kind: 'syncSelection', frameId, selection: selectionOutcome.selection },
        { kind: 'focus', frameId },
      ],
    },
    nav
  );
}

/** Pure planner: maps one intent and frame context to an ordered effect plan. */
export function planInteraction(
  context: InteractionPlannerContext,
  intent: InteractionIntent
): PlannedInteraction {
  const rejection = validatePreconditions(context, intent);
  if (rejection) {
    return { frameId: context.frame.id, effects: [rejection] };
  }

  const frameId = context.frame.id;
  const navFor = (kind: string) => navigationSessionPlanForIntent(context.navigationSession, kind);

  switch (intent.kind) {
    case 'semanticSelection': {
      const staleOrInvalid = resolveSelectionAgainstCanonicalState(context.frame, intent.selection);
      if (staleOrInvalid) {
        return { frameId, effects: [staleOrInvalid] };
      }
      return attachNavigation(
        {
          frameId,
          effects: [
            { kind: 'syncSelection', frameId, selection: intent.selection },
            { kind: 'focus', frameId },
          ],
        },
        navFor('semanticSelection')
      );
    }
    case 'focus':
      return { frameId, effects: [{ kind: 'focus', frameId }] };
    case 'blur':
      return attachNavigation({ frameId, effects: [{ kind: 'blur' }] }, navFor('blur'));
    case 'command':
      // Read-only body text is selectable but never mutable: a mutating command
      // over a read-only block must not reach the store (task 5.6a).
      if (
        !NON_MUTATING_COMMANDS.has(intent.command.type) &&
        readOnlyBlockInSelection(context.frame, context.frame.selection)
      ) {
        return {
          frameId,
          effects: [
            rejectEffect(
              'readOnly',
              'command rejected because the selection covers read-only text',
              frameId
            ),
          ],
        };
      }
      return { frameId, effects: [{ kind: 'execCommand', frameId, command: intent.command }] };
    case 'delegateNativeInput':
      if (readOnlyBlockInSelection(context.frame, context.frame.selection)) {
        return {
          frameId,
          effects: [
            rejectEffect(
              'readOnly',
              'native input rejected because the selection covers read-only text',
              frameId
            ),
          ],
        };
      }
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
      return {
        frameId,
        effects: [
          rejectEffect(
            'unsupported',
            'pointer drag is handled by createEditor dispatchInteraction (task 5.4)',
            frameId
          ),
        ],
      };
    case 'pointerCancel':
      return {
        frameId,
        effects: [
          rejectEffect(
            'unsupported',
            'pointer cancel is handled by createEditor dispatchInteraction (task 5.4)',
            frameId
          ),
        ],
      };
    case 'geometryKeyboard': {
      const keyboard = planKeyboardNavigation({
        frame: context.frame,
        intent,
        priorSession: context.navigationSession ?? null,
        documentGeneration: context.documentGeneration ?? 0,
        modelRevision: context.modelRevision ?? context.frame.revisions.modelRevision,
        paragraphText: context.resolveParagraphText ?? (() => ''),
        navigation: context.navigationGeometry ?? emptyNavigationGeometry(),
      });
      return attachNavigation(keyboard.plan, keyboard.navigation);
    }
  }
}
