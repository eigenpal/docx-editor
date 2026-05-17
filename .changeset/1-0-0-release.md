---
'@eigenpal/docx-editor-react': major
'@eigenpal/docx-editor-core': major
'@eigenpal/docx-editor-agents': major
'@eigenpal/docx-editor-vue': major
'@eigenpal/docx-editor-i18n': major
---

# 1.0.0

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
