// Keyboard navigation geometry (interactive-paginated-editing 5.5).

import type {
  GeometryKeyboardInteractionIntent,
  InteractionEffect,
  InteractionFrame,
  InteractionPlan,
  SemanticSelection,
  SemanticTarget,
} from '@docx-editor.dev/core-contract/contracts/interaction';
import {
  scopesEqual,
  validateKeyboardBidiTrust,
  type ParagraphTextResolver,
} from './bidi-policy.ts';
import { deriveCaretGeometry } from './interaction-geometry.ts';
import type { CaretStopProvenance, NavigationGeometry } from './navigation-geometry.ts';
import { traversalLinksForBlock } from './navigation-geometry.ts';
import {
  buildLineCatalog,
  caretContentX,
  destinationOverlayVisible,
  lineForTarget,
  nearestStopOnLine,
  pageRelativeY,
  type LineCaretStop,
  type VisualLine,
} from './line-catalog.ts';
import {
  buildNavigationSession,
  sessionMatchesSelection,
  type NavigationSession,
  type NavigationSessionPlan,
} from './navigation-session.ts';
import { caretAffinity } from './semantic-index.ts';
import {
  horizontalTransitionStopsForBlock,
  isHorizontalTransitionOffset,
  nextHorizontalTransitionStop,
} from './navigation-stops.ts';

const SUPPORTED_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

const HORIZONTAL_KEYS = new Set(['ArrowLeft', 'ArrowRight']);
const VERTICAL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']);
const LINE_EDGE_KEYS = new Set(['Home', 'End']);

export interface KeyboardNavigationInput {
  readonly frame: InteractionFrame;
  readonly intent: GeometryKeyboardInteractionIntent;
  readonly priorSession: NavigationSession | null;
  readonly documentGeneration: number;
  readonly modelRevision: number;
  readonly paragraphText: ParagraphTextResolver;
  readonly navigation: NavigationGeometry;
}

const MODIFIER_KEYS = ['shiftKey', 'ctrlKey', 'metaKey', 'altKey'] as const;

function validateKeyboardModifiers(
  intent: GeometryKeyboardInteractionIntent
): { ok: true } | { ok: false; reason: string } {
  for (const key of MODIFIER_KEYS) {
    const value = intent[key];
    if (value !== undefined && typeof value !== 'boolean') {
      return { ok: false, reason: `keyboard modifier ${key} must be a boolean when present` };
    }
  }
  return { ok: true };
}

function validateBidiForNavigation(
  frame: InteractionFrame,
  selection: SemanticSelection,
  paragraphText: ParagraphTextResolver,
  destination: Extract<SemanticTarget, { kind: 'text' }> | null
): { ok: true } | { ok: false; reason: string } {
  const extra = destination ? [destination] : [];
  return validateKeyboardBidiTrust(frame, selection, paragraphText, extra);
}

function rejectEffect(
  code: 'invalidTarget' | 'unsupported' | 'readOnly',
  reason: string,
  frameId: InteractionFrame['id']
): InteractionEffect {
  return { kind: 'reject', code, reason, frameId };
}

function blockRecord(frame: InteractionFrame, blockId: string, storyId: string) {
  return frame.semanticIndex.stories
    .find((story) => story.storyId === storyId)
    ?.blocks.find((block) => block.identity.blockId === blockId);
}

function compareTargets(
  frame: InteractionFrame,
  a: Extract<SemanticTarget, { kind: 'text' }>,
  b: Extract<SemanticTarget, { kind: 'text' }>
): number | null {
  if (a.identity.storyId !== b.identity.storyId) return null;
  const aBlock = blockRecord(frame, a.identity.blockId, a.identity.storyId);
  const bBlock = blockRecord(frame, b.identity.blockId, b.identity.storyId);
  if (!aBlock || !bBlock) return null;
  if (aBlock.orderIndex !== bBlock.orderIndex) return aBlock.orderIndex - bBlock.orderIndex;
  if (a.graphemeOffset !== b.graphemeOffset) return a.graphemeOffset - b.graphemeOffset;
  if (a.affinity === b.affinity) return 0;
  return a.affinity === 'upstream' ? -1 : 1;
}

