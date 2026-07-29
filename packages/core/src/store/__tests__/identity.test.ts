// Deterministic stable-identity allocation across every model kind (document-
// engine task 3.3).

import { describe, expect, test } from 'bun:test';
import { IdentityAllocator, type IdKindName } from '../model/identity.ts';

const KINDS: IdKindName[] = [
  'story',
  'paragraph',
  'run',
  'part',
  'relationship',
  'table',
  'row',
  'cell',
  'bookmark',
  'comment',
  'revision',
  'annotation',
  'control',
];

describe('identity allocation', () => {
  test('allocates collision-free ids across all kinds', () => {
    const alloc = new IdentityAllocator();
    const ids = new Set<string>();
    for (const kind of KINDS) {
      for (let i = 0; i < 100; i++) {
        const id = alloc.allocate(kind);
        expect(ids.has(id)).toBe(false); // globally unique
        ids.add(id);
      }
    }
    expect(ids.size).toBe(KINDS.length * 100);
  });

  test('allocation is deterministic for the same seed state', () => {
    const a = new IdentityAllocator();
    const b = new IdentityAllocator();
    for (const kind of KINDS) {
      expect(a.allocate(kind)).toBe(b.allocate(kind));
    }
  });

  test('cursors round-trip through IdentityState (stable across reopen)', () => {
    const first = new IdentityAllocator();
    first.allocate('paragraph');
    first.allocate('paragraph');
    first.allocate('story');
    const state = first.state();
    // Resume from the persisted state — ids continue without collision.
    const resumed = new IdentityAllocator(state);
    expect(resumed.allocate('paragraph')).toBe('p-3');
    expect(resumed.allocate('story')).toBe('st-2');
  });

  test('per-kind cursors are independent', () => {
    const alloc = new IdentityAllocator();
    expect(alloc.allocate('paragraph')).toBe('p-1');
    expect(alloc.allocate('run')).toBe('r-1');
    expect(alloc.allocate('paragraph')).toBe('p-2');
  });
});
