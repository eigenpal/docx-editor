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

Locale strings, types, and runtime helpers for the [docx-editor.dev](https://docx-editor.dev) editor chrome. Ten languages, with per-key fallback to English.

## Quick Start

```bash
npm install @docx-editor.dev/i18n
```

Hand the catalog to the editor:

```tsx
import { DocxEditor } from '@docx-editor.dev/react';
import { de } from '@docx-editor.dev/i18n';

<DocxEditor document={bytes} i18n={de} />;
```

For several editors, or for chrome parts you compose yourself, put it in context once with
`LocaleProvider` instead:

```tsx
import { DocxEditor, LocaleProvider } from '@docx-editor.dev/react';

<LocaleProvider i18n={de}>
  <DocxEditor.Toolbar />
  <DocxEditor document={bytes} />
</LocaleProvider>;
```

Chrome you write yourself reads the same catalog through `useTranslation()`.

Mix a community locale with custom overrides:

```ts
import { de } from '@docx-editor.dev/i18n';

const myLocale = {
  ...de,
  toolbar: { ...de.toolbar, bold: 'Fettdruck' },
};
```

Keys set to `null` in any locale fall back to English.

## Packages

| Package                                                                                    | Description                                                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [`@docx-editor.dev/react`](https://www.npmjs.com/package/@docx-editor.dev/react)           | React adapter. `<DocxEditor>`, provider primitives, hooks, and compound chrome.                   |
| [`@docx-editor.dev/core`](https://www.npmjs.com/package/@docx-editor.dev/core)             | Framework-agnostic engine: OOXML read/write, canonical document tree, layout, paint.              |
| [`@docx-editor.dev/i18n`](https://www.npmjs.com/package/@docx-editor.dev/i18n)             | Shared locale strings and types.                                                                  |
| [`@docx-editor.dev/pro`](https://www.npmjs.com/package/@docx-editor.dev/pro)               | Tracked changes, comments, and custom nodes.                                                      |
| [`@docx-editor.dev/editor-api`](https://www.npmjs.com/package/@docx-editor.dev/editor-api) | Office.js-compatible editing API: a batching object model, on a server or against an open editor. |

> **Forking the adapter?** Keep your fork thin. Depend on `@docx-editor.dev/core` directly so parser, serializer, and rendering fixes land in your build automatically, without backporting each upstream change by hand.

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

> Importing `locales` pulls every locale into your bundle. For a smaller bundle, import only the ones you need by name; `sideEffects: false` lets the rest tree-shake.

## Per-locale subpaths

For apps that pick the locale at runtime, the named exports above don't tree-shake — the bundler can't know which locale wins, so it ships them all. Use the per-locale subpaths instead. Each one bundles a single locale (~30KB) and code-splits cleanly:

```ts
// Static — bundler ships only this locale's strings
import pl from '@docx-editor.dev/i18n/pl';

// Dynamic — splits into its own chunk, loaded on demand
const pl = (await import('@docx-editor.dev/i18n/pl')).default;
```

Subpaths ship for every locale: `/en`, `/de`, `/fr`, `/he`, `/hi`, `/id`, `/pl`, `/pt-BR`, `/tr`, `/zh-CN`. Each also exports its locale as a named binding (`import { pl } from '@docx-editor.dev/i18n/pl'`) for callers that prefer non-default imports.

## Types

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

Contributions welcome. See [CONTRIBUTING.md](https://github.com/eigenpal/docx-editor/blob/main/CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Commercial Support

> [!TIP]
> Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
