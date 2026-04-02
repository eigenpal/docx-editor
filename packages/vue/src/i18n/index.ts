/**
 * i18n system for Vue DOCX Editor
 *
 * Provides locale context and t() translation function with:
 * - Deep merge of partial translations over English defaults
 * - {variable} interpolation
 * - ICU MessageFormat plurals
 */

import { inject, provide, computed, type InjectionKey, type App } from 'vue';
import en from '../../i18n/en.json';

// ============================================================================
// TYPES
// ============================================================================

type AnyRecord = Record<string, unknown>;

/** The full locale strings type, derived from en.json */
export type LocaleStrings = typeof en;

/** Partial translations (null = fall back to English) */
export type Translations = {
  [K in keyof LocaleStrings]?: LocaleStrings[K] extends Record<string, unknown>
    ? { [J in keyof LocaleStrings[K]]?: LocaleStrings[K][J] | null }
    : LocaleStrings[K] | null;
} & { _lang?: string };

// ============================================================================
// HELPERS
// ============================================================================

function isRecord(v: unknown): v is AnyRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

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

function parseBranches(branchStr: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const regex = /(=\d+|\w+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = regex.exec(branchStr)) !== null) {
    parsed[match[1]] = match[2];
  }
  return parsed;
}

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
      const exact = parsed[`=${count}`];
      if (exact !== undefined) return exact.replace(/#/g, String(count));

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

// ============================================================================
// PROVIDE / INJECT
// ============================================================================

const LOCALE_KEY: InjectionKey<AnyRecord> = Symbol('docx-locale');
const LANG_KEY: InjectionKey<string> = Symbol('docx-lang');

/**
 * Provide locale strings to descendant components.
 * Call this in a parent component's setup():
 *
 *   provideLocale(myTranslations);
 */
export function provideLocale(i18n?: Translations) {
  const i18nRecord = i18n as AnyRecord | undefined;
  const lang = typeof i18nRecord?._lang === 'string' ? i18nRecord._lang : 'en';
  const merged = deepMerge(en as AnyRecord, i18nRecord);
  provide(LOCALE_KEY, merged);
  provide(LANG_KEY, lang);
}

/**
 * useTranslation composable — returns t(key, vars?) function.
 *
 * Usage:
 *   const { t } = useTranslation();
 *   t('toolbar.bold')
 *   t('dialogs.findReplace.matchCount', { current: 3, total: 15 })
 */
export function useTranslation() {
  const strings = inject(LOCALE_KEY, en as AnyRecord);
  const lang = inject(LANG_KEY, 'en');

  function t(key: string, vars?: Record<string, string | number>): string {
    const value = getNestedValue(strings, key);
    return formatMessage(value ?? key, vars, lang);
  }

  return { t };
}

/**
 * Vue plugin for i18n — install via app.use(i18nPlugin, translations)
 */
export const i18nPlugin = {
  install(app: App, i18n?: Translations) {
    const i18nRecord = i18n as AnyRecord | undefined;
    const lang = typeof i18nRecord?._lang === 'string' ? i18nRecord._lang : 'en';
    const merged = deepMerge(en as AnyRecord, i18nRecord);
    app.provide(LOCALE_KEY, merged);
    app.provide(LANG_KEY, lang);
  },
};

export { en as defaultLocale };
