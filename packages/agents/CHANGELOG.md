# @eigenpal/docx-editor-agents

## 1.8.1

## 1.8.0

### Patch Changes

- 274e45f: `applyReview` now reports when a batch accept/reject id is note-resident. An id that lives only inside a footnote or endnote previously surfaced as a bare "Tracked change not found", giving no hint the id exists but isn't body-mutable here. It now returns a message saying the change is inside a footnote/endnote and must be resolved through the note-targeting accept/reject API. Batch ids stay document-body-scoped — this sharpens the error only and is fully backward-compatible (the new note stores are passed internally and optional).

## 1.7.0

### Patch Changes

- 2dedf30: The agent bridge now re-exports the paragraph-flash option types (`ParagraphHighlightOptions`, `ScrollToParaIdOptions`) from `@eigenpal/docx-editor-core` instead of redeclaring them, so the two definitions can't drift. No change to the public API surface.
- 6b1897a: Fix `DocxReviewer.getChanges()` dropping a tracked change when two changes in different paragraphs share a revision id (Word reuses `w:id` across paragraphs), which made the enumerated change list disagree with the count from `acceptAll`/`rejectAll`.

## 1.6.2

## 1.6.1

### Patch Changes

- 7c1d1ff: Reach paragraphs inside table cells from the headless review tools. `find_text`, `suggest_change`, and `add_comment` now locate and edit paragraphs in `w:tbl > w:tr > w:tc > w:p`, addressed by the same paraId / ordinal index as body paragraphs, so a tracked change can be authored inside a table cell.

## 1.6.0

### Minor Changes

- a6a2dd0: Add an `insert_break` agent/MCP tool (and `bridge.insertBreak` / editor `insertBreak` ref method) so agents can insert a page break or a section break (next page / continuous) after a paragraph.

## 1.5.0

### Minor Changes

- c4fd221: `DocxReviewer` can now accept/reject tracked changes inside footnote and endnote bodies. Pass a `ReviewChange` from `getChanges` (it carries `noteId`/`noteType`) to `acceptChange`/`rejectChange` to resolve a change wherever it lives, or use `acceptAll`/`rejectAll` with `{ includeFootnotes, includeEndnotes }` to resolve note changes in bulk. The result persists through `toBuffer()`. Previously these methods operated on the document body only; the numeric `acceptChange(id)` form is unchanged.

## 1.4.0

## 1.3.3

## 1.3.2

## 1.3.1

## 1.3.0

### Minor Changes

- 1be9cf5: Edit and track-change footnote and endnote bodies.

  Note bodies are now serialized on save, so edits and tracked changes (`w:ins` /
  `w:del`) inside footnotes and endnotes persist instead of being dropped — the
  run model preserves the separator markers and the in-body auto-number marks, and
  `repackDocx` writes `word/footnotes.xml` / `word/endnotes.xml` from the model.
  `DocxReviewer.getChanges()` gains `includeFootnotes` / `includeEndnotes` options;
  when set, tracked changes inside note bodies are reported with `noteId` /
  `noteType`.

## 1.2.1

### Patch Changes

- a0adf60: Headless agent bridge: paragraphs with no `w14:paraId` are now addressable. `read_document` already labels such paragraphs by their ordinal index, but the bridge only registered paragraphs that carried a paraId — so every paraId-anchored op (comments, tracked changes, and formatting/style) rejected the id the agent was given, and `find_text` skipped those paragraphs entirely. Documents without paraIds (common in Word output) were effectively read-only through the bridge. The bridge now keys those paragraphs by the same ordinal index it reports, and `find_text` surfaces them with that ordinal id — so a phrase it returns is anchorable by the mutate tools.

## 1.2.0

## 1.1.0

### Minor Changes

- 7a91813: Add headless reviewer formatting and paragraph style edits
- 42ea72d: Track structural edits as OOXML revisions in suggesting mode. Paragraph-break insert/delete, paragraph-property changes, and table row/cell insert/delete/merge are now recorded, round-tripped through DOCX, and shown in the tracked-changes sidebar (React and Vue, localized). Adds `acceptChangeById(id)` / `rejectChangeById(id)`, and `acceptAllChanges` / `rejectAllChanges` now resolve every revision type rather than inline marks only. Fixes #614.

