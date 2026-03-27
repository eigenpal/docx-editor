import { createContext, useContext, useMemo, useCallback } from 'react';
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
 * Parse ICU plural branches: "=0 {none} one {# item} other {# items}"
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
 * Process ICU MessageFormat plurals and simple {variable} interpolation.
 *
 * Supports (same subset as next-intl):
 *   - Interpolation: "Hello {name}"
 *   - Cardinal plural: "{count, plural, =0 {none} one {# item} other {# items}}"
 *   - Exact matches: =0, =1, =2 take priority over CLDR categories
 *   - # inside branches is replaced with the count value
 */
function formatMessage(
  template: string,
  vars?: Record<string, string | number>,
  lang?: string
): string {
  if (!vars) return template;

  const result = template.replace(
    /\{(\w+),\s*plural,\s*((?:[^{}]|\{[^{}]*\})*)\}/g,
    (full, varName, branchStr) => {
      const count = Number(vars[varName]);
      if (isNaN(count)) return full;

      const parsed = parseBranches(branchStr);

      // Exact match (=0, =1) takes priority
      const exact = parsed[`=${count}`];
      if (exact !== undefined) return exact.replace(/#/g, String(count));

      // CLDR plural category via Intl.PluralRules
      let category: string;
      try {
        category = new Intl.PluralRules(lang || 'en').select(count);
      } catch {
        category = count === 1 ? 'one' : 'other';
      }

      const text = parsed[category] ?? parsed['other'] ?? '';
      return text.replace(/#/g, String(count));
    }
  );

  return result.replace(/\{(\w+)\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

export interface LocaleProviderProps {
  locale?: PartialLocaleStrings;
  children: ReactNode;
}

export function LocaleProvider({ locale, children }: LocaleProviderProps) {
  const merged = useMemo(
    () => deepMerge(defaultLocale, locale as Record<string, unknown> | undefined),
    [locale]
  );
  return <LocaleContext.Provider value={merged}>{children}</LocaleContext.Provider>;
}

export function useTranslation() {
  const strings = useContext(LocaleContext);
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
