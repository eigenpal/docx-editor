# Add Russian (ru) Locale

## Problem

The editor UI ships ten locales (`en` + `de`, `fr`, `he`, `hi`, `id`, `pl`, `pt-BR`, `tr`, `zh-CN`) and no Russian — Russian-speaking users get an English UI.

Adding a locale means translating 718 strings. The current `i18n:validate` only checks key-set sync; it does not verify that a translation preserves `{placeholders}` or ICU plural structure. A translator dropping `{count}` makes the literal `{count}` render to users, and nothing in CI catches it. This defect class is most likely precisely when a large new locale lands.

## Scope

- Add `ru`: scaffold (`ru.json` + `src/ru.ts` + typed exports + `package.json#exports`), 100% translation of all 718 keys, `_lang: "ru"`, Russian CLDR plural forms (`one`/`few`/`many`/`other`).
- Harden `i18n:validate` with a placeholder/ICU integrity rule for all locales (pure module + `bun:test` unit tests); shipped locales stay green.
- Regenerate the API Extractor snapshot (`docs/api/docx-editor-i18n/ru.api.md` + updated `index.api.md`).
- Update consumer docs: package README locale table and docs-site i18n pages (also fixing stale entries — `fr`, `hi`, `id` are missing there).
- Changeset for `@docx-editor.dev/i18n` (patch).

## Out of scope

- UI layout adjustments for longer Russian strings (overflow findings get recorded; separate change if needed).
- Locale switcher / browser-locale auto-detection in demo apps or adapters.
- Translating the documentation site itself.
- Filling the pre-existing untranslated keys in other locales.
- RTL-related work.
