// Vue mirror of packages/react/src/i18n/LocaleContext.tsx — exposes
// the same hook surface (`useTranslation`) and provider helper
// (`provideLocale`) that the React side does. The runtime lives in
// `./index.ts`; this file re-exports under the React-style filename
// so consumer plugins can import portably. Locale string types live
// in `@eigenpal/docx-editor-i18n`; import them from there.
export {
  provideLocale,
  createTranslator,
  useTranslation,
  i18nPlugin,
  defaultLocale,
} from './index';
