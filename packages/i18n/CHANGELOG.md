# @eigenpal/docx-editor-i18n

## 1.10.0

## 1.9.0

### Patch Changes

- 28876a2: Make regular expressions over file- and library-supplied strings run in linear time and escape quoted font names completely. The variable-detection, plural-message, and core-properties date regexes no longer backtrack polynomially on hostile input, and font family names are now backslash-escaped before being wrapped in a quoted CSS string so a crafted DOCX font name cannot break out of it.

## 1.8.3

## 1.8.2

## 1.8.1

## 1.8.0

## 1.7.0

## 1.6.2

## 1.6.1

### Patch Changes

- c25ba18: Fix Indonesian (id) locale interpolation: restore the `{total}`, `{minRows}/{maxRows}/{minCols}/{maxCols}`, and `{label}` placeholders that were renamed or dropped, so the find/replace match count, insert-table validation hint, and line-spacing tooltip render their values instead of literal braces.
- 4a75c5e: Add Indonesian (id) community-maintained locale - 97% Coverage

## 1.6.0

## 1.5.0

## 1.4.0

## 1.3.3

## 1.3.2

## 1.3.1

## 1.3.0

## 1.2.1

## 1.2.0

## 1.1.0

### Minor Changes

- a7f9ac5: Add French locale
- 42ea72d: Track structural edits as OOXML revisions in suggesting mode. Paragraph-break insert/delete, paragraph-property changes, and table row/cell insert/delete/merge are now recorded, round-tripped through DOCX, and shown in the tracked-changes sidebar (React and Vue, localized). Adds `acceptChangeById(id)` / `rejectChangeById(id)`, and `acceptAllChanges` / `rejectAllChanges` now resolve every revision type rather than inline marks only. Fixes #614.

### Patch Changes

- 14fe4f2: add Hindi (hi) community-maintained locale

## 1.0.3

## 1.0.2

## 1.0.1

### Patch Changes

- fe4cb94: Add per-locale subpath imports to `@eigenpal/docx-editor-i18n` so dynamic
  locale loading can code-split a single locale instead of bundling the whole
  set:

  ```ts
  // Static — bundler ships only this locale's strings
  import pl from '@eigenpal/docx-editor-i18n/pl';

  // Dynamic — splits into its own chunk, loaded on demand
  const pl = (await import('@eigenpal/docx-editor-i18n/pl')).default;
  ```

  Subpaths ship for every locale: `/en`, `/de`, `/he`, `/pl`, `/pt-BR`, `/tr`,
  `/zh-CN`. The named exports on the package root still work — pick the
  ergonomic path for static lists, the subpath for runtime locale switching.

  Also re-export `createEmptyDocument`, `createDocumentWithText`, and
  `CreateEmptyDocumentOptions` from `@eigenpal/docx-editor-react` and
  `@eigenpal/docx-editor-vue` so the common "spawn a blank editor"
  affordance no longer requires installing `-core` alongside the adapter.

  Surface `Comment`, `CommentRangeStart`, `CommentRangeEnd`,
  `TrackedChangeInfo`, `TrackedRunChange`, `Insertion`, `Deletion`,
  `MoveFrom`, `MoveTo`, and `ParagraphContent` from the main
  `@eigenpal/docx-editor-core` entry. They were already public via
  `@eigenpal/docx-editor-core/headless`; the main entry just hadn't been
  re-exporting them.

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

- 6b8f1fb: Fill in the last 26 untranslated keys in `de`, `he`, `pl`, `pt-BR`, `tr`, and `zh-CN`. All six community locales now reach 100% coverage against `en.json`.
