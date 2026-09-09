// Bounded automatic hyphenation: language admission, TeX offsets, last-fit helper.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  admittedHyphenationLanguage,
  DISCRETIONARY_HYPHEN_GLYPH,
  hyphenationBreakOffsets,
  hyphenationCacheSize,
  lastFittingDiscretionaryHyphen,
  MAX_HYPHENATION_CACHE_ENTRIES,
  MAX_HYPHENATION_WORD_UTF16,
  resetHyphenationCache,
} from '../hyphenation.ts';
import type { DiscretionaryHyphenRecord, StyleSpanRecord } from '../semantic-records.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';

afterEach(() => {
  resetHyphenationCache();
});

const measure = (text: string): number => text.length * 6;

describe('admitted BCP 47 languages', () => {
  test('en* maps to English patterns', () => {
    expect(admittedHyphenationLanguage('en')).toBe('en');
    expect(admittedHyphenationLanguage('en-US')).toBe('en');
    expect(admittedHyphenationLanguage('EN-GB')).toBe('en');
    expect(admittedHyphenationLanguage(' en-Latn-US ')).toBe('en');
  });

  test('ru* maps to Russian patterns', () => {
    expect(admittedHyphenationLanguage('ru')).toBe('ru');
    expect(admittedHyphenationLanguage('ru-RU')).toBe('ru');
  });

  test('unknown, empty, and malformed tags are refused', () => {
    expect(admittedHyphenationLanguage(null)).toBeNull();
    expect(admittedHyphenationLanguage(undefined)).toBeNull();
    expect(admittedHyphenationLanguage('')).toBeNull();
    expect(admittedHyphenationLanguage('fr')).toBeNull();
    expect(admittedHyphenationLanguage('de-DE')).toBeNull();
    expect(admittedHyphenationLanguage('en_US')).toBeNull();
    expect(admittedHyphenationLanguage('english')).toBeNull();
    expect(admittedHyphenationLanguage('zh')).toBeNull();
  });
});

describe('hyphenationBreakOffsets', () => {
  test('English citizenship breaks at TeX points and leaves the source unchanged', () => {
    const word = 'citizenship';
    expect(hyphenationBreakOffsets(word, 'en-US')).toEqual([3, 4, 7]);
    expect(word).toBe('citizenship');
    expect(word.includes('\u00AD')).toBe(false);
  });

  test('Russian Постоянное breaks at TeX points', () => {
    const word = 'Постоянное';
    expect(hyphenationBreakOffsets(word, 'ru')).toEqual([2, 5, 7]);
    expect(word).toBe('Постоянное');
  });

  test('doNotHyphenateCaps suppresses an all-caps word', () => {
    expect(hyphenationBreakOffsets('CITIZENSHIP', 'en', { doNotHyphenateCaps: true })).toEqual([]);
    expect(hyphenationBreakOffsets('CITIZENSHIP', 'en', { doNotHyphenateCaps: false })).toEqual([
      3, 4, 7,
    ]);
    expect(hyphenationBreakOffsets('Citizenship', 'en', { doNotHyphenateCaps: true })).toEqual([
      3, 4, 7,
    ]);
  });

  test('an unknown language fails open', () => {
    expect(hyphenationBreakOffsets('citizenship', 'fr')).toEqual([]);
    expect(hyphenationBreakOffsets('citizenship', 'de-DE')).toEqual([]);
  });

  test('English patterns admit Latin patient and refuse Cyrillic', () => {
    expect(hyphenationBreakOffsets('patient', 'en-US').length).toBeGreaterThan(0);
    expect(hyphenationBreakOffsets('patient', 'en-US')).toEqual(
      hyphenationBreakOffsets('patient', 'en')
    );
    expect(hyphenationBreakOffsets('Постоянное', 'en-US')).toEqual([]);
    expect(hyphenationBreakOffsets('Постоянное', 'en')).toEqual([]);
    expect(hyphenationCacheSize()).toBe(1);
  });

  test('Russian patterns admit Cyrillic and refuse Latin patient', () => {
    expect(hyphenationBreakOffsets('Постоянное', 'ru-RU')).toEqual([2, 5, 7]);
    expect(hyphenationBreakOffsets('patient', 'ru-RU')).toEqual([]);
    expect(hyphenationBreakOffsets('patient', 'ru')).toEqual([]);
    expect(hyphenationBreakOffsets('café', 'ru-RU')).toEqual([]);
    expect(hyphenationBreakOffsets('раtient', 'en-US')).toEqual([]);
    expect(hyphenationCacheSize()).toBe(1);
  });

  test('a word over the UTF-16 cap fails open', () => {
    const tooLong = 'a'.repeat(MAX_HYPHENATION_WORD_UTF16 + 1);
    expect(tooLong.length).toBe(65);
    expect(hyphenationBreakOffsets(tooLong, 'en')).toEqual([]);
    expect(hyphenationCacheSize()).toBe(0);
    hyphenationBreakOffsets('a'.repeat(MAX_HYPHENATION_WORD_UTF16), 'en');
    expect(hyphenationCacheSize()).toBe(1);
  });

  test('HTML-looking input is not hyphenated and is not rewritten', () => {
    const html = '<blockquote>citizenship</blockquote>';
    expect(hyphenationBreakOffsets(html, 'en')).toEqual([]);
    expect(html).toBe('<blockquote>citizenship</blockquote>');
  });
});

