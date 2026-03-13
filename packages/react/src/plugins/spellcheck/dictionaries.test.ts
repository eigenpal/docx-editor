import { describe, it, expect } from 'bun:test';
import { getDictionary } from './dictionaries';

describe('spellcheck dictionaries', () => {
  it('loads en_US dictionary data', () => {
    const dict = getDictionary('en_US');
    expect(typeof dict.aff).toBe('string');
    expect(typeof dict.dic).toBe('string');
    expect(dict.aff.length).toBeGreaterThan(0);
    expect(dict.dic.length).toBeGreaterThan(0);
  });

  it('loads en_GB dictionary data', () => {
    const dict = getDictionary('en_GB');
    expect(typeof dict.aff).toBe('string');
    expect(typeof dict.dic).toBe('string');
    expect(dict.aff.length).toBeGreaterThan(0);
    expect(dict.dic.length).toBeGreaterThan(0);
  });
});
