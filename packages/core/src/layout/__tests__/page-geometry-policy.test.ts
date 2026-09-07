import { describe, expect, test } from 'bun:test';
import {
  applyPageGeometryGridPolicy,
  type PageGeometryGridPolicy,
} from '../page-geometry-policy.ts';

const policy: PageGeometryGridPolicy = Object.freeze({
  unitPt: 72 / 300,
  rounding: 'nearest',
  contentExtent: 'source-span-nearest',
});

describe('page geometry grid phases', () => {
  test('rounds the source content span before deriving the trailing margin', () => {
    const geometry = applyPageGeometryGridPolicy(
      {
        width: 11907 / 20,
        height: 16840 / 20,
        margin: {
          top: 1797 / 20,
          right: 1797 / 20,
          bottom: 1797 / 20,
          left: 1797 / 20,
        },
      },
      policy
    );
    expect(geometry.width).toBeCloseTo(595.44, 12);
    expect(geometry.margin.left).toBeCloseTo(89.76, 12);
    expect(geometry.width - geometry.margin.left - geometry.margin.right).toBeCloseTo(415.68, 12);
  });
});
