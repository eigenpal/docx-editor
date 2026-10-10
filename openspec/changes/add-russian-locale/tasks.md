# Tasks: Add Russian (ru) Locale

## 0. Environment

- [x] Install bun (official installer / `winget install Oven-sh.Bun`) and run `bun install` at the repo root; confirm `bun run i18n:status` reports the current locales.

## 1. Validator integrity rule (TDD)

- [x] Add `packages/i18n/i18n-integrity.mjs` — pure module: placeholder extraction (simple `{name}` + plural block) and `checkLocaleIntegrity(enStrings, localeStrings, code)` returning violations with codes: `placeholder_mismatch`, `plural_var_mismatch`, `invalid_branch_label`, `missing_other`, `missing_exact_branch`, `malformed_braces`, `lang_mismatch`. (Lives next to `locale-files.mjs` so the `bunfig.toml` `root = "./packages"` test scope discovers the test.)
- [x] Add `packages/i18n/i18n-integrity.test.mjs` (`bun:test`): each violation code; clean cases incl. Form B (en plural → simple interpolation, the `id.formattingBar.moreItems` shape); Russian plural with `one`/`few`/`many`/`other`; preserved `=N`; English-label tolerance (`zh-CN`/`id` shape); `null` skipped.
- [x] Regression test: every shipped locale JSON against `en.json` yields zero violations.
- [x] Wire the rule into `scripts/validate-i18n.mjs` `validate` and `fix` modes (fix reports manual fixes and exits non-zero; key-sync repair unchanged).
- [x] Run `bun test` and `bun run i18n:validate` — green on current `main`.

## 2. Scaffold `ru`

- [x] Run `bun run i18n:new ru` — creates `packages/i18n/ru.json` (all keys `null`, `_lang: "ru"`), `packages/i18n/src/ru.ts`, updates the generated block in `packages/i18n/src/index.ts` and `package.json#exports`.
- [x] Verify the diff contains only those files; `bun run i18n:validate` still green.

## 3. Glossary gate

- [x] Present the core glossary (design.md) to the reviewer and freeze it before bulk translation.

## 4. Translation (8 batches; `node scripts/validate-i18n.mjs validate` after each)

- [x] Batch 1 — common, toolbar, titleBar, formattingBar, alignment, lists, lineSpacing, styles, font, fontSize, zoom, toc (122 keys)
- [x] Batch 2 — colorPicker, contextMenu, editor (89)
- [x] Batch 3 — dialogs.keyboardShortcuts (93)
- [x] Batch 4 — dialogs: imageProperties, imagePosition, insertImage, insertSymbol, watermark (98)
- [x] Batch 5 — dialogs: findReplace, hyperlink, insertTable, tableProperties, pasteSpecial, splitCell, pageSetup, footnoteProperties (119)
- [x] Batch 6 — table, tableAdvanced, imageWrap, imageTransform, image, imageOverlay (101)
- [x] Batch 7 — comments, trackedChanges, revisions, commentMarkers, sidebar, documentOutline, responsePreview, agentPanel, headerFooter (60)
- [x] Batch 8 — errors, viewer, unsaved, loading, print, ruler, hyperlinkPopup (36)
- [x] Final sweep: no `null`s left in `ru.json`; `i18n:status` reports ru 718/718.

## 5. Plural verification

- [x] Render-check all 5 plural keys (`formattingBar.moreItems`, `comments.replyCount`, `agentPanel.timeline.working`, `agentPanel.timeline.summary`, `agentPanel.timeline.earlier`) via `createT` + `deepMerge` for counts 1, 2, 5, 21, 22, 25; confirm `one`/`few`/`many`/`other` selection. (Also covered the 3 plural blocks added during translation — `dialogs.findReplace.matchCount`, `dialogs.splitCell.currentMinimum`, `dialogs.splitCell.minValue` — 8 keys × counts 0–101, 90/90 PASS.)

## 6. Final validation