describe('lastFittingDiscretionaryHyphen', () => {
  test('returns the last prefix-plus-hyphen that fits, without U+00AD', () => {
    const word = 'citizenship';
    // Offsets 3/4/7 → "cit-" 24pt, "citi-" 30pt, "citizen-" 48pt at 6pt/glyph.
    const fit = lastFittingDiscretionaryHyphen(word, 'en', 30, measure);
    expect(fit).toEqual({ utf16Offset: 4, widthPt: 30, hyphenWidthPt: 6 });
    expect(word.slice(0, fit!.utf16Offset)).toBe('citi');
    expect(JSON.stringify(fit)).not.toContain('\u00ad');
    expect(DISCRETIONARY_HYPHEN_GLYPH).toBe('-');
  });

  test('a tighter width walks back to an earlier point', () => {
    expect(lastFittingDiscretionaryHyphen('citizenship', 'en', 29, measure)?.utf16Offset).toBe(3);
    expect(lastFittingDiscretionaryHyphen('citizenship', 'en', 23, measure)).toBeNull();
  });

  test('Russian last-fit uses the same geometry contract', () => {
    const fit = lastFittingDiscretionaryHyphen('Постоянное', 'ru', 36, measure);
    expect(fit).toEqual({ utf16Offset: 5, widthPt: 36, hyphenWidthPt: 6 });
  });

  test('a StyleSpanRecord can carry the hyphen without changing text or range', () => {
    const hyphen: DiscretionaryHyphenRecord = { widthPt: 6 };
    const span: StyleSpanRecord = {
      range: { paragraphId: 'p1', start: 0, end: 4 },
      text: 'citi',
      props: [],
      style: DEFAULT_RUN_STYLE,
      box: { x: 0, y: 0, width: 30, height: 14 },
      discretionaryHyphen: hyphen,
    };
    expect(span.text).toBe('citi');
    expect(span.range).toEqual({ paragraphId: 'p1', start: 0, end: 4 });
    expect(span.discretionaryHyphen?.widthPt).toBe(6);
    expect(span.text.includes('\u00AD')).toBe(false);
  });
});

describe('resource bounds', () => {
  test('the offset cache never grows past 4096 entries', () => {
    expect(MAX_HYPHENATION_CACHE_ENTRIES).toBe(4096);
    for (let index = 0; index < MAX_HYPHENATION_CACHE_ENTRIES + 8; index += 1) {
      let n = index;
      let word = '';
      for (let place = 0; place < 5; place += 1) {
        word = String.fromCharCode(97 + (n % 26)) + word;
        n = Math.floor(n / 26);
      }
      hyphenationBreakOffsets(word, 'en');
    }
    expect(hyphenationCacheSize()).toBe(MAX_HYPHENATION_CACHE_ENTRIES);
  });
});
