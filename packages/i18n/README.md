# @eigenpal/docx-editor-i18n

Shared UI locale strings, types, and runtime helpers for the docx-editor
adapters. `@eigenpal/docx-editor-react` and `@eigenpal/docx-editor-vue` both
re-export `LocaleProvider` / `useTranslation` etc. — but the locale data and
the type contract live here, so there's one source of truth.

## Usage

Pass a typed locale straight to the editor's `i18n` prop:

```tsx
// React
import { de } from '@eigenpal/docx-editor-i18n';
<DocxEditor documentBuffer={file} i18n={de} />

// Vue (template)
import { de } from '@eigenpal/docx-editor-i18n';
<DocxEditor :document-buffer="file" :i18n="de" />
```

Want to mix a community locale with custom overrides? Spread it:

```ts
import { de } from '@eigenpal/docx-editor-i18n';

const myLocale = {
  ...de,
  toolbar: { ...de.toolbar, bold: 'Fettdruck' },
};
```

Keys that are `null` in any locale fall back to English. The English defaults
are also re-exported as `defaultLocale` from each adapter package.

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

Hyphenated BCP-47 codes (`pt-BR`, `zh-CN`) use camelCase JS identifiers
(`ptBR`, `zhCN`). For runtime lookup by tag, use `locales`:

```ts
import { locales } from '@eigenpal/docx-editor-i18n';
<DocxEditor i18n={locales[userPreferredLocale]} />
```

> `locales` references every locale, so importing it pulls all of them into
> your bundle. For a smaller bundle, import the locales you need by name
> (`import { en, de } from '...'`) — `sideEffects: false` lets the unused
> ones tree-shake.

## Types

```ts
import type {
  LocaleStrings, // shape of `en` — the full source of truth
  PartialLocaleStrings, // shape of a community partial (null = fall back)
  Translations, // alias for PartialLocaleStrings
  TranslationKey, // 'toolbar.bold' | 'dialogs.findReplace.title' | ...
  LocaleCode, // 'en' | 'de' | 'pt-BR' | ...
  TFunction, // signature of the `t()` callback
} from '@eigenpal/docx-editor-i18n';
```

## Non-React/Vue hosts

Use `deepMerge` + `createT` to build a typed `t()` outside the adapter
packages:

```ts
import { createT, deepMerge, en, de, type LocaleStrings } from '@eigenpal/docx-editor-i18n';

const merged = deepMerge(en, de) as LocaleStrings;
const t = createT(merged, 'de');
t('toolbar.bold'); // → 'Fett'
t('dialogs.findReplace.matchCount', { current: 3, total: 15 }); // ICU plurals
```

## Editing

`en.json` is the source of truth — add keys there, then run `bun run i18n:fix`
from the repo root to sync the community locale files (new keys land as `null`).
See `docs/i18n.md`.
