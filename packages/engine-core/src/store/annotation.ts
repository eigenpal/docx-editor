// Durable annotation lifecycle rules (document-engine task 12.5 / design D12).
// Comments, tracked changes, citations, and bookmarks share range anchors and
// explicit deletion policy: under partial deletion the range shrinks; under full
// deletion it collapses to a boundary point, detaches, or tombstones per its
// policy. It NEVER reattaches to unrelated text — an annotation whose content is
// gone becomes inactive, not relocated.

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

function inactivate(a: Annotation, at?: { block: string; offset: number }): Annotation {
  switch (a.policy) {
    case 'collapse':
      // Collapse to a zero-width point at the boundary (only if the block survives).
      return at
        ? { ...a, state: 'collapsed', range: { startBlock: at.block, startOffset: at.offset, endBlock: at.block, endOffset: at.offset } }
        : { ...a, state: 'detached' };
    case 'detach':
      return { ...a, state: 'detached' };
    case 'tombstone':
      return { ...a, state: 'tombstoned' };
  }
}

/** Apply the deletion of a whole block to an annotation. */
export function onBlockDeleted(a: Annotation, blockId: string): Annotation {
  if (a.state !== 'active') return a;
  const startGone = a.range.startBlock === blockId;
  const endGone = a.range.endBlock === blockId;
  if (startGone && endGone) return inactivate(a); // wholly inside the deleted block
  if (startGone) {
    // Start block gone; anchor the start to the surviving end block's start.
    return { ...a, range: { ...a.range, startBlock: a.range.endBlock, startOffset: 0 } };
  }
  if (endGone) {
    // End block gone; anchor the end to the surviving start block (unknown length -> its start offset region).
    return { ...a, range: { ...a.range, endBlock: a.range.startBlock, endOffset: a.range.startOffset } };
  }
  return a;
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