## 1.0.3

## 1.0.2

## 1.0.1

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

- c5125ff: Wire API Extractor on `@eigenpal/docx-editor-agents/server`. Tag the 11 public exports with `@public`. Commits the first `etc/agents-server.api.md` snapshot; CI now fails on undocumented public-surface drift via `bun run api:check`. No runtime change.
- f7b8dc7: Move the source folder from `packages/agent-use` to `packages/agents` so it matches the published npm name (`@eigenpal/docx-editor-agents`). The npm package name, version, exports, and import paths are unchanged — no consumer action needed.

## 0.5.1

## 0.5.0

## 0.4.3

## 0.4.2

## 0.4.1

## 0.4.0

## 0.3.1

## 0.3.0

## 0.2.0

### Minor Changes

- c81fdd3: # Live agent chat + server-side MCP support

  A Word-API-style bridge that lets an AI agent read a DOCX, comment on it, suggest tracked changes, and scroll the view — live in a running editor, or server-side against a parsed file. Same tool catalog, same shape, two transports.

  ## The pattern

  Locate, then mutate. The agent calls a locate tool (`read_document`, `read_selection`, `find_text`) which returns paragraphs tagged with their stable Word `w14:paraId`. It passes those paraIds to mutate tools. paraIds survive concurrent edits and tool-loop iterations; ordinal indices don't.

  ## Ten agent tools

  OpenAI function-calling format (also accepted by Anthropic / Vercel AI SDK):
  - **Locate** — `read_document`, `read_selection`, `find_text`, `read_comments`, `read_changes`
  - **Mutate** — `add_comment`, `suggest_change` (one tool, three modes via empty-string semantics: replacement / deletion / insertion at paragraph end), `reply_comment`, `resolve_comment`
  - **Navigate** — `scroll`

  Exported from `@eigenpal/docx-editor-agents` as `agentTools`, `getToolSchemas()`, `executeToolCall(name, args, bridge)`.

  ## Two bridges, same interface

  Everything wires into an `EditorBridge` interface. Two implementations ship:

  ```ts
  // Live editor in a browser
  import { useAgentChat } from '@eigenpal/docx-editor-agents/bridge';
  const { executeToolCall, toolSchemas } = useAgentChat({ editorRef, author: 'AI' });

  // Server-side, against a parsed DOCX
  import { DocxReviewer, createReviewerBridge } from '@eigenpal/docx-editor-agents';
  const reviewer = await DocxReviewer.fromBuffer(buffer, 'AI');
  const bridge = createReviewerBridge(reviewer);
  const result = executeToolCall('add_comment', { paraId, text }, bridge);
  ```

  Both expose the same 10 tools to the agent. The bridge layer abstracts the transport.

  ## MCP server (built-in, spec 2025-06-18)

  ```ts
  import { McpServer, createReviewerBridge, DocxReviewer } from '@eigenpal/docx-editor-agents';
  import { McpServer as _ } from '@eigenpal/docx-editor-agents/mcp';

  const server = new McpServer(bridge, { name: 'my-saas', version: '1.0.0' });
  const reply = server.handle(jsonRpcMessage); // sync, transport-free, never throws
  ```

  - **Transport-agnostic core**: wire `server.handle()` to HTTP-SSE, WebSocket, your queue worker, or a managed stdio process. The library does not pick a transport.
  - **stdio adapter** for customers who want to run the server inside a worker pool: `runStdioServer(bridge)` (Node-only).
  - **Spec compliance**: `initialize` / `tools/list` / `tools/call` / `ping`. Tool failures use the spec's `{isError: true, content: [...]}` envelope inside a successful JSON-RPC response; JSON-RPC errors are reserved for protocol-level problems. Includes UTF-8-safe chunk decoding (multi-byte codepoints don't break across stdio chunks) and a buffer cap to prevent memory DoS.

  A local-install stdio bin was prototyped and removed: one-document-per-config is the wrong shape for a contract-review product. The right deployment is a hosted MCP service the customer operates with their own auth + storage.

  ## Events

  `bridge.onContentChange(listener)` and `bridge.onSelectionChange(listener)` (both return unsubscribe functions) let host apps and MCP servers react to edits without owning the single React callback prop.
  - `ContentChangeEvent` ships `{ commentCount, changeCount, comments, changes }`.
  - `SelectionChangeEvent` ships the current `SelectionInfo` or `null`. (Reviewer bridge: never fires — no caret in headless mode.)

  ## New on `DocxEditorRef`

  ```ts
  addComment({ paraId, text, author, search? }) → number | null
  replyToComment(commentId, text, author)        → number | null
  resolveComment(commentId)                       → void
  proposeChange({ paraId, search, replaceWith, author }) → boolean
  findInDocument(query, { caseSensitive?, limit? }) → FoundMatch[]
  getSelectionInfo()                              → SelectionInfo | null
  getComments()                                   → Comment[]
  onContentChange(listener)                       → () => void
  onSelectionChange(listener)                     → () => void
  ```

  `scrollToParaId` was already public.

  ## New on `@eigenpal/docx-core`

  `findParagraphByParaId(doc, paraId)` returns the PM range for a paragraph by paraId.

  ## Word JS API parity contract

  `WordCompatBridge` (exported type from the package root) formally documents every Office.js Word API method we mirror. A compile-time static assertion enforces that `EditorBridge` satisfies it. If we drop or change a method that's part of the public Word-API mirror, typecheck breaks.

  ## Demos
  - **`examples/agent-use-demo` (roast-my-doc)** — server-side demo of the canonical "build your own MCP-shaped agent server" pattern: parse → `createReviewerBridge` → `agentTools` → tool-call loop with `executeToolCall` → `toBuffer()`. The route's preamble shows the one-line diff to convert it to a real MCP server.
  - **`examples/agent-chat-demo` (chat with your doc)** — live editor + chat panel. Demonstrates `useAgentChat` against a running `<DocxEditor>`.

  Both demos support `ALLOWED_ORIGINS` env var for production deployments (open by default for local dev), forward client `AbortSignal` to OpenAI calls, and cap upload size.

  ## Hardening
  - `proposeChange` refuses to layer onto an existing tracked-change run (would produce invalid OOXML).
  - Ambiguous `search` arguments return an error instead of silently mistargeting.
  - `scroll` does not steal the user's caret.
  - Comment IDs and tracked-change revisionIds use the shared monotonic counter to avoid collisions in OOXML.
  - Mark guards if a host StarterKit omits `comment` / `insertion` / `deletion` extensions.

  ## Spec

  `specs/live-agent-chat.md`.

