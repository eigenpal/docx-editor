import { describe, it, expect } from 'bun:test';
import { computeDebounceDelay } from './documentChangeScheduler';

describe('computeDebounceDelay', () => {
  it('clamps to min and max bounds', () => {
    expect(computeDebounceDelay({ docSize: 10, blockCount: 1, lastKeyInterval: 50 })).toBe(120);
    expect(computeDebounceDelay({ docSize: 500000, blockCount: 5000, lastKeyInterval: 20 })).toBe(
      650
    );
  });

  it('increases with doc size and block count', () => {
    const small = computeDebounceDelay({ docSize: 1000, blockCount: 20, lastKeyInterval: 60 });
    const large = computeDebounceDelay({ docSize: 100000, blockCount: 500, lastKeyInterval: 60 });
    expect(large).toBeGreaterThan(small);
  });

  it('reduces delay when typing slows', () => {
    const fast = computeDebounceDelay({ docSize: 50000, blockCount: 300, lastKeyInterval: 40 });
    const slow = computeDebounceDelay({ docSize: 50000, blockCount: 300, lastKeyInterval: 400 });
    expect(slow).toBeLessThanOrEqual(fast);
  });
});
