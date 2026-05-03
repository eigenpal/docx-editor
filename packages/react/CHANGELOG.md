# @eigenpal/docx-js-editor

## 0.4.0

### Minor Changes

- 159cad2: **Curated subpath exports + peerDeps move.** Replaces the `./*` wildcard on `@eigenpal/docx-core` with 17 explicit, tree-shakeable subpaths:
  - Top level: `.`, `./headless`, `./core-plugins`, `./mcp`
  - ProseMirror: `./prosemirror`, `./prosemirror/extensions`, `./prosemirror/conversion`, `./prosemirror/commands`, `./prosemirror/plugins`, `./prosemirror/editor.css`
  - DOCX I/O: `./docx`, `./docx/serializer`
  - Headless agent: `./agent`
  - Layout (`@experimental`): `./layout-engine`, `./layout-painter`, `./layout-bridge`, `./plugin-api`
  - Types: `./types/document`, `./types/content`, `./types/agentApi`
  - Utilities: `./utils`

  **Breaking change for consumers**: `prosemirror-*` packages are now `peerDependencies` (in both `@eigenpal/docx-core` and `@eigenpal/docx-js-editor`) so consumer bundles don't end up with duplicate ProseMirror copies. After upgrading you must install them yourself:

  ```bash
  npm i prosemirror-commands prosemirror-dropcursor prosemirror-history \
        prosemirror-keymap prosemirror-model prosemirror-state \
        prosemirror-tables prosemirror-transform prosemirror-view
  ```

  Also breaks the `schema → StarterKit → extensions → schema` circular import that crashed bundled consumers with `X is not a function`. Extensions now receive their owning `ExtensionManager` via `ExtensionContext.manager` instead of reaching for the module-level `singletonManager`. The `singletonManager` is no longer exported from `./prosemirror` — internal commands still get it via the relative `./schema` path inside the package.

### Patch Changes

- 23a2c7e: Add Hebrew (he) locale

## 0.3.1

### Patch Changes

- e92b349: Fix comments sidebar not repositioning when comments are added programmatically (e.g. via the agent `addComment` ref). Cards no longer overlap until you click one — heights are now re-measured whenever the items list changes, mirroring the existing re-measure pass that runs on expand/collapse.

## 0.3.0

### Minor Changes

- fe17e73: Add Open and Save entries to the toolbar's File menu (with Ctrl+O / Ctrl+S labels) so users can import and download DOCX files without leaving the editor. New translation keys (`toolbar.open`, `toolbar.openShortcut`, `toolbar.save`, `toolbar.saveShortcut`) are wired through the i18n system and synced across community locales.

### Patch Changes

- 06cdf53: Agent now reads and searches the vanilla document. Previously, `read_document` showed insertions inlined and hid deletions (the resolved view), while the search backing `add_comment` / `suggest_change` flattened both — so a phrase the agent picked from `read_document` often failed to anchor and the bridge returned `null` with no diagnostic. Now both the read view and the search view treat the document as it exists right now: tracked insertions are hidden (not in the doc until accepted) and tracked deletions are visible as plain text (still in the doc until accepted). Anchoring against text the agent actually saw works on first try.
- beee9a4: Translate agent panel UI strings — wires `AgentPanel`, `AgentChatLog`, `AgentTimeline`, and `AgentComposer` through `t()` and ships full translations for `de`, `pl`, and `pt-BR`. Previously `agentPanel.*` keys were `null` in every non-English locale, and the chat primitives hardcoded strings like "Working… N steps", "Assistant is thinking", "Ask the assistant…", "Send", and "Resize agent panel".
- 69f5ab0: Translate the four File-menu keys (`toolbar.open`, `toolbar.openShortcut`, `toolbar.save`, `toolbar.saveShortcut`) in `de.json`, `pl.json`, and `pt-BR.json` so German, Polish, and Brazilian-Portuguese users see localized labels instead of the English fallback. All three locales are now at 100% coverage.

## 0.2.0

### Minor Changes

