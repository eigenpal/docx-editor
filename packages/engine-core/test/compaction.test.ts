// Atomic snapshot compaction tests (document-engine task 5.8): concurrent updates
// preserved exactly-once, prior checkpoint retained until validation, and
// crash-recovery materialization.

import { describe, expect, test } from 'bun:test';
import { compact, materialize, type Compactable, type Checkpoint } from '../src/store/index.ts';

interface State { readonly applied: readonly string[] }
interface Update { readonly id: string }

const ops: Compactable<State, Update> = {
  apply: (s, u) => ({ applied: [...s.applied, u.id] }),
  validate: (s) => s.applied.length >= 0,
  updateId: (u) => u.id,
};

const base: Checkpoint<State, Update> = { snapshot: { applied: ['s0'] }, log: [{ id: 'u1' }, { id: 'u2' }] };

describe('compaction', () => {
  test('folds the log into the snapshot and retains the prior checkpoint', () => {
    const r = compact(base, ops);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.checkpoint.snapshot.applied).toEqual(['s0', 'u1', 'u2']);
    expect(r.checkpoint.log).toEqual([]);
    expect(r.prior).toBe(base); // prior retained for recovery until confirmed
  });

  test('updates arriving during compaction are preserved in the new tail log', () => {
    const r = compact(base, ops, [{ id: 'u3' }, { id: 'u4' }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.checkpoint.log.map((u) => u.id)).toEqual(['u3', 'u4']);
  });

  test('a concurrent update duplicating a folded one is dropped (exactly once)', () => {
    // u2 was already folded; a re-delivered u2 during compaction must not repeat.
    const r = compact(base, ops, [{ id: 'u2' }, { id: 'u3' }, { id: 'u3' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.checkpoint.log.map((u) => u.id)).toEqual(['u3']); // u2 folded, u3 once
    // Crash recovery: materialize -> each update appears exactly once.
    expect(materialize(r.checkpoint, ops).applied).toEqual(['s0', 'u1', 'u2', 'u3']);
  });

  test('validation failure retains the prior checkpoint (no new state published)', () => {
    const failing: Compactable<State, Update> = { ...ops, validate: () => false };
    const r = compact(base, failing);
    expect(r).toMatchObject({ ok: false, reason: 'validation-failed' });
    if (!r.ok) expect(r.retained).toBe(base);
  });
});
