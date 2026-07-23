// Durable annotation lifecycle tests (document-engine task 12.5): collapse /
// detach / tombstone under deletion, offset shifting under partial deletion, and
// the property that an annotation NEVER reattaches to unrelated text.

import { describe, expect, test } from 'bun:test';
import { onBlockDeleted, onRangeDeleted, type Annotation, type AnnotationPolicy } from '../src/store/index.ts';

function ann(policy: AnnotationPolicy, range = { startBlock: 'p1', startOffset: 2, endBlock: 'p1', endOffset: 6 }): Annotation {
  return { id: 'a1', kind: 'comment', policy, range, state: 'active' };
}

describe('full deletion applies policy', () => {
  test('collapse -> zero-width point at the deletion boundary', () => {
    const r = onRangeDeleted(ann('collapse'), 'p1', 0, 10);
    expect(r.state).toBe('collapsed');
    expect(r.range).toEqual({ startBlock: 'p1', startOffset: 0, endBlock: 'p1', endOffset: 0 });
  });
  test('detach -> detached state', () => {
    expect(onRangeDeleted(ann('detach'), 'p1', 0, 10).state).toBe('detached');
  });
  test('tombstone -> tombstoned state', () => {
    expect(onRangeDeleted(ann('tombstone'), 'p1', 0, 10).state).toBe('tombstoned');
  });
  test('deleting the whole block collapses/detaches, never relocates', () => {
    expect(onBlockDeleted(ann('detach'), 'p1').state).toBe('detached');
    expect(onBlockDeleted(ann('tombstone'), 'p1').state).toBe('tombstoned');
  });

  test('REGRESSION: whole-block collapse stays collapsed (not silently detached)', () => {
    const r = onBlockDeleted(ann('collapse'), 'p1');
    expect(r.state).toBe('collapsed'); // policy is honored, not swapped for detach
  });

  test('REGRESSION: cross-block deletion collapses to a SURVIVING endpoint, never reattaches', () => {
    // Annotation spans p1..p2; delete the start block p1.
    const spanning = ann('collapse', { startBlock: 'p1', startOffset: 1, endBlock: 'p2', endOffset: 4 });
    const r = onBlockDeleted(spanning, 'p1');
    // It is inactive (collapsed), anchored to its OWN surviving end block p2 — not
    // left active spanning unrelated text, and not reattached to a third block.
    expect(r.state).toBe('collapsed');
    expect(r.range.startBlock).toBe('p2');
    expect(r.range.endBlock).toBe('p2');
    expect(r.range.startBlock).not.toBe('p1');
    // A detach-policy spanning annotation simply detaches.
    const d = onBlockDeleted(ann('detach', { startBlock: 'p1', startOffset: 1, endBlock: 'p2', endOffset: 4 }), 'p2');
    expect(d.state).toBe('detached');
  });
});

describe('partial deletion shifts offsets', () => {
  test('deletion before the range shifts it left', () => {
    // Delete [0,2) before the range [2,6) -> becomes [0,4).
    const r = onRangeDeleted(ann('collapse'), 'p1', 0, 2);
    expect(r.state).toBe('active');
    expect(r.range).toMatchObject({ startOffset: 0, endOffset: 4 });
  });
  test('deletion overlapping the range clamps into the surviving text', () => {
    // Delete [4,10) overlapping the end of [2,6) -> end clamps to 4.
    const r = onRangeDeleted(ann('collapse'), 'p1', 4, 10);
    expect(r.range).toMatchObject({ startOffset: 2, endOffset: 4 });
  });
});

describe('property: never reattaches to unrelated text', () => {
  test('across random deletions an annotation stays anchored or inactive', () => {
    const survivingBlocks = new Set(['p1', 'p2']);
    for (let seed = 0; seed < 200; seed++) {
      // Deterministic pseudo-random deletion parameters from the seed.
      let a: Annotation = ann(['collapse', 'detach', 'tombstone'][seed % 3] as AnnotationPolicy, {
        startBlock: 'p1', startOffset: 1, endBlock: 'p1', endOffset: 5,
      });
      const from = seed % 7;
      const to = from + ((seed % 5) + 1);
      a = onRangeDeleted(a, 'p1', from, to);
      if (a.state === 'active') {
        // An active annotation must still point at a surviving block with sane offsets.
        expect(survivingBlocks.has(a.range.startBlock)).toBe(true);
        expect(survivingBlocks.has(a.range.endBlock)).toBe(true);
        expect(a.range.startOffset).toBeGreaterThanOrEqual(0);
        expect(a.range.endOffset).toBeGreaterThanOrEqual(a.range.startOffset);
      }
      // Deleting a wholly-unrelated block must not touch an annotation on p1.
      const untouched = onBlockDeleted(a, 'p2');
      expect(untouched).toBe(a);
    }
  });
});
