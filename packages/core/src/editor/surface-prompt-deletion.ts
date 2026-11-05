// Delete and Backspace leave a `w:showingPlcHdr` prompt whole.
//
// A prompt is what an empty control shows, not text to edit one character at a time: the first
// typed character replaces it whole, and Word shows it again whenever the control is empty. So a
// press never takes prompt characters. It takes the text around the prompt and leaves the prompt
// as it was, in edit mode and in suggesting mode alike. A press that reaches only prompt
// characters selects the prompt instead, as a click or an arrow into it does. Deleting prompt
// characters one at a time left "ck here to enter text." on the page, still flagged as the prompt.
//
// A control the same press removes goes whole, prompt and all: a range that covers a whole block
// control removes the control, as typing over that range does.

import { findNode, type OoxmlPart, type TreeDocOp } from '@docx-editor.dev/core/store';
import type { SemanticPosition } from '@docx-editor.dev/core/layout';
import {
  contentControlPropertiesOf,
  contentControlsIn,
} from '../store/package/content-control-nodes.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { enclosingContentControls } from '../store/store/tree-op-content-controls.ts';
import { paragraphLength, paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';

/** A deletion a press plans: its ops, and where the caret goes after them. */
export interface PlannedDeletion {
  readonly ops: readonly TreeDocOp[];
  readonly collapseTo: SemanticPosition;
}

interface Span {
  readonly start: number;
  readonly end: number;
}

/** `[start, end)` of each prompt in a paragraph. A block prompt holds the whole paragraph. */
function promptSpans(part: OoxmlPart, paragraphId: string, removed: ReadonlySet<string>): Span[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  const showing = (control: OoxmlNode) =>
    !removed.has(control.id) && contentControlPropertiesOf(control).showingPlaceholder;
  if (enclosingContentControls(part, paragraphId).some(showing)) {
    return [{ start: 0, end: paragraphLength(paragraph) }];
  }
  const offsets = paragraphOffsetIndex(paragraph);
  return contentControlsIn(paragraph).flatMap((entry) => {
    const span = showing(entry.node) ? offsets.spanOf(entry.node) : null;
    return span ? [span] : [];
  });
}

/** The parts of `[start, end)` outside every span, in document order. */
function outside(start: number, end: number, spans: readonly Span[]): Span[] {
  const pieces: Span[] = [];
  let at = start;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.end <= at || span.start >= end) continue;
    if (span.start > at) pieces.push({ start: at, end: span.start });
    at = Math.max(at, span.end);
  }
  if (at < end) pieces.push({ start: at, end });
  return pieces;
}

/**
 * The deletion with every prompt character taken out, or null when it takes none. The ops are
 * empty when the deletion reached only prompt characters. A caret that would land inside a kept
 * prompt goes to the prompt's end, where the deleted text began.
 */
export function keepPromptsWhole(part: OoxmlPart, plan: PlannedDeletion): PlannedDeletion | null {
  const removed = new Set(
    plan.ops.flatMap((op) => (op.op === 'removeContentControl' ? [op.controlId] : []))
  );
  let changed = false;
  const ops = plan.ops.flatMap((op): TreeDocOp[] => {
    if (op.op !== 'deleteText') return [op];
    const pieces = outside(op.start, op.end, promptSpans(part, op.paragraphId, removed));
    if (pieces.length === 1 && pieces[0]!.start === op.start && pieces[0]!.end === op.end) {
      return [op];
    }
    changed = true;
    // From the end back, so no piece moves the offsets of the pieces after it.
    return pieces.reverse().map((piece) => ({ ...op, ...piece }));
  });
  if (!changed) return null;
  const { paragraphId, offset } = plan.collapseTo;
  const around = promptSpans(part, paragraphId, removed).find(
    (span) => offset >= span.start && offset < span.end
  );
  return { ops, collapseTo: around ? { paragraphId, offset: around.end } : plan.collapseTo };
}
