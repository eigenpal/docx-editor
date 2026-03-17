## Context

The editor is currently a single npm package (`@eigenpal/docx-js-editor`) with ~80% framework-agnostic code and ~20% React UI. The codebase already has clean internal boundaries — separate entry points (`core.ts`, `headless.ts`, `react.ts`, `ui.ts`) and framework-agnostic directories (`src/docx/`, `src/types/`, `src/prosemirror/`, `src/layout-engine/`, `src/layout-painter/`, `src/layout-bridge/`). A community contributor wants to build a Vue wrapper, which requires the core to be importable without React dependencies.

Current state:

- Single `package.json`, single `tsup.config.ts` building 7 entry points
- React is an optional peer dependency
- Two files in `src/utils/` import `type CSSProperties from 'react'` (type-only)
- `src/plugin-api/types.ts` imports `type ReactNode from 'react'` (type-only)
- ProseMirror packages are direct dependencies
- `@radix-ui/react-select` is a direct dependency (React-only)

## Goals / Non-Goals

**Goals:**

- Extract framework-agnostic core into `@eigenpal/docx-core` with zero React dependencies
- Keep `@eigenpal/docx-js-editor` as the React UI package (preserves npm stats, no migration for existing users)
- Use Bun workspaces for monorepo management (already using Bun as runtime)
- Enable community Vue/Svelte wrappers that depend only on `@eigenpal/docx-core`
- Maintain a single repo, single CI pipeline

**Non-Goals:**

- Building the Vue package (community contribution)
- Splitting into more than 2 packages (core + react is sufficient; no separate layout/prosemirror packages)
- Changing any public API signatures
- Migrating build tool away from tsup

## Decisions

### 1. Two packages, not more

**Decision:** Split into exactly `@eigenpal/docx-core` and `@eigenpal/docx-js-editor` (React).

**Rationale:** More packages (separate layout, prosemirror, UI packages) adds versioning complexity without clear benefit. The Vue contributor needs one clean core dependency. Two packages is the minimum viable split.

**Alternative considered:** 4+ packages (core, layout, prosemirror, react, ui). Rejected — too much coordination overhead for the current project size.

### 2. Bun workspaces (not turborepo/nx/lerna)

**Decision:** Use Bun's native workspaces feature.

**Rationale:** Already using Bun as runtime. Bun workspaces are simple (`"workspaces"` field in root `package.json`) and require no additional tooling. Sufficient for 2 packages.

**Alternative considered:** Turborepo for caching. Rejected — overkill for 2 packages, adds dependency.

### 3. Keep existing package name for React

**Decision:** `@eigenpal/docx-js-editor` stays as the React package name. No rename.

**Rationale:** Preserves npm download stats, existing users don't need to migrate, no deprecation dance.

### 4. What goes in core vs react

**Core (`@eigenpal/docx-core`):**

- `src/docx/` — DOCX parsing, serialization, XML handling
- `src/types/` — document model types
- `src/prosemirror/` — schema, extensions, plugins, commands, conversions
- `src/layout-engine/` — pagination algorithm
- `src/layout-painter/` — vanilla DOM rendering
- `src/layout-bridge/` — hit-testing, position mapping
- `src/core-plugins/` — plugin registry
- `src/utils/` — all utilities (with React type leaks cleaned up)
- `src/agent/` — DocumentAgent API
- `src/mcp/` — MCP server tools
- Entry points: `core.ts`, `headless.ts`

**React (`@eigenpal/docx-js-editor`):**

- `src/components/` — React UI components (toolbar, dialogs, pickers)
- `src/hooks/` — React hooks
- `src/plugin-api/` — PluginHost React component
- `src/plugins/` — template plugin with React overlays
- `src/paged-editor/` — PagedEditor, HiddenProseMirror, SelectionOverlay (React components)
- `src/styles/` — CSS
- Entry points: `index.ts`, `react.ts`, `ui.ts`

**Rationale:** ProseMirror itself is framework-agnostic (vanilla JS library). The PM extensions, schema, and commands have zero React imports. Only the React wrappers (`HiddenProseMirror.tsx`, `PagedEditor.tsx`) need React. A Vue wrapper would create its own equivalents of these ~4 React components while reusing all the PM logic from core.

### 5. Handle React type leaks

**Decision:** Replace `type CSSProperties from 'react'` with a local type alias `Record<string, string | number>` or extract from `csstype` (which React itself uses internally).

**Rationale:** These are type-only imports that don't affect runtime bundles, but they create a conceptual dependency that confuses the boundary. Clean them up for correctness.

### 6. Internal cross-package imports

**Decision:** React package imports from `@eigenpal/docx-core` (the npm package name), not relative paths.

**Rationale:** Bun workspaces resolve workspace packages by name. This ensures the React package treats core as a proper dependency, matching what external consumers see.

### 7. Build setup

**Decision:** Each package has its own `tsup.config.ts` and `package.json`. Root `package.json` defines workspaces and shared scripts.

**Rationale:** Per-package builds are independent, can be run in parallel, and each package controls its own entry points and externals.

### 8. Cross-framework plugin abstraction

**Decision:** Split the current `EditorPlugin` interface into a framework-agnostic core and framework-specific adapters.

