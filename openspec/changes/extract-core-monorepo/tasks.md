## 1. Monorepo Scaffold

- [x] 1.1 Create `packages/core/` and `packages/react/` directories
- [x] 1.2 Add `"workspaces": ["packages/*"]` and `"private": true` to root `package.json`
- [x] 1.3 Create `packages/core/package.json` with name `@eigenpal/docx-core`, dependencies (prosemirror-\*, jszip, pizzip, xml-js, docxtemplater, clsx), and exports config
- [x] 1.4 Create `packages/react/package.json` with name `@eigenpal/docx-js-editor`, dependency on `@eigenpal/docx-core`, peerDependencies (react, react-dom), and `@radix-ui/react-select`
- [x] 1.5 Create `packages/vue/package.json` with name `@eigenpal/docx-editor-vue`, dependency on `@eigenpal/docx-core`, peerDependency on `vue`, and a placeholder `src/index.ts`
- [x] 1.6 Create `packages/core/tsconfig.json`, `packages/react/tsconfig.json`, and `packages/vue/tsconfig.json` extending a shared root tsconfig

## 2. Move Source Files to Core Package

- [x] 2.1 Move `src/docx/` → `packages/core/src/docx/`
- [x] 2.2 Move `src/types/` → `packages/core/src/types/`
- [x] 2.3 Move `src/prosemirror/` → `packages/core/src/prosemirror/`
- [x] 2.4 Move `src/layout-engine/` → `packages/core/src/layout-engine/`
- [x] 2.5 Move `src/layout-painter/` → `packages/core/src/layout-painter/`
- [x] 2.6 Move `src/layout-bridge/` → `packages/core/src/layout-bridge/`
- [x] 2.7 Move `src/core-plugins/` → `packages/core/src/core-plugins/`
- [x] 2.8 Move `src/utils/` → `packages/core/src/utils/`
- [x] 2.9 Move `src/agent/` → `packages/core/src/agent/`
- [x] 2.10 Move `src/mcp/` → `packages/core/src/mcp/`
- [x] 2.11 Move `src/core.ts` and `src/headless.ts` → `packages/core/src/`

## 3. Move Source Files to React Package

- [x] 3.1 Move `src/components/` → `packages/react/src/components/`
- [x] 3.2 Move `src/hooks/` → `packages/react/src/hooks/`
- [x] 3.3 Move `src/plugin-api/` → `packages/react/src/plugin-api/`
- [x] 3.4 Move `src/plugins/` → `packages/react/src/plugins/`
- [x] 3.5 Move `src/paged-editor/` → `packages/react/src/paged-editor/`
- [x] 3.6 Move `src/styles/` → `packages/react/src/styles/`
- [x] 3.7 Move `src/index.ts`, `src/react.ts`, `src/ui.ts`, `src/renderAsync.ts` → `packages/react/src/`
- [x] 3.8 Move `src/lib/` → `packages/react/src/lib/` (React-specific — only used by components)

## 4. Clean Up React Type Leaks in Core

- [x] 4.1 Replace `type CSSProperties from 'react'` in `utils/formatToStyle.ts` with a local type alias
- [x] 4.2 Replace `type CSSProperties from 'react'` in `utils/selectionHighlight.ts` with a local type alias
- [x] 4.3 Verify no remaining `react` or `react-dom` imports in `packages/core/` (use grep)

## 5. Cross-Framework Plugin Abstraction

