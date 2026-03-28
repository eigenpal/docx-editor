import { createContext, useContext, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import en from '../../i18n/en.json';
import type { LocaleStrings, Translations, TranslationKey } from './types';

const defaultLocale: LocaleStrings = en;

const LocaleContext = createContext<LocaleStrings>(defaultLocale);
const LangContext = createContext<string>('en');

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deep merge locale objects. Null values in the override are treated as
 * "not yet translated" and fall back to the base (English) value.
 */
function deepMerge(base: AnyRecord, override: AnyRecord | undefined): AnyRecord {
  if (!override) return base;
  const result: AnyRecord = { ...base };
  for (const key of Object.keys(override)) {
    const overVal = override[key];
    if (overVal === null) continue;
    if (isRecord(base[key]) && isRecord(overVal)) {
      result[key] = deepMerge(base[key], overVal);
    } else if (overVal !== undefined) {
      result[key] = overVal;
    }
  }
  return result;
}

function getNestedValue(obj: AnyRecord, path: string): string | undefined {
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
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
  i18n?: Translations;
  children: ReactNode;
}

export function LocaleProvider({ i18n, children }: LocaleProviderProps) {
  const i18nRecord = i18n as AnyRecord | undefined;
  const lang = typeof i18nRecord?._lang === 'string' ? i18nRecord._lang : 'en';
  const merged = useMemo(() => deepMerge(defaultLocale, i18nRecord), [i18nRecord]);
  return (
    <LangContext.Provider value={lang}>
      <LocaleContext.Provider value={merged as LocaleStrings}>{children}</LocaleContext.Provider>
    </LangContext.Provider>
  );
}

export function useTranslation() {
  const strings = useContext(LocaleContext);
  const lang = useContext(LangContext);
  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      const value = getNestedValue(strings as AnyRecord, key);
      return formatMessage(value ?? key, vars, lang);
    },
    [strings, lang]
  );
  return { t };
}