- 6094eaf: Built-in agent panel + chat primitives + expanded toolkit so consumers can plug a streaming AI agent into the editor in ~50 lines. See [`docs/agents.md`](../docs/agents.md).

  ### Agent panel
  - `<DocxEditor agentPanel={{ render }}>` — controllable right-hand dock with toolbar toggle, drag-to-resize, persisted width, animated open/close. Render-prop receives `{ close }`; controlled mode (`open` + `onOpenChange`) lets a parent drive it.
  - New `agent-sparkle` icon and i18n keys across en / de / pl / pt-BR.

  ### Chat primitives (opinionated, optional)
  - `<AgentChatLog>`, `<AgentComposer>`, `<AgentSuggestionChip>`, `<AgentTimeline>` — Google-Docs-style UI for message list, composer, starter chips, and a collapsible tool-call timeline (per-row spinner while streaming, auto-collapses to "N steps" on done).
  - New types: `AgentMessage`, `AgentToolCall`.

  ### Toolkit (`@eigenpal/docx-editor-agents`)
  - Four new tools: `apply_formatting`, `set_paragraph_style`, `read_page`, `read_pages`.
  - `useDocxAgentTools` hook with `include` / `exclude` filters; `executeToolCall` enforces them.
  - `AgentToolDefinition.displayName` for friendly UI labels.
  - New subpath exports — package stays runtime-agnostic, AI SDK helpers are opt-in:
    - `/server` — `getToolSchemas`, `executeToolCall`, `getToolDisplayName` (OpenAI function-calling format)
    - `/react` — `useDocxAgentTools`
    - `/ai-sdk/server` — `getAiSdkTools()` returning `streamText({ tools })` shape
    - `/ai-sdk/react` — `toAgentMessages()` adapting `useChat`'s `UIMessage[]` to `AgentMessage[]`
  - `WordCompatBridge` parity contract — compile-time assertion that `EditorBridge` covers `Range.font.*` and `ParagraphFormat.style`.

  ### Bug fixes
  - **Rapid sequential `addComment` calls now all persist.** The unified `setComments` setter read a stale `commentsRef.current` for every call; a 30-comment burst kept only the last. Now assigns `commentsRef.current` synchronously in uncontrolled mode.

  ### Spec / Word-API hardening
  - **`paraId` allocator** — new `ParaIdAllocatorExtension` assigns fresh 8-char hex `w14:paraId`s on Enter / paste / split. Without this the agent's anchors silently drifted whenever the user typed Enter. Marked `addToHistory: false`.
  - **`apply_formatting`** validates `underline.style` against ECMA-376 §17.3.2.40 `ST_Underline` and `highlight` against §17.3.2.15 `ST_HighlightColor`. Out-of-spec values return a structured error instead of round-tripping invalid OOXML.
  - **`set_paragraph_style`** returns `false` for ids not in `styles.xml` — matches Word's `ItemNotFound` behavior.

  ### Public API additions

  `@eigenpal/docx-js-editor`: `<AgentPanel>`, `<AgentChatLog>`, `<AgentComposer>`, `<AgentSuggestionChip>`, `<AgentTimeline>`, matching prop types, `AgentMessage`, `AgentToolCall`. `DocxEditorRef` gains `applyFormatting`, `setParagraphStyle`, `getPageContent`.

  `@eigenpal/docx-editor-agents`: new `/ai-sdk/server` and `/ai-sdk/react` subpaths (peer dep `ai`, optional). `/server` and `/react` unchanged. `displayName` on `AgentToolDefinition`.

  ### Known limitations (v1.1)
  - Missing Word `Range.font.*` properties: `superscript`, `subscript`, `allCaps`, `smallCaps`, `doubleStrikeThrough`, `colorTheme` tint/shade.
  - No paragraph-level mutators (`alignment`, `lineSpacing`, `spaceBefore`, `spaceAfter`) wired through the toolkit yet.

- 9c0721b: Add `disableFindReplaceShortcuts` to `DocxEditor` so host apps can let the browser handle native Cmd/Ctrl+F and Cmd/Ctrl+H shortcuts.
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

