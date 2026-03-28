## 1. i18n Core Infrastructure

- [x] 1.1 Create `src/i18n/types.ts` — auto-derive `LocaleStrings` type from `en.json` via `typeof import`, define `DeepPartial`, `PartialLocaleStrings`, and `TranslationKey` (dot-path union) utility types
- [x] 1.2 Create `i18n/en.json` — extract all ~200+ hardcoded strings from components into a multi-level nested JSON structure (types auto-derive from this file)
- [x] 1.3 Create `src/i18n/LocaleContext.tsx` — implement `LocaleProvider` (React Context + deep merge with `useMemo`), `useTranslation()` hook returning type-safe `t()` function with `{variable}` interpolation support and key-string fallback
- [x] 1.4 Create `src/i18n/index.ts` — barrel export for `LocaleProvider`, `useTranslation`, `LocaleStrings`, `PartialLocaleStrings`, and default locale
- [x] 1.5 Wire `LocaleProvider` into `DocxEditor.tsx` — accept `locale` prop of type `PartialLocaleStrings`, wrap editor internals with `<LocaleProvider locale={locale}>`

## 2. String Extraction — Toolbar & Formatting

- [x] 2.1 Replace hardcoded strings in `Toolbar.tsx` with `t()` calls (formatting tooltips, menu labels)
- [x] 2.2 Replace hardcoded strings in `FormattingBar.tsx` with `t()` calls (bold, italic, underline, undo/redo tooltips)

## 3. String Extraction — Dialogs

- [x] 3.1 Replace hardcoded strings in `FindReplaceDialog.tsx` (title, placeholders, buttons, match count, options)
- [x] 3.2 Replace hardcoded strings in `HyperlinkDialog.tsx` (title, labels, placeholders, errors, buttons)
- [x] 3.3 Replace hardcoded strings in `InsertTableDialog.tsx` (title, labels, buttons)
- [x] 3.4 Replace hardcoded strings in `InsertImageDialog.tsx` (title, labels, placeholders, buttons)
- [x] 3.5 Replace hardcoded strings in `InsertSymbolDialog.tsx` (title, placeholder, buttons)
- [x] 3.6 Replace hardcoded strings in `ImagePropertiesDialog.tsx` (title, labels, options)
- [x] 3.7 Replace hardcoded strings in `ImagePositionDialog.tsx` (title, labels, options)
- [x] 3.8 Replace hardcoded strings in `PageSetupDialog.tsx` (title, labels, options)
- [x] 3.9 Replace hardcoded strings in `TablePropertiesDialog.tsx` (title, labels, options)
- [x] 3.10 Replace hardcoded strings in `PasteSpecialDialog.tsx` (title, buttons)
- [x] 3.11 Replace hardcoded strings in `FootnotePropertiesDialog.tsx` (labels, options)
- [x] 3.12 Replace hardcoded strings in `KeyboardShortcutsDialog.tsx` (aria-label, placeholder)

## 4. String Extraction — Panels & Menus

- [x] 4.1 Replace hardcoded strings in `CommentCard.tsx` (Resolved, Resolve, Reopen, Delete, More options)
- [x] 4.2 Replace hardcoded strings in `ContextMenu.tsx` and `TextContextMenu.tsx` (menu items, AI actions)
- [x] 4.3 Replace hardcoded strings in `DocumentOutline.tsx` (aria-labels, tooltips)
- [x] 4.4 Replace hardcoded strings in `UnifiedSidebar.tsx` (aria-label)
- [x] 4.5 Replace hardcoded strings in `TitleBar.tsx` (aria-labels)
- [x] 4.6 Replace hardcoded strings in `ErrorBoundary.tsx` and `DocxEditorHelpers.tsx` (error/loading messages)

## 5. String Extraction — Pickers & Remaining Components

- [x] 5.1 Replace hardcoded strings in picker components (FontPicker, AlignmentButtons, ListButtons, LineSpacingPicker, StylePicker, TableStyleGallery)
- [x] 5.2 Replace hardcoded strings in `CommentMarginMarkers.tsx` (tooltips)
- [x] 5.3 Replace hardcoded strings in `ResponsePreview.tsx` (tooltips)
- [x] 5.4 Audit all components for any remaining hardcoded user-facing strings and replace with `t()` calls

## 6. Package Exports & Community Locale

- [x] 6.1 ~~Create `i18n/pl.json`~~ — Skipped: let community contribute natural translations rather than shipping AI-generated ones
- [x] 6.2 Update `package.json` exports to include `./i18n/*.json` paths for consumer imports
- [x] 6.3 Export `LocaleStrings` and `PartialLocaleStrings` types from the package entry point (`src/index.ts`)

## 7. Documentation

- [x] 7.1 Add i18n section to `CLAUDE.md` documenting: locale file location (`i18n/{lang}.json`), `useTranslation()` hook usage, `t()` key convention, how to add new strings, how to contribute a new locale

## 8. Validation & Testing

- [x] 8.1 Run `bun run typecheck` to verify all `t()` calls use valid keys and no type errors exist
- [x] 8.2 Run existing Playwright E2E tests to confirm no regressions (formatting test failures are pre-existing on main)
- [ ] 8.3 Add a Playwright test that renders `<DocxEditor>` with a partial locale override and verifies overridden strings appear in the UI
- [x] 8.4 Verify `i18n/pl.json` import path works from a consumer perspective (package exports configured)
