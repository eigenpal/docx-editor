# Design: Add Russian (ru) Locale

## Context

`packages/i18n` ships one JSON per locale; `en.json` is the source of truth (718 leaf keys across 38 sections: `dialogs` alone holds 310, `dialogs.keyboardShortcuts` 93). Locales are community-maintained partials: `null` falls back to English, missing keys fail CI. Tooling is `scripts/validate-i18n.mjs` (`validate` / `fix` / `new` / `status` / `codegen`) driven from the repo root; `i18n:new <code>` scaffolds the JSON, the `src/<code>.ts` subpath source, the generated block in `src/index.ts`, and the `package.json#exports` entry.

A scan of the shipped locales against `en.json` shows the key-sync discipline holds, but placeholder/plural structure is unvalidated:

| Locale  | translated | placeholder mismatches | plural-structure issues |
| ------- | ---------- | ---------------------- | ----------------------- |
| de      | 698        | 0                      | 0                       |
| fr, he, hi, pt-BR, tr, zh-CN | 690 | 0             | 0                       |
| id      | 694        | 1 (see below)          | 1 (same key)            |
| pl      | 690        | 0                      | 4 (extra `few`/`many` — correct Polish CLDR) |

`id.formattingBar.moreItems` translates the English ICU plural (`{count, plural, one {# more item} other {# more items}}`) as plain interpolation `{count} item lainnya`. This is legitimate: Indonesian's only CLDR plural category is `other`, so the plural block is dead syntax for that language. Runtime `formatMessage` handles the simple form correctly. The integrity rule must accept this shape.

## Goals / Non-Goals

**Goals:**

- Ship `ru` at 100% coverage (no `null`s) with MS Word RU terminology, so the editor reads naturally to Russian Word users.
- Close the unvalidated-placeholder gap for every locale before 718 new translated strings land.
- Keep shipped locales green: the new rule must not false-positive on existing data.
- Leave the repo's release/documentation invariants satisfied (API snapshot, changeset, docs tables).

**Non-Goals:**

- Editor layout/typography adjustments for longer Russian strings.
- Demo-app locale switching or adapter-side locale auto-detection.
- Translating the docs site content.
- Changing locale runtime semantics (`deepMerge`, `createT`, plural selection) — unchanged.
- Requiring full CLDR category coverage in the validator (see Decision 3).

## Decisions

### 1. Harden the validator first, translate under its protection

**Decision**: Implement and land the integrity rule (with tests proving it green on current `main`) before translating `ru`.

**Rationale**: The rule is the safety net for the translation phase. Landing it first means every translation batch is checked from the first keystroke, and the final PR contains no unverified strings. It also keeps the rule and the data in separate reviewable steps (rule first, data after).

**Alternative considered**: Translate first, harden afterwards — batches would pass an unchecked `validate` and any placeholder corruption would be found late, if at all.

### 2. One uniform rule for all locales, two accepted plural forms

**Decision**: The rule is not Russian-specific and has no per-locale exemptions. A translation of a placeholder-bearing English string is valid in either form:

- **Form A — ICU plural preserved**: `{count, plural, …}` with the same variable name as English; required `other` branch; branch labels restricted to `=N` or the locale's CLDR categories (`Intl.PluralRules(locale).resolvedOptions().pluralCategories`); every `=N` exact branch in English must survive.
- **Form B — plain interpolation**: `{count}` with the same placeholder-name set.

**Rationale**: Form B is required by real data (`id`), and it is not a defect — the runtime falls back per-message, and some languages legitimately have no plural distinction. Uniformity keeps the check honest: `ru` gets exactly the same treatment as a community locale.

**Alternative considered**: Strict ICU-only enforcement plus a rewritten `id` translation — churn in an unrelated locale to satisfy a new rule, and a false claim that Indonesian needs plural syntax.

### 3. Rule mechanics

**Decision**: Extract the logic into a pure module `packages/i18n/i18n-integrity.mjs` (next to `locale-files.mjs` — the existing cross-boundary tooling module) consumed by `scripts/validate-i18n.mjs` in both `validate` and `fix` modes; unit-test it in `packages/i18n/i18n-integrity.test.mjs`. The test lives under `packages/` because `bunfig.toml` scopes the repo-wide `bun test` root to `./packages` — tests under `scripts/` would silently never run in CI.

Checks, per leaf where an English string exists and the translation is a non-null string:

