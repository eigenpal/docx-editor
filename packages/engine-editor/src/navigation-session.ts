// Private keyboard-navigation session (interactive-paginated-editing 5.5).

import type { ViewScope } from '@docx-editor.dev/core-contract/editor';
import type {
  InteractionAffinity,
  InteractionDispatchResult,
  InteractionFrame,
  SemanticSelection,
} from '@docx-editor.dev/core-contract/interaction';
import { scopesEqual } from './bidi-policy.ts';

/** Ephemeral visual-advance state; not selection authority and not publicly exposed. */
export interface NavigationSession {
  readonly documentGeneration: number;
  readonly modelRevision: number;
  readonly layoutRevision: number;
  readonly frameIdValue: number;
  readonly scope: ViewScope;
  readonly storyId: string;
  readonly anchorBlockId: string;
  readonly anchorGraphemeOffset: number;
  readonly anchorAffinity: InteractionAffinity;
  readonly headBlockId: string;
  readonly headGraphemeOffset: number;
  readonly headAffinity: InteractionAffinity;
  readonly visualAdvanceX: number;
}

export interface NavigationSessionPlan {
  readonly priorSession: NavigationSession | null;
  readonly nextSessionOnSuccess: NavigationSession | null;
}

export interface NavigationSessionCommit {
  readonly session: NavigationSession | null | undefined;
}

export function buildNavigationSession(
  frame: InteractionFrame,
  selection: SemanticSelection,
  visualAdvanceX: number,
  documentGeneration: number,
  modelRevision: number,
): NavigationSession {
  if (selection.anchor.kind !== 'text' || selection.head.kind !== 'text') {
    throw new Error('navigation session requires text selection endpoints');
  }
  return {
    documentGeneration,
    modelRevision,
    layoutRevision: frame.revisions.layoutRevision,
    frameIdValue: frame.id.value,
    scope: selection.scope,
    storyId: selection.head.identity.storyId,
    anchorBlockId: selection.anchor.identity.blockId,
    anchorGraphemeOffset: selection.anchor.graphemeOffset,
    anchorAffinity: selection.anchor.affinity,
    headBlockId: selection.head.identity.blockId,
    headGraphemeOffset: selection.head.graphemeOffset,
    headAffinity: selection.head.affinity,
    visualAdvanceX,
  };
}

export function sessionMatchesSelection(
  session: NavigationSession,
  selection: SemanticSelection,
  _frame: InteractionFrame,
  documentGeneration: number,
  modelRevision: number,
): boolean {
  if (selection.anchor.kind !== 'text' || selection.head.kind !== 'text') return false;
  return (
    session.documentGeneration === documentGeneration &&
    session.modelRevision === modelRevision &&
    scopesEqual(session.scope, selection.scope) &&
    session.storyId === selection.head.identity.storyId &&
    session.anchorBlockId === selection.anchor.identity.blockId &&
    session.anchorGraphemeOffset === selection.anchor.graphemeOffset &&
    session.anchorAffinity === selection.anchor.affinity &&
    session.headBlockId === selection.head.identity.blockId &&
    session.headGraphemeOffset === selection.head.graphemeOffset &&
    session.headAffinity === selection.head.affinity
  );
}

/** Intents that clear visual-advance session only after successful execution. */
export function navigationSessionClearsOnSuccess(kind: string): boolean {
  return kind === 'semanticSelection' || kind === 'click' || kind === 'pointerDown' || kind === 'pointerUp' || kind === 'blur';
}

/** @deprecated Use navigationSessionClearsOnSuccess */
export const navigationSessionResetsForIntent = navigationSessionClearsOnSuccess;

export function navigationSessionPlanForIntent(
  priorSession: NavigationSession | null | undefined,
  kind: string,
): NavigationSessionPlan | undefined {
  if (!navigationSessionClearsOnSuccess(kind)) return undefined;
  return { priorSession: priorSession ?? null, nextSessionOnSuccess: null };
}

type NavigationCommitInput = NavigationSessionPlan | { readonly navigation?: NavigationSessionPlan };

function resolveNavigationPlan(input: NavigationCommitInput): NavigationSessionPlan | undefined {
  if ('priorSession' in input) return input;
  return input.navigation;
}

/** Accepts a session plan or a planner result carrying `navigation`. */
export function commitNavigationSessionAfterExecution(
  navigationInput: NavigationCommitInput | undefined,
  execution: InteractionDispatchResult,
): NavigationSessionCommit {
  const navigation = navigationInput ? resolveNavigationPlan(navigationInput) : undefined;
  if (!navigation) return { session: undefined };
  if (!execution.outcome.ok) {
    return { session: navigation.priorSession };
  }
  return { session: navigation.nextSessionOnSuccess };
}
