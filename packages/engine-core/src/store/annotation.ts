// Durable annotation lifecycle rules (document-engine task 12.5 / design D12).
// Comments, tracked changes, citations, and bookmarks share range anchors and
// explicit deletion policy: under partial deletion the range shrinks; under full
// deletion it collapses to a boundary point, detaches, or tombstones per its
// policy. It NEVER reattaches to unrelated text — an annotation whose content is
// gone becomes inactive, not relocated.
//
// SCOPE: this covers deletion (partial + whole-block). Split/join/move/semantic-
// replacement re-anchoring (task 12.5's full contract) is NOT yet implemented and
// requires block-ordering context the store owns; task 12.5 stays open.

export type AnnotationKind = 'comment' | 'tracked-change' | 'citation' | 'bookmark';
export type AnnotationPolicy = 'collapse' | 'detach' | 'tombstone';
export type AnnotationState = 'active' | 'collapsed' | 'detached' | 'tombstoned';

export interface AnnotationRange {
  readonly startBlock: string;
  readonly startOffset: number;
  readonly endBlock: string;
  readonly endOffset: number;
}

export interface Annotation {
  readonly id: string;
  readonly kind: AnnotationKind;
  readonly policy: AnnotationPolicy;
  readonly range: AnnotationRange;
  readonly state: AnnotationState;
}

// Inactivate an annotation per its policy. `at` is the collapse point — a
// SURVIVING position. Collapse ALWAYS yields the 'collapsed' state (a policy is
// never silently swapped for 'detached').
function inactivate(a: Annotation, at: { block: string; offset: number }): Annotation {
  switch (a.policy) {
    case 'collapse':
      return { ...a, state: 'collapsed', range: { startBlock: at.block, startOffset: at.offset, endBlock: at.block, endOffset: at.offset } };
    case 'detach':
      return { ...a, state: 'detached' };
    case 'tombstone':
      return { ...a, state: 'tombstoned' };
  }
}

/**
 * Apply the deletion of a whole block. When a boundary block is deleted the range
 * boundary is gone; the annotation collapses (per policy) to a SURVIVING endpoint
 * — it is never left active spanning, nor reattached to, unrelated text.
 */
export function onBlockDeleted(a: Annotation, blockId: string): Annotation {
  if (a.state !== 'active') return a;
  const startGone = a.range.startBlock === blockId;
  const endGone = a.range.endBlock === blockId;
  if (!startGone && !endGone) return a; // unrelated deletion -> untouched
  // Collapse to a surviving endpoint (its own start or end), never to another block.
  const survivor = !startGone
    ? { block: a.range.startBlock, offset: a.range.startOffset }
    : !endGone
      ? { block: a.range.endBlock, offset: a.range.endOffset }
      : { block: blockId, offset: 0 }; // both endpoints were in the deleted block
  return inactivate(a, survivor);
}

/**
 * Apply a text-range deletion [from, to) within `blockId` to an annotation.
 * Offsets after the deletion shift left; a range wholly inside the deletion is
 * inactivated per policy.
 */
export function onRangeDeleted(a: Annotation, blockId: string, from: number, to: number): Annotation {
  if (a.state !== 'active' || to <= from) return a;
  const len = to - from;
  const shift = (block: string, off: number): number => {
    if (block !== blockId) return off;
    if (off <= from) return off;
    if (off >= to) return off - len;
    return from; // inside the deletion -> clamp to its start
  };
  const single = a.range.startBlock === blockId && a.range.endBlock === blockId;
  if (single && a.range.startOffset >= from && a.range.endOffset <= to) {
    return inactivate(a, { block: blockId, offset: from }); // wholly deleted
  }
  return {
    ...a,
    range: {
      ...a.range,
      startOffset: shift(a.range.startBlock, a.range.startOffset),
      endOffset: shift(a.range.endBlock, a.range.endOffset),
    },
  };
}