1. **Placeholder-name set equality** — names from simple `{name}` tokens plus the plural block's variable name must match English exactly. Missing → blank/broken interpolation; extra → literal `{name}` shown.
2. **Plural structure (when the translation uses a plural block)** — the variable name matches the English plural variable (when English has no plural block, it must match an English simple placeholder name instead); `other` present; labels ∈ {`=N` fixed matches} ∪ CLDR categories for the locale ∪ labels used by the English message; English `=N` branches preserved. The English-label allowance is empirical: shipped `zh-CN`/`id` keep English's `one` branch although their CLDR category set is `['other']` (globally, a dead branch — the runtime falls back to `other`); the strict variant would force edits in unrelated locales. Exact branches are only required of translations that use a plural block — Form B cannot express `=N`, mirroring the accepted fallback for missing categories.
3. **Malformed braces** — after stripping recognized placeholders/plural blocks, any residual `{` or `}` is an error: catches typos like an unclosed brace, and `{name}` nested inside a plural branch, which the runtime formatter cannot render (verified against `formatMessage`: the nested construct leaks raw ICU to the UI). Verified: no shipped English string contains literal braces, so the check is safe.
4. **`_lang` consistency** — when present, `_lang` must equal the file stem (`ru.json` → `"ru"`). All shipped locales already comply.
5. `null` translations are skipped (English fallback); they are covered by the existing key-sync rule.

Full CLDR coverage is **not** required: a missing category falls back to `other` at runtime (by design in `createT`), so requiring `few`/`many` would be false-strict for community contributions. For `ru` we author all four categories as an editorial standard (Decision 5), not as a validator rule.

`--fix` cannot invent translations: it repairs key sync as today, reports integrity violations as manual fixes, and exits non-zero.

**Rationale**: Violations map 1:1 to user-visible bugs; every check is decidable on the JSON alone; Form-B tolerance keeps the rule green on current `main` (empirically confirmed).

**Alternative considered**: Reusing `formatMessage` from `src/index.ts` for validation — it is a runtime formatter, not a validator; it silently degrades (missing category → `other`, unknown var → literal) instead of reporting.

### 4. Translation workflow: glossary gate, section batches, continuous validation

**Decision**: Translate in 8 section batches (below), running `node scripts/validate-i18n.mjs validate` after each — fast feedback, no mega-merge. The core glossary (next section) is frozen with the reviewer before bulk translation starts. All 5 plural keys are render-verified with `createT` + `deepMerge` against counts 1 / 2 / 5 / 21 / 22 / 25 before the final checks.

| Batch | Sections | Keys |
| ----- | -------- | ---- |
| 1 | common, toolbar, titleBar, formattingBar, alignment, lists, lineSpacing, styles, font, fontSize, zoom, toc | 122 |
| 2 | colorPicker, contextMenu, editor | 89 |
| 3 | dialogs.keyboardShortcuts | 93 |
| 4 | dialogs.imageProperties, imagePosition, insertImage, insertSymbol, watermark | 98 |
| 5 | dialogs.findReplace, hyperlink, insertTable, tableProperties, pasteSpecial, splitCell, pageSetup, footnoteProperties | 119 |
| 6 | table, tableAdvanced, imageWrap, imageTransform, image, imageOverlay | 101 |
| 7 | comments, trackedChanges, revisions, commentMarkers, sidebar, documentOutline, responsePreview, agentPanel, headerFooter | 60 |
| 8 | errors, viewer, unsaved, loading, print, ruler, hyperlinkPopup | 36 |

**Rationale**: Batches follow UI feature areas, so terminology stays coherent within a batch and review diffs are navigable. Continuous `validate` turns a 718-string change into 8 checked increments.

### 5. `ru` ships at 100% coverage

**Decision**: Unlike community locales (96–97%), `ru` leaves no `null`s.

**Rationale**: We author it with a frozen glossary in one pass; a partial machine-assisted mix of Russian and English in the same UI reads worse than a smaller complete locale. `i18n:status` must report 718/718.

### 6. Non-translatables and typography

Not translated: font family names (`Arial`, `Calibri`, …), typographic categories (`Sans Serif`, `Monospace` — per `docs/i18n.md`), page sizes (`A4`, `Letter`), keyboard shortcuts (`Ctrl+B`, `Ctrl+Left`, …), unit strings (`px`, `pt`), placeholder tokens.

Typography conventions: Russian quotes «…» with „…" nested; sentence case (first word capitalized — Word UI convention, not Title Case); preserve trailing ellipsis `…` and dashes; `{placeholders}` and ICU syntax byte-exact.

### 7. Docs, API snapshot, changeset

