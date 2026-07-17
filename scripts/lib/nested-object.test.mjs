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
});
