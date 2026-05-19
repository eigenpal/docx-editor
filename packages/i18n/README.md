<p align="center">
  <a href="https://www.docx-editor.dev/">
    <img src="https://raw.githubusercontent.com/eigenpal/docx-editor/main/assets/header.png" alt="DOCX Editor — .docx in, .docx out. Open source, agent ready, client-side." width="500" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@eigenpal/docx-editor-i18n"><img src="https://img.shields.io/npm/v/@eigenpal/docx-editor-i18n.svg?style=flat-square&color=3B5BDB" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@eigenpal/docx-editor-i18n"><img src="https://img.shields.io/npm/dm/@eigenpal/docx-editor-i18n.svg?style=flat-square&color=3B5BDB" alt="npm downloads" /></a>
  <a href="https://github.com/eigenpal/docx-editor/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg?style=flat-square&color=3B5BDB" alt="license" /></a>
  <a href="https://docx-editor.dev/editor"><img src="https://img.shields.io/badge/Live_Demo-3B5BDB?style=flat-square&logo=vercel&logoColor=white" alt="Demo" /></a>
  <a href="https://www.docx-editor.dev/docs"><img src="https://img.shields.io/badge/Docs-3B5BDB?style=flat-square&logo=readthedocs&logoColor=white" alt="Documentation" /></a>
</p>

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

## Packages

| Package                                                                                      | Description                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@eigenpal/docx-editor-react`](https://www.npmjs.com/package/@eigenpal/docx-editor-react)   | <img src="https://cdn.simpleicons.org/react/61DAFB" width="20" align="middle" /> &nbsp; React adapter. Toolbar, paged editor, plugins.     |
| [`@eigenpal/docx-editor-vue`](https://www.npmjs.com/package/@eigenpal/docx-editor-vue)       | <img src="https://cdn.simpleicons.org/vuedotjs/4FC08D" width="20" align="middle" /> &nbsp; Vue 3 adapter. Toolbar, paged editor, plugins.  |
| [`@eigenpal/docx-editor-core`](https://www.npmjs.com/package/@eigenpal/docx-editor-core)     | Framework-agnostic core: OOXML parser, serializer, layout engine, ProseMirror schema. Depend on this if you fork the React or Vue adapter. |
| [`@eigenpal/docx-editor-i18n`](https://www.npmjs.com/package/@eigenpal/docx-editor-i18n)     | Shared locale strings and types consumed by both adapters.                                                                                 |
| [`@eigenpal/docx-editor-agents`](https://www.npmjs.com/package/@eigenpal/docx-editor-agents) | Agent SDK and chat UI: framework-agnostic bridge, MCP server, AI SDK adapters, plus React UI.                                              |

> **Forking the adapter?** Keep your fork thin. Depend on `@eigenpal/docx-editor-core` directly so parser, serializer, and rendering fixes land in your build automatically, without backporting each upstream change by hand.

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

`en.json` is the source of truth. Add keys there, then run `bun run i18n:fix` from the repo root to sync community locales (new keys land as `null`). Full guide: [docs/i18n.md](https://github.com/eigenpal/docx-editor/blob/main/docs/i18n.md).

## Contributing

Contributions welcome. See [CONTRIBUTING.md](https://github.com/eigenpal/docx-editor/blob/main/CONTRIBUTING.md) for setup, tests, and the one-time CLA signature.

## Commercial Support

> [!TIP]
> Questions or custom features? Email **[docx-editor@eigenpal.com](mailto:docx-editor@eigenpal.com)**.
