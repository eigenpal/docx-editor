import { describe, expect, test } from 'bun:test';
import { clampSplit, desktopSplitBounds } from './split-layout';

describe('desktop split bounds', () => {
  test.each([901, 1_000])('keeps two 320px panes at a %dpx viewport', (width) => {
    const bounds = desktopSplitBounds(width);
    const divider = 1;
    expect((bounds.min / 100) * width).toBeGreaterThanOrEqual(320);
    expect(width - (bounds.max / 100) * width - divider).toBeGreaterThanOrEqual(319.999);
    expect(clampSplit(72, bounds)).toBe(bounds.max);
  });

  test('restores the preferred range when both panes fit it', () => {
    expect(desktopSplitBounds(1_200)).toEqual({ min: 28, max: 72 });
  });
});
