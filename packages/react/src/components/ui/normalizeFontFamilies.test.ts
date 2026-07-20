import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import { normalizeFontFamilies } from './normalizeFontFamilies';
import type { FontOption } from './FontPicker';

describe('normalizeFontFamilies', () => {
  test('returns undefined when prop is omitted (FontPicker uses defaults)', () => {
    expect(normalizeFontFamilies(undefined)).toBeUndefined();
  });

  test('returns empty array when prop is an empty array (host opt-out)', () => {
    expect(normalizeFontFamilies([])).toEqual([]);
  });

  test('expands string entries to { name, fontFamily, category: "other" }', () => {
    expect(normalizeFontFamilies(['Arial', 'Roboto'])).toEqual([
      { name: 'Arial', fontFamily: 'Arial', category: 'other' },
      { name: 'Roboto', fontFamily: 'Roboto', category: 'other' },
    ]);
  });

  test('passes FontOption objects through unchanged', () => {
    const fonts: FontOption[] = [
      { name: 'Roboto', fontFamily: 'Roboto, sans-serif', category: 'sans-serif' },
      { name: 'Cambria', fontFamily: 'Cambria, serif', category: 'serif' },
    ];
    expect(normalizeFontFamilies(fonts)).toEqual(fonts);
  });

  test('handles a mixed (string | FontOption)[] union', () => {
    const result = normalizeFontFamilies([
      'Arial',
      { name: 'Roboto', fontFamily: 'Roboto, sans-serif', category: 'sans-serif' },
    ]);
    expect(result).toEqual([
      { name: 'Arial', fontFamily: 'Arial', category: 'other' },
      { name: 'Roboto', fontFamily: 'Roboto, sans-serif', category: 'sans-serif' },
    ]);
  });

  describe('duplicate-name dev warning', () => {
    let originalWarn: typeof console.warn;
    let warnSpy: ReturnType<typeof mock>;

    beforeEach(() => {
      originalWarn = console.warn;
      warnSpy = mock(() => {});
      console.warn = warnSpy;
    });

    afterEach(() => {
      console.warn = originalWarn;
    });

    test('warns on duplicate names from string + FontOption mix', () => {
      normalizeFontFamilies([
        'Arial',
        { name: 'Arial', fontFamily: 'Arial, Helvetica, sans-serif' },
      ]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const arg = warnSpy.mock.calls[0][0] as string;
      expect(arg).toContain('Duplicate font name');
      expect(arg).toContain('Arial');
      expect(arg).toContain('[DocxEditor]');
    });

    test('warns once per duplicate name even when it appears 3+ times', () => {
      // Triple-duplicate must produce exactly one warning, not two.
      // Otherwise a typo'd large list spams the console.
      normalizeFontFamilies(['Arial', 'Arial', 'Arial']);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    test('warns once per distinct duplicate name', () => {
      normalizeFontFamilies(['Arial', 'Arial', 'Roboto', 'Roboto']);
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    test('does not warn when names are unique', () => {
      normalizeFontFamilies(['Arial', 'Roboto', 'Cambria']);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
