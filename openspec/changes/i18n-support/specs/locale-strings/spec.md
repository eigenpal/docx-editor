## ADDED Requirements

### Requirement: Default English locale file

A default English locale file SHALL exist at `i18n/en.json` in the package. It SHALL contain all user-facing strings organized by feature area as a two-level nested JSON object. This file SHALL serve as the source of truth for all translatable strings.

#### Scenario: en.json contains all UI strings

- **WHEN** `i18n/en.json` is loaded
- **THEN** it SHALL contain entries for every user-facing string in the editor, organized by feature area (e.g., `toolbar`, `findReplace`, `dialogs`, `comments`, `contextMenu`, `common`, `errors`)

#### Scenario: en.json structure matches LocaleStrings type

- **WHEN** `i18n/en.json` is validated against the `LocaleStrings` TypeScript interface
- **THEN** it SHALL satisfy the type completely with no missing keys

### Requirement: Multi-level feature-area string organization

Strings in locale files SHALL be organized into a multi-level nested hierarchy. Top-level keys group by feature area, with sub-keys for sections within that area. Nesting depth SHALL follow the natural structure of the UI (e.g., dialogs with buttons, labels, and options get sub-objects). The following top-level keys SHALL exist at minimum:

- `toolbar` — formatting buttons, undo/redo, tooltips
- `dialogs` — per-dialog sub-objects (e.g., `dialogs.findReplace`, `dialogs.hyperlink`, `dialogs.insertTable`), each with their own `title`, `buttons`, `labels`, `placeholders`, etc.
- `comments` — comment card, sidebar, resolve/reopen actions
- `contextMenu` — right-click menu items, AI actions
- `common` — shared strings used across multiple components (Cancel, Insert, Close, OK, etc.)
- `errors` — error messages and loading states
- `documentOutline` — outline panel

#### Scenario: String lookup by feature area

- **WHEN** a developer needs the "Bold" tooltip string
- **THEN** it SHALL be found at `toolbar.bold`

#### Scenario: Multi-level dialog strings

- **WHEN** a developer needs the Find & Replace dialog title
- **THEN** it SHALL be found at `dialogs.findReplace.title`
- **AND** the Replace button SHALL be at `dialogs.findReplace.buttons.replace`

#### Scenario: Shared strings in common section

- **WHEN** multiple dialogs need a "Cancel" button label
- **THEN** they SHALL all use `t('common.cancel')` from the `common` section

### Requirement: Auto-derived LocaleStrings TypeScript type

A `LocaleStrings` type SHALL be exported from `src/i18n/types.ts`. It SHALL be automatically derived from the `en.json` import using `typeof` — NOT manually maintained. A `PartialLocaleStrings` type (using `DeepPartial<LocaleStrings>`) SHALL also be exported. A `TranslationKey` type SHALL be auto-derived as a union of all valid dot-notation paths through the locale object.

#### Scenario: Type auto-updates when en.json changes

- **WHEN** a developer adds a new key to `en.json`
- **THEN** `LocaleStrings`, `TranslationKey`, and autocomplete SHALL automatically reflect the new key without editing any type file

#### Scenario: Type provides multi-level autocomplete

- **WHEN** a developer types `locale.dialogs.findReplace.` in their IDE
- **THEN** autocomplete SHALL suggest all sub-keys (title, buttons, placeholders, etc.)

#### Scenario: DeepPartial allows partial overrides at any depth

- **WHEN** a developer passes `{ dialogs: { findReplace: { title: "Suchen" } } }` as `PartialLocaleStrings`
- **THEN** TypeScript SHALL accept it without requiring all other keys

### Requirement: Community locale contribution pattern

Locale files SHALL be stored in the `i18n/` directory at the package root. Each locale SHALL be a single JSON file named with a standard BCP 47 language tag (e.g., `en.json`, `pl.json`, `de.json`, `fr.json`, `ja.json`). Community-contributed locale files SHALL be importable as:

```typescript
import pl from '@eigenpal/docx-js-editor/i18n/pl.json';
```

#### Scenario: Adding a new locale

- **WHEN** a community contributor wants to add German translations
- **THEN** they SHALL create `i18n/de.json` with the same structure as `en.json`
- **AND** the file SHALL be usable immediately via `import de from '@eigenpal/docx-js-editor/i18n/de.json'`

#### Scenario: Partial locale file is valid

- **WHEN** a community contributor creates a locale file with only some strings translated
- **THEN** untranslated strings SHALL fall back to English at runtime via the deep merge in `LocaleProvider`

### Requirement: Package exports include locale files

The package `package.json` SHALL include exports entries for locale JSON files so they can be imported by consumers using the `@eigenpal/docx-js-editor/i18n/{lang}` path.

#### Scenario: Consumer imports a locale

- **WHEN** a consumer writes `import pl from '@eigenpal/docx-js-editor/i18n/pl.json'`
- **THEN** the import SHALL resolve correctly in both ESM and CommonJS environments

#### Scenario: Only imported locales are bundled

- **WHEN** a consumer imports only the Polish locale
- **THEN** the consumer's bundle SHALL NOT include any other locale files (e.g., German, French)

### Requirement: Simple interpolation in strings

Locale strings MAY contain `{variable}` placeholders. The `t()` function SHALL replace these with values from an optional second argument object.

#### Scenario: String with single variable

- **WHEN** locale contains `"errors.loadFailed": "Failed to load {filename}"`
- **AND** `t('errors.loadFailed', { filename: 'report.docx' })` is called
- **THEN** it SHALL return `"Failed to load report.docx"`

#### Scenario: String with no variables

- **WHEN** locale contains `"toolbar.bold": "Bold"`
- **AND** `t('toolbar.bold')` is called without a second argument
- **THEN** it SHALL return `"Bold"` unchanged

### Requirement: Community-contributed locales

Locale files beyond `en.json` SHALL be contributed by the community. The `en.json` file SHALL serve as the template for new translations. No AI-generated locale files SHALL be shipped — only human-verified translations.
