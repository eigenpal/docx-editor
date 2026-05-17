# @eigenpal/docx-editor-i18n

Shared UI locale strings for the docx-editor adapters. `@eigenpal/docx-editor-react`
and `@eigenpal/docx-editor-vue` both read their default English copy from `en.json`
here, so there's a single source of truth — no per-adapter copies to keep in sync.

## Usage

Pass a locale object straight to the editor's `i18n` prop:

```ts
// React
import de from '@eigenpal/docx-editor-i18n/de.json';
<DocxEditor documentBuffer={file} i18n={de} />

// Vue
import de from '@eigenpal/docx-editor-i18n/de.json';
<DocxEditor :document-buffer="file" :i18n="de" />
```

Keys that are `null` in a locale file fall back to English. The English defaults
are also re-exported as `defaultLocale` from each adapter package.

## Available locales

`en` (source), `de`, `he`, `pl`, `pt-BR`, `tr`, `zh-CN`.

## Editing

`en.json` is the source of truth — add keys there, then run `bun run i18n:fix`
from the repo root to sync the community locale files (new keys land as `null`).
See `docs/i18n.md`.
