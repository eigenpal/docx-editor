/**
 * Vue bindings for the shared i18n surface. ICU formatting, deep-merge,
 * and locale data live in `@eigenpal/docx-editor-i18n`; this module wraps
 * them in `provide`/`inject` + a reactive `useTranslation()` composable.
 */

import { computed, inject, provide, unref, type InjectionKey, type App, type MaybeRef } from 'vue';
import { createT, deepMerge, en } from '@eigenpal/docx-editor-i18n';
import type { LocaleStrings, TFunction, Translations } from '@eigenpal/docx-editor-i18n';

type AnyRecord = Record<string, unknown>;

const LOCALE_KEY: InjectionKey<MaybeRef<AnyRecord>> = Symbol('docx-locale');
const LANG_KEY: InjectionKey<MaybeRef<string>> = Symbol('docx-lang');

function createTranslationContext(i18n?: MaybeRef<Translations | undefined>) {
  const strings = computed(() => deepMerge(en as AnyRecord, unref(i18n) as AnyRecord | undefined));
  const lang = computed(() => {
    const value = unref(i18n)?._lang;
    return typeof value === 'string' ? value : 'en';
  });
  return { strings, lang };
}

/**
 * Provide locale strings to descendant components. Call in a parent's
 * `setup()`:
 *
 *     provideLocale(myTranslations);
 */
export function provideLocale(i18n?: MaybeRef<Translations | undefined>) {
  const { strings, lang } = createTranslationContext(i18n);
  provide(LOCALE_KEY, strings);
  provide(LANG_KEY, lang);
}

export function createTranslator(i18n?: MaybeRef<Translations | undefined>): {
  t: TFunction;
} {
  const { strings, lang } = createTranslationContext(i18n);
  return {
    t: (key, vars) => createT(unref(strings) as LocaleStrings, unref(lang))(key, vars),
  };
}

/**
 * `useTranslation` composable — returns `t(key, vars?)`. Inject-based,
 * so a `provideLocale(...)` call must sit above it in the component tree.
 */
export function useTranslation(): { t: TFunction } {
  const strings = inject(LOCALE_KEY, en as AnyRecord);
  const lang = inject(LANG_KEY, 'en');
  return {
    t: (key, vars) => createT(unref(strings) as LocaleStrings, unref(lang))(key, vars),
  };
}

/**
 * Vue plugin for i18n. Install via `app.use(i18nPlugin, translations)`.
 */
export const i18nPlugin = {
  install(app: App, i18n?: Translations) {
    const lang = typeof i18n?._lang === 'string' ? i18n._lang : 'en';
    const merged = deepMerge(en as AnyRecord, i18n as AnyRecord | undefined);
    app.provide(LOCALE_KEY, merged);
    app.provide(LANG_KEY, lang);
  },
};

export { en as defaultLocale };
