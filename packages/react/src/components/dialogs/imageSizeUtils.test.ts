import { describe, it, expect } from 'bun:test';
import { applyLockedDimensionChange } from './imageSizeUtils';

describe('imageSizeUtils', () => {
  it('locks height when width changes', () => {
    const result = applyLockedDimensionChange({
      width: 200,
      height: 100,
      ratio: 2,
      lock: true,
      changed: 'width',
      value: 400,
    });
    expect(result.width).toBe(400);
    expect(result.height).toBe(200);
  });

  it('locks width when height changes', () => {
    const result = applyLockedDimensionChange({
      width: 200,
      height: 100,
      ratio: 2,
      lock: true,
      changed: 'height',
      value: 50,
    });
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it('does not lock when disabled', () => {
    const result = applyLockedDimensionChange({
      width: 200,
      height: 100,
      ratio: 2,
      lock: false,
      changed: 'width',
      value: 123,
    });
    expect(result.width).toBe(123);
    expect(result.height).toBe(100);
  });
});
