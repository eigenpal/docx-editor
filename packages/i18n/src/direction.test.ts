import { describe, expect, test } from 'bun:test';
import { catalogDirection, localeDirection } from './direction';
import { ar, es, he } from './index';

describe('catalogDirection', () => {
  test('the shipped right-to-left catalogs declare their direction', () => {
    expect(catalogDirection(ar)).toBe('rtl');
    expect(catalogDirection(he)).toBe('rtl');
    expect(catalogDirection(es)).toBe('ltr');
  });

  test('_dir decides over _lang', () => {
    expect(catalogDirection({ _lang: 'en', _dir: 'rtl' })).toBe('rtl');
    expect(catalogDirection({ _lang: 'ar', _dir: 'ltr' })).toBe('ltr');
    expect(catalogDirection({ _lang: 'fa' })).toBe('rtl');
    expect(catalogDirection({ _dir: 'sideways' })).toBeUndefined();
  });

  test('a catalog without direction or language has none', () => {
    expect(catalogDirection({})).toBeUndefined();
    expect(catalogDirection(undefined)).toBeUndefined();
  });
});

describe('localeDirection', () => {
  test('right-to-left languages', () => {
    for (const tag of ['ar', 'ar-SA', 'he', 'he-IL', 'iw', 'fa-IR', 'ur', 'ps', 'ckb', 'yi']) {
      expect(localeDirection(tag)).toBe('rtl');
    }
  });

  test('left-to-right languages and missing tags', () => {
    for (const tag of ['en', 'en-US', 'de', 'pt-BR', 'zh-CN', 'ja', 'hi', '', 'arab']) {
      expect(localeDirection(tag)).toBe('ltr');
    }
    expect(localeDirection(undefined)).toBe('ltr');
    expect(localeDirection(null)).toBe('ltr');
  });

  test('a script subtag decides over the language', () => {
    expect(localeDirection('az-Arab')).toBe('rtl');
    expect(localeDirection('pa_Arab_PK')).toBe('rtl');
    expect(localeDirection('ku-Latn')).toBe('ltr');
    expect(localeDirection('uz-Cyrl')).toBe('ltr');
    expect(localeDirection('AR')).toBe('rtl');
  });
});
