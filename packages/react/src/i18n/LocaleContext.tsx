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
 * Process ICU MessageFormat plurals and simple {variable} interpolation.
 *
 * Supports:
 *   - Simple interpolation: "Hello {name}" → "Hello World"
 *   - ICU plural: "{count, plural, one {# item} other {# items}}" → "5 items"
 *   - # inside plural branches is replaced with the count value
 *
 * This is the same subset that next-intl uses for basic plural support.
 */
function formatMessage(
  template: string,
  vars?: Record<string, string | number>,
  lang?: string
): string {
  if (!vars) return template;

  // Process ICU plural blocks: {varName, plural, one {text} other {text}}
  const result = template.replace(
    /\{(\w+),\s*plural,\s*((?:[^{}]|\{[^{}]*\})*)\}/g,
    (_, varName, branches) => {
      const count = Number(vars[varName]);
      if (isNaN(count)) return _;

      // Parse branches: "one {# item} other {# items}"
      const parsed: Record<string, string> = {};
      const branchRegex = /(\w+)\s*\{([^}]*)\}/g;
      let match;
      while ((match = branchRegex.exec(branches)) !== null) {
        parsed[match[1]] = match[2];
      }

      // Select category via Intl.PluralRules
      let category: string;
      try {
        category = new Intl.PluralRules(lang || 'en').select(count);
      } catch {
        category = count === 1 ? 'one' : 'other';
      }

      const text = parsed[category] ?? parsed['other'] ?? '';
      // Replace # with the actual count
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
