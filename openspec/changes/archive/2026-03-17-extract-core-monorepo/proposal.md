## Why

The editor's core (DOCX parsing, ProseMirror schema/extensions/plugins, layout engine, document model) is ~80% of the codebase and already framework-agnostic, but it's bundled in a single package with React UI components. Users of other frameworks (Vue, Svelte, vanilla JS) must either ship React as a dependency or fork the entire project, losing upstream contributions. Extracting the core into a separate package enables a framework-agnostic ecosystem where community members can build wrappers (e.g., Vue) on top of the same core.

## What Changes

- **BREAKING**: Split the single `@eigenpal/docx-js-editor` package into a Bun workspaces monorepo with separate packages
- New `@eigenpal/docx-core` package containing all framework-agnostic code: `src/docx/`, `src/types/`, `src/prosemirror/`, `src/layout-engine/`, `src/layout-painter/`, `src/layout-bridge/`, `src/core-plugins/`, `src/utils/` (non-React parts), `src/agent/`, `src/mcp/`
- `@eigenpal/docx-js-editor` becomes a thin React UI package depending on `@eigenpal/docx-core`, containing: `src/components/`, `src/hooks/`, `src/plugin-api/`, `src/plugins/`, `src/paged-editor/`
- Remove React type leaks from core code paths (e.g., `CSSProperties` imports in utils)
- Split `EditorPlugin` interface into a framework-agnostic core (`EditorPluginCore` in `@eigenpal/docx-core`) and framework-specific adapters (`ReactEditorPlugin` in React package, `VueEditorPlugin` in Vue package)
- Existing `@eigenpal/docx-js-editor` keeps its npm name and download stats — existing users continue using it as before
- Shared build/test/lint configuration at monorepo root

## Capabilities

### New Capabilities

- `monorepo-structure`: Bun workspaces monorepo with `packages/core/`, `packages/react/`, and `packages/vue/` (scaffold), shared tsconfig, build scripts, and dependency management
- `core-package-api`: Public API surface for `@eigenpal/docx-core` — exports for DOCX parsing/serialization, ProseMirror schema/extensions/commands, layout engine, document model types, and headless editor creation
- `cross-framework-plugins`: Framework-agnostic `EditorPluginCore` interface in core with framework-specific adapters (`ReactEditorPlugin`, `VueEditorPlugin`) so plugin logic (ProseMirror plugins, state, styles) is written once and UI rendering (panels, overlays) is provided per framework

### Modified Capabilities

## Impact

- **Package structure**: Single package becomes monorepo with 3 packages (core, react, vue scaffold)
- **npm**: New `@eigenpal/docx-core` package published; `@eigenpal/docx-js-editor` gains `@eigenpal/docx-core` as dependency; `@eigenpal/docx-editor-vue` scaffolded for community contribution
- **Imports**: Internal imports between core and React code change to cross-package imports
- **Build**: `tsup` config splits into per-package builds; CSS build stays in React package
- **Tests**: Playwright E2E tests stay in React package (they test the full editor); unit tests for core logic move to core package
- **CI**: Needs to build/test both packages
- **Dependencies**: `@radix-ui/react-select`, React peer deps move to React package only; ProseMirror, jszip, xml-js, docxtemplater stay in core
- **Downstream**: Vue/Svelte/vanilla consumers can depend on `@eigenpal/docx-core` directly with zero React overhead