export function selectionCollapsed(frame: InteractionFrame, selection: SemanticSelection): boolean {
  if (selection.anchor.kind !== 'text' || selection.head.kind !== 'text') return false;
  const cmp = compareTargets(frame, selection.anchor, selection.head);
  return cmp === 0;
}

function validateEditableTarget(
  frame: InteractionFrame,
  target: Extract<SemanticTarget, { kind: 'text' }>
): { ok: true } | { ok: false; effect: InteractionEffect } {
  const block = blockRecord(frame, target.identity.blockId, target.identity.storyId);
  if (!block) {
    return {
      ok: false,
      effect: rejectEffect(
        'invalidTarget',
        'navigation target block is missing from semantic index',
        frame.id
      ),
    };
  }
  if (block.readOnly) {
    return {
      ok: false,
      effect: rejectEffect(
        'readOnly',
        'navigation into read-only text is not supported in task 5.5',
        frame.id
      ),
    };
  }
  if (target.graphemeOffset < 0 || target.graphemeOffset > block.graphemeCount) {
    return {
      ok: false,
      effect: rejectEffect(
        'invalidTarget',
        'navigation target grapheme offset is out of range',
        frame.id
      ),
    };
  }
  return { ok: true };
}

function rebindTarget(
  scope: SemanticSelection['scope'],
  target: Extract<SemanticTarget, { kind: 'text' }>
) {
  return { ...target, scope };
}

function selectionFromHead(
  frame: InteractionFrame,
  selection: SemanticSelection,
  head: Extract<SemanticTarget, { kind: 'text' }>,
  shiftKey: boolean
): SemanticSelection {
  const anchor =
    shiftKey && selection.anchor.kind === 'text'
      ? rebindTarget(selection.scope, selection.anchor)
      : rebindTarget(selection.scope, head);
  return {
    frameId: frame.id,
    scope: selection.scope,
    anchor,
    head: rebindTarget(selection.scope, head),
  };
}

function collapseSelection(
  frame: InteractionFrame,
  selection: SemanticSelection,
  backward: boolean
): Extract<SemanticTarget, { kind: 'text' }> {
  if (selection.anchor.kind !== 'text' || selection.head.kind !== 'text') {
    return selection.head as Extract<SemanticTarget, { kind: 'text' }>;
  }
  const cmp = compareTargets(frame, selection.anchor, selection.head);
  if (cmp === null) return selection.head;
  if (backward) return cmp <= 0 ? selection.anchor : selection.head;
  return cmp <= 0 ? selection.head : selection.anchor;
}

function blockedByStructuralBoundary(
  frame: InteractionFrame,
  navigation: NavigationGeometry,
  block: NonNullable<ReturnType<typeof blockRecord>>,
  dir: -1 | 1
): boolean {
  const links = traversalLinksForBlock(navigation, block.identity.blockId);
  const linkedId = dir < 0 ? links.previousEditableBlockId : links.nextEditableBlockId;
  if (linkedId) return false;
  const story = frame.semanticIndex.stories.find((s) => s.storyId === block.identity.storyId);
  if (!story) return false;
  const neighborOrder = block.orderIndex + (dir < 0 ? -1 : 1);
  return story.blocks.some((candidate) => candidate.orderIndex === neighborOrder);
}

function adjacentEditableBlock(
  frame: InteractionFrame,
  navigation: NavigationGeometry,
  current: Extract<SemanticTarget, { kind: 'text' }>,
  dir: -1 | 1
): Extract<SemanticTarget, { kind: 'text' }> | null | 'readOnly' {
  const block = blockRecord(frame, current.identity.blockId, current.identity.storyId);
  if (!block) return null;
  const links = traversalLinksForBlock(navigation, block.identity.blockId);
  const linkedId = dir < 0 ? links.previousEditableBlockId : links.nextEditableBlockId;
  if (!linkedId) return null;
  const candidate = blockRecord(frame, linkedId, current.identity.storyId);
  if (!candidate) return null;
  if (candidate.readOnly) return 'readOnly';
  const graphemeOffset = dir < 0 ? candidate.graphemeCount : 0;
  return {
    kind: 'text',
    scope: current.scope,
    identity: candidate.identity,
    graphemeOffset,
    affinity: caretAffinity(graphemeOffset, candidate.graphemeCount),
  };
}

