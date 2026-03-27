import { createContext, useContext, useMemo, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import en from '../../i18n/en.json';
import type { LocaleStrings, PartialLocaleStrings, TranslationKey } from './types';

const defaultLocale: LocaleStrings = en;

const LocaleContext = createContext<LocaleStrings>(defaultLocale);

/**
 * Deep merge locale objects. Null values in the override are treated as
 * "not yet translated" and fall back to the base (English) value.
 */
function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown> | undefined
): T {
  if (!override) return base;
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = (base as Record<string, unknown>)[key];
    const overVal = override[key];
    // null means "not yet translated" — keep base value
    if (overVal === null) continue;
    if (
      baseVal &&
      overVal &&
      typeof baseVal === 'object' &&
      typeof overVal === 'object' &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overVal)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>
      );
    } else if (overVal !== undefined) {
      (result as Record<string, unknown>)[key] = overVal;
    }
  }
  return result;
}

function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

/**
 * Simple deep equality check for locale objects.
 * Compares JSON serializations — fast enough for locale-sized objects (~5-10KB).
 */
function localeEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Basic CLDR-style plural category selection.
 * Covers the most common plural rules. Languages with more complex rules
 * (e.g., Arabic with 6 forms) can override via the `other` fallback.
 */
function getPluralCategory(
  count: number,
  lang?: string
): 'zero' | 'one' | 'two' | 'few' | 'many' | 'other' {
  const abs = Math.abs(count);
  const prefix = lang?.split('-')[0];

  // Languages with zero form
  if (abs === 0 && (prefix === 'ar' || prefix === 'lv')) return 'zero';

  if (abs === 1) return 'one';
  if (abs === 2 && prefix === 'ar') return 'two';

  // Slavic plural rules (Polish, Russian, Ukrainian, etc.)
  if (
    prefix === 'pl' ||
    prefix === 'ru' ||
    prefix === 'uk' ||
    prefix === 'hr' ||
    prefix === 'sr' ||
    prefix === 'bs'
  ) {
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
    if (mod10 === 0 || (mod10 >= 5 && mod10 <= 9) || (mod100 >= 11 && mod100 <= 14)) return 'many';
  }

  return 'other';
}

/**
 * Collect all null-valued leaf keys from a locale object (untranslated strings).
 */
function findNullKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v === null) {
      keys.push(path);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...findNullKeys(v as Record<string, unknown>, path));
    }
  }
  return keys;
}

export interface LocaleProviderProps {
  locale?: PartialLocaleStrings;
  /** BCP 47 language tag (e.g., "pl", "de", "ar"). Used for plural rules. */
  lang?: string;
  children: ReactNode;
}

const LangContext = createContext<string | undefined>(undefined);

export function LocaleProvider({ locale, lang, children }: LocaleProviderProps) {
  // Deep-compare locale to avoid re-renders when consumers pass inline objects
  const localeRef = useRef(locale);
  if (
    !localeEqual(locale as Record<string, unknown>, localeRef.current as Record<string, unknown>)
  ) {
    localeRef.current = locale;
  }
  const stableLocale = localeRef.current;

  const merged = useMemo(
    () => deepMerge(defaultLocale, stableLocale as Record<string, unknown> | undefined),
    [stableLocale]
  );
  return (
    <LangContext.Provider value={lang}>
      <LocaleContext.Provider value={merged}>{children}</LocaleContext.Provider>
    </LangContext.Provider>
  );
}

export function useTranslation() {
  const strings = useContext(LocaleContext);
  const lang = useContext(LangContext);
  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      const value = getNestedValue(strings as unknown as Record<string, unknown>, key);
      return interpolate(value ?? key, vars);
    },
    [strings]
  );

  /**
   * Pluralized translation. Looks up `${key}.one`, `${key}.few`, `${key}.many`, `${key}.other`
   * based on CLDR plural rules for the current language.
   *
   * @example
   * // en.json: { "comments": { "replies": { "one": "{count} reply", "other": "{count} replies" } } }
   * tPlural('comments.replies', 3) // → "3 replies"
   * tPlural('comments.replies', 1) // → "1 reply"
   */
  const tPlural = useCallback(
    (key: string, count: number, vars?: Record<string, string | number>): string => {
      const category = getPluralCategory(count, lang);
      const allVars = { count, ...vars };
      const stringsObj = strings as unknown as Record<string, unknown>;

      // Try category-specific key, then fall back to 'other', then the key itself
      const value =
        getNestedValue(stringsObj, `${key}.${category}`) ??
        getNestedValue(stringsObj, `${key}.other`) ??
        key;
      return interpolate(value, allVars);
    },
    [strings, lang]
  );

  return { t, tPlural };
}

/**
 * Returns keys that are null (untranslated) in the given locale object.
 * Use in dev tools / CI to detect missing translations.
 *
 * @example
 * import pl from '@eigenpal/docx-js-editor/i18n/pl.json';
 * const missing = getMissingTranslations(pl);
 * // → ["toolbar.bold", "dialogs.findReplace.title", ...]
 */
export function getMissingTranslations(locale: Record<string, unknown>): string[] {
  return findNullKeys(locale);
}
