import { describe, expect, test } from 'bun:test';
import { findWordBoundaries, isWordCharacter } from '../textSelection';

describe('textSelection word boundaries', () => {
  test('treats accented letters as word characters', () => {
    expect(isWordCharacter('Ó')).toBe(true);
    expect(isWordCharacter('Ł')).toBe(true);
  });

  test('selects the full word when the cursor is on a diacritic', () => {
    const text = 'PROTOKÓŁ';
    const [start, end] = findWordBoundaries(text, 6);

    expect(text.slice(start, end)).toBe('PROTOKÓŁ');
  });
});