- [x] 5.1 Create `EditorPluginCore` interface in `packages/core/src/plugin-api/types.ts` with framework-agnostic fields only (`id`, `name`, `proseMirrorPlugins`, `onStateChange`, `initialize`, `destroy`, `styles`, `panelConfig`)
- [x] 5.2 Move `PluginPanelProps` (without `ReactNode` fields), `PanelConfig`, and `RenderedDomContext` to `packages/core/src/plugin-api/`
- [x] 5.3 Export `EditorPluginCore`, `PluginPanelProps`, `PanelConfig`, `RenderedDomContext` from `@eigenpal/docx-core`
- [x] 5.4 Create `ReactEditorPlugin` interface in `packages/react/src/plugin-api/types.ts` extending `EditorPluginCore` with `Panel` (React.ComponentType) and `renderOverlay` (returns ReactNode)
- [ ] 5.5 Update `PluginHost.tsx` in React package to accept `ReactEditorPlugin[]` instead of `EditorPlugin[]` — deferred (EditorPlugin is already aliased to ReactEditorPlugin)
- [ ] 5.6 Update existing template plugin (`packages/react/src/plugins/template/`) to use `ReactEditorPlugin` — deferred (EditorPlugin alias handles backwards compat)
- [x] 5.7 Scaffold `VueEditorPlugin` interface in `packages/vue/src/plugin-api/types.ts` extending `EditorPluginCore` with Vue-specific `Panel` and `renderOverlay` types
- [x] 5.8 Export `ReactEditorPlugin` from `@eigenpal/docx-js-editor` and `VueEditorPlugin` from `@eigenpal/docx-editor-vue`

## 6. Update Internal Imports

- [x] 6.1 Update all imports in `packages/react/` that reference core modules to use `@eigenpal/docx-core` instead of relative paths
- [x] 6.2 Update `packages/react/src/index.ts` to re-export everything from `@eigenpal/docx-core` for backwards compatibility
- [x] 6.3 Create re-export shims (core-reexport.ts, headless-reexport.ts, core-plugins-reexport.ts, mcp-reexport.ts)
- [x] 6.4 Verify all internal imports in `packages/core/` use relative paths within the package

## 7. Build Configuration

- [x] 7.1 Create `packages/core/tsup.config.ts` with entry points (`core.ts`, `headless.ts`, `core-plugins`, `mcp`) and externals
- [x] 7.2 Create `packages/react/tsup.config.ts` with entry points (`index.ts`, `react.ts`, `ui.ts`, re-exports) externalizing `@eigenpal/docx-core`
- [x] 7.3 CSS build already in `packages/react/` build script
- [x] 7.4 Root `build` script builds core first, then react
- [x] 7.5 Root `typecheck` script typechecks all packages
- [x] 7.6 Removed old root `tsup.config.ts`

## 8. Test Infrastructure

- [x] 8.1 Ensure Playwright config resolves imports from both workspace packages
- [x] 8.2 Update Vite dev server config (`examples/vite/vite.config.ts`) to work with workspace packages
- [x] 8.3 Run `bun run typecheck` — fix any type errors from the restructuring
- [x] 8.4 Run targeted Playwright tests (`formatting.spec.ts`, `demo-docx.spec.ts`) to verify no regressions
- [ ] 8.5 Run full test suite as final validation

## 9. Cross-Framework E2E Test Reuse (deferred — implement when Vue package has content)

- [ ] 9.1 Separate test files into shared core tests (editing, formatting, rendering, file loading) and React-specific UI tests (toolbar, dialogs, pickers) — e.g., `tests/shared/` vs `tests/react/`
- [ ] 9.2 Add `react` and `vue` projects to `playwright.config.ts`, each with its own `baseURL` (`localhost:5173` for React, `localhost:5174` for Vue)
- [ ] 9.3 Configure shared tests to run under both projects; React-specific UI tests to run only under `react` project
- [ ] 9.4 Create `examples/vue/` with a minimal Vite + Vue app (`@vitejs/plugin-vue`) that mounts the Vue editor on port 5174
- [ ] 9.5 Verify shared tests pass against React app (`--project=react`)

## 10. Backwards Compatibility Verification

- [x] 10.1 Verify `@eigenpal/docx-js-editor` main export includes all previously exported symbols
- [x] 10.2 Verify subpath exports (`/core`, `/headless`, `/react`, `/ui`, `/core-plugins`, `/mcp`) still work from the React package
- [x] 10.3 Verify `@eigenpal/docx-core` can be imported and used without React installed
- [ ] 10.4 Update root README with new monorepo structure and usage instructions for core package
