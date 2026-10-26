// The demo's interface language: the `?lang=` URL parameter, shared by the React and Vue
// examples. The settings panel switches it; a right-to-left catalog mirrors the interface.
import {
  catalogDirection,
  locales,
  type LocaleCode,
  type Translations,
} from '@docx-editor.dev/i18n';

/** Catalogs offered by the demo, named in their own language. */
export const DEMO_LANGUAGES: ReadonlyArray<{ readonly code: LocaleCode; readonly name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'ar', name: 'العربية' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'he', name: 'עברית' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ja', name: '日本語' },
  { code: 'pl', name: 'Polski' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'zh-CN', name: '简体中文' },
];

/** The language the URL asks for, or English for a missing or unknown code. */
export function demoLanguage(): LocaleCode {
  const code = new URLSearchParams(globalThis.location?.search ?? '').get('lang') ?? '';
  return Object.hasOwn(locales, code) ? (code as LocaleCode) : 'en';
}

/** The catalog to pass to `LocaleProvider`: none for English, so the defaults stay as they are. */
export function demoCatalog(code: LocaleCode = demoLanguage()): Translations | undefined {
  return code === 'en' ? undefined : locales[code];
}

/** The interface direction for `code`, for the demo's own wrapper and new documents. */
export function demoDirection(code: LocaleCode = demoLanguage()): 'ltr' | 'rtl' {
  return catalogDirection(demoCatalog(code)) ?? 'ltr';
}

/** Open the demo again in `code`. The editor reads the catalog when it mounts. */
export function switchDemoLanguage(code: LocaleCode): void {
  const url = new URL(globalThis.location.href);
  if (code === 'en') url.searchParams.delete('lang');
  else url.searchParams.set('lang', code);
  globalThis.location.assign(url.toString());
}
