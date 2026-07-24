// PM-free semantic target/selection resolution for ProseMirror sync (interactive-paginated-editing 4.2).
// Editability is derived from canonical model traversal — caller roles are ignored.

import { bodyStoryId } from '@docx-editor.dev/engine-core';
import type {
  InteractionFrameId,
  InteractionOutcome,
  SemanticSelection,
  SemanticTarget,
} from '@docx-editor.dev/core-contract/interaction';
import type { DocxEditorSession } from './session.ts';
import { graphemeOffsetToUtf16 } from './grapheme.ts';
import { paragraphOwnership, topLevelBlockKind } from './semantic-ownership.ts';
import type { SelectionAnchor } from './selection.ts';

export interface SemanticSelectionSyncRequest {
  readonly frameId: InteractionFrameId;
  readonly selection: SemanticSelection;
}

function paragraphText(runs: readonly { text: string }[]): string {
  return runs.map((r) => r.text).join('');
}

function reject(code: 'readOnly' | 'invalidTarget' | 'staleFrame', reason: string, frameId?: InteractionFrameId): InteractionOutcome<never> {
  return frameId ? { ok: false, code, reason, frameId } : { ok: false, code, reason };
}

/** Resolve one semantic text/atomic target to a store-backed selection anchor. */
export function resolveSemanticTarget(
  session: DocxEditorSession,
  target: SemanticTarget,
  frameId: InteractionFrameId,
): InteractionOutcome<SelectionAnchor> {
  const model = session.currentModel();
  if (target.kind === 'atomic') {
    const kind = topLevelBlockKind(model, target.objectId, target.scope.kind === 'body' ? bodyStoryId(model) : target.scope.kind);
    if (kind === 'missing') return reject('invalidTarget', 'atomic target does not resolve to a canonical block', frameId);
    if (kind === 'paragraph') return reject('readOnly', 'atomic target refers to an editable paragraph block', frameId);
    return { ok: true, value: { paragraphId: null, offset: 0, affinity: 'after' }, frameId };
  }

  const storyId = target.identity.storyId;
  const owned = paragraphOwnership(model, target.identity.blockId, storyId);
  if (!owned) return reject('invalidTarget', 'text target paragraph is missing from the canonical model', frameId);
  if (!owned.editable) {
    const reason =
      owned.rejectReason === 'tableCell'
        ? 'text target is inside an unowned table cell'
        : 'text target is outside the editable body-paragraph lane';
    return reject('readOnly', reason, frameId);
  }

  const text = paragraphText(owned.paragraph.runs);
  const offset = graphemeOffsetToUtf16(text, target.graphemeOffset);
  return {
    ok: true,
    value: { paragraphId: owned.paragraph.id, offset, affinity: target.affinity === 'upstream' ? 'before' : 'after' },
    frameId,
  };
}

/** Resolve a semantic selection range to anchor/head store-backed anchors. */
export function resolveSemanticSelection(
  session: DocxEditorSession,
  request: SemanticSelectionSyncRequest,
): InteractionOutcome<{ readonly anchor: SelectionAnchor; readonly head: SelectionAnchor }> {
  if (request.selection.frameId.value !== request.frameId.value) {
    return reject('staleFrame', 'semantic selection belongs to a superseded interaction frame', request.frameId);
  }
  const anchor = resolveSemanticTarget(session, request.selection.anchor, request.frameId);
  if (!anchor.ok) return anchor;
  const head = resolveSemanticTarget(session, request.selection.head, request.frameId);
  if (!head.ok) return head;
  return { ok: true, value: { anchor: anchor.value, head: head.value }, frameId: request.frameId };
}
