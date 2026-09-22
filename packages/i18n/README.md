<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/.github/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@docx-editor.dev/i18n"><img src="https://img.shields.io/npm/v/@docx-editor.dev/i18n.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@docx-editor.dev/i18n"><img src="https://img.shields.io/npm/dm/@docx-editor.dev/i18n.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

# @docx-editor.dev/i18n

Translate [docx-editor.dev](https://docx-editor.dev) controls with locale strings, types, and runtime helpers. The package provides ten languages and falls back to English for missing translations.

## Quick start

Install the locale package:

```bash
npm install @docx-editor.dev/i18n
```

Pass a locale to the editor. This example requires the React adapter and its engine peer:

```tsx
import { DocxEditor } from '@docx-editor.dev/react';
import { de } from '@docx-editor.dev/i18n';

<DocxEditor document={bytes} i18n={de} />;
```

To share a locale across editors and custom controls, use `LocaleProvider`:

```tsx
import { DocxEditor, LocaleProvider } from '@docx-editor.dev/react';
import { de } from '@docx-editor.dev/i18n';

<LocaleProvider i18n={de}>
  <DocxEditor document={bytes} />
</LocaleProvider>;
```

Chrome you write yourself reads the same catalog through `useTranslation()`.

Mix a community locale with custom overrides:

```ts
import { de } from '@docx-editor.dev/i18n';

const myLocale = {
  ...de,
  formattingBar: { ...de.formattingBar, bold: 'Fettdruck' },
};
```

Keys set to `null` in any locale fall back to English.

## Available locales

| Code    | Export | Language            |
| ------- | ------ | ------------------- |
| `en`    | `en`   | English (source)    |
| `de`    | `de`   | German              |
| `fr`    | `fr`   | French              |
| `he`    | `he`   | Hebrew              |
| `hi`    | `hi`   | Hindi               |
| `id`    | `id`   | Indonesian          |
| `pl`    | `pl`   | Polish              |
| `pt-BR` | `ptBR` | Portuguese (Brazil) |
| `tr`    | `tr`   | Turkish             |
| `zh-CN` | `zhCN` | Simplified Chinese  |

BCP-47 codes (`pt-BR`, `zh-CN`) use camelCase JS identifiers (`ptBR`, `zhCN`). For runtime lookup by tag:

```tsx
import { locales } from '@docx-editor.dev/i18n';

<LocaleProvider i18n={locales[userPreferredLocale]}>
  <DocxEditor document={bytes} />
</LocaleProvider>;
```

Importing `locales` includes every locale in your bundle. Import individual locales to reduce the bundle size.

## Per-locale subpaths

If you choose a locale at runtime, import its subpath to load only that locale. Static imports include it in the bundle. Dynamic imports let the bundler create a separate chunk:

```ts
// Static import: include only this locale's strings.
import pl from '@docx-editor.dev/i18n/pl';
```

For on-demand loading, use a dynamic import instead:

```ts
const pl = (await import('@docx-editor.dev/i18n/pl')).default;
```

Subpaths ship for every locale: `/en`, `/de`, `/fr`, `/he`, `/hi`, `/id`, `/pl`, `/pt-BR`, `/tr`, `/zh-CN`. Each also exports its locale as a named binding (`import { pl } from '@docx-editor.dev/i18n/pl'`) for callers that prefer non-default imports.

## Types

Import types to describe locale data and translation functions:

```ts
import type {
  LocaleStrings, // shape of `en`, the full source of truth
  PartialLocaleStrings, // shape of a community partial (null falls back)
  Translations, // alias for PartialLocaleStrings
  TranslationKey, // 'formattingBar.bold' | 'navigation.find.counter' | ...
  LocaleCode, // 'en' | 'de' | 'pt-BR' | ...
  TFunction, // signature of the `t()` callback
} from '@docx-editor.dev/i18n';
```

## Outside the React adapter

Build a typed `t()` outside the adapter packages:

```ts
import { createT, deepMerge, en, de, type LocaleStrings } from '@docx-editor.dev/i18n';

const merged = deepMerge(en, de) as LocaleStrings;
const t = createT(merged, 'de');
t('formattingBar.bold'); // 'Fett'
t('navigation.find.total', { total: 15 }); // ICU plurals
```

`en.json` is the source of truth. Add keys there, then run `bun run i18n:fix` from the repo root to sync community locales (new keys land as `null`). Full guide: [docs/i18n.md](https://github.com/eigenpal/docx-editor/blob/main/docs/i18n.md).

## Contributing

To contribute, see [CONTRIBUTING.md](https://github.com/eigenpal/docx-editor/blob/main/CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Commercial support

For commercial support or custom features, [email the support team](mailto:docx-editor@eigenpal.com).
