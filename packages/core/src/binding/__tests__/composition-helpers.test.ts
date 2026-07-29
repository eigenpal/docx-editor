import { describe, expect, test } from 'bun:test';
import {
  remoteChangePreservesCompositionAnchor,
  mapCompositionRangeAfterRemote,
  deriveCompositionOverlay,
  applyCompositionOverlay,
  observeComposition,
  type CompositionSnapshot,
} from '../composition.ts';

function snapshot(overrides: Partial<CompositionSnapshot> & Pick<CompositionSnapshot, 'paragraphText'>): CompositionSnapshot {
  return {
    anchor: { paragraphId: 'p1', offset: overrides.selectionStart ?? 0, affinity: 'after' },
    paragraphId: 'p1',
    selectionStart: overrides.selectionStart ?? 0,
    selectionEnd: overrides.selectionEnd ?? overrides.selectionStart ?? 0,
    startRevision: 1,
    ...overrides,
  };
}

describe('deriveCompositionOverlay', () => {
  test('collapsed caret insertion in the middle (old suffix heuristic would fail)', () => {
    const snap = snapshot({ paragraphText: 'helloworld', selectionStart: 5, selectionEnd: 5 });
    expect(deriveCompositionOverlay(snap, 'helloXXworld')).toBe('XX');
  });

  test('selected-range replacement preserves UTF-16 surrogate boundaries', () => {
    const snap = snapshot({ paragraphText: 'a\uD83D\uDE00b', selectionStart: 1, selectionEnd: 3 });
    expect(deriveCompositionOverlay(snap, 'a\uD83D\uDE01b')).toBe('\uD83D\uDE01');
  });

  test('returns empty overlay when prefix/suffix anchor is broken', () => {
    const snap = snapshot({ paragraphText: 'abcdef', selectionStart: 2, selectionEnd: 4 });
    expect(deriveCompositionOverlay(snap, 'abZZef')).toBe('ZZ');
    expect(deriveCompositionOverlay(snap, 'abZZff')).toBe('');
  });
});

describe('remote anchor invariant (conservative prefix-only)', () => {
  test('preserves exact paragraph and single prefix insertion', () => {
    const snap = snapshot({ paragraphText: 'start', selectionStart: 5, selectionEnd: 5 });
    expect(remoteChangePreservesCompositionAnchor(snap, 'start', 1)).toBe(true);
    expect(remoteChangePreservesCompositionAnchor(snap, 'Xstart', 2)).toBe(true);
    expect(mapCompositionRangeAfterRemote(snap, 'Xstart')).toEqual({ selectionStart: 6, selectionEnd: 6 });
  });

  test('preserves multiple prefix-only revisions', () => {
    const snap = snapshot({ paragraphText: 'start', selectionStart: 3, selectionEnd: 3 });
    expect(remoteChangePreservesCompositionAnchor(snap, 'YXstart', 3)).toBe(true);
    expect(mapCompositionRangeAfterRemote(snap, 'YXstart')).toEqual({ selectionStart: 5, selectionEnd: 5 });
  });

  test('invalidates intersecting replacement', () => {
    const snap = snapshot({ paragraphText: 'compose', selectionStart: 3, selectionEnd: 3 });
    expect(remoteChangePreservesCompositionAnchor(snap, 'remote', 2)).toBe(false);
    expect(mapCompositionRangeAfterRemote(snap, 'remote')).toBeNull();
  });

  test('invalidates append that mutates the anchored suffix region', () => {
    const snap = snapshot({ paragraphText: 'start', selectionStart: 2, selectionEnd: 2 });
    expect(remoteChangePreservesCompositionAnchor(snap, 'start!', 2)).toBe(false);
  });

  test('applyCompositionOverlay merges overlay after mapped remote prefix', () => {
    const snap = snapshot({ paragraphText: 'start', selectionStart: 5, selectionEnd: 5 });
    const mapped = mapCompositionRangeAfterRemote(snap, 'Xstart');
    expect(mapped).toEqual({ selectionStart: 6, selectionEnd: 6 });
    expect(applyCompositionOverlay('Xstart', mapped!.selectionStart, mapped!.selectionEnd, '!?')).toBe('Xstart!?');
  });
});

describe('observeComposition', () => {
  test('exposes body scope while active and surfaces lastCancel when idle', () => {
    expect(observeComposition(true)).toEqual({ active: true, scope: { kind: 'body' }, lastCancel: null });
    expect(observeComposition(false, { code: 'remoteInvalidation', reason: 'x' })).toEqual({
      active: false,
      scope: null,
      lastCancel: { code: 'remoteInvalidation', reason: 'x' },
    });
  });
});
