## 1. Monorepo Scaffold

- [ ] 1.1 Create `packages/core/` and `packages/react/` directories
- [ ] 1.2 Add `"workspaces": ["packages/*"]` and `"private": true` to root `package.json`
- [ ] 1.3 Create `packages/core/package.json` with name `@eigenpal/docx-core`, dependencies (prosemirror-\*, jszip, pizzip, xml-js, docxtemplater, clsx), and exports config
- [ ] 1.4 Create `packages/react/package.json` with name `@eigenpal/docx-js-editor`, dependency on `@eigenpal/docx-core`, peerDependencies (react, react-dom), and `@radix-ui/react-select`
- [ ] 1.5 Create `packages/vue/package.json` with name `@eigenpal/docx-editor-vue`, dependency on `@eigenpal/docx-core`, peerDependency on `vue`, and a placeholder `src/index.ts`
- [ ] 1.6 Create `packages/core/tsconfig.json`, `packages/react/tsconfig.json`, and `packages/vue/tsconfig.json` extending a shared root tsconfig

## 2. Move Source Files to Core Package

- [ ] 2.1 Move `src/docx/` → `packages/core/src/docx/`
- [ ] 2.2 Move `src/types/` → `packages/core/src/types/`
- [ ] 2.3 Move `src/prosemirror/` → `packages/core/src/prosemirror/`
- [ ] 2.4 Move `src/layout-engine/` → `packages/core/src/layout-engine/`
- [ ] 2.5 Move `src/layout-painter/` → `packages/core/src/layout-painter/`
- [ ] 2.6 Move `src/layout-bridge/` → `packages/core/src/layout-bridge/`
- [ ] 2.7 Move `src/core-plugins/` → `packages/core/src/core-plugins/`
- [ ] 2.8 Move `src/utils/` → `packages/core/src/utils/`
- [ ] 2.9 Move `src/agent/` → `packages/core/src/agent/`
- [ ] 2.10 Move `src/mcp/` → `packages/core/src/mcp/`
- [ ] 2.11 Move `src/core.ts` and `src/headless.ts` → `packages/core/src/`

## 3. Move Source Files to React Package

- [ ] 3.1 Move `src/components/` → `packages/react/src/components/`
- [ ] 3.2 Move `src/hooks/` → `packages/react/src/hooks/`
- [ ] 3.3 Move `src/plugin-api/` → `packages/react/src/plugin-api/`
- [ ] 3.4 Move `src/plugins/` → `packages/react/src/plugins/`
- [ ] 3.5 Move `src/paged-editor/` → `packages/react/src/paged-editor/`
- [ ] 3.6 Move `src/styles/` → `packages/react/src/styles/`
- [ ] 3.7 Move `src/index.ts`, `src/react.ts`, `src/ui.ts`, `src/renderAsync.ts` → `packages/react/src/`
- [ ] 3.8 Move `src/lib/` → `packages/react/src/lib/` (if React-specific) or `packages/core/src/lib/`

## 4. Clean Up React Type Leaks in Core

- [ ] 4.1 Replace `type CSSProperties from 'react'` in `utils/formatToStyle.ts` with a local type alias
- [ ] 4.2 Replace `type CSSProperties from 'react'` in `utils/selectionHighlight.ts` with a local type alias
- [ ] 4.3 Verify no remaining `react` or `react-dom` imports in `packages/core/` (use grep)

## 5. Cross-Framework Plugin Abstraction

