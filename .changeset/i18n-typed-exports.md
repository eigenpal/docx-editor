---
'@eigenpal/docx-editor-react': major
---

`@eigenpal/docx-editor-i18n` ships its public surface as named exports from the package root. One import path, IDE-discoverable, tree-shakeable.

```ts
import {
  // Locale data — typed
  en,
  de,
  pl,
  tr,
  he,
  ptBR,
  zhCN,
  // Runtime lookup by BCP-47 tag
  locales,
  // Types
  type LocaleStrings,
  type Translations,
  type TranslationKey,
  type LocaleCode,
} from '@eigenpal/docx-editor-i18n';
```

`en` is typed as `LocaleStrings` (source of truth, 100% coverage). Every other locale is `PartialLocaleStrings` (null leaves fall back to English). Hyphenated locale codes use camelCase identifiers (`ptBR`, `zhCN`); the `locales` record keeps BCP-47 keys (`'pt-BR'`, `'zh-CN'`) for runtime lookup.

The package is marked `sideEffects: false`, so importing one locale from the root tree-shakes the rest. Verified with esbuild: a consumer importing only `en` ships ~26KB.

Breaking from earlier (unpublished) shape: the `./<locale>.json` subpath exports are gone. Everything goes through the root. The `LocaleStrings`, `Translations`, `PartialLocaleStrings`, and `TranslationKey` types are no longer re-exported from `-react` or `-vue`. Runtime exports from the adapters (`LocaleProvider`, `useTranslation`, `provideLocale`, `i18nPlugin`, `createTranslator`, `defaultLocale`) are unchanged.
