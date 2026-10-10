## ADDED Requirements

### Requirement: Placeholder and ICU integrity validation

`bun run i18n:validate` SHALL verify every non-null translated leaf against its English source for placeholder and ICU structural integrity, for every locale. The check SHALL accept two valid forms: (A) an ICU plural block `{var, plural, …}` whose variable name matches the English plural variable (or, when English has no plural block, an English placeholder name), with a required `other` branch, branch labels limited to `=N` fixed matches, the locale's CLDR plural categories, or labels used by the English message, and all English `=N` branches preserved; or (B) plain interpolation `{var}`. In both forms the placeholder-name set (simple `{name}` tokens plus the plural variable name) SHALL equal the English set exactly. A `null` translation SHALL be skipped by this rule (covered by key-sync validation).

#### Scenario: Missing placeholder fails

- **WHEN** a translation drops a `{name}` present in the English string
- **THEN** `i18n:validate` SHALL report a `placeholder_mismatch` violation and exit non-zero

#### Scenario: Extra placeholder fails

- **WHEN** a translation introduces a `{name}` not present in the English string
- **THEN** `i18n:validate` SHALL report a `placeholder_mismatch` violation and exit non-zero

#### Scenario: Renamed plural variable fails

- **WHEN** a translation's plural block renames the variable (for example `{total, plural, …}` for English `{count, plural, …}`)
- **THEN** `i18n:validate` SHALL report a `plural_var_mismatch` violation and exit non-zero

#### Scenario: Invalid plural branch label fails

- **WHEN** a plural branch label is neither `=N` nor a CLDR plural category of the locale (for example `man {…}`)
- **THEN** `i18n:validate` SHALL report an `invalid_branch_label` violation and exit non-zero

#### Scenario: Missing other branch fails

- **WHEN** a plural block omits the `other` branch
- **THEN** `i18n:validate` SHALL report a `missing_other` violation and exit non-zero

#### Scenario: English branch labels outside the locale's CLDR set pass

- **WHEN** a translation keeps an English branch label that is not a category of its locale (for example `zh-CN` keeping the `one` branch)
- **THEN** `i18n:validate` SHALL pass this leaf (the runtime falls back to `other` for that locale)

#### Scenario: Dropped exact-match branch fails

- **WHEN** the English string contains a fixed `=N` branch and the translation's plural block drops it
- **THEN** `i18n:validate` SHALL report a `missing_exact_branch` violation and exit non-zero

#### Scenario: Plain interpolation of an English plural passes

- **WHEN** the English string is an ICU plural and the translation uses plain interpolation with the same placeholder name (for example Indonesian `{count} item lainnya`)
- **THEN** `i18n:validate` SHALL pass this leaf

#### Scenario: Russian plural with extended categories passes

- **WHEN** a Russian translation of an English `{count, plural, one {…} other {…}}` string adds `few` and `many` branches
- **THEN** `i18n:validate` SHALL pass this leaf

#### Scenario: Plural added for a simple English placeholder passes

- **WHEN** English uses plain `{count}` and the translation uses `{count, plural, one {…} few {…} many {…} other {…}}`
- **THEN** `i18n:validate` SHALL pass this leaf (the plural variable name matches the English placeholder name)

### Requirement: Malformed braces fail validation

`i18n:validate` SHALL reject a translation that contains a `{` or `}` residual after recognized placeholders and plural blocks are stripped, including a `{name}` nested inside a plural branch (a construct the runtime formatter cannot render).

#### Scenario: Unclosed brace fails

- **WHEN** a translation contains a malformed token (for example `{count` without a closing brace)
- **THEN** `i18n:validate` SHALL report a `malformed_braces` violation and exit non-zero

#### Scenario: Nested placeholder inside a plural branch fails

- **WHEN** a plural branch contains a nested interpolation (for example `one {Delete {name}}`)
- **THEN** `i18n:validate` SHALL report a `malformed_braces` violation and exit non-zero

### Requirement: `_lang` matches the locale file

When a locale file declares `_lang`, `i18n:validate` SHALL require it to equal the filename stem (`ru.json` → `"ru"`).

#### Scenario: Mismatched language tag fails

- **WHEN** `ru.json` declares `_lang: "uk"`
- **THEN** `i18n:validate` SHALL report a `lang_mismatch` violation and exit non-zero

### Requirement: Shipped locales pass the integrity rule

All locale files shipped in `packages/i18n` SHALL produce zero integrity violations against `en.json`, guaranteed by a regression test over the real files.

#### Scenario: Integrity rule stays green on shipped data

- **WHEN** the integrity regression test runs against every shipped locale JSON
- **THEN** zero violations SHALL be reported

#### Scenario: `i18n:fix` reports unfixable violations

- **WHEN** `bun run i18n:fix` encounters an integrity violation
- **THEN** it SHALL repair key sync as before, report the violation as a manual fix, and exit non-zero
