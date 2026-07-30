// Tests for the frozen canonical comparator formats (document-engine task 0.4).

import { describe, expect, test } from 'bun:test';
import {
  canonicalize,
  stableHash,
  compareArtifacts,
  fingerprint,
  COMPARATORS,
} from '../comparators/index.ts';

describe('canonicalize', () => {
  test('key order does not affect canonical form; array order does', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });
  test('drops declared ephemera at any depth', () => {
    const e = new Set(['revision']);
    expect(canonicalize({ x: 1, revision: 9 }, e)).toBe(canonicalize({ x: 1, revision: 3 }, e));
    expect(canonicalize({ n: { revision: 1, v: 2 } }, e)).toBe(canonicalize({ n: { v: 2 } }, e));
  });
  test('-0 normalizes and non-finite numbers are rejected', () => {
    expect(canonicalize(-0)).toBe(canonicalize(0));
    expect(() => canonicalize(Infinity)).toThrow();
    expect(() => canonicalize(NaN)).toThrow();
  });
  test('cyclic structures are rejected', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalize(a)).toThrow();
  });
  test('stableHash is deterministic and key-order independent', () => {
    expect(stableHash({ a: 1, b: [2, 3] })).toBe(stableHash({ b: [2, 3], a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
    expect(stableHash({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('authored-state comparator (canonical-exact, ephemera excluded)', () => {
  test('equal when only ephemera differ', () => {
    const a = { body: 'x', revision: 1, commitId: 'c1', producedAt: 100 };
    const b = { body: 'x', revision: 2, commitId: 'c2', producedAt: 200 };
    expect(compareArtifacts('authoredState', a, b).equal).toBe(true);
    expect(fingerprint('authoredState', a)).toBe(fingerprint('authoredState', b));
  });
  test('unequal when authored content differs, with diagnostic forms', () => {
    const r = compareArtifacts('authoredState', { body: 'x' }, { body: 'y' });
    expect(r.equal).toBe(false);
    expect(r.left).toBeDefined();
    expect(r.right).toBeDefined();
  });
});

describe('exact comparators keep every field', () => {
  test('shaped runs compare all fields (no ephemera drop)', () => {
    const a = { glyphs: [1, 2], advances: [10, 12], revision: 1 };
    const b = { glyphs: [1, 2], advances: [10, 12], revision: 2 };
    // revision is NOT ephemera for exact-mode comparators, so these differ.
    expect(compareArtifacts('shapedRun', a, b).equal).toBe(false);
  });
});

describe('mode guards', () => {
  test('yjs state vector is not an equivalence basis', () => {
    expect(() => compareArtifacts('yjsStateVector', {}, {})).toThrow(/not an equivalence basis/);
    expect(() => fingerprint('yjsStateVector', {})).toThrow();
  });
  test('raster tolerance requires explicit epsilon', () => {
    expect(() => compareArtifacts('rasterCheckpoint', 1, 1)).toThrow(/epsilon/);
    expect(compareArtifacts('rasterCheckpoint', 100, 100.5, { epsilon: 1 }).equal).toBe(true);
    expect(compareArtifacts('rasterCheckpoint', 100, 102, { epsilon: 1 }).equal).toBe(false);
  });
  test('artifacts required to match exactly declare no tolerance', () => {
    for (const name of [
      'shapedRun',
      'paginationFingerprint',
      'semanticTree',
      'hitTest',
      'anchor',
    ] as const) {
      expect(COMPARATORS[name].mode).toBe('exact');
    }
  });
});