function validateScopeCompatible(
  frame: InteractionFrame,
  selection: SemanticSelection,
  target: Extract<SemanticTarget, { kind: 'text' }>
): { ok: true } | { ok: false; effect: InteractionEffect } {
  if (!scopesEqual(selection.scope, target.scope)) {
    return {
      ok: false,
      effect: rejectEffect(
        'unsupported',
        'cross-scope keyboard navigation is not supported in task 5.5',
        frame.id
      ),
    };
  }
  if (
    selection.head.kind === 'text' &&
    target.identity.storyId !== selection.head.identity.storyId
  ) {
    return {
      ok: false,
      effect: rejectEffect(
        'unsupported',
        'cross-story keyboard navigation is not supported in task 5.5',
        frame.id
      ),
    };
  }
  return { ok: true };
}

export function moveHorizontal(
  frame: InteractionFrame,
  navigation: NavigationGeometry,
  selection: SemanticSelection,
  key: 'ArrowLeft' | 'ArrowRight',
  shiftKey: boolean
):
  | { ok: true; head: Extract<SemanticTarget, { kind: 'text' }>; provenance: CaretStopProvenance }
  | { ok: false; effect: InteractionEffect } {
  const backward = key === 'ArrowLeft';
  const dir = backward ? -1 : 1;
  if (!shiftKey && !selectionCollapsed(frame, selection)) {
    return {
      ok: true,
      head: collapseSelection(frame, selection, backward),
      provenance: 'geometry',
    };
  }
  const head = selection.head;
  if (head.kind !== 'text' || selection.anchor.kind !== 'text') {
    return {
      ok: false,
      effect: rejectEffect(
        'invalidTarget',
        'keyboard navigation requires a text selection',
        frame.id
      ),
    };
  }
  const block = blockRecord(frame, head.identity.blockId, head.identity.storyId);
  if (!block) {
    return {
      ok: false,
      effect: rejectEffect(
        'invalidTarget',
        'navigation head block is missing from semantic index',
        frame.id
      ),
    };
  }
  if (block.readOnly) {
    return {
      ok: false,
      effect: rejectEffect(
        'readOnly',
        'navigation into read-only text is not supported in task 5.5',
        frame.id
      ),
    };
  }
  const transitionStops = horizontalTransitionStopsForBlock(
    navigation,
    head.identity.storyId,
    head.identity.blockId,
    block.graphemeCount
  );
  if (transitionStops.length === 0) {
    return {
      ok: false,
      effect: rejectEffect('unsupported', 'block has no horizontal transition stops', frame.id),
    };
  }
  if (
    !isHorizontalTransitionOffset(
      navigation,
      head.identity.storyId,
      head.identity.blockId,
      head.graphemeOffset,
      block.graphemeCount
    )
  ) {
    return {
      ok: false,
      effect: rejectEffect(
        'invalidTarget',
        'caret is not on a trusted horizontal transition stop',
        frame.id
      ),
    };
  }
  const firstStop = transitionStops[0]!;
  const lastStop = transitionStops[transitionStops.length - 1]!;
  const atStart = head.graphemeOffset <= firstStop.graphemeOffset;
  const atEnd = head.graphemeOffset >= lastStop.graphemeOffset;
  if ((backward && atStart) || (!backward && atEnd)) {
    const adjacent = adjacentEditableBlock(frame, navigation, head, dir);
    if (adjacent === 'readOnly') {
      return {
        ok: false,
        effect: rejectEffect(
          'unsupported',
          'navigation crosses a read-only or unsupported block boundary',
          frame.id
        ),
      };
    }
    if (!adjacent) {
      if (blockedByStructuralBoundary(frame, navigation, block, dir)) {
        return {
          ok: false,
          effect: rejectEffect(
            'unsupported',
            'navigation crosses a read-only or unsupported block boundary',
            frame.id
          ),
        };
      }
      return { ok: true, head, provenance: 'geometry' };
    }
    const usable = validateEditableTarget(frame, adjacent);
    if (!usable.ok) return usable;
    return { ok: true, head: adjacent, provenance: 'geometry' };
  }
  const next = nextHorizontalTransitionStop(navigation, head, dir, block.graphemeCount);
  if (!next) {
    return {
      ok: false,
      effect: rejectEffect(
        'invalidTarget',
        'no trusted horizontal transition destination',
        frame.id
      ),
    };
  }
  if (
    next.provenance === 'geometry' &&
    !destinationOverlayVisible(frame, navigation, next.target)
  ) {
    return {
      ok: false,
      effect: rejectEffect(
        'invalidTarget',
        'horizontal navigation destination is not visible',
        frame.id
      ),
    };
  }
  return { ok: true, head: next.target, provenance: next.provenance };
}

