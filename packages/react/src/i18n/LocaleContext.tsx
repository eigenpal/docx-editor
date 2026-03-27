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

/**
 * Parse ICU plural/selectordinal branches: "=0 {none} one {# item} other {# items}"
 * Supports both exact matches (=0, =1) and CLDR categories (zero, one, two, few, many, other).
 */
function parseBranches(branchStr: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const regex = /(=\d+|\w+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = regex.exec(branchStr)) !== null) {
    parsed[match[1]] = match[2];
  }
  return parsed;
}

/**
 * Select the best branch for a count value.
 * Priority: exact match (=N) > CLDR category > "other" fallback.
 */
function selectBranch(
  parsed: Record<string, string>,
  count: number,
  type: 'cardinal' | 'ordinal',
  lang: string
): string {
  // 1. Exact match (=0, =1, =2, etc.)
  const exact = parsed[`=${count}`];
  if (exact !== undefined) return exact;

  // 2. CLDR plural category via Intl.PluralRules
  let category: string;
  try {
    category = new Intl.PluralRules(lang, { type }).select(count);
  } catch {
    category = count === 1 ? 'one' : 'other';
  }

  return parsed[category] ?? parsed['other'] ?? '';
}

/**
 * Process ICU MessageFormat and simple {variable} interpolation.
 *
 * Supports (same subset as next-intl):
 *   - Interpolation: "Hello {name}" → "Hello World"
 *   - Cardinal plural: "{count, plural, =0 {none} one {# item} other {# items}}"
 *   - Ordinal plural: "{year, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}"
 *   - Exact matches: =0, =1, =2 etc. take priority over CLDR categories
 *   - # inside branches is replaced with the count value
 */
function formatMessage(
  template: string,
  vars?: Record<string, string | number>,
  lang?: string
): string {
  if (!vars) return template;

  // Process ICU plural/selectordinal blocks
  const result = template.replace(
    /\{(\w+),\s*(plural|selectordinal),\s*((?:[^{}]|\{[^{}]*\})*)\}/g,
    (full, varName, type, branchStr) => {
      const count = Number(vars[varName]);
      if (isNaN(count)) return full;

      const parsed = parseBranches(branchStr);
      const pluralType = type === 'selectordinal' ? 'ordinal' : 'cardinal';
      const text = selectBranch(parsed, count, pluralType, lang || 'en');
      return text.replace(/#/g, String(count));
    }
  );

  // Process simple {variable} interpolation
  return result.replace(/\{(\w+)\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

/** Simple deep equality check for locale objects. */
function localeEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
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
  children: ReactNode;
}

export function LocaleProvider({ locale, children }: LocaleProviderProps) {
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
  return <LocaleContext.Provider value={merged}>{children}</LocaleContext.Provider>;
}

export function useTranslation() {
  const strings = useContext(LocaleContext);
  // Read _lang from the locale file for plural rules
  const lang = (strings as unknown as Record<string, unknown>)['_lang'] as string | undefined;
  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      const value = getNestedValue(strings as unknown as Record<string, unknown>, key);
      return formatMessage(value ?? key, vars, lang);
    },
    [strings, lang]
  );
  return { t };
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
