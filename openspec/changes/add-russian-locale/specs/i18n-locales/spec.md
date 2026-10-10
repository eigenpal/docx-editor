## ADDED Requirements

### Requirement: Russian locale ships complete

The system SHALL ship a Russian (`ru`) locale in `@docx-editor.dev/i18n` with 100% translation coverage of all keys in `en.json` (no `null` values), exposed as a typed `ru` named export, a `./ru` package subpath, a member of the `LocaleCode` union, and an entry in the `locales` record. The locale file SHALL declare `_lang: "ru"`.

#### Scenario: Named export provides full Russian strings

- **WHEN** a consumer imports `{ ru } from '@docx-editor.dev/i18n'`
- **THEN** `ru` SHALL contain a Russian translation for every leaf key in `en.json`
- **AND** no leaf SHALL be `null`

#### Scenario: Per-locale subpath code-splits

- **WHEN** a consumer imports `ru from '@docx-editor.dev/i18n/ru'`
- **THEN** the default export SHALL be the Russian locale data
- **AND** the built per-locale bundle SHALL stay under the `check:i18n-bundle-size` limit

#### Scenario: Editor renders Russian UI

- **WHEN** `<DocxEditor i18n={ru} />` renders in any adapter
- **THEN** toolbar, dialogs, context menus, and sidebar labels SHALL display Russian strings
- **AND** untranslated-fallback SHALL never occur (coverage is complete)

#### Scenario: Coverage tooling reports completeness

- **WHEN** `bun run i18n:status` runs
- **THEN** `ru` SHALL report 718/718 keys translated (100%)

### Requirement: Russian plural forms follow CLDR categories

The `ru` locale SHALL translate every ICU plural key from `en.json` using the Russian CLDR plural categories `one`, `few`, `many`, and `other`, keeping the English placeholder variable name and the required `other` fallback.

#### Scenario: Plural selection matches Russian rules

- **WHEN** a plural string from `ru` is rendered with `count` values 1, 2, 5, 21, 22, 25
- **THEN** the selected branch SHALL follow `Intl.PluralRules('ru')` (`one` for 1/21, `few` for 2/22, `many` for 5/25)
- **AND** every rendered form SHALL be grammatical Russian

### Requirement: Consumer documentation lists the Russian locale

The package README and the docs site i18n pages SHALL list `ru` with its named export (`ru`), subpath (`/ru`), and language name alongside the existing locales.

#### Scenario: Locale tables include Russian

- **WHEN** a consumer reads `packages/i18n/README.md` or `docs/site/content/i18n/index.mdx`
- **THEN** `ru` SHALL appear in the available-locales table and subpath list
- **AND** the stated language count SHALL match the shipped locale files
