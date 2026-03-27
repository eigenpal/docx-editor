import { describe, expect, test } from 'bun:test';
import { findWordBoundaries, isWordCharacter } from '../textSelection';

describe('textSelection word boundaries', () => {
  test('treats accented letters, combining marks, and underscores as word characters', () => {
    expect(isWordCharacter('Ó')).toBe(true);
    expect(isWordCharacter('Ł')).toBe(true);
    expect(isWordCharacter('\u0301')).toBe(true);
    expect(isWordCharacter('_')).toBe(true);
  });

  test('selects the full word when the cursor is on a diacritic', () => {
    const text = 'PROTOKÓŁ';
    const [start, end] = findWordBoundaries(text, 6);

    expect(text.slice(start, end)).toBe('PROTOKÓŁ');
  });

  test('selects the full word when the cursor is on a combining mark', () => {
    const text = 'Cafe\u0301';
    const [start, end] = findWordBoundaries(text, 4);

    expect(text.slice(start, end)).toBe(text);
  });

  test('selects the full word for scripts that rely on combining marks', () => {
    const text = 'किताब';
    const [start, end] = findWordBoundaries(text, 1);

    expect(text.slice(start, end)).toBe(text);
  });

  test('preserves underscore-delimited identifiers as a single word', () => {
    const text = 'foo_bar';
    const [start, end] = findWordBoundaries(text, 3);

    expect(text.slice(start, end)).toBe(text);
  });
});
