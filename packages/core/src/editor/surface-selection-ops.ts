// Selection geometry and edit-op planning (paginated-surface seam).
//
// This module owns the pure reading of a semantic selection against the published layout —
// document order, clamping, the covered text — and the tree ops a destructive gesture
// produces. No DOM and no session here: the surface closure passes in its current layout,
// selection and part, so every function is a plain input-to-output computation.

import type { TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import { parentNodeOf, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import {
  documentOrder,
  paragraphTextFromLayout,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core-contract/layout';

export function collapsedAt(position: SemanticPosition): SemanticSelection {
  return { anchor: position, head: position };
}

/**
 * A selection as a history mark, or null when it spans paragraphs.
 *
 * A mark addresses ONE paragraph, and a cross-paragraph selection has no honest single-id
 * form; recording the head's paragraph would put the caret somewhere the user never had it.
 */
export function selectionMarkOf(
  selection: SemanticSelection
): { paragraphId: string; start: number; end: number } | null {
  if (selection.anchor.paragraphId !== selection.head.paragraphId) return null;
  const start = Math.min(selection.anchor.offset, selection.head.offset);
  const end = Math.max(selection.anchor.offset, selection.head.offset);
  return { paragraphId: selection.head.paragraphId, start, end };
}

/** The selection in DOCUMENT order, whichever way the user dragged it. */
export function orderedRangeOf(
  layout: SemanticLayout,
  selection: SemanticSelection
): { from: SemanticPosition; to: SemanticPosition } {
  const { anchor, head } = selection;
  if (anchor.paragraphId === head.paragraphId) {
    return anchor.offset <= head.offset ? { from: anchor, to: head } : { from: head, to: anchor };
  }
  const order = documentOrder(layout);
  return order.indexOf(anchor.paragraphId) <= order.indexOf(head.paragraphId)
    ? { from: anchor, to: head }
    : { from: head, to: anchor };
}

/** A selection guaranteed to address content that exists at the current revision. */
export function clampedToDocument(
  layout: SemanticLayout,
  ids: readonly string[],
  next: SemanticSelection
): SemanticSelection {
  const fallback = ids[0];
  const clampPosition = (position: SemanticPosition): SemanticPosition => {
    const paragraphId = ids.includes(position.paragraphId)
      ? position.paragraphId
      : (fallback ?? position.paragraphId);
    const length = paragraphTextFromLayout(layout, paragraphId).length;
    return { paragraphId, offset: Math.max(0, Math.min(position.offset, length)) };
  };
  return { anchor: clampPosition(next.anchor), head: clampPosition(next.head) };
}

/** The model text a document-ordered range covers, newline-separated per paragraph. */
export function selectedTextIn(
  layout: SemanticLayout,
  from: SemanticPosition,
  to: SemanticPosition
): string {
  if (from.paragraphId === to.paragraphId) {
    return paragraphTextFromLayout(layout, from.paragraphId).slice(from.offset, to.offset);
  }
  const order = documentOrder(layout);
  const firstIndex = order.indexOf(from.paragraphId);
  const lastIndex = order.indexOf(to.paragraphId);
  if (firstIndex === -1 || lastIndex === -1) return '';
  const parts = [paragraphTextFromLayout(layout, from.paragraphId).slice(from.offset)];
  for (let index = firstIndex + 1; index < lastIndex; index += 1) {
    parts.push(paragraphTextFromLayout(layout, order[index]!));
  }
  parts.push(paragraphTextFromLayout(layout, to.paragraphId).slice(0, to.offset));
  // Paragraphs are newline-separated, which is what a paste target expects.
  return parts.join('\n');
}

/**
 * Ops that remove a document-ordered range, or none when it is collapsed.
 *
 * A selection spanning paragraphs is trimmed at both ends and then JOINED back into one,
 * which is what makes selecting three paragraphs and typing behave like every other
 * editor. The order matters: trim first, join after, so each join sees the text that is
 * meant to survive rather than the text being removed.
 */
export function deleteRangeOps(
  layout: SemanticLayout,
  part: OoxmlPart,
  from: SemanticPosition,
  to: SemanticPosition
): Parameters<TreeDocxSession['applyTreeOps']>[0] {
  const textOf = (paragraphId: string): string => paragraphTextFromLayout(layout, paragraphId);
  if (from.paragraphId === to.paragraphId) {
    if (from.offset === to.offset) return [];
    return [
      { op: 'deleteText', paragraphId: from.paragraphId, start: from.offset, end: to.offset },
    ];
  }

  const order = documentOrder(layout);
  const firstIndex = order.indexOf(from.paragraphId);
  const lastIndex = order.indexOf(to.paragraphId);
  if (firstIndex === -1 || lastIndex === -1) return [];

  const ops: Parameters<TreeDocxSession['applyTreeOps']>[0][number][] = [];
  // Tail of the first paragraph.
  const firstText = textOf(from.paragraphId);
  if (from.offset < firstText.length) {
    ops.push({
      op: 'deleteText',
      paragraphId: from.paragraphId,
      start: from.offset,
      end: firstText.length,
    });
  }
  // Whole paragraphs in between.
  for (let index = firstIndex + 1; index < lastIndex; index += 1) {
    const id = order[index]!;
    const length = textOf(id).length;
    if (length > 0) ops.push({ op: 'deleteText', paragraphId: id, start: 0, end: length });
  }
  // Head of the last paragraph.
  if (to.offset > 0) {
    ops.push({ op: 'deleteText', paragraphId: to.paragraphId, start: 0, end: to.offset });
  }
  // Then collapse the emptied paragraphs — but only WITHIN runs of consecutive sibling
  // `w:p` elements. A join across a table (or any block this lane does not own) is not a
  // paragraph edit: the store rightly refuses it, and one refused join vetoes the whole
  // atomic transaction — Select All + Delete on any document containing a table deleted
  // nothing at all. Text still clears everywhere; each block boundary keeps one empty
  // paragraph beside it, which is the honest paragraph-lane reading of the gesture.
  const positionsByParent = new Map<string, Map<string, number>>();
  const consecutiveSiblings = (before: string, after: string): boolean => {
    const parent = parentNodeOf(part, after);
    if (!parent || parentNodeOf(part, before) !== parent) return false;
    let positions = positionsByParent.get(parent.id);
    if (!positions) {
      positions = new Map<string, number>();
      for (const [at, child] of parent.children.entries()) positions.set(child.id, at);
      positionsByParent.set(parent.id, positions);
    }
    return positions.get(after) === (positions.get(before) ?? Number.NaN) + 1;
  };
  let groupHead = from.paragraphId;
  let previous = from.paragraphId;
  for (let index = firstIndex + 1; index <= lastIndex; index += 1) {
    const id = order[index]!;
    if (consecutiveSiblings(previous, id)) {
      ops.push({ op: 'joinParagraphs', firstId: groupHead, secondId: id });
    } else {
      // Something that is not a selected paragraph sits between: start a new join group
      // on ITS far side rather than joining across it.
      groupHead = id;
    }
    previous = id;
  }
  return ops;
}