function lineEdgeTarget(line: VisualLine, edge: 'start' | 'end'): LineCaretStop {
  const editable = line.stops.filter((stop) => stop.role === 'editableText');
  const pool = editable.length > 0 ? editable : line.stops;
  return edge === 'start' ? pool[0]! : pool[pool.length - 1]!;
}

export function moveVertical(
  frame: InteractionFrame,
  navigation: NavigationGeometry,
  selection: SemanticSelection,
  key: 'ArrowUp' | 'ArrowDown',
  visualAdvanceX: number
):
  | { ok: true; head: Extract<SemanticTarget, { kind: 'text' }>; visualAdvanceX: number }
  | { ok: false; effect: InteractionEffect } {
  const catalog = buildLineCatalog(frame, navigation);
  if (!catalog.ok) {
    return { ok: false, effect: rejectEffect('unsupported', catalog.reason, frame.id) };
  }
  const head = selection.head;
  if (head.kind !== 'text') {
    return {
      ok: false,
      effect: rejectEffect('invalidTarget', 'vertical navigation requires a text caret', frame.id),
    };
  }
  const currentLine = lineForTarget(catalog.lines, head, frame, navigation);
  if (!currentLine) {
    return {
      ok: false,
      effect: rejectEffect(
        'invalidTarget',
        'current caret line is not in the line catalog',
        frame.id
      ),
    };
  }
  const targetLineOrder = currentLine.lineOrder + (key === 'ArrowUp' ? -1 : 1);
  const targetLine = catalog.lines.find(
    (line) =>
      line.lineOrder === targetLineOrder &&
      line.storyId === head.identity.storyId &&
      scopesEqual(line.scope, selection.scope)
  );
  if (!targetLine) return { ok: true, head, visualAdvanceX };
  const stop = nearestStopOnLine(targetLine, visualAdvanceX);
  if (stop.role !== 'editableText') {
    return {
      ok: false,
      effect: rejectEffect('readOnly', 'vertical navigation target is read-only', frame.id),
    };
  }
  if (!destinationOverlayVisible(frame, navigation, stop.target)) {
    return {
      ok: false,
      effect: rejectEffect(
        'invalidTarget',
        'vertical navigation destination is not visible',
        frame.id
      ),
    };
  }
  const scopeOk = validateScopeCompatible(frame, selection, stop.target);
  if (!scopeOk.ok) return scopeOk;
  return { ok: true, head: stop.target, visualAdvanceX };
}

