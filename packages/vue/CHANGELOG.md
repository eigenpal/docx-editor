# @eigenpal/docx-editor-vue

## 1.2.1

### Patch Changes

- Updated dependencies [a0adf60]
- Updated dependencies [1c2b098]
  - @eigenpal/docx-editor-agents@1.2.1
  - @eigenpal/docx-editor-core@1.2.1
  - @eigenpal/docx-editor-i18n@1.2.1

## 1.2.0

### Minor Changes

- 362a65f: Make block-level content controls (`w:sdt`) editable. Block structured document tags wrapping paragraphs or tables now convert to a dedicated ProseMirror node, so their content stays editable and the control survives the full edit cycle (previously it round-tripped on save but was flattened in the editor). The control boundary is drawn around its content in the paged view, and the region remains addressable by its tag/alias.
- d791e05: Add content-control (SDT) methods to the editor ref. `getContentControls` lists block controls in the live document (filtered by tag/alias/id/type) with their text and position; `scrollToContentControl` brings one into view; `setContentControlContent` fills a control by tag (as a normal undoable edit); `removeContentControl` deletes or unwraps one. Locked controls are refused unless forced. Paired across the React and Vue adapters.
- a60ed77: Add typed value setters for content controls. `setContentControlValue` (headless) and the `setContentControlValue` editor-ref method (React + Vue) set a dropdown selection, toggle a checkbox, or set a date by tag, updating both the visible content and the structured `w:sdtPr` state (dropdown `w:lastValue`, `w14:checked`, `w:date`'s `w:fullDate`). Validates the value against the control type and list items.
- a60ed77: Support repeating sections (`w15:repeatingSection`) with add/remove, matching Word. `addRepeatingSectionItem`/`removeRepeatingSectionItem` (headless) clone an item with fresh unique ids or drop one (keeping at least one); the editor renders ＋/✕ affordances on each repeating item in React and Vue. Items round-trip losslessly.

### Patch Changes

- Updated dependencies [362a65f]
- Updated dependencies [e30c763]
- Updated dependencies [d791e05]
- Updated dependencies [d791e05]
- Updated dependencies [a60ed77]
- Updated dependencies [bc67374]
- Updated dependencies [a60ed77]
  - @eigenpal/docx-editor-core@1.2.0
  - @eigenpal/docx-editor-agents@1.2.0
  - @eigenpal/docx-editor-i18n@1.2.0

## 1.1.0

### Minor Changes

- 9d7138e: Add a `fonts` prop on `<DocxEditor>` for declarative custom-font registration — each entry injects an `@font-face` from the URL you provide, and entries sharing a `family` register different weights. Also exposes `loadFontFromUrl`, `loadFontDefinitions`, and the `FontDefinition` type from `@eigenpal/docx-editor-core/utils`. Fixes #620.
- 9d7138e: Font-load failures now route through the React `onError` prop and the Vue `error` event instead of the console, so you can forward them to your own error tracker; with no subscriber attached they fall back to `console.warn`. Adds `onFontError(callback)` to `@eigenpal/docx-editor-core/utils` for non-adapter hosts.
- 42ea72d: Track structural edits as OOXML revisions in suggesting mode. Paragraph-break insert/delete, paragraph-property changes, and table row/cell insert/delete/merge are now recorded, round-tripped through DOCX, and shown in the tracked-changes sidebar (React and Vue, localized). Adds `acceptChangeById(id)` / `rejectChangeById(id)`, and `acceptAllChanges` / `rejectAllChanges` now resolve every revision type rather than inline marks only. Fixes #614.

### Patch Changes

- Updated dependencies [14fe4f2]
- Updated dependencies [9d7138e]
- Updated dependencies [7e77654]
- Updated dependencies [bf11ee8]
- Updated dependencies [30c1931]
- Updated dependencies [9d7138e]
- Updated dependencies [7a91813]
- Updated dependencies [a7f9ac5]
- Updated dependencies [42ea72d]
- Updated dependencies [ebb85a5]
- Updated dependencies [137d5de]
- Updated dependencies [e5e0997]
  - @eigenpal/docx-editor-i18n@1.1.0
  - @eigenpal/docx-editor-core@1.1.0
  - @eigenpal/docx-editor-agents@1.1.0

## 1.0.3

### Patch Changes

- 6d56181: Vue now renders documents with stacked floating objects identically to React. Previously, the Vue composable ran a simplified measurement pipeline without floating-zone awareness, so anchored images / floating textboxes / floating tables would not push body text below them in Vue. The float-extraction and per-block orchestration is now shared from `@eigenpal/docx-editor-core/layout-bridge` (`measureBlocksWithFloats`); both adapters call it with their own per-block measure callback.
- Updated dependencies [24b31a4]
- Updated dependencies [ec36a50]
- Updated dependencies [143c31e]
- Updated dependencies [d91357e]
- Updated dependencies [bdd7f50]
- Updated dependencies [6d56181]
- Updated dependencies [e80093d]
  - @eigenpal/docx-editor-core@1.0.3
  - @eigenpal/docx-editor-agents@1.0.3
  - @eigenpal/docx-editor-i18n@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [4e73af5]
  - @eigenpal/docx-editor-core@1.0.2
  - @eigenpal/docx-editor-agents@1.0.2
  - @eigenpal/docx-editor-i18n@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [8d60d65]
- Updated dependencies [7806b78]
- Updated dependencies [a193caa]
- Updated dependencies [fe4cb94]
  - @eigenpal/docx-editor-core@1.0.1
  - @eigenpal/docx-editor-i18n@1.0.1
  - @eigenpal/docx-editor-agents@1.0.1

## 1.0.0

### Major Changes

- 6272b32: # 1.0.0

  First multi-package, multi-framework release. The monolithic `@eigenpal/docx-js-editor` is split into a framework-agnostic core and per-framework adapters, Vue 3 ships as a first-class adapter alongside React, and the license moves to Apache 2.0 across all packages.

  ## Package restructure (breaking)

  | Old import                                 | New import                                |
  | ------------------------------------------ | ----------------------------------------- |
  | `@eigenpal/docx-js-editor`                 | `@eigenpal/docx-editor-react`             |
  | `@eigenpal/docx-js-editor/react`           | `@eigenpal/docx-editor-react`             |
  | `@eigenpal/docx-editor-react/core`         | `@eigenpal/docx-editor-core`              |
  | `@eigenpal/docx-editor-react/headless`     | `@eigenpal/docx-editor-core/headless`     |
  | `@eigenpal/docx-editor-react/core-plugins` | `@eigenpal/docx-editor-core/core-plugins` |
  | `@eigenpal/docx-editor-react/mcp`          | `@eigenpal/docx-editor-agents/mcp`        |
  | `@eigenpal/docx-editor-react/i18n/*.json`  | `@eigenpal/docx-editor-i18n/*.json`       |

  The old `@eigenpal/docx-js-editor` package stays on 0.x for legacy maintenance — no 1.x compatibility shim ships. Framework-agnostic utilities (e.g. `createEmptyDocument`) move to core:

  ```diff
  - import { DocxEditor, createEmptyDocument } from '@eigenpal/docx-js-editor';
  + import { DocxEditor } from '@eigenpal/docx-editor-react';
  + import { createEmptyDocument } from '@eigenpal/docx-editor-core';
  ```

  ## Vue 3 adapter (`@eigenpal/docx-editor-vue`)

  The Vue package becomes a real adapter (previously a stub). Public API mirrors React:
  - `<DocxEditor>` with matching prop surface
  - `useDocxEditor` composable + `renderAsync` for the Node.js path
  - `/ui`, `/composables`, `/dialogs`, `/plugin-api`, `/styles` subpaths

  Parity gates cover insert-table, find/replace, page-setup, context menus, image overlay (resize/move/rotate/aspect-locked corners, dimension tooltip), advanced cell/row options (margins, height rule, text direction, no-wrap), menu-bar icons + shortcuts + carets, toolbar pickers, and the agent UI surface.

  ## Shared i18n package (`@eigenpal/docx-editor-i18n`)

  Locale strings move out of `@eigenpal/docx-editor-react` into a dedicated package consumed by both adapters from a single source.

  ```diff
  - import de from '@eigenpal/docx-editor-react/i18n/de.json';
  + import de from '@eigenpal/docx-editor-i18n/de.json';
  ```

  The `defaultLocale` value (English) is still re-exported from the adapter packages, unchanged.

  ## Agent UI relocation (breaking)

  `AgentPanel`, `AgentChatLog`, `AgentComposer`, `AgentSuggestionChip`, `AgentTimeline` no longer ship from `@eigenpal/docx-editor-react`. They live at:
  - `@eigenpal/docx-editor-agents/react` — React components + `useAgentChat`
  - `@eigenpal/docx-editor-agents/vue` — Vue 3 twins, plus `AIContextMenu` and `AIResponsePreview`
  - `@eigenpal/docx-editor-agents/ai-sdk/react` / `/ai-sdk/vue` — `@ai-sdk/*` adapters
  - `@eigenpal/docx-editor-agents/bridge` — React-free `createEditorBridge`, `agentTools`, `executeToolCall`, `getToolSchemas`, `createReviewerBridge`. Safe for headless / Vue / Node.

  ```diff
  - import { AgentPanel, AgentChatLog } from '@eigenpal/docx-editor-react';
  + import { AgentPanel, AgentChatLog } from '@eigenpal/docx-editor-agents/react';
  ```

  The agent components no longer call `useTranslation` directly — pass localized `*Label` props instead. `<DocxEditor>`'s built-in agent panel slot still forwards localized strings automatically.

  Accessibility polish on the agent surface: keyboard-operable resize handle, Escape-dismissable context menu, live-region chat log, WCAG AA contrast on response previews.

  ## Toolbar naming unified (breaking)

  The standalone formatting bar is `Toolbar` on both adapters. The old "classic" single-row `Toolbar` (with File/Format/Insert menus baked in) is removed — compose `EditorToolbar.MenuBar` + `EditorToolbar.Toolbar` for that layout.

  | Old (React)                    | New (React + Vue)       |
  | ------------------------------ | ----------------------- |
  | `FormattingBar`                | `Toolbar`               |
  | Classic `Toolbar` (with menus) | `EditorToolbar`         |
  | `EditorToolbar.FormattingBar`  | `EditorToolbar.Toolbar` |

  Vue: `BasicToolbar` / `FormattingBar` aliases removed; `EditorToolbar`'s `formatting-bar` slot is now `toolbar`. Vue's table border-color and cell-fill pickers now use the advanced color picker matching React. Vue `MenuDropdown`'s `showChevron` default flips from `true` to `false` — pass `:show-chevron="true"` explicitly to keep the caret.

  ## `showPrintButton` prop removed (breaking)

  Removed from `<DocxEditor>` and `<Toolbar>` on both adapters; the Vue `<Toolbar>` `print` event is gone with it. `onPrint` callback stays.

  ```diff
  - <DocxEditor showPrintButton onPrint={handlePrint} />
  + <DocxEditor onPrint={handlePrint} />
  ```

  To hide File > Print, omit `onPrint`. Programmatic print still works via `ref.current.print()` / `editorRef.value.print()`.

  ## License moves to Apache 2.0

  All published packages relicense to Apache 2.0. Notably: `@eigenpal/docx-editor-agents` was AGPL-3.0-or-later — the relicense lifts copyleft obligations on agent embedders.

### Patch Changes

- 0187af2: Emit consumer-friendly JSON docs at `docs/json/<pkg-slug>/<subpath>.json` for every `@public` export across the published packages. Companion to the existing `etc/<slug>.api.md` snapshots — same source of truth (API Extractor), different output shape: instead of human-readable Markdown, the JSON is structured for a docs site to render any layout it wants. Includes per-export source-link URLs into the GitHub source tree, type-reference canonical IDs for cross-page linking, and TSDoc summaries/remarks/examples parsed out of the source.

  New tooling: `bun run docs:json` regenerates, `bun run docs:check` (in CI) fails on drift. Contract documented in `CLAUDE.md` under `### Docs JSON`. No runtime change to any published package.

- 348fa6b: API Extractor snapshots for the 6 published subpaths of `@eigenpal/docx-editor-react` (root, `/ui`, `/hooks`, `/dialogs`, `/plugin-api`, `/styles`) and `@eigenpal/docx-editor-vue` (root, `/ui`, `/composables`, `/dialogs`, `/plugin-api`, `/styles`). CI now fails on undocumented public-surface drift via `bun run api:check`.

  Adds `etc/parity.contract.json` — the cross-adapter parity contract listing which `DocxEditorProps` fields and `DocxEditorRef` members are paired between React and Vue, which are deliberately deferred in Vue, and which are Vue-exclusive. `bun run check:parity-contract` (also gated in CI) parses both snapshots and fails on any drift the contract doesn't acknowledge. Adding a new prop or ref method to either adapter forces an explicit classification in the contract.

  Vue composables now declare named `Use*Return` interfaces (`UseClipboardReturn`, `UseFindReplaceReturn`, `UseSelectionHighlightReturn`, `UseTableSelectionReturn`, `UseHistoryReturn`, `UseTableResizeReturn`, `UseDragAutoScrollReturn`, `UseVisualLineNavigationReturn`, `UseDocxEditorReturn`). Before this change the composables returned anonymous object literals that recursively expanded core's internal types in the published `.d.ts`, inflating `etc/composables.api.md` to 3,526 lines and locking core's internal `Run`/`Comment` shape into Vue's public contract. Named returns drop the snapshot to ~450 lines and decouple Vue's surface from core's internals.

  Vue's `useTableSelection` no longer exposes `manager: TableSelectionManager` in its return — it was unused by any internal consumer and leaked core's `TableSelectionManager` class as part of Vue's public surface.

  Side effect for `@eigenpal/docx-editor-vue`: the build no longer writes workspace-relative source paths (e.g. `../../core/src/core.ts`) into published declarations. Those paths were valid in this repo but unresolvable once installed from npm; setting `pathsToAliases: false` on the dts plugin keeps the package names (`@eigenpal/docx-editor-core`, `@eigenpal/docx-editor-i18n`) intact in `dist/*.d.ts`.

  No runtime change for either package.

- 2e6398a: Drop framework-prefixed names from Vue's public surface — the package name already encodes the framework, so `Vue`-prefixed identifiers are redundant in consumer code.

  Renames `VueRenderAsyncOptions` → `RenderAsyncOptions` in `packages/vue/src/renderAsync.ts`. The previous compat alias (`VueRenderAsyncOptions as RenderAsyncOptions`) is dropped — `RenderAsyncOptions` is now the only exported name. Matches React's `RenderAsyncOptions` 1:1.

  Adds `EditorPlugin` as a type alias for `VueEditorPlugin` in `packages/vue/src/plugin-api/types.ts`, mirroring React's `EditorPlugin` / `ReactEditorPlugin` pair. Consumers writing `import { EditorPlugin } from '@eigenpal/docx-editor-vue/plugin-api'` now resolve. `VueEditorPlugin` stays exported for callers who want the framework-explicit name.

  No runtime change.

- Updated dependencies [6272b32]
- Updated dependencies [c5125ff]
- Updated dependencies [76093f9]
- Updated dependencies [c5125ff]
- Updated dependencies [348fa6b]
- Updated dependencies [0187af2]
- Updated dependencies [6b8f1fb]
- Updated dependencies [61983ca]
- Updated dependencies [f7b8dc7]
- Updated dependencies [b2230a3]
- Updated dependencies [8836214]
  - @eigenpal/docx-editor-core@1.0.0
  - @eigenpal/docx-editor-agents@1.0.0
  - @eigenpal/docx-editor-i18n@1.0.0
