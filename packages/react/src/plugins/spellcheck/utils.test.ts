import { describe, it, expect } from 'bun:test';
import { normalizeWord, isCheckableWord } from './utils';

describe('spellcheck utils', () => {
  it('normalizes words', () => {
    expect(normalizeWord("Don't")).toBe("don't");
    expect(normalizeWord('  hello ')).toBe('hello');
  });

  it('filters non-checkable words', () => {
    expect(isCheckableWord('123')).toBe(false);
    expect(isCheckableWord('hello2')).toBe(false);
    expect(isCheckableWord('mother-in-law')).toBe(true);
  });
});
