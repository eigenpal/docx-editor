// Public setSelection command mapping (interactive-paginated-editing 4.7).

import type { EditorCommand, EditorPosition, EditorSelection, ViewScope } from '@docx-editor.dev/core-contract/editor';
import type { InteractionFrameId, SemanticSelection, SemanticTarget } from '@docx-editor.dev/core-contract/interaction';
import type { ExecErrorCode, ExecResult } from '@docx-editor.dev/core-contract/types';
import type { InteractionOutcomeCode } from '@docx-editor.dev/core-contract/interaction';

function isSemanticTarget(value: unknown): value is SemanticTarget {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

function isSemanticSelection(value: unknown): value is SemanticSelection {
  return (
    typeof value === 'object' &&
    value !== null &&
    'anchor' in value &&
    'head' in value &&
    'frameId' in value &&
    'scope' in value
  );
}

function positionToTarget(position: EditorPosition, scope: ViewScope): SemanticTarget | null {
  if (isSemanticTarget(position)) {
    return position.scope.kind === scope.kind ? position : { ...position, scope };
  }
  return null;
}

function isEditorAnchorHeadRange(value: unknown): value is { anchor: EditorPosition; head: EditorPosition } {
  return typeof value === 'object' && value !== null && 'anchor' in value && 'head' in value && !('frameId' in value);
}

function rangeToSelection(
  range: EditorSelection,
  frameId: InteractionFrameId,
  scope: ViewScope,
): SemanticSelection | null {
  if (isSemanticSelection(range)) {
    // Keep the CALLER's frameId. Rewriting it to the current frame made the
    // staleFrame check structurally unreachable from this path: a selection
    // minted on a superseded frame was silently rebound to the live one and
    // applied. Only a range with no frame of its own (an EditorPosition pair)
    // binds to the current frame below.
    return { ...range, scope: range.scope.kind === scope.kind ? range.scope : scope };
  }
  if (isSemanticTarget(range)) {
    return { frameId, scope, anchor: range, head: range };
  }
  if (isEditorAnchorHeadRange(range)) {
    const anchor = positionToTarget(range.anchor, scope);
    const head = positionToTarget(range.head, scope);
    if (!anchor || !head) return null;
    return { frameId, scope, anchor, head };
  }
  if ('from' in range && 'to' in range) {
    const anchor = positionToTarget(range.from, scope);
    const head = positionToTarget(range.to, scope);
    if (!anchor || !head) return null;
    return { frameId, scope, anchor, head };
  }
  return null;
}

/** Map the public setSelection command to a frame-bound semantic selection. */
export function semanticSelectionFromCommand(
  command: Extract<EditorCommand, { type: 'setSelection' }>,
  frameId: InteractionFrameId,
  scope: ViewScope,
): SemanticSelection | null {
  if ('anchor' in command) {
    const anchor = positionToTarget(command.anchor, scope);
    if (!anchor) return null;
    return { frameId, scope, anchor, head: anchor };
  }
  return rangeToSelection(command.range, frameId, scope);
}

export function unsupportedSetSelection(reason: string): ExecResult {
  return { ok: false, code: 'unsupported', reason };
}

export function invalidSetSelection(reason: string): ExecResult {
  return { ok: false, code: 'invalidArgs', reason };
}

export function execErrorFromInteraction(code: InteractionOutcomeCode): ExecErrorCode {
  switch (code) {
    case 'readOnly':
      return 'locked';
    case 'invalidTarget':
      return 'invalidArgs';
    case 'staleFrame':
    case 'pendingLayout':
    case 'pendingSelection':
    case 'unsupported':
      return 'unsupported';
  }
}
