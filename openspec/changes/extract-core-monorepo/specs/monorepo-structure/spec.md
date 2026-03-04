## ADDED Requirements

### Requirement: Bun workspaces monorepo structure

The repository SHALL be organized as a Bun workspaces monorepo with a root `package.json` containing a `"workspaces"` field pointing to `packages/*`.

#### Scenario: Root package.json defines workspaces

- **WHEN** a developer clones the repository
- **THEN** the root `package.json` SHALL contain `"workspaces": ["packages/*"]`
- **AND** the root `package.json` SHALL have `"private": true`
- **AND** running `bun install` from the root SHALL install dependencies for all packages

### Requirement: Core package directory structure

The `packages/core/` directory SHALL contain all framework-agnostic source code with its own `package.json` named `@eigenpal/docx-core`.

#### Scenario: Core package contains framework-agnostic modules

- **WHEN** inspecting `packages/core/src/`
- **THEN** it SHALL contain the directories: `docx/`, `types/`, `prosemirror/`, `layout-engine/`, `layout-painter/`, `layout-bridge/`, `core-plugins/`, `utils/`, `agent/`, `mcp/`
- **AND** it SHALL contain entry points: `core.ts`, `headless.ts`
- **AND** no file in the package SHALL have a runtime import of `react` or `react-dom`

#### Scenario: Core package.json declares correct dependencies

- **WHEN** inspecting `packages/core/package.json`
- **THEN** dependencies SHALL include: prosemirror packages, jszip, pizzip, xml-js, docxtemplater, clsx
- **AND** `react` and `react-dom` SHALL NOT appear in dependencies or peerDependencies

### Requirement: React package directory structure

The `packages/react/` directory SHALL contain all React-dependent source code with its own `package.json` named `@eigenpal/docx-js-editor`.

#### Scenario: React package contains UI modules

- **WHEN** inspecting `packages/react/src/`
- **THEN** it SHALL contain the directories: `components/`, `hooks/`, `plugin-api/`, `plugins/`, `paged-editor/`, `styles/`
- **AND** it SHALL contain entry points: `index.ts`, `react.ts`, `ui.ts`

#### Scenario: React package depends on core

- **WHEN** inspecting `packages/react/package.json`
- **THEN** `@eigenpal/docx-core` SHALL be listed in dependencies
- **AND** `react` and `react-dom` SHALL be listed as peerDependencies
- **AND** `@radix-ui/react-select` SHALL be listed in dependencies

### Requirement: Each package has its own build configuration

Each package SHALL have its own `tsup.config.ts` producing independent build outputs.

#### Scenario: Core package builds independently

- **WHEN** running `bun run build` in `packages/core/`
- **THEN** it SHALL produce `dist/` with CJS and ESM outputs and type declarations
- **AND** the build SHALL succeed without React installed

#### Scenario: React package builds independently

- **WHEN** running `bun run build` in `packages/react/`
- **THEN** it SHALL produce `dist/` with CJS and ESM outputs, type declarations, and `styles.css`
- **AND** it SHALL externalize `@eigenpal/docx-core` (not bundle it)

### Requirement: Shared development scripts at root

The root `package.json` SHALL provide convenience scripts that operate across all packages.

#### Scenario: Root scripts orchestrate workspaces

- **WHEN** running `bun run build` from the root
- **THEN** it SHALL build core first, then react (respecting dependency order)

#### Scenario: Typecheck runs across all packages

- **WHEN** running `bun run typecheck` from the root
- **THEN** it SHALL typecheck all packages

### Requirement: Tests work across the monorepo

Playwright E2E tests SHALL remain functional and test the full integrated editor.

#### Scenario: E2E tests use both packages

- **WHEN** running `npx playwright test` from the root (or a tests directory)
- **THEN** tests SHALL import from both `@eigenpal/docx-core` and `@eigenpal/docx-js-editor`
- **AND** all existing tests SHALL pass without modification to test logic

### Requirement: Cross-framework E2E test reuse

Core editor behavior tests (editing, formatting, rendering, file loading) SHALL be reusable across framework packages via Playwright projects parameterized by base URL.

#### Scenario: Playwright config defines per-framework projects

- **WHEN** inspecting `playwright.config.ts`
- **THEN** it SHALL define a `react` project with `baseURL` pointing to the React example app (e.g., `http://localhost:5173`)
- **AND** it SHALL define a `vue` project with `baseURL` pointing to the Vue example app (e.g., `http://localhost:5174`)

#### Scenario: Core editing tests run against both frameworks

- **WHEN** running `npx playwright test --project=react`
- **THEN** shared core tests (editing, formatting, undo/redo, rendering, file loading) SHALL run against the React app
- **WHEN** running `npx playwright test --project=vue`
- **THEN** the same shared core tests SHALL run against the Vue app
- **AND** results SHALL be equivalent for both frameworks

#### Scenario: Framework-specific tests are scoped

- **WHEN** a test file tests React-specific UI (toolbar, dialogs, pickers)
- **THEN** it SHALL only run under the `react` project
- **WHEN** a test file tests Vue-specific UI
- **THEN** it SHALL only run under the `vue` project

### Requirement: Vue example app for E2E testing

An `examples/vue/` directory SHALL contain a minimal Vite + Vue app that mounts the Vue editor, serving as the test target for the `vue` Playwright project.

#### Scenario: Vue example app runs with Vite

- **WHEN** running `bun run dev` in `examples/vue/`
- **THEN** it SHALL start a Vite dev server with `@vitejs/plugin-vue`
- **AND** the app SHALL render a functional DOCX editor using `@eigenpal/docx-editor-vue` and `@eigenpal/docx-core`

#### Scenario: Vue example app serves on a distinct port

- **WHEN** the Vue example app is running
- **THEN** it SHALL serve on a port different from the React example app (e.g., `5174` vs `5173`)

### Requirement: Vue package scaffold

The `packages/vue/` directory SHALL contain an empty scaffolded package named `@eigenpal/docx-editor-vue` with a dependency on `@eigenpal/docx-core`, ready for community contribution.

#### Scenario: Vue package has minimal package.json

- **WHEN** inspecting `packages/vue/package.json`
- **THEN** it SHALL have name `@eigenpal/docx-editor-vue`
- **AND** `@eigenpal/docx-core` SHALL be listed in dependencies
- **AND** `vue` SHALL be listed in peerDependencies
- **AND** `react` and `react-dom` SHALL NOT appear in dependencies or peerDependencies

#### Scenario: Vue package has a placeholder entry point

- **WHEN** inspecting `packages/vue/src/index.ts`
- **THEN** it SHALL exist with a minimal export (e.g., empty or a version constant)
- **AND** it SHALL contain a comment indicating the package is ready for community contribution

### Requirement: Zero React type leaks in core

The core package SHALL have no imports (including type-only) from `react` or `react-dom`.

#### Scenario: CSSProperties type replaced

- **WHEN** inspecting `utils/formatToStyle.ts` and `utils/selectionHighlight.ts` in core
- **THEN** they SHALL use a local CSS properties type (e.g., `Record<string, string | number>`) instead of importing from React

#### Scenario: Plugin types are framework-agnostic in core

- **WHEN** inspecting plugin-related types in core
- **THEN** they SHALL NOT reference `ReactNode` or any React types
