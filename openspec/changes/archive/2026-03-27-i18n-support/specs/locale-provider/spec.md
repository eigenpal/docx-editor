## ADDED Requirements

### Requirement: DocxEditor accepts a locale prop

The `<DocxEditor>` component SHALL accept an optional `locale` prop of type `PartialLocaleStrings` (deeply partial version of `LocaleStrings`). When provided, the locale object SHALL be deep-merged with the default English locale, with user-provided values taking precedence. When omitted, the editor SHALL render all strings in English.

#### Scenario: No locale prop provided

- **WHEN** `<DocxEditor>` is rendered without a `locale` prop
- **THEN** all UI strings SHALL display in English using the default `en.json` values

#### Scenario: Partial locale override

- **WHEN** `<DocxEditor>` is rendered with `locale={{ toolbar: { bold: "Fett" } }}`
- **THEN** the bold button tooltip SHALL display "Fett"
- **AND** all other strings SHALL remain in English

#### Scenario: Full locale object provided

- **WHEN** `<DocxEditor>` is rendered with a complete locale object (e.g., imported from `i18n/pl.json`)
- **THEN** all UI strings SHALL display using the provided translations

#### Scenario: Locale prop changes at runtime

- **WHEN** the `locale` prop value changes (e.g., user switches language)
- **THEN** all UI strings SHALL update to reflect the new locale on the next render

### Requirement: LocaleProvider wraps editor internals

A `LocaleProvider` React Context provider SHALL wrap all editor UI components inside `<DocxEditor>`. The provider SHALL supply the merged locale object to all descendants via React Context.

#### Scenario: Provider makes locale available to nested components

- **WHEN** a component nested inside `<DocxEditor>` calls `useTranslation()`
- **THEN** it SHALL receive the merged locale (user overrides + English defaults)

#### Scenario: Deep merge preserves unoverridden keys

- **WHEN** a locale object overrides `toolbar.bold` but not `toolbar.italic`
- **THEN** `t('toolbar.bold')` SHALL return the overridden value
- **AND** `t('toolbar.italic')` SHALL return the English default

### Requirement: useTranslation hook provides t() function

A `useTranslation()` hook SHALL be exported from `src/i18n/LocaleContext.tsx`. It SHALL return an object with a `t` function that accepts a dot-notation key string and returns the corresponding translated string.

#### Scenario: Valid key lookup

- **WHEN** `t('toolbar.bold')` is called
- **THEN** it SHALL return the string value at `locale.toolbar.bold`

#### Scenario: Key with interpolation

- **WHEN** `t('findReplace.matchCount', { current: 3, total: 15 })` is called
- **AND** the locale string is `"{current} of {total} matches"`
- **THEN** it SHALL return `"3 of 15 matches"`

#### Scenario: Missing key fallback

- **WHEN** `t()` is called with a key that does not exist in the merged locale
- **THEN** it SHALL return the key string itself as a fallback (e.g., `"toolbar.unknownKey"`)

### Requirement: Type-safe translation keys

The `t()` function SHALL accept only valid dot-notation paths that correspond to keys in the `LocaleStrings` type. Invalid keys SHALL produce a TypeScript compile-time error.

#### Scenario: Valid key compiles

- **WHEN** a developer writes `t('toolbar.bold')`
- **THEN** TypeScript SHALL compile without errors

#### Scenario: Invalid key produces compile error

- **WHEN** a developer writes `t('toolbar.nonExistent')`
- **THEN** TypeScript SHALL produce a type error at compile time

### Requirement: No runtime dependencies added

The i18n system SHALL NOT introduce any new npm runtime dependencies. It SHALL use only React Context, plain JSON imports, and standard TypeScript utilities.

#### Scenario: Package dependencies unchanged

- **WHEN** the i18n system is implemented
- **THEN** `package.json` dependencies (not devDependencies) SHALL have no new entries related to i18n

### Requirement: All components use t() for user-facing strings

Every user-facing string in the editor UI SHALL be replaced with a `t()` call using the appropriate key. No hardcoded English strings SHALL remain in component render output (excluding internal developer-facing strings like console logs or error codes).

#### Scenario: Toolbar button tooltips are translated

- **WHEN** the editor renders with a non-English locale
- **THEN** all toolbar button tooltips (bold, italic, underline, etc.) SHALL display translated text

#### Scenario: Dialog titles are translated

- **WHEN** a dialog (Find & Replace, Insert Table, Insert Image, etc.) opens with a non-English locale
- **THEN** the dialog title SHALL display the translated text

#### Scenario: Placeholders and aria-labels are translated

- **WHEN** the editor renders with a non-English locale
- **THEN** all input placeholders and aria-labels SHALL display translated text

#### Scenario: Error messages are translated

- **WHEN** an error occurs (e.g., "Failed to Load Document") with a non-English locale
- **THEN** the error message SHALL display the translated text
