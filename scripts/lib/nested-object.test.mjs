import { afterEach, describe, expect, test } from 'bun:test';
import { deleteNestedValue, setNestedValue } from './nested-object.mjs';

afterEach(() => {
  delete Object.prototype.inheritedLocaleBranch;
  delete Object.prototype.polluted;
});

describe('nested object mutation', () => {
  test('setNestedValue does not descend into inherited objects', () => {
    Object.prototype.inheritedLocaleBranch = {};
    const target = {};

    setNestedValue(target, 'inheritedLocaleBranch.label', 'safe');

    expect(Object.prototype.inheritedLocaleBranch).toEqual({});
    expect(Object.hasOwn(target, 'inheritedLocaleBranch')).toBe(true);
    expect(target.inheritedLocaleBranch.label).toBe('safe');
  });

  test('rejects prototype-chain path segments', () => {
    const target = {};
    expect(() => setNestedValue(target, '__proto__.polluted', true)).toThrow();
    expect(() => deleteNestedValue(target, 'constructor.prototype.polluted')).toThrow();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  test('every unsafe key is refused at the head, in the middle and at the leaf', () => {
    // `setNestedValue` spells the three names out three times: once in the shared guard, once
    // at the descent step and once at the leaf write. A name added to only one of them would
    // still pass the test above, so each position is checked for each name.
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(() => setNestedValue({}, key, 1)).toThrow();
      expect(() => setNestedValue({}, `${key}.leaf`, 1)).toThrow();
      expect(() => setNestedValue({}, `a.${key}.leaf`, 1)).toThrow();
      expect(() => setNestedValue({}, `a.b.${key}`, 1)).toThrow();
      expect(() => deleteNestedValue({}, `a.${key}.leaf`)).toThrow();
    }
    expect(Object.prototype.polluted).toBeUndefined();
  });
});
