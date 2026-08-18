import { createContext, useContext, useMemo } from 'react';
import { createT, deepMerge, en } from '@docx-editor.dev/i18n';
import type { LocaleStrings, TFunction, Translations } from '@docx-editor.dev/i18n';
import type { DocxEditorChildren } from '../docx-editor-children';

const LocaleContext = createContext<LocaleStrings>(en);
const LangContext = createContext<string>('en');

export interface LocaleProviderProps {
  i18n?: Translations;
  children: DocxEditorChildren;
}

export function LocaleProvider({ i18n, children }: LocaleProviderProps) {
  // Merged onto the INHERITED catalogue, not onto bundled English: a provider nested in
  // another (a host wrapping its app, a subtree overriding a few strings) composes with
  // the one above instead of resetting it, and one with no `i18n` is a no-op rather than
  // a silent revert to English. At the top the inherited catalogue IS `en`.
  const inherited = useContext(LocaleContext);
  const inheritedLang = useContext(LangContext);
  const lang = typeof i18n?._lang === 'string' ? i18n._lang : inheritedLang;
  const merged = useMemo(
    () =>
      deepMerge(inherited as Record<string, unknown>, i18n as Record<string, unknown> | undefined),
    [inherited, i18n]
  );
  return (
    <LangContext.Provider value={lang}>
      <LocaleContext.Provider value={merged as LocaleStrings}>{children}</LocaleContext.Provider>
    </LangContext.Provider>
  );
}

export function useTranslation(): { t: TFunction } {
  const strings = useContext(LocaleContext);
  const lang = useContext(LangContext);
  const t = useMemo(() => createT(strings, lang), [strings, lang]);
  return { t };
}
