import { createContext, useContext, useMemo } from 'react';
import { catalogDirection, createT, deepMerge, en } from '@docx-editor.dev/i18n';
import type { LocaleStrings, TFunction, Translations } from '@docx-editor.dev/i18n';
import type { DocxEditorChildren } from '../docx-editor-children';

const LocaleContext = createContext<LocaleStrings>(en);
const LangContext = createContext<string>('en');
const DirContext = createContext<'ltr' | 'rtl'>('ltr');
/** The direction a provider DECIDED for the chrome; `undefined` keeps the host page's. */
const ChromeDirContext = createContext<'ltr' | 'rtl' | undefined>(undefined);

/**
 * The chrome direction a provider decides: its `dir` prop, the catalog's `_dir`, or a
 * right-to-left `_lang`. A left-to-right `_lang` alone decides nothing, so the shipped
 * left-to-right catalogs keep the host page direction, as before.
 */
function decidedChromeDir(
  dir: 'ltr' | 'rtl' | undefined,
  i18n: Translations | undefined,
  inherited: 'ltr' | 'rtl' | undefined
): 'ltr' | 'rtl' | undefined {
  if (dir) return dir;
  const declared = i18n?._dir;
  if (declared === 'ltr') return 'ltr';
  if (declared === 'rtl') return 'rtl';
  return catalogDirection(i18n) === 'rtl' ? 'rtl' : inherited;
}

export interface LocaleProviderProps {
  i18n?: Translations;
  /**
   * The writing direction of the editor chrome. Defaults to the catalog's `_dir`, then to
   * its `_lang`, then to the direction of an outer provider. With `'rtl'`, the toolbar, menu
   * bar, dialogs, context menu, and panes mirror without a wrapper element.
   */
  dir?: 'ltr' | 'rtl';
  children: DocxEditorChildren;
}

export function LocaleProvider({ i18n, dir, children }: LocaleProviderProps) {
  // Merged onto the INHERITED catalogue, not onto bundled English: a provider nested in
  // another (a host wrapping its app, a subtree overriding a few strings) composes with
  // the one above instead of resetting it, and one with no `i18n` is a no-op rather than
  // a silent revert to English. At the top the inherited catalogue IS `en`.
  const inherited = useContext(LocaleContext);
  const inheritedLang = useContext(LangContext);
  const inheritedDir = useContext(DirContext);
  const inheritedChromeDir = useContext(ChromeDirContext);
  const lang = typeof i18n?._lang === 'string' ? i18n._lang : inheritedLang;
  const direction = dir ?? catalogDirection(i18n) ?? inheritedDir;
  const chromeDir = decidedChromeDir(dir, i18n, inheritedChromeDir);
  const merged = useMemo(
    () =>
      deepMerge(inherited as Record<string, unknown>, i18n as Record<string, unknown> | undefined),
    [inherited, i18n]
  );
  return (
    <LangContext.Provider value={lang}>
      <DirContext.Provider value={direction}>
        <ChromeDirContext.Provider value={chromeDir}>
          <LocaleContext.Provider value={merged as LocaleStrings}>
            {children}
          </LocaleContext.Provider>
        </ChromeDirContext.Provider>
      </DirContext.Provider>
    </LangContext.Provider>
  );
}

/**
 * The active catalogue's `t()`, the catalogue itself, its language tag (`_lang`, `en` by
 * default), which formats numbers the way the strings around them read, and the chrome's
 * writing direction (`dir`).
 */
export function useTranslation(): {
  t: TFunction;
  catalogue: LocaleStrings;
  lang: string;
  dir: 'ltr' | 'rtl';
} {
  const strings = useContext(LocaleContext);
  const lang = useContext(LangContext);
  const dir = useContext(DirContext);
  const t = useMemo(() => createT(strings, lang), [strings, lang]);
  return { t, catalogue: strings, lang, dir };
}

/**
 * The `dir` attribute a chrome part sets on its root: the direction a provider decided
 * (its `dir` prop, the catalog's `_dir`, or a right-to-left `_lang`), otherwise nothing, so
 * the part keeps the host page direction.
 * @internal
 */
export function useChromeDir(): 'ltr' | 'rtl' | undefined {
  return useContext(ChromeDirContext);
}