**Core interface (`@eigenpal/docx-core`):**

```typescript
interface EditorPluginCore<TState = any> {
  id: string;
  name: string;
  proseMirrorPlugins?: ProseMirrorPlugin[]; // framework-agnostic
  onStateChange?: (view: EditorView) => TState | undefined;
  initialize?: (view: EditorView | null) => TState;
  destroy?: () => void;
  styles?: string;
  panelConfig?: PanelConfig;
}
```

**React adapter (`@eigenpal/docx-js-editor`):**

```typescript
interface ReactEditorPlugin<TState = any> extends EditorPluginCore<TState> {
  Panel?: React.ComponentType<PluginPanelProps<TState>>;
  renderOverlay?: (
    context: RenderedDomContext,
    state: TState,
    view: EditorView | null
  ) => ReactNode;
}
```

**Vue adapter (`@eigenpal/docx-editor-vue`):**

```typescript
interface VueEditorPlugin<TState = any> extends EditorPluginCore<TState> {
  Panel?: DefineComponent<PluginPanelProps<TState>>;
  renderOverlay?: (context: RenderedDomContext, state: TState, view: EditorView | null) => VNode;
}
```

**What moves where:**

- `EditorPluginCore`, `PanelConfig`, `PluginPanelProps` (without ReactNode), `RenderedDomContext` → `@eigenpal/docx-core`
- `PluginHost.tsx` stays in React package as `ReactPluginHost` — renders `Panel` as React components
- Vue package builds its own `VuePluginHost` — renders `Panel` as Vue components
- `CorePlugin` (headless command/MCP system) stays in core unchanged — already framework-agnostic

**Plugin authoring pattern:**
A plugin author writes the core logic once (PM plugins, state, styles), then provides a thin framework-specific UI:

```typescript
// Shared core logic (in a plugin package or inline)
const templatePluginCore: EditorPluginCore<TemplateState> = {
  id: 'template',
  proseMirrorPlugins: [createTemplatePlugin()],
  onStateChange: (view) => getTemplateState(view),
  styles: templateCSS,
  panelConfig: { position: 'right', defaultWidth: 280 },
};

// React version
const templatePluginReact: ReactEditorPlugin<TemplateState> = {
  ...templatePluginCore,
  Panel: AnnotationPanel,           // React component
  renderOverlay: (ctx, state) => <TemplateHighlightOverlay ... />,
};

// Vue version
const templatePluginVue: VueEditorPlugin<TemplateState> = {
  ...templatePluginCore,
  Panel: VueAnnotationPanel,       // Vue component
  renderOverlay: (ctx, state) => h(VueTemplateHighlightOverlay, ...),
};
```

**Rationale:** The current `EditorPlugin` interface is tightly coupled to React via `Panel` (React.ComponentType) and `renderOverlay` (returns ReactNode). But the core logic — PM plugins, state management, event handling, CSS — is already framework-agnostic. Splitting the interface lets plugin authors share ~80% of their plugin code across frameworks.

**Alternative considered:** A framework-agnostic rendering approach (e.g., plugins return vanilla DOM elements instead of React/Vue components). Rejected — this would sacrifice the DX of using each framework's component model for building panels and overlays. The thin adapter approach keeps the best of both worlds.

### 9. Cross-framework E2E test reuse via Playwright projects

**Decision:** Split tests into shared core tests and framework-specific UI tests. Use Playwright's `projects` config to run shared tests against both React and Vue apps on different ports.

**Rationale:** The Playwright tests don't test React internals — they interact with the browser DOM (clicking, typing, checking rendered output). Since both React and Vue render the same core (same ProseMirror instance, same layout painter DOM output), ~60-70% of tests are reusable as-is. Only toolbar/dialog tests are framework-specific.

**Structure:**

```
tests/
  shared/        ← formatting, editing, rendering, file loading (run against both)
  react/         ← toolbar, dialogs, pickers (React-specific)
  vue/           ← Vue-specific UI tests (contributor adds these)

playwright.config.ts:
  projects:
    - name: react,  baseURL: http://localhost:5173
    - name: vue,    baseURL: http://localhost:5174

examples/
  vite/          ← React dev app (port 5173)
  vue/           ← Vue dev app (port 5174, Vite + @vitejs/plugin-vue)
```

**Alternative considered:** Separate test suites per framework. Rejected — duplicates effort, core behavior should be tested identically.

## Risks / Trade-offs

**[Risk] Internal import churn** → Files that currently do `../docx/parser` will need `@eigenpal/docx-core` imports. Mitigation: batch find-and-replace, verify with typecheck.

**[Risk] Circular dependencies between packages** → Core must not import from React package. Mitigation: the current code already respects this boundary (core modules don't import React components). Verify with a "no-import" lint rule.

**[Risk] Dev experience regression** → Working across two packages can be slower. Mitigation: Bun workspaces auto-link local packages; `bun run dev` from root can start both.

**[Risk] Test infrastructure split** → Playwright E2E tests need the full editor (core + react). Mitigation: E2E tests stay in a top-level `tests/` directory (or in the React package) and import both packages. Core gets its own unit tests.

**[Trade-off] Two package releases instead of one** → Accepted. Core will change less frequently than React UI, so this is manageable.