export function movePage(
  frame: InteractionFrame,
  navigation: NavigationGeometry,
  selection: SemanticSelection,
  key: 'PageUp' | 'PageDown',
  visualAdvanceX: number
):
  | { ok: true; head: Extract<SemanticTarget, { kind: 'text' }>; visualAdvanceX: number }
  | { ok: false; effect: InteractionEffect } {
  const catalog = buildLineCatalog(frame, navigation);
  if (!catalog.ok) {
    return { ok: false, effect: rejectEffect('unsupported', catalog.reason, frame.id) };
  }
  const head = selection.head;
  if (head.kind !== 'text') {
    return {
      ok: false,
      effect: rejectEffect('invalidTarget', 'page navigation requires a text caret', frame.id),
    };
  }
  const caret = deriveCaretGeometry(frame, head);
  if (!caret) {
    return {
      ok: false,
      effect: rejectEffect('invalidTarget', 'page navigation requires caret geometry', frame.id),
    };
  }
  const relativeY = pageRelativeY(frame, caret.pageIndex, caret.rect.y + caret.rect.height / 2);
  if (relativeY === null) {
    return {
      ok: false,
      effect: rejectEffect(
        'invalidTarget',
        'page navigation could not resolve relative page position',
        frame.id
      ),
    };
  }
  const targetPage = caret.pageIndex + (key === 'PageUp' ? -1 : 1);
  if (!frame.display.some((page) => page.index === targetPage)) {
    return {
      ok: false,
      effect: rejectEffect(
        'invalidTarget',
        'target page is not mounted in the current interaction frame',
        frame.id
      ),
    };
  }
  const pageLines = catalog.lines.filter(
    (line) =>
      line.pageIndex === targetPage &&
      line.storyId === head.identity.storyId &&
      scopesEqual(line.scope, selection.scope)
  );
  if (pageLines.length === 0) {
    return {
      ok: false,
      effect: rejectEffect(
        'invalidTarget',
        'target page has no navigable lines in the current frame',
        frame.id
      ),
    };
  }
  let bestLine = pageLines[0]!;
  let bestDist = Math.abs((pageRelativeY(frame, targetPage, bestLine.contentY) ?? 0) - relativeY);
  for (const line of pageLines) {
    const lineRelative = pageRelativeY(frame, targetPage, line.contentY) ?? 0;
    const dist = Math.abs(lineRelative - relativeY);
    if (dist < bestDist - 1e-9) {
      bestLine = line;
      bestDist = dist;
    }
  }
  const stop = nearestStopOnLine(bestLine, visualAdvanceX);
  if (stop.role !== 'editableText') {
    return {
      ok: false,
      effect: rejectEffect('readOnly', 'page navigation target is read-only', frame.id),
    };
  }
  if (!destinationOverlayVisible(frame, navigation, stop.target)) {
    return {
      ok: false,
      effect: rejectEffect('invalidTarget', 'page navigation destination is not visible', frame.id),
    };
  }
  const scopeOk = validateScopeCompatible(frame, selection, stop.target);
  if (!scopeOk.ok) return scopeOk;
  return { ok: true, head: stop.target, visualAdvanceX };
}

function keyboardReject(
  priorSession: NavigationSession | null,
  frameId: InteractionFrame['id'],
  effect: InteractionEffect
): { plan: InteractionPlan; navigation: NavigationSessionPlan } {
  return {
    plan: { frameId, effects: [effect] },
    navigation: { priorSession, nextSessionOnSuccess: priorSession },
  };
}

function keyboardSuccess(
  frame: InteractionFrame,
  selection: SemanticSelection,
  priorSession: NavigationSession | null,
  nextSession: NavigationSession | null
): { plan: InteractionPlan; navigation: NavigationSessionPlan } {
  return {
    plan: {
      frameId: frame.id,
      effects: [
        { kind: 'syncSelection', frameId: frame.id, selection },
        { kind: 'publishSelectionOverlay', frameId: frame.id, selection },
      ],
    },
    navigation: { priorSession, nextSessionOnSuccess: nextSession },
  };
}

