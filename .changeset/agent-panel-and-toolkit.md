---
'@eigenpal/docx-js-editor': minor
---

Built-in agent panel + chat primitives + expanded toolkit so consumers can plug a streaming AI agent into the editor in ~50 lines. See [`docs/agents.md`](../docs/agents.md).

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