## 0.1.1

## 0.1.0

### Minor Changes

- 91a6f97: Add `fontFamilies` prop to `DocxEditor` to customize the toolbar's font dropdown.

  Pass either bare strings or full `FontOption` objects (or a mix). Strings render in the "Other" group; `FontOption[]` enables CSS fallback chains and category grouping. Omitting the prop preserves the existing 12-font default. Closes #278.

  ```tsx
  <DocxEditor
    fontFamilies={[
      'Arial',
      { name: 'Roboto', fontFamily: 'Roboto, sans-serif', category: 'sans-serif' },
    ]}
  />
  ```

### Patch Changes

- b10a517: Fix three toolbar tooltips/labels that ignored the `i18n` prop and rendered as English regardless of locale: the comments-sidebar toggle, the outline-toggle button, and the Editing / Suggesting / Viewing mode dropdown (including its descriptions). The translation keys already existed in `de.json` and `pl.json`; the components were just bypassing `useTranslation()`. Now wired through correctly.

## 0.0.35

### Patch Changes

- 4e20b77: Add `DocxReviewer.removeComment(id)` — removes a comment (and its replies when called on a top-level thread) along with its anchored range markers. Closes #252.

## 0.0.34

### Patch Changes

- ce89e70: Yjs collab

## 0.0.33

### Patch Changes

- Add i18n

## 0.0.32

### Patch Changes

- Fixes with comments and tracked changes

## 0.0.31

### Patch Changes

- [`d77716f`](https://github.com/eigenpal/docx-editor/commit/d77716f3abc8580ca48d9e2280f6564ce17df443) Thanks [@jedrazb](https://github.com/jedrazb)! - Bump

## 0.0.30

### Patch Changes

- Bump

## 0.0.29

### Patch Changes

- Bump to patch

## 0.0.28

### Patch Changes

- Bump packages
