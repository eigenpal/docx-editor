/**
 * i18n system for Vue DOCX Editor
 *
 * Provides locale context and t() translation function with:
 * - Deep merge of partial translations over English defaults
 * - {variable} interpolation
 * - ICU MessageFormat plurals
 */

import { computed, inject, provide, unref, type InjectionKey, type App, type MaybeRef } from 'vue';
import en from '@eigenpal/docx-editor-i18n/en.json';

// ============================================================================
// TYPES
// ============================================================================

type AnyRecord = Record<string, unknown>;

/** The full locale strings type, derived from en.json */
export type LocaleStrings = typeof en;

/** Recursively makes all properties optional */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] | null;
};

/** Partial translations (null = fall back to English) */
export type PartialLocaleStrings = DeepPartial<LocaleStrings> & { _lang?: string };

/** Consumer-facing type for the i18n prop. */
export type Translations = PartialLocaleStrings;

/** Generates a union of all valid dot-notation paths through a nested object type */
type DotPath<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? DotPath<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];

export type TranslationKey = DotPath<LocaleStrings>;

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

const LOCALE_KEY: InjectionKey<MaybeRef<AnyRecord>> = Symbol('docx-locale');
const LANG_KEY: InjectionKey<MaybeRef<string>> = Symbol('docx-lang');

/**
 * Provide locale strings to descendant components.
 * Call this in a parent component's setup():
 *
 *   provideLocale(myTranslations);
 */
export function provideLocale(i18n?: MaybeRef<Translations | undefined>) {
  const { strings: merged, lang } = createTranslationContext(i18n);
  provide(LOCALE_KEY, merged);
  provide(LANG_KEY, lang);
}

function createTranslationContext(i18n?: MaybeRef<Translations | undefined>) {
  const strings = computed(() => {
    const i18nRecord = unref(i18n) as AnyRecord | undefined;
    return deepMerge(en as AnyRecord, i18nRecord);
  });
  const lang = computed(() => {
    const i18nRecord = unref(i18n) as AnyRecord | undefined;
    return typeof i18nRecord?._lang === 'string' ? i18nRecord._lang : 'en';
  });
  return { strings, lang };
}

export function createTranslator(i18n?: MaybeRef<Translations | undefined>) {
  const { strings, lang } = createTranslationContext(i18n);
  function t(key: string, vars?: Record<string, string | number>): string {
    const value = getNestedValue(unref(strings), key);
    return formatMessage(value ?? key, vars, unref(lang));
  }
  return { t };
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
    const value = getNestedValue(unref(strings), key);
    return formatMessage(value ?? key, vars, unref(lang));
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
