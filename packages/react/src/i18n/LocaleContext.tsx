import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { createT, deepMerge, en } from '@eigenpal/docx-editor-i18n';
import type { LocaleStrings, TFunction, Translations } from '@eigenpal/docx-editor-i18n';

const LocaleContext = createContext<LocaleStrings>(en);
const LangContext = createContext<string>('en');

export interface LocaleProviderProps {
  i18n?: Translations;
  children: ReactNode;
}

export function LocaleProvider({ i18n, children }: LocaleProviderProps) {
  const lang = typeof i18n?._lang === 'string' ? i18n._lang : 'en';
  const merged = useMemo(
    () => deepMerge(en as Record<string, unknown>, i18n as Record<string, unknown> | undefined),
    [i18n]
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
