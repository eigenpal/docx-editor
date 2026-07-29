// Migration runner tests (document-engine task 5.7): resumable multi-step
// migration, validation-before-publication, and prior-checkpoint recovery with
// no partial migrated state.

import { describe, expect, test } from 'bun:test';
import { MigrationRunner, type MigrationStep } from '../store/index.ts';

interface Doc {
  readonly v: number;
  readonly fields: readonly string[];
}

const addField = (from: number, field: string, valid = true): MigrationStep<Doc> => ({
  from,
  to: from + 1,
  migrate: (d) => ({ v: from + 1, fields: [...d.fields, field] }),
  validate: () => valid,
});

describe('successful migration', () => {
  test('applies steps in order and records applied versions', () => {
    const runner = new MigrationRunner<Doc>().register(addField(1, 'a')).register(addField(2, 'b'));
    const r = runner.run({ v: 1, fields: [] }, 1, 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.version).toBe(3);
      expect(r.applied).toEqual([2, 3]);
      expect(r.data.fields).toEqual(['a', 'b']);
    }
  });
  test('same version is a no-op', () => {
    const r = new MigrationRunner<Doc>().run({ v: 2, fields: ['x'] }, 2, 2);
    expect(r).toMatchObject({ ok: true, version: 2, applied: [] });
  });
});

describe('safe failure -> prior checkpoint, no partial state', () => {
  const original: Doc = { v: 1, fields: ['orig'] };

  test('a missing migration path recovers the original', () => {
    const runner = new MigrationRunner<Doc>().register(addField(1, 'a')); // no step 2->3
    const r = runner.run(original, 1, 3);
    expect(r).toMatchObject({ ok: false, reason: 'no-path', recoveredVersion: 1 });
    if (!r.ok) expect(r.recovered).toBe(original); // exact original, not partial
  });

  test('a throwing step recovers the original (interruption mid-migration)', () => {
    const runner = new MigrationRunner<Doc>()
      .register(addField(1, 'a'))
      .register({ from: 2, to: 3, migrate: () => { throw new Error('crash'); }, validate: () => true });
    const r = runner.run(original, 1, 3);
    expect(r).toMatchObject({ ok: false, reason: 'migration-threw' });
    if (!r.ok) expect(r.recovered.fields).toEqual(['orig']); // no 'a' leaked out
  });

  test('a failed validation recovers the original (validation before publication)', () => {
    const runner = new MigrationRunner<Doc>().register(addField(1, 'a', /* valid */ false));
    const r = runner.run(original, 1, 2);
    expect(r).toMatchObject({ ok: false, reason: 'validation-failed', recoveredVersion: 1 });
    if (!r.ok) expect(r.recovered).toBe(original);
  });

  test('after recovery, migration is resumable from the recovered version', () => {
    // A first run fails at step 2->3; a second run (with the step fixed) succeeds.
    const broken = new MigrationRunner<Doc>()
      .register(addField(1, 'a'))
      .register({ from: 2, to: 3, migrate: () => { throw new Error('x'); }, validate: () => true });
    const first = broken.run(original, 1, 3);
    expect(first.ok).toBe(false);
    const fixed = new MigrationRunner<Doc>().register(addField(1, 'a')).register(addField(2, 'b'));
    const second = fixed.run(first.ok ? first.data : (first as { recovered: Doc }).recovered, 1, 3);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.fields).toEqual(['orig', 'a', 'b']); // original 'orig' + migrated fields
  });
});