- `packages/i18n/README.md`: add `ru` to the locale table and the subpath list; fix the already-stale table (missing `fr`, `hi`, `id`).
- `docs/site/content/i18n/index.mdx`: add `id` + `ru` rows, update the "nine languages" description to the real count; `docs/site/content/i18n/contributing.mdx`: update the count.
- API Extractor: `bun run api:extract` → commit new `docs/api/docx-editor-i18n/ru.api.md` and the updated `index.api.md` (new export, `LocaleCode` union member, subpath).
- Changeset `@docx-editor.dev/i18n`: patch — `Add Russian (ru) locale (100% translated); validate placeholder/ICU integrity across locales.`

### 8. Environment prerequisite: bun

The repo pins `bun.lock` and CI uses `bun-version: latest`; this machine currently has neither bun in `PATH` nor `node_modules`. Plan step 0 installs bun and runs `bun install`. The `i18n:*` scripts are plain Node and work without bun, but `bun test`, `bun run typecheck`, package build, and `api:extract` orchestration require it.

## Translation glossary (core terms)

| English | Russian (MS Word RU) | | English | Russian |
| ------- | -------------------- | - | ------- | ------- |
| Bold | Полужирный | | Table | Таблица |
| Italic | Курсив | | Row / Column | Строка / Столбец |
| Underline | Подчёркнутый | | Merge cells | Объединить ячейки |
| Strikethrough | Зачёркнутый | | Split cells | Разделить ячейки |
| Superscript / Subscript | Надстрочный / Подстрочный | | Borders | Границы |
| Align left / right | По левому краю / По правому краю | | Shading / Fill | Заливка |
| Align center | По центру | | Wrap text | Обтекание текстом |
| Justify | По ширине | | In line with text | В тексте |
| Bulleted / Numbered list | Маркированный / Нумерованный список | | Square / Tight | Вокруг рамки / По контуру |
| Line spacing | Междустрочный интервал | | Behind / In front of text | За текстом / Перед текстом |
| Paragraph | Абзац | | Ruler | Линейка |
| Style / Heading | Стиль / Заголовок | | Watermark | Подложка |
| Font / Font size | Шрифт / Размер шрифта | | Footnote / Endnote | Сноска / Концевая сноска |
| Text color / Highlight | Цвет текста / Цвет выделения текста | | Hyperlink / Bookmark | Гиперссылка / Закладка |
| Undo / Redo | Отменить / Вернуть | | Symbol | Символ |
| Comment | Примечание | | Paste special | Специальная вставка |
| Tracked changes | Исправления | | Page setup / Margins | Параметры страницы / Поля |
| Accept / Reject | Принять / Отклонить | | Portrait / Landscape | Книжная / Альбомная |
| Header / Footer | Верхний / нижний колонтитул | | Find / Replace / Replace all | Найти / Заменить / Заменить все |
| Page break / Section break | Разрыв страницы / Разрыв раздела | | Match case | Учитывать регистр |
| Table of contents | Оглавление | | Sidebar | Боковая панель |
| Zoom | Масштаб | | Document outline | Структура документа |
| Save / Open / Print | Сохранить / Открыть / Печать | | Insert | Вставка (меню) / Вставить (действие) |

The glossary fixes the canonical core; case-specific wording inside long sentences follows it.

## Risks

- **Environment** — bun/node_modules missing on this machine; step 0 of tasks covers install. Low risk, blocks everything if skipped.
- **Longer Russian strings** (~15–30% growth) may overflow tight toolbar/menu areas. Out of scope to fix; the manual QA task records findings for a follow-up decision (blocked pre-merge by the contract-only core stub; see tasks.md).
- **False positives in the new rule** would block unrelated PRs. Mitigated by the regression test over all shipped locale files and by the Form-B tolerance (Decision 2).
- **Terminology drift** within 718 strings. Mitigated by the frozen glossary and the per-batch feature-area grouping.

## Post-merge update (2026-10-10)

The numbers above (718 keys, 10 locales) describe the pre-merge branch state. During integration, `main` (686 commits, `48f4ee68`) brought a restructured 822-key `en.json` plus `es`/`ja` locales. `ru` was resynced to the new catalog: 91 translations ported by exact English-text match against the pre-merge pair, 2 stale surviving translations corrected, 446 strings newly translated — still under the frozen glossary and the same integrity rule. Upstream had already solved the generated-union/prettier tension with `// prettier-ignore` (adopted, replacing the wrap-emulation from the pre-merge branch). The strict upstream gate `catalogs.test.ts` (every shipped catalog: full non-null coverage, placeholder-set equality, brace-free plural rendering for counts 0…21) passes for all 13 locales, as does `placeholder-syntax.test.ts`.