- [ ] 5.1 Create `EditorPluginCore` interface in `packages/core/src/plugin-api/types.ts` with framework-agnostic fields only (`id`, `name`, `proseMirrorPlugins`, `onStateChange`, `initialize`, `destroy`, `styles`, `panelConfig`)
- [ ] 5.2 Move `PluginPanelProps` (without `ReactNode` fields), `PanelConfig`, and `RenderedDomContext` to `packages/core/src/plugin-api/`
- [ ] 5.3 Export `EditorPluginCore`, `PluginPanelProps`, `PanelConfig`, `RenderedDomContext` from `@eigenpal/docx-core`
- [ ] 5.4 Create `ReactEditorPlugin` interface in `packages/react/src/plugin-api/types.ts` extending `EditorPluginCore` with `Panel` (React.ComponentType) and `renderOverlay` (returns ReactNode)
- [ ] 5.5 Update `PluginHost.tsx` in React package to accept `ReactEditorPlugin[]` instead of `EditorPlugin[]`
- [ ] 5.6 Update existing template plugin (`packages/react/src/plugins/template/`) to use `ReactEditorPlugin` — verify no behavioral changes
- [ ] 5.7 Scaffold `VueEditorPlugin` interface in `packages/vue/src/plugin-api/types.ts` extending `EditorPluginCore` with Vue-specific `Panel` and `renderOverlay` types
- [ ] 5.8 Export `ReactEditorPlugin` from `@eigenpal/docx-js-editor` and `VueEditorPlugin` from `@eigenpal/docx-editor-vue`

## 6. Update Internal Imports

- [ ] 6.1 Update all imports in `packages/react/` that reference core modules to use `@eigenpal/docx-core` instead of relative paths
- [ ] 6.2 Update `packages/react/src/index.ts` to re-export everything from `@eigenpal/docx-core` for backwards compatibility
- [ ] 6.3 Update `packages/react/src/react.ts` and `src/ui.ts` entry points for new paths
- [ ] 6.4 Verify all internal imports in `packages/core/` use relative paths within the package

## 7. Build Configuration

- [ ] 7.1 Create `packages/core/tsup.config.ts` with entry points (`core.ts`, `headless.ts`) and externals
- [ ] 7.2 Create `packages/react/tsup.config.ts` with entry points (`index.ts`, `react.ts`, `ui.ts`) externalizing `@eigenpal/docx-core`
- [ ] 7.3 Move CSS build (`tailwindcss` command) to `packages/react/` build script
- [ ] 7.4 Add root-level `build` script that builds core first, then react
- [ ] 7.5 Add root-level `typecheck` script that typechecks all packages
- [ ] 7.6 Update or remove the old root `tsup.config.ts`

## 8. Test Infrastructure

- [ ] 8.1 Ensure Playwright config resolves imports from both workspace packages
- [ ] 8.2 Update Vite dev server config (`examples/vite/vite.config.ts`) to work with workspace packages
- [ ] 8.3 Run `bun run typecheck` — fix any type errors from the restructuring
- [ ] 8.4 Run targeted Playwright tests (`formatting.spec.ts`, `demo-docx.spec.ts`) to verify no regressions
- [ ] 8.5 Run full test suite as final validation

## 9. Cross-Framework E2E Test Reuse

- [ ] 9.1 Separate test files into shared core tests (editing, formatting, rendering, file loading) and React-specific UI tests (toolbar, dialogs, pickers) — e.g., `tests/shared/` vs `tests/react/`
- [ ] 9.2 Add `react` and `vue` projects to `playwright.config.ts`, each with its own `baseURL` (`localhost:5173` for React, `localhost:5174` for Vue)
- [ ] 9.3 Configure shared tests to run under both projects; React-specific UI tests to run only under `react` project
- [ ] 9.4 Create `examples/vue/` with a minimal Vite + Vue app (`@vitejs/plugin-vue`) that mounts the Vue editor on port 5174
- [ ] 9.5 Verify shared tests pass against React app (`--project=react`)

## 10. Backwards Compatibility Verification

- [ ] 10.1 Verify `@eigenpal/docx-js-editor` main export includes all previously exported symbols
- [ ] 10.2 Verify subpath exports (`/core`, `/headless`, `/react`, `/ui`, `/core-plugins`, `/mcp`) still work from the React package
- [ ] 10.3 Verify `@eigenpal/docx-core` can be imported and used without React installed
- [ ] 10.4 Update root README with new monorepo structure and usage instructions for core package