function finalizeKeyboardMove(
  frame: InteractionFrame,
  navigation: NavigationGeometry,
  selection: SemanticSelection,
  priorSession: NavigationSession | null,
  nextSession: NavigationSession | null,
  head: Extract<SemanticTarget, { kind: 'text' }>,
  shiftKey: boolean,
  paragraphText: ParagraphTextResolver,
  destinationProvenance: CaretStopProvenance = 'geometry'
): { plan: InteractionPlan; navigation: NavigationSessionPlan } {
  const bidiDest = validateBidiForNavigation(frame, selection, paragraphText, head);
  if (!bidiDest.ok) {
    return keyboardReject(
      priorSession,
      frame.id,
      rejectEffect('unsupported', bidiDest.reason, frame.id)
    );
  }
  const collapsedNoOp =
    !shiftKey &&
    selection.anchor.kind === 'text' &&
    selection.head.kind === 'text' &&
    head.kind === 'text' &&
    head.graphemeOffset === selection.head.graphemeOffset &&
    head.affinity === selection.head.affinity &&
    head.identity.blockId === selection.head.identity.blockId &&
    head.identity.storyId === selection.head.identity.storyId;
  if (
    !collapsedNoOp &&
    destinationProvenance !== 'semanticWholeGrapheme' &&
    !destinationOverlayVisible(frame, navigation, head)
  ) {
    return keyboardReject(
      priorSession,
      frame.id,
      rejectEffect('invalidTarget', 'keyboard navigation destination is not visible', frame.id)
    );
  }
  return keyboardSuccess(
    frame,
    selectionFromHead(frame, selection, head, shiftKey),
    priorSession,
    nextSession
  );
}

