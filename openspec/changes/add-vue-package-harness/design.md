## Context

The monorepo already has:

- `packages/vue/` — a scaffold with `renderAsync` (throws "not implemented") and plugin types
- `examples/vue/` — a Vite app with `@vitejs/plugin-vue`, port 5174, alias config pointing at source — but shows a static "coming soon" page
- `packages/core/` — framework-agnostic core with `EditorCoordinator`, managers, ProseMirror extensions, layout-painter, and the full parsing/serialization pipeline
- `packages/react/` — the reference implementation with `DocxEditor`, `PagedEditor`, `HiddenProseMirror`, toolbar, and hooks

The React editor's architecture: `DocxEditor` (orchestrator) → `PagedEditor` (visible pages + selection mapping) → `HiddenProseMirror` (off-screen PM instance). All rendering goes through `layout-painter` which is pure DOM manipulation (framework-agnostic).

## Goals / Non-Goals

**Goals:**

- Add `bun run dev:vue` to root package.json, starting Vue example on port 5174
- Create a minimal `DocxEditorVue` component that renders a DOCX with toolbar and basic editing
- Update `examples/vue/App.vue` to a working demo (open file, new document, save/download)
- Keep it minimal — a contributor-friendly harness, not feature parity with React

**Non-Goals:**

- Full feature parity with the React editor (find/replace, plugins, context menus, zoom control, ruler)
- Vue-specific implementations of all React hooks (useAutoSave, useTableSelection, etc.)
- Publishing `@eigenpal/docx-editor-vue` to npm
- Tests for the Vue package (can be added by contributors later)
- Mobile responsive layout in the Vue demo

## Decisions

### 1. Wrap layout-painter directly, not through React components

The React editor's `PagedEditor` and `HiddenProseMirror` are React components that manage DOM directly. Since `layout-painter` is pure DOM manipulation and ProseMirror manages its own DOM, the Vue component can:

- Create a hidden PM view in `onMounted`
- Use `layout-painter/renderPage.ts` to paint visible pages into a container div
- Handle click-to-position mapping same as React does

**Alternative considered:** Port React components to Vue line-by-line. Rejected — too much work for a harness, and contributors should design Vue-idiomatic patterns.

### 2. Single-file component approach

One `DocxEditorVue.vue` SFC that:

- Accepts props: `documentBuffer`, `document`, `showToolbar`, `readOnly`, `initialZoom`
- Emits: `change`, `error`, `fontsLoaded`
- Exposes ref methods: `save()`, `getDocument()`, `focus()`
- Uses `@eigenpal/docx-core` imports for parsing, PM setup, and layout painting

This keeps the harness self-contained. Contributors can later extract composables.

### 3. Reuse the React toolbar as-is (skip for minimal harness)

The toolbar is a complex React component. For the minimal harness, we'll render the ProseMirror menubar plugin or skip toolbar entirely and let the hidden PM instance handle keyboard shortcuts. Contributors can build a Vue toolbar later.

**Decision:** Include a basic Vue toolbar with essential formatting (bold, italic, underline, alignment) using direct ProseMirror commands. This gives contributors a working pattern to extend.

### 4. Port structure mirrors React but stays minimal

```
packages/vue/src/
  components/
    DocxEditorVue.vue    — Main editor component
    BasicToolbar.vue     — Minimal toolbar (B/I/U, alignment)
  composables/
    useDocxEditor.ts     — Core editor lifecycle (parse, PM, layout-painter)
  index.ts               — Updated exports
  renderAsync.ts         — Implement using DocxEditorVue
  plugin-api/types.ts    — Unchanged
```

## Risks / Trade-offs

- **[Risk] Layout-painter integration may need React-specific assumptions removed** → Mitigation: layout-painter is pure DOM; the React coupling is only in PagedEditor.tsx which we're not using. We'll call the same functions directly.
- **[Risk] Contributor confusion about what's "done" vs "harness"** → Mitigation: Clear TODO comments and a README section listing what's implemented vs what needs work.
- **[Risk] ProseMirror CSS may clash with Vue scoped styles** → Mitigation: Use unscoped styles or import the existing editor.css from core.
