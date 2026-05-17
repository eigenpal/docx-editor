## Why

The 1.0.0 unified rename ships `@eigenpal/docx-editor-vue` as a public package, and the Vue editor now has a real `DocxEditor`/`renderAsync` mounting path. It still carries the `[STUB]` marker until the parity gates pass, but the question is no longer "do we ship a placeholder?" — it is "how do we harden the Vue implementation with the rigour of the React adapter so the parity preview at `1-0-0.docx-editor.dev/vue/` is something a Vue dev can actually `npm install` and trust?"

## What Changes

- Merge PR #245 into `1.0.0-release` as the foundation, then harden it on a `vue-editor-robust-implementation` follow-up branch. Not a rewrite; a hardening pass.
- Audit the 49 files from #245: accept what's solid, refactor reactivity hot spots, identify gaps vs the React adapter's UI surface, and produce a per-component **parity matrix** (done / partial / missing / deliberately omitted in v1).
- Lock the **3-package boundary**: `@eigenpal/docx-editor-core` stays UI-framework-agnostic (DOCX parser, ProseMirror schema, layout engine, plugin API, agent API, headless), `@eigenpal/docx-editor-react` keeps React-only UI, `@eigenpal/docx-editor-vue` owns Vue-only UI. Add a CI lint that fails the build if `vue/` imports `react`/`react-dom` or `react/` imports `vue`. **BREAKING** for any contributor who's been crossing the boundary.
- Reuse the existing Playwright `tests/` specs against the parity preview's `/vue/` route so the same DOCX behaves identically across both adapters. Shared fixtures live in `examples/parity/fixtures/` and drive both runners.
- Manual QA pass: visual fidelity (side-by-side screenshots), keyboard interaction, accessibility (axe-core sweep, focus order, aria roles), responsive layout.
- Agentic review pass: spawn dedicated Claude/Codex sessions targeting Vue-specific bug classes — reactivity drift (`ref` vs `reactive` vs `shallowRef` for ProseMirror state), watch/effect ordering, DOM event timing in `onMounted`, prop mutation, v-model integration. Each pass writes findings to `openspec/changes/vue-editor-robust-implementation/notes/`.
- Define the Vue v1 feature set: editing, formatting, lists, tables, comments, tracked changes, find/replace, hyperlinks, images, page setup, printing, i18n, keyboard shortcuts, **agent SDK integration** (`@eigenpal/docx-editor-agents/vue` ships with the same API surface as `/react` — `<AgentPanel>`, `<AgentChatLog>`, `<AgentComposer>`, `<AgentSuggestionChip>`, `<AgentTimeline>`, AI context menu, AI response preview). Out of v1: SSR, Nuxt-specific helpers, Vue 2 compat.
- Drop `[STUB]` from `packages/vue/package.json` description and the README packages-table caveat once the parity matrix is fully green.

## Capabilities

### New Capabilities

- `vue-adapter`: Vue 3 wrapper over `@eigenpal/docx-editor-core`. Mounts the editor as an SFC, exposes a `<DocxEditor>` component with v-model + ref-based imperative API, and ships a `useDocxEditor` composable. Owns Vue-only UI components and Vue reactivity bindings to ProseMirror state.
- `vue-agent-sdk`: Vue equivalent of `@eigenpal/docx-editor-agents`'s React UI surface. Ships SFC components (`<AgentPanel>`, `<AgentChatLog>`, `<AgentComposer>`, `<AgentSuggestionChip>`, `<AgentTimeline>`) and composables (`useAgentBridge`, `useAgentEvents`) that hit the same framework-agnostic bridge from core. Same DOCX, same agent, same UX semantics — picked-Vue-or-React is purely a host-app choice. **Prerequisite:** the React agent UI components currently live in `packages/react/src/components/` (`AgentPanel.tsx`, `AgentChat.tsx`); they must first migrate to `packages/agent-use/src/react/` so the package actually owns the React UI surface it claims. The Vue subpath then mirrors that real `/react` subpath.
- `vue-react-parity`: Behavioural parity contract between the React and Vue adapters. Same `Document` input → same on-page rendering, same DOCX output, same keyboard shortcuts, same i18n strings. Codified as a Playwright test suite that runs against both `/react/` and `/vue/` routes on the parity preview deployment, plus a per-component parity matrix tracking implementation status.
- `framework-isolation-lint`: Build-time enforcement that `packages/vue/src/` contains no React imports, `packages/react/src/` contains no Vue imports, and `packages/core/src/` imports neither. Ships as a small lint rule + CI check.

### Modified Capabilities

_None._ This is a foundation drop on a long-living release branch; existing `@eigenpal/docx-editor-react` and `@eigenpal/docx-editor-core` requirements don't change.

## Impact

- **Affected packages**: `packages/vue/` (foundation from #245 + hardening), `packages/core/` (no behavioural changes; may need exports map tweaks for Vue-specific consumption paths), `examples/vue/` (real demo replacing the placeholder), `examples/parity/` (Vue route now serves a working editor; banner copy updates).
- **CI**: new Playwright run against `/vue/` parity preview. Approximately doubles E2E runtime — keep workers high, run only affected specs by default per `CLAUDE.md` test guidance, full suite gated to release.
- **Public API surface**: `@eigenpal/docx-editor-vue` exports stabilize. The first version that drops `[STUB]` is effectively the package's API contract for the 1.x line; future breaking changes need a major bump.
- **Dependencies**: adds `vue` peer dep (already declared at `^3.0.0`), `@vitejs/plugin-vue` (already in vue example). No new runtime deps in core.
- **Downstream**: PR #340 (Tailwind + parity preview) is already merged on `1.0.0-release`; the `/vue/` route exists and serves a placeholder. This change replaces the placeholder with the real editor.
- **Affected packages** (added): `packages/agent-use/` gains a `/vue` subpath export mirroring `/react`. The bridge / server / mcp / ai-sdk subpaths stay framework-agnostic and are reused unchanged.
- **Out of scope** (do not implement here): SSR/Nuxt support, Vue 2 compatibility, Vue-specific plugin API extensions beyond what parity demands.
