# @eigenpal/docx-editor-vue

## 1.3.2

### Patch Changes

- b05e9cf: Add the `author` prop to the Vue editor, matching React. Comments and tracked changes created through the UI now use the supplied author name instead of always being attributed to "User". Fixes #720.
- 1c254e8: Add React-parity callback props to the Vue editor: `onChange`, `onError`, `onSelectionChange`, `onEditorViewReady`, and the comment lifecycle callbacks `onCommentAdd`, `onCommentResolve`, `onCommentDelete`, `onCommentReply`, and `onCommentsChange`. Hosts can now observe document, selection, and comment changes via props alongside the existing Vue events. Part of #720.
- 6228132: Vue toolbar tooltips and the right-click text context menu now follow the active i18n locale instead of always rendering English. Shortcut-bearing buttons (bold, italic, underline, insert link, super/subscript, image properties) and every context-menu item (cut, copy, paste, delete, select all, table and image actions) route through `t()`.
- Updated dependencies [3bd7bf7]
- Updated dependencies [0ded2a1]
- Updated dependencies [58e3a7e]
  - @eigenpal/docx-editor-core@1.3.2
  - @eigenpal/docx-editor-agents@1.3.2
  - @eigenpal/docx-editor-i18n@1.3.2

## 1.3.1

### Patch Changes

- 3fe9c57: Share the layout pipeline across the React and Vue adapters. The Vue editor now renders multi-column section layouts with correct per-section column widths, coalesces a burst of keystrokes into one layout pass per frame, and no longer scrolls the page when you edit. React behavior is unchanged.
- d100115: Fix blank render on documents whose header contains a page-anchored letterhead. The body now clears the header/footer based on in-flow content only, so anchored shapes and text boxes (which Word positions on the page) no longer push the body off the page. Fixes #705.
- 66cf3a8: Share the React/Vue editor orchestration through core so both adapters stay in lockstep. Vue gains three behaviors it was missing: multi-cell selection highlighting, drag-to-edge auto-scroll while selecting, and correct comment/tracked-change ID allocation (IDs are no longer reused after a delete and no longer collide across the comment/revision space). Vue selection rectangles now also cover tab stops and hyperlink text. No public API changes.
- Updated dependencies [3fe9c57]
- Updated dependencies [d100115]
- Updated dependencies [db75f4f]
- Updated dependencies [66cf3a8]
  - @eigenpal/docx-editor-core@1.3.1
  - @eigenpal/docx-editor-agents@1.3.1
  - @eigenpal/docx-editor-i18n@1.3.1

## 1.3.0

### Minor Changes

- 0f3eb97: Add the Insert → Watermark dialog to the Vue editor. The Vue adapter could already render and round-trip watermarks from opened documents; now you can also add, edit, or remove text and picture watermarks from the UI, with the change participating in undo/redo.

### Patch Changes

- 928593b: Vue: show the hyperlink popup when clicking a link in a header or footer. The click handler now resolves against the active header/footer editor (matching the body and React behavior) instead of the body, and no longer ignores links whose URL is empty.

  Fixes #692

- 6dc5b50: Vue: fix the image selection frame being offset from the image at zoom levels other than 100%. The overlay lives in the unscaled scroll viewport, so it now positions at post-scale pixels and scales its border/handles with the zoom factor, wrapping the image tightly. It also re-anchors when the zoom transition settles.

  Fixes #695

- 98ae3e5: Vue: fix the text selection highlight and caret drifting away from the text at zoom levels other than 100%. The overlay rects are painted into the scaled pages container, so they are now divided by the zoom factor to land on the selected text.

  Fixes #693

- 9c8068f: Fix the Vue "Add comment" card overlapping existing comment and tracked-change cards in the sidebar. The add-comment input now flows through the same collision-avoidance pass as every other card, so it claims its slot and neighbouring cards stack below it. Fixes #669
- cab7424: Fix the Vue header/footer "Remove" button doing nothing. Removing a header or footer now drops the part from the package and strips its section references, so it stops rendering on the page (matching React). Fixes #686
- f3d6861: Fix text selection not showing in Vue headers and footers. Selecting text while editing a header or footer now paints the highlight (the body overlay was suppressed in HF mode but the HF rects were never drawn), and double/triple-click word and paragraph selection resolves against the header/footer text instead of a body run at the same position. On multi-page documents, the caret and selection now render on the header/footer instance being edited rather than always on page one's copy. Fixes #691
- 06aea12: Vue: keep the image selection frame on the image when it moves to another page or is resized, instead of stranding it at the old position.
- 127985a: Fix the Vue horizontal ruler indent handles not tracking the active paragraph. The ruler now reads the selection's left/right/first-line/hanging indents and tab stops (like React) and moves the handles to match. Also stop showing an extra first-line-indent marker at the left margin. Fixes #685
- Updated dependencies [15966fc]
- Updated dependencies [2003cec]
- Updated dependencies [5e51a9b]
- Updated dependencies [cb5f622]
- Updated dependencies [1be9cf5]
- Updated dependencies [5fcca3b]
- Updated dependencies [f73706e]
- Updated dependencies [0d5beed]
- Updated dependencies [5b38696]
- Updated dependencies [15966fc]
- Updated dependencies [f3d6861]
- Updated dependencies [0f3eb97]
- Updated dependencies [eaa6f7f]
  - @eigenpal/docx-editor-core@1.3.0
  - @eigenpal/docx-editor-agents@1.3.0
  - @eigenpal/docx-editor-i18n@1.3.0

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
