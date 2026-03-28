## Why

All UI strings in the editor (~200+) are hardcoded in English. This makes it impossible to ship the editor in non-English apps without forking the codebase. Community contributors cannot add translations, and consumers cannot customize labels for their brand or domain. This is the most-requested localization feature (GitHub issue #222).

## What Changes

- Extract all ~200+ user-facing strings (dialog titles, button labels, tooltips, placeholders, aria-labels, status messages, error messages, menu items) into a structured default `en.json` locale file
- Create a `useTranslation()` hook backed by React Context that all components use instead of hardcoded strings
- Add a `locale` prop on `<DocxEditor>` accepting `Partial<LocaleStrings>` with deep merge against English defaults — consumers override only what they need
- Ship locale JSON files under `i18n/en.json` (required, bundled) with community-contributed locales as optional imports (e.g., `@eigenpal/docx-js-editor/i18n/pl.json`)
- Provide a TypeScript type contract (`LocaleStrings`) so locale objects are type-safe and autocomplete-friendly
- Zero new runtime dependencies — plain JSON + React Context only

## Capabilities

### New Capabilities

- `locale-provider`: React Context provider, `useTranslation()` hook, deep-merge logic for partial locale overrides, `locale` prop on DocxEditor
- `locale-strings`: Default `en.json` locale file with all extracted strings organized by feature area, TypeScript type definition (`LocaleStrings`), community contribution pattern via `i18n/*.json`

### Modified Capabilities

<!-- No existing spec-level requirements are changing — this is purely additive -->

## Impact

- **Components affected**: Every component with user-facing text — Toolbar, FormattingBar, FindReplaceDialog, HyperlinkDialog, InsertTableDialog, InsertImageDialog, InsertSymbolDialog, ImagePropertiesDialog, ImagePositionDialog, PageSetupDialog, TablePropertiesDialog, PasteSpecialDialog, FootnotePropertiesDialog, KeyboardShortcutsDialog, CommentCard, ContextMenu, TextContextMenu, DocxEditor, ErrorBoundary, DocumentOutline, TitleBar, UnifiedSidebar, and various picker components
- **API surface**: New `locale` prop on `<DocxEditor>` (non-breaking, optional)
- **Bundle size**: Minimal — one JSON file (~5-8KB) bundled, React Context is lightweight, no new dependencies
- **Headless API**: Not affected (no UI strings)
- **Breaking changes**: None — English remains the default, all strings fall back automatically
