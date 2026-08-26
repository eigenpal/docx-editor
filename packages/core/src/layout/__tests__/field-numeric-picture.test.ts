// The `\#` numeric picture switch: what it renders, and what it refuses.
import { describe, expect, test } from 'bun:test';
import { formatNumericPicture, MAX_NUMERIC_PICTURE_CHARS } from '../field-numeric-picture.ts';
import {
  allowlistedPageField,
  matchAllowlistedPageField,
  pageFieldNumericPicture,
} from '../field-instruction.ts';
import { projectPageFieldValue } from '../field-page-furniture.ts';

describe('numeric picture rendering', () => {
  test('fills digit positions from the right', () => {
    expect(formatNumericPicture(2, '0#')).toBe('02');
    expect(formatNumericPicture(12, '0#')).toBe('12');
    expect(formatNumericPicture(7, '000')).toBe('007');
    expect(formatNumericPicture(7, '###')).toBe('7');
  });

  test('keeps every digit of a value wider than the picture', () => {
    expect(formatNumericPicture(1234, '0#')).toBe('1234');
    expect(formatNumericPicture(100, '0')).toBe('100');
  });

  test('paints literals, and a grouping comma only with a digit to its left', () => {
    expect(formatNumericPicture(2, 'Page 0')).toBe('Page 2');
    expect(formatNumericPicture(1234, '#,##0')).toBe('1,234');
    expect(formatNumericPicture(5, '#,##0')).toBe('5');
  });

  test('refuses a picture with no digit position, an oversized one, or a bad value', () => {
    expect(formatNumericPicture(2, '')).toBeNull();
    expect(formatNumericPicture(2, 'Page')).toBeNull();
    expect(formatNumericPicture(2, '0'.repeat(MAX_NUMERIC_PICTURE_CHARS + 1))).toBeNull();
    expect(formatNumericPicture(Number.NaN, '0#')).toBeNull();
    expect(formatNumericPicture(-1, '0#')).toBeNull();
  });
});

describe('page-field instructions carrying a picture', () => {
  test('allowlists the keyword and reads its picture', () => {
    expect(allowlistedPageField(' PAGE \\# 0# ')).toBe('PAGE');
    expect(pageFieldNumericPicture(' PAGE \\# 0# ')).toBe('0#');
    expect(pageFieldNumericPicture('NUMPAGES \\# "000"')).toBe('000');
    expect(matchAllowlistedPageField('PAGE \\# 0#')).toEqual({ kind: 'PAGE', picture: '0#' });
    expect(matchAllowlistedPageField('PAGE')).toEqual({ kind: 'PAGE' });
  });

  test('keeps the picture case the author wrote', () => {
    expect(pageFieldNumericPicture('PAGE \\# "Page 0"')).toBe('Page 0');
  });

  test('leaves a field inert when another switch rides with the picture', () => {
    expect(allowlistedPageField('PAGE \\n 3 \\# 0#')).toBeNull();
    expect(allowlistedPageField('INCLUDETEXT "http://example.invalid" \\# 0#')).toBeNull();
    expect(pageFieldNumericPicture('DATE \\# 0#')).toBeUndefined();
  });

  test('projects the computed value through the picture', () => {
    expect(projectPageFieldValue('PAGE', { pageNumber: 2, pageCount: 9 }, '0#')).toBe('02');
    expect(projectPageFieldValue('NUMPAGES', { pageNumber: 2, pageCount: 9 }, '000')).toBe('009');
    // An unusable picture falls back to the plain number, never to a cached result.
    expect(projectPageFieldValue('PAGE', { pageNumber: 2, pageCount: 9 }, 'Page')).toBe('2');
    // A non-decimal page format has no digits for a picture to place, so the format wins.
    expect(
      projectPageFieldValue('PAGE', { pageNumber: 4, pageCount: 9, format: 'lowerRoman' }, '0#')
    ).toBe('iv');
  });
});