/** Plan keyboard navigation after shared planner preconditions succeed. */
export function planKeyboardNavigation(input: KeyboardNavigationInput): {
  plan: InteractionPlan;
  navigation: NavigationSessionPlan;
} {
  const {
    frame,
    intent,
    priorSession,
    documentGeneration,
    modelRevision,
    paragraphText,
    navigation,
  } = input;
  const frameId = frame.id;

  const modifiers = validateKeyboardModifiers(intent);
  if (!modifiers.ok) {
    return keyboardReject(
      priorSession,
      frameId,
      rejectEffect('unsupported', modifiers.reason, frameId)
    );
  }
  if (intent.ctrlKey === true || intent.metaKey === true || intent.altKey === true) {
    return keyboardReject(
      priorSession,
      frameId,
      rejectEffect(
        'unsupported',
        'modified keyboard navigation is not supported in task 5.5',
        frameId
      )
    );
  }
  if (!SUPPORTED_KEYS.has(intent.key)) {
    return keyboardReject(
      priorSession,
      frameId,
      rejectEffect('unsupported', `unsupported geometry keyboard key ${intent.key}`, frameId)
    );
  }
  if (!frame.focus.focused) {
    return keyboardReject(
      priorSession,
      frameId,
      rejectEffect(
        'invalidTarget',
        'geometry keyboard navigation requires a focused interaction frame',
        frameId
      )
    );
  }
  if (!navigation.shapingSupported) {
    return keyboardReject(
      priorSession,
      frameId,
      rejectEffect(
        'unsupported',
        'layout shaping does not support exact keyboard navigation caret edges',
        frameId
      )
    );
  }
  const selection = frame.selection;
  if (!selection || selection.frameId.value !== frame.id.value) {
    return keyboardReject(
      priorSession,
      frameId,
      rejectEffect(
        'invalidTarget',
        'keyboard navigation requires a current semantic selection',
        frameId
      )
    );
  }
  if (selection.anchor.kind !== 'text' || selection.head.kind !== 'text') {
    return keyboardReject(
      priorSession,
      frameId,
      rejectEffect(
        'unsupported',
        'keyboard navigation for non-text selections is deferred to task 5.6',
        frameId
      )
    );
  }

  if (selection.anchor.identity.storyId !== selection.head.identity.storyId) {
    return keyboardReject(
      priorSession,
      frameId,
      rejectEffect(
        'unsupported',
        'cross-story keyboard navigation is not supported in task 5.5',
        frameId
      )
    );
  }

  const mixed = validateKeyboardBidiTrust(frame, selection, paragraphText);
  if (!mixed.ok) {
    return keyboardReject(
      priorSession,
      frameId,
      rejectEffect('unsupported', mixed.reason, frameId)
    );
  }

  const shiftKey = intent.shiftKey === true;

  if (HORIZONTAL_KEYS.has(intent.key)) {
    const moved = moveHorizontal(
      frame,
      navigation,
      selection,
      intent.key as 'ArrowLeft' | 'ArrowRight',
      shiftKey
    );
    if (!moved.ok) return keyboardReject(priorSession, frameId, moved.effect);
    const usable = validateEditableTarget(frame, moved.head);
    if (!usable.ok) return keyboardReject(priorSession, frameId, usable.effect);
    return finalizeKeyboardMove(
      frame,
      navigation,
      selection,
      priorSession,
      null,
      moved.head,
      shiftKey,
      paragraphText,
      moved.provenance
    );
  }

  if (LINE_EDGE_KEYS.has(intent.key)) {
    const catalog = buildLineCatalog(frame, navigation);
    if (!catalog.ok) {
      return keyboardReject(
        priorSession,
        frameId,
        rejectEffect('unsupported', catalog.reason, frameId)
      );
    }
    const head = selection.head;
    if (head.kind !== 'text') {
      return keyboardReject(
        priorSession,
        frameId,
        rejectEffect('invalidTarget', 'Home/End requires a text caret', frameId)
      );
    }
    const currentLine = lineForTarget(catalog.lines, head, frame, navigation);
    if (!currentLine) {
      return keyboardReject(
        priorSession,
        frameId,
        rejectEffect('invalidTarget', 'Home/End requires a line-resolved caret', frameId)
      );
    }
    const stop = lineEdgeTarget(currentLine, intent.key === 'Home' ? 'start' : 'end');
    if (stop.role !== 'editableText') {
      return keyboardReject(
        priorSession,
        frameId,
        rejectEffect('readOnly', 'line-edge navigation target is read-only', frameId)
      );
    }
    return finalizeKeyboardMove(
      frame,
      navigation,
      selection,
      priorSession,
      null,
      stop.target,
      shiftKey,
      paragraphText
    );
  }

  if (VERTICAL_KEYS.has(intent.key)) {
    let visualAdvanceX =
      priorSession &&
      sessionMatchesSelection(priorSession, selection, frame, documentGeneration, modelRevision)
        ? priorSession.visualAdvanceX
        : null;
    if (visualAdvanceX === null) {
      const seeded = caretContentX(frame, selection.head, navigation);
      if (seeded === 'singular') {
        return keyboardReject(
          priorSession,
          frameId,
          rejectEffect('unsupported', 'visual advance seeding hit non-invertible geometry', frameId)
        );
      }
      if (seeded === null) {
        return keyboardReject(
          priorSession,
          frameId,
          rejectEffect(
            'invalidTarget',
            'visual advance could not be seeded from caret geometry',
            frameId
          )
        );
      }
      visualAdvanceX = seeded;
    }

    const moved =
      intent.key === 'PageUp' || intent.key === 'PageDown'
        ? movePage(frame, navigation, selection, intent.key, visualAdvanceX)
        : moveVertical(
            frame,
            navigation,
            selection,
            intent.key as 'ArrowUp' | 'ArrowDown',
            visualAdvanceX
          );
    if (!moved.ok) return keyboardReject(priorSession, frameId, moved.effect);
    const usable = validateEditableTarget(frame, moved.head);
    if (!usable.ok) return keyboardReject(priorSession, frameId, usable.effect);
    const nextSelection = selectionFromHead(frame, selection, moved.head, shiftKey);
    const nextSession = buildNavigationSession(
      frame,
      nextSelection,
      moved.visualAdvanceX,
      documentGeneration,
      modelRevision
    );
    return finalizeKeyboardMove(
      frame,
      navigation,
      selection,
      priorSession,
      nextSession,
      moved.head,
      shiftKey,
      paragraphText
    );
  }

  return keyboardReject(
    priorSession,
    frameId,
    rejectEffect('unsupported', `geometry keyboard key ${intent.key} is not implemented`, frameId)
  );
}