- 8dba7e8: # Word-style split button for text + highlight color (issue #130)

  Closes [#130](https://github.com/eigenpal/docx-editor/issues/130).

  The font-color and highlight-color toolbar buttons are now Word-style split buttons. Two halves:
  - **Apply half (icon + swatch):** click to re-apply the last color you picked. No dropdown.
  - **Arrow half (▾):** click to open the full color picker (theme grid, standard colors, custom hex, "no color").

  Pick a color once, then for every subsequent occurrence just click the swatch — one click instead of three.

  ## API surface (consolidated)

  The package previously shipped two color pickers — a simple `ColorPicker` and a fuller `AdvancedColorPicker`. The two have been merged into a single `ColorPicker` with two new props:
  - `splitButton?: boolean` — default `true`. Set `false` to render a legacy single-button shape.
  - `defaultColor?: ColorValue | string` — initial "last picked" color used by the apply half before the user picks anything. Defaults: text → red, highlight → yellow, border → black.

  The "last picked" memory is independent of the current selection's color (matches Word). Picking "Automatic" / "No color" does NOT update it.

  ## Breaking changes
  - The legacy `ColorPicker` (the simpler grid picker that ran inline, not via dropdown) has been **removed**. Its types `ColorOption` and the old `ColorPickerProps` shape are no longer exported.
  - `AdvancedColorPicker` has been **renamed to `ColorPicker`**. Update imports:

    ```diff
    - import { AdvancedColorPicker } from '@eigenpal/docx-js-editor';
    + import { ColorPicker } from '@eigenpal/docx-js-editor';
    ```

    The exported `ColorPickerProps` and `ColorPickerMode` types now correspond to the renamed component (formerly `AdvancedColorPickerProps` / `AdvancedColorPickerMode`).

  - CSS class names changed from `docx-advanced-color-picker-*` → `docx-color-picker-*`. If you targeted these in user CSS overrides, update the selectors.

  ## Migration

  No changes needed inside the library — text-color, highlight-color, table-cell-fill, and table-border-color buttons all use the new `ColorPicker` automatically. If you import `AdvancedColorPicker` directly, switch to `ColorPicker`. If you used the legacy simpler `ColorPicker`, the new `ColorPicker` is a drop-in for any case that benefits from the fuller picker; otherwise build a small custom picker — the legacy one was thin enough to inline.

### Patch Changes

- 71a1836: Replace hardcoded `816` page-width literals in `DocxEditor` with the existing
  `DEFAULT_PAGE_WIDTH` constant exported from `PagedEditor`, and fold the two
  duplicated `pageWidth` fallback expressions into a single `pageWidthPx` value
  shared by `UnifiedSidebar` and `CommentMarginMarkers`.
- f31fd5a: Fix document outline overlap and ruler behavior
  - Outline panel no longer sits on top of the page. On wide viewports the
    page stays where it was (centered, or translated left by the comments
    sidebar) — only the layout's min-width grows so the centered page never
    overlaps the panel. On narrow viewports the page + outline scroll
    horizontally as a unit instead.
  - Outline panel header lines up with the doc's top margin and uses a
    transparent background so the page's left-side shadow stays visible when
    the viewport is squeezed.
  - Vertical ruler stays pinned to the viewport's left edge during horizontal
    scroll instead of scrolling out of view.
  - Horizontal ruler is now sticky inside the scroll container, so it scrolls
    horizontally with the doc and stays put on vertical scroll. Padding tracks
    the outline (right shift) and comments sidebar (left shift) so the ruler
    centers against the same axis as the page.
  - Editor surround uses `--doc-bg` uniformly so the over-scroll/rubber-band
    area matches the gutter.

- 6a0b9a9: Fix crash when accepting a tracked replacement.

  The `paragraphChangeTracker` plugin walked `tr.steps` using each step's raw
  `from`/`to`/`pos` against `tr.doc` (the final doc after every step has been
  applied). Those coords are valid only in the doc as it was _when that step
  ran_, so a later doc-shrinking step could leave the earlier step's coords
  past the final doc end and crash `Fragment.nodesBetween` on
  `undefined.nodeSize`.

  Concretely: `acceptChange` emits `[RemoveMarkStep, ReplaceStep]` when the
  range contains both an `insertion` mark and a `deletion` (a tracked
  replace). The replace shrinks the doc, the mark step's `to` becomes
  invalid in `tr.doc`, and the editor crashes.

  Remap each step's coords through `tr.mapping.slice(stepIndex + 1)` before
  using them with `tr.doc`, and skip steps whose range was fully consumed by
  a later deletion. Adds a regression test reproducing the
  accept-tracked-replacement crash shape.

- 95f8df1: Add Brazilian Portuguese (pt-BR) locale support with 100% translation coverage.

  This PR introduces:
  - New `packages/react/i18n/pt-BR.json` file
  - 619 translated UI strings (100% coverage)
  - Proper locale structure following existing patterns
  - All keys in sync with en.json source

  The translation covers core UI elements including:
  - Common actions (cancel, save, edit, etc.)
  - Toolbar and formatting controls
  - Color picker and dialog interfaces
  - Table operations and context menus
  - Error messages and status indicators

## 0.1.1

### Patch Changes

- 1a9d8eb: Fix caret rendering at the wrong height after changing font size/family in an empty paragraph. The paragraph measurement cache key didn't include `defaultFontSize`/`defaultFontFamily`, so empty paragraphs with different default fonts collided on the same key and the cache returned a stale measurement until the user typed a character.
- 1a9d8eb: Fix font/size/color/highlight changes silently dropping when applied in an empty paragraph (e.g. right after pressing Enter). The mark commands set stored marks before updating the paragraph node, but every transform step clears stored marks — so the chosen value was wiped before dispatch and typed text fell back to the editor default. Reordered so node updates run first.
- 14d7623: ci(release): fix Slack notification release link to use per-package tag (changesets fixed-group ships @eigenpal/docx-js-editor@X.Y.Z, not vX.Y.Z)

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

- bcc9c6d: Fix a regression where clicking the checkmark of a resolved comment did not re-open the comment card (issue #268). `PagedEditor.updateSelectionOverlay` fired `onSelectionChange` from every overlay redraw — including ResizeObserver and layout/font callbacks — not only on actual selection changes. When the sidebar card resize (or any window resize) triggered a redraw, the parent received a spurious callback with the unchanged cursor and cleared the just-set expansion. Dedup by PM state identity (immutable references) so consumers are only notified for real selection / doc / stored-marks changes.

  Also: cursor-based sidebar expansion now skips resolved comments. Moving the cursor through previously-commented text no longer re-opens old resolved threads — they stay collapsed to the checkmark marker until the user explicitly clicks it.

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
