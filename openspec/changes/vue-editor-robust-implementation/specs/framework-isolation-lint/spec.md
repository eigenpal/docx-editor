## ADDED Requirements

### Requirement: ESLint enforces package boundaries

The repository's ESLint configuration SHALL declare per-package import restrictions: `packages/vue/src/**` cannot import `react`, `react-dom`, `@types/react`, `@vitejs/plugin-react`, or any subpath of `@eigenpal/docx-editor-react`; `packages/react/src/**` cannot import `vue`, `@vue/*`, `@vitejs/plugin-vue`, or any subpath of `@eigenpal/docx-editor-vue`; `packages/core/src/**` cannot import either. The same restrictions apply inside `packages/agent-use/src/`: `src/vue/**` cannot import React, `src/react/**` cannot import Vue, `src/index.ts`/`src/bridge.ts` and the framework-agnostic core files cannot import either. The rule SHALL be `no-restricted-imports` with explicit patterns. The rule SHALL fire on dynamic imports as well as static.

**Custom error messages.** Each `no-restricted-imports` pattern SHALL include a `"message"` field that names the alternative consumers should use, pointing at the relevant package and doc. Example: `{ "name": "react", "message": "Vue files cannot import React. Use @eigenpal/docx-editor-core for shared logic, or move shared utilities into core. See packages/vue/README.md#architecture." }`. Generic ESLint defaults like "is restricted from being used" are NOT acceptable.

#### Scenario: Vue file importing React

- **WHEN** a contributor edits `packages/vue/src/components/SomeDialog.vue` to import from `'react'` or `'@eigenpal/docx-editor-react'`
- **THEN** running `bun run lint` produces a `no-restricted-imports` error pointing at the violation
- **AND** the exit code is non-zero

#### Scenario: React file importing Vue

- **WHEN** a contributor edits `packages/react/src/components/X.tsx` to import from `'vue'` or any `@vue/*` subpath
- **THEN** `bun run lint` produces an equivalent error from the same rule
- **AND** the violation is caught at lint time, not runtime

#### Scenario: Core file importing a UI framework

- **WHEN** a contributor edits `packages/core/src/anything.ts` to import from `'react'`, `'vue'`, or any framework subpath
- **THEN** `bun run lint` produces a `no-restricted-imports` error
- **AND** core stays framework-agnostic

#### Scenario: Test files exempt where reasonable

- **WHEN** a Vue component's `__tests__/*.test.ts` file imports `@vue/test-utils` (which itself depends on Vue)
- **THEN** the lint passes — the rule restricts forbidden frameworks, not Vue test tooling within Vue test files
- **AND** equivalent React Testing Library imports are allowed within React tests only

### Requirement: CI fails the build on lint violation

The existing CI workflow SHALL run `bun run lint` as a required step before any package's `build` step. A violation in any package SHALL fail the entire CI run.

#### Scenario: Cross-import lands accidentally in a PR

- **WHEN** a contributor opens a PR with a forbidden import
- **THEN** CI runs `bun run lint`, the lint step fails
- **AND** the PR's required checks block merge until the import is removed or relocated

### Requirement: Allowed cross-package imports are workspace deps via core

Vue and React adapters MAY both import from `@eigenpal/docx-editor-core` and any of its subpath exports. They MAY NOT import from each other. Shared utilities that don't depend on Vue or React SHALL live in core; framework-specific helpers stay in the respective adapter. New cross-cutting utilities default to landing in core.

#### Scenario: Vue imports a core utility

- **WHEN** a Vue component imports `findStartPosForParaId` from `'@eigenpal/docx-editor-core'`
- **THEN** the lint passes
- **AND** the same utility is available to the React adapter through the same import path