- [x] `bun run i18n:validate` (all locales), `bun test`, `bun run typecheck`. (i18n typecheck green; full-repo typecheck/test red only on the pre-existing `@docx-editor.dev/core/*` resolution class — 500 `TS2307` in react/vue/agents/nuxt + 24 test failures — unchanged by this change.)
- [x] `bun run --filter '@docx-editor.dev/i18n' build` then `bun run check:i18n-bundle-size` (ru per-locale bundle under 80 KB — ru.mjs 40.2 KB).
- [x] `bun run api:extract`; commit `docs/api/docx-editor-i18n/ru.api.md` and updated `index.api.md`. (Generated + EOL-normalized to LF; `api:check` green; files left in the working tree for the commit.)
- [x] `bun run format`. (Pre-merge note: the old `LocaleCode` one-liner crossed prettier's printWidth with the 11th locale; upstream solved this during the merge with `// prettier-ignore` on the generated union — our wrap-emulation was replaced by upstream's approach in merge resolution, so `format` and `i18n:validate` agree by construction.)

## 7. Docs and release meta

- [x] `packages/i18n/README.md`: add `ru` to the locale table and subpath list; fix missing `fr`/`hi`/`id` entries.
- [x] `docs/site/content/i18n/index.mdx`: add `id` + `ru` rows, correct the language count; `docs/site/content/i18n/contributing.mdx`: correct the count.
- [x] Add `.changeset/add-russian-locale.md`: `'@docx-editor.dev/i18n': patch`, summary `Add Russian (ru) locale (100% translated); validate placeholder/ICU integrity across locales.` (Final summary kept consumer-facing: `Add Russian (ru) locale with full UI translation coverage.`)

## 7.5 Post-merge resync (main @ 48f4ee68, 686 commits)

- [x] Merge `main` into the branch; resolve conflicts (6 files). Adopted upstream's `// prettier-ignore` `LocaleCode` union; kept our integrity wiring in `scripts/validate-i18n.mjs`; union of locales in docs tables (13 shipped: en, de, es, fr, he, hi, id, ja, pl, pt-BR, ru, tr, zh-CN).
- [x] The merged `en.json` is 822 keys (upstream restructure: `collaboration.*`, `disabledReason.*`, `revisionMarkup.*`, `contentControl.*`, `textFormField.*`, `review.*`, `navigation.*`, …). `i18n:fix` reshaped `ru.json` (433 stale keys removed, 537 added).
- [x] Resync translations to keep `ru` at 100%: 91 keys ported by exact English-text match against the pre-merge pair (`c815d02` en ↔ our ru), 2 stale surviving translations corrected (`revisions.runPropertiesChanged`, `contextMenu.ariaLabel`), 446 strings newly translated in 3 batches under the frozen glossary.
- [x] Merged gates green: `i18n:validate` (key sync + integrity, all 12 community catalogs), `i18n:status` → ru 822/822 (100%), `bun test packages/i18n` → 76 pass / 0 fail (includes upstream `catalogs.test.ts` — every locale non-null, placeholder-equal, plural-rendered — and `placeholder-syntax.test.ts`), i18n `typecheck`, `build`, `check:i18n-bundle-size` (26 bundles < 80 KB), `api:extract` + `api:check` (snapshot gains `'ru'` in `LocaleCode` and `export const ru` alongside upstream `es`/`ja`).

## 8. Manual visual QA (local only, not committed)

- [ ] BLOCKED (pre-existing, not caused by this change): the source-based demo cannot build in this snapshot — `@docx-editor.dev/core` resolves to the npm contract-only stub (3 files) which ships neither `tailwind-preset.cjs` nor `styles/editor.css`, and react/vue sources import `@docx-editor.dev/core/internal/*` modules that exist nowhere (same class as the 24 failing unit tests / 800 typecheck errors on `main`). Evidence: `npx vite build` in `examples/vite` → `[postcss] Cannot find module '@docx-editor.dev/core/tailwind-preset.cjs'` + `ENOENT ... core/styles/editor.css`. Visual QA of `ru` is deferred until the core workspace resolution is restored; overflow findings from longer Russian strings remain a follow-up, not a blocker for this change.
- [x] No temporary edits exist in the working tree — nothing to revert (`git status` shows only the intended change set).
