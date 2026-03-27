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
  const merged = useMemo(
    () => deepMerge(defaultLocale, locale as Record<string, unknown> | undefined),
    [locale]
  );
  return <LocaleContext.Provider value={merged}>{children}</LocaleContext.Provider>;
}

export function useTranslation() {
  const strings = useContext(LocaleContext);
  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      const value = getNestedValue(strings as unknown as Record<string, unknown>, key);
      return interpolate(value ?? key, vars);
    },
    [strings]
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
