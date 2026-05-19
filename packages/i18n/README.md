# @eigenpal/docx-editor-i18n

Shared locale strings, types, and runtime helpers for the [docx-editor](https://docx-editor.dev) adapters. One source of truth for translations consumed by `@eigenpal/docx-editor-react` and `@eigenpal/docx-editor-vue`.

## Quick Start

```bash
npm install @eigenpal/docx-editor-i18n
```

Pass a typed locale to the editor's `i18n` prop:

```tsx
// React
import { de } from '@eigenpal/docx-editor-i18n';
<DocxEditor documentBuffer={file} i18n={de} />

// Vue
import { de } from '@eigenpal/docx-editor-i18n';
<DocxEditor :document-buffer="file" :i18n="de" />
```

Mix a community locale with custom overrides:

```ts
import { de } from '@eigenpal/docx-editor-i18n';

const myLocale = {
  ...de,
  toolbar: { ...de.toolbar, bold: 'Fettdruck' },
};
```

Keys set to `null` in any locale fall back to English.

## Available locales

| Code    | Export | Language            |
| ------- | ------ | ------------------- |
| `en`    | `en`   | English (source)    |
| `de`    | `de`   | German              |
| `he`    | `he`   | Hebrew              |
| `pl`    | `pl`   | Polish              |
| `pt-BR` | `ptBR` | Portuguese (Brazil) |
| `tr`    | `tr`   | Turkish             |
| `zh-CN` | `zhCN` | Simplified Chinese  |

BCP-47 codes (`pt-BR`, `zh-CN`) use camelCase JS identifiers (`ptBR`, `zhCN`). For runtime lookup by tag:

```ts
import { locales } from '@eigenpal/docx-editor-i18n';
<DocxEditor i18n={locales[userPreferredLocale]} />
```

> Importing `locales` pulls every locale into your bundle. For a smaller bundle, import only the ones you need by name; `sideEffects: false` lets the rest tree-shake.

## Types

```ts
import type {
  LocaleStrings, // shape of `en`, the full source of truth
  PartialLocaleStrings, // shape of a community partial (null falls back)
  Translations, // alias for PartialLocaleStrings
  TranslationKey, // 'toolbar.bold' | 'dialogs.findReplace.title' | ...
  LocaleCode, // 'en' | 'de' | 'pt-BR' | ...
  TFunction, // signature of the `t()` callback
} from '@eigenpal/docx-editor-i18n';
```

## Non-React/Vue hosts

Build a typed `t()` outside the adapter packages:

```ts
import { createT, deepMerge, en, de, type LocaleStrings } from '@eigenpal/docx-editor-i18n';

const merged = deepMerge(en, de) as LocaleStrings;
const t = createT(merged, 'de');
t('toolbar.bold'); // 'Fett'
t('dialogs.findReplace.matchCount', { current: 3, total: 15 }); // ICU plurals
```

## Contributing

`en.json` is the source of truth. Add keys there, then run `bun run i18n:fix` from the repo root to sync community locales (new keys land as `null`). Full guide: [docs/i18n.md](https://github.com/eigenpal/docx-editor/blob/main/docs/i18n.md).
