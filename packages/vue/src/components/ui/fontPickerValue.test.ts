import { describe, expect, test } from 'bun:test';
import { getPrimaryFontFamily } from './fontPickerValue';

describe('getPrimaryFontFamily', () => {
  test('keeps a single family unchanged', () => {
    expect(getPrimaryFontFamily('Lato')).toBe('Lato');
  });

  test('extracts the first family from a CSS fallback stack', () => {
    expect(getPrimaryFontFamily('Montserrat, sans-serif')).toBe('Montserrat');
  });

  test('unquotes a spaced family from a CSS fallback stack', () => {
    expect(getPrimaryFontFamily('"Open Sans", sans-serif')).toBe('Open Sans');
  });

  test('does not split commas inside quoted family names', () => {
    expect(getPrimaryFontFamily('"Family, With Comma", serif')).toBe('Family, With Comma');
  });
});
