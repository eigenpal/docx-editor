// Task 8 fix round 4 — exact Minkowski event sweep with source/clip segment intersections.

import { describe, expect, test } from 'bun:test';
import { minkowskiExcludedIntervalsAtY } from '../drawing-wrap.ts';
import type { DrawingPoint } from '../drawing-geometry.ts';

describe('fix round 4 — source/clip segment intersection event sweep', () => {
  const source: readonly DrawingPoint[] = Object.freeze([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 1 },
    { x: 1, y: 1 },
  ]);
  const clip: readonly DrawingPoint[] = Object.freeze([
    { x: 0.6, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 1 },
    { x: -0.4, y: 1 },
  ]);

  test('reviewer counterexample yields [0.3, 10] not [0.5, 10]', () => {
    const excluded = minkowskiExcludedIntervalsAtY(
      source,
      0,
      { top: 1, right: 0, bottom: 0, left: 0 },
      'nonzero',
      clip
    );
    expect(excluded).toHaveLength(1);
    expect(excluded[0]!.start).toBeCloseTo(0.3, 5);
    expect(excluded[0]!.end).toBeCloseTo(10, 5);
  });

  test('crossing-edge regression preserves left endpoint at interior band crossing', () => {
    const excluded = minkowskiExcludedIntervalsAtY(
      source,
      0.65,
      { top: 0.35, right: 0, bottom: 0.35, left: 0 },
      'nonzero',
      clip
    );
    expect(excluded[0]!.start).toBeCloseTo(0.3, 5);
    expect(excluded[0]!.end).toBeCloseTo(10, 5);
  });
});
