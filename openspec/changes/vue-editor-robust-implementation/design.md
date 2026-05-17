## Context

The 1.0.0-release branch is the long-living integration branch for a unified package rename + the public debut of the framework-agnostic core. PR #340 (already merged on `1.0.0-release`) wired up a `/react` + `/vue` parity preview at `1-0-0.docx-editor.dev`, with the `/vue/` route serving a "coming soon" stub.

Community PR #245 (`Cruiser13`) is the first real Vue 3 implementation. It builds on the earlier #88 harness and adds the full UI surface: toolbar, dialogs, sidebar, image handling, error boundaries — 49 files spanning ~9.2k lines. The author describes it as bug-free; reality after a hardening pass will probably be different. This design covers how to land it well.

The strategic constraint: we keep three packages with hard boundaries — `@eigenpal/docx-editor-core` (no UI framework), `@eigenpal/docx-editor-react` (React-only UI), `@eigenpal/docx-editor-vue` (Vue-only UI). Cross-imports between adapters or from core into a framework break the whole thesis of "core is framework-agnostic."

The React adapter is the reference. It works, ships, has Playwright coverage, and has been iterated on for months. Vue parity is defined as "same `Document` in → same on-page rendering, same DOCX out, same UX semantics."

## Goals / Non-Goals

**Goals:**

- Land PR #245 as the foundation, then harden it through audit + agentic review + Playwright parity tests.
- Maintain a single unambiguous import boundary between the three packages, enforced at build time.
- Produce a per-component parity matrix that's the source of truth for "what's done, what's partial, what's missing, what's deliberately out of v1."
- Deterministic Playwright suite that runs the existing `tests/` specs against `/vue/` on the parity preview, not just `/react/`.
- Drop the `[STUB]` description from `packages/vue/package.json` only when the parity matrix is fully green.
- Keep the contributor's commits intact where possible; cherry-pick rather than rewrite when a commit is solid as-is.

**Non-Goals:**

- SSR or Nuxt-specific helpers. The editor is client-side only and Vue's hydration story would balloon scope.
- Vue 2 compatibility. Composition API is required.
- Vue-specific extensions to the plugin API or agent API beyond what's needed to mount the editor.
- Re-architecting `@eigenpal/docx-editor-core` for Vue. The core is already framework-agnostic; if Vue can't consume it cleanly, that's a Vue-side adapter problem.
- A unified test runner that's Vue-aware. Playwright drives the browser; framework specifics are invisible at that layer.
- Re-architecting `@eigenpal/docx-editor-agents`. The bridge, server, mcp, ai-sdk subpaths stay framework-agnostic; only the UI subpath gets a Vue twin alongside the existing React one.

## Decisions

### Decision 1: Foundation strategy — merge PR #245, then harden in place

**Choice:** merge PR #245 to `1.0.0-release` first, then iterate on `vue-editor-robust-implementation` branch off `1.0.0-release`.

**Why:** the PR has 9.2k lines of contributor work. Cherry-picking selectively forks the contributor's narrative, breaks attribution in `git blame`, and forces us to redo work that's already correct. Merging then hardening preserves attribution and gives a clean diff for each subsequent improvement.

**Alternative considered:** cherry-pick only the components we trust, rewrite the rest. Rejected — sets a hostile precedent for community PRs ("we'll take the bits we want and ghost the rest") and produces messier diffs.

**Implication:** the `1.0.0-release` HEAD will briefly carry an unhardened Vue at 1.0.0. The `[STUB]` description stays in `package.json` until the hardening branch lands and the parity matrix turns green.

### Decision 2: Reactivity model — `shallowRef` for ProseMirror state, `ref` for derived UI

**Choice:** wrap the ProseMirror `EditorState` in a Vue `shallowRef` and trigger an explicit `triggerRef` on each transaction. UI-derived state (toolbar selection, dialog open/closed, dropdown selections) uses regular `ref` or `reactive`.

**Why:** ProseMirror state is a deeply nested immutable object that already manages its own version through transactions. Vue's `reactive` would walk the entire doc on every change to install proxies, defeating ProseMirror's structural sharing and causing measurable lag on documents over a few hundred nodes. `shallowRef` skips the proxy install — Vue tracks pointer changes only — and `triggerRef` after `view.updateState(...)` keeps Vue's render scheduler in sync.

**Alternative considered:** `reactive(editorState)`. Tried in PR #88 prototype, abandoned for the latency reason above.

**Alternative considered:** `markRaw(editorState)` + manual `ref<number>` version counter. Works but adds bookkeeping; `shallowRef` is the idiomatic Vue answer for "external mutable object I don't want proxied."

**Implication:** components that read fields off the EditorState (e.g. toolbar reading `state.selection`) need to bind to `editorStateRef.value` and re-render when the ref's tag bumps. Computed properties that derive from it work normally — they re-evaluate when the ref reference changes after `triggerRef`.

### Decision 3: Public Vue API shape — composable + component, both backed by the same engine

**Choice:** ship two consumer entry points:

- `<DocxEditor>` SFC component with `v-model:document`, props for config, ref-exposed imperative API mirroring `DocxEditorRef` from React.
- `useDocxEditor(options)` composable that returns the same imperative API plus reactive refs for selection/state. For consumers building custom UI on top of core.

**Why:** Vue idiom is "components for layouts, composables for logic." Forcing component-only would push power users into manual DOM mounting; forcing composable-only would make the simple "drop in an editor" path verbose. Both paths share one underlying `EditorCore` from `@eigenpal/docx-editor-core`, no duplication.

**Alternative considered:** component-only (matches React's `<DocxEditor>` 1:1). Rejected — Vue users expect composables, and the React adapter already exposes `useDocxEditor`-shaped hooks elsewhere; symmetry across adapters is the point.

### Decision 4: Framework-isolation lint — eslint rule, not custom script

**Choice:** add a per-package `eslint.config.js` override. `packages/vue/`: `no-restricted-imports` for `react`, `react-dom`, `react/*`. `packages/react/`: `no-restricted-imports` for `vue`, `@vue/*`. `packages/core/`: `no-restricted-imports` for both. Wire it into the existing `bun run lint` pipeline so CI fails on a violation.

**Why:** ESLint already runs in CI. A bespoke script is one more thing to maintain. `no-restricted-imports` is the canonical way to express "this package can't depend on X."

**Alternative considered:** custom script that grep's for forbidden imports. Rejected — duplicates logic ESLint already encodes correctly (handles aliased imports, dynamic imports, etc.).

### Decision 5: Parity matrix lives in the spec, not a separate doc

**Choice:** the per-component parity matrix lives in `specs/vue-react-parity/spec.md` as a structured table within the requirement that defines parity. Components move done → partial → missing as work progresses; the spec file is updated alongside each implementation PR.

**Why:** keeping it in the spec makes parity the contract, not a side document that drifts. When the spec says "Bold button MUST behave identically across adapters," the matrix entry says "done." When implementation lands, the test in the Playwright suite proves it. Single source of truth.

**Alternative considered:** standalone `PARITY.md` in `packages/vue/`. Rejected — no enforcement, easy to forget to update, no clear relationship to test coverage.

### Decision 6: Test sharing between adapters — fixtures, not specs

**Choice:** Playwright spec files stay framework-coupled (different selectors, different mount paths). What's shared is the **fixture corpus** in `examples/parity/fixtures/`: input DOCX files + expected output DOCX files + golden screenshots at standard zoom levels. The Vue spec suite lives at `tests/vue/` and the React suite stays at `tests/`. Both walk the same fixture directory.

**Why:** specs need framework-aware selectors (`role="button" name="Bold"` works in both, but `data-testid` may differ between Vue SFC `<button data-testid>` and React `<button data-testid>` if the components use different attribute conventions). Fixtures are framework-agnostic — a DOCX file is a DOCX file. Sharing fixtures captures 80% of the parity contract; the spec files diverge only on framework-specific glue.

**Alternative considered:** truly shared specs with an adapter-detection layer. Rejected — too clever, harder to debug a parity failure when the abstraction is in the test itself.

### Decision 7: Migrate React agent UI from `packages/react/` to `packages/agent-use/src/react/` first

**Choice:** before adding the Vue agent UI subpath, move `<AgentPanel>`, `<AgentChat>`, `<AgentChatLog>`, `<AgentComposer>`, `<AgentSuggestionChip>`, `<AgentTimeline>` out of `packages/react/src/components/` and into `packages/agent-use/src/react/`. Do not re-export them from `packages/react`; the React adapter should expose React editor surfaces only. Then the `@eigenpal/docx-editor-agents/react` subpath actually owns its claimed UI surface, and the Vue subpath can mirror a real precedent rather than a fictional one.

**Why:** today's `@eigenpal/docx-editor-agents/react` exports only hooks (`useAgentChat`, `useDocxAgentTools`) and types. The React agent UI components live in `@eigenpal/docx-editor-react`'s component tree alongside the editor itself. That's a category error — agent UI is part of the agent SDK, not the editor adapter. Without this migration, the Vue plan claims to "mirror the existing `/react` subpath" but there's no UI to mirror, and the framework-isolation lint can't apply cleanly to the agent UI because half of it is in the editor package.

**Alternative considered:** ship Vue agent UI in `@eigenpal/docx-editor-vue` to match the current React layout. Rejected — perpetuates the category error, doubles the framework-isolation surface area, and forces every editor consumer to pull agent UI even when not using agents.

**Implication:** packages/react/src/index.ts loses agent component exports entirely. Consumers import agent UI from `@eigenpal/docx-editor-agents/react` directly.

### Decision 8: Refactor `bridge.ts` to be truly framework-agnostic before Vue consumes it

**Choice:** drop the React-flavoured re-exports (`useAgentChat`, `useDocxAgentTools`) from `packages/agent-use/src/bridge.ts` and the framework-agnostic `index.ts`. Move them to `src/react/` only. Factor any tool-running logic that's currently inside `useAgentChat` into a framework-agnostic `createAgentToolRunner(bridgeRef, options)` returning `{ executeToolCall, getContext }`. Vue's `useAgentBridge` composable wraps this same runner.

**Why:** the bridge is supposedly "framework-agnostic" but the same module re-exports React hooks. A Vue consumer importing `@eigenpal/docx-editor-agents/bridge` would pull `react` as a transitive dep through the re-export chain. Breaks the framework-isolation contract.

**Alternative considered:** declare bridge "mostly framework-agnostic" and live with the re-exports. Rejected — defeats the entire isolation thesis, and the lint rule would either have to be relaxed or fire on the bridge file itself.

**Implication:** import paths shift slightly. Anyone importing `useAgentChat` from `@eigenpal/docx-editor-agents` (the bare entry) breaks; they need `@eigenpal/docx-editor-agents/react`. Document in the change's CHANGELOG; keep the bare-entry export for one minor version with a deprecation notice if back-compat matters.

### Decision 9: AI SDK adapter — Vue needs `@ai-sdk/vue`, not `@ai-sdk/react`

**Choice:** the Vue agent SDK uses `@ai-sdk/vue` (Vercel AI SDK's official Vue bindings) for streaming chat state, mirroring how the React side uses `@ai-sdk/react`. `@ai-sdk/vue` becomes an optional peer dep of `@eigenpal/docx-editor-agents` alongside the existing `ai` peer.

**Why:** `useChat` is the source of streaming agent messages on the React side. There's no framework-neutral "useChat" — each framework has its own. `@ai-sdk/vue` exposes a Vue composable equivalent. Without this, Vue's `<AgentChatLog>` has no streaming source and would have to reimplement the whole AI-SDK chat lifecycle.

**Alternative considered:** roll our own framework-agnostic streaming primitive. Rejected — duplicates `@ai-sdk/*` for no gain; users would have to bring two stream sources in their host app.

**Implication:** `packages/agent-use/package.json` adds `@ai-sdk/vue` to `peerDependencies` and `peerDependenciesMeta` (optional). The Vue example demo `npm install`s `@ai-sdk/vue` to wire the chat. The agnostic data adapter (`toAgentMessages`) already in `packages/agent-use/src/ai-sdk/` is reused — only the UI hook source changes per framework.

### Decision 10: Vue `<DocxEditor>` ref MUST conform to `EditorRefLike` exactly

**Choice:** the Vue `<DocxEditor>` ref's TypeScript type is `EditorRefLike` from `@eigenpal/docx-editor-agents/bridge`. Not "approximately the same shape as `DocxEditorRef`" — strictly the same interface, enforced by typecheck. Any method missing from `EditorRefLike` either gets added there (if it's a real cross-adapter primitive) or stays out of the agent-bridge contract.

**Why:** the agent bridge is the integration contract. If Vue's ref doesn't satisfy `EditorRefLike`, the agent bridge breaks at runtime. The plan today says "match React 1:1 ish" but doesn't anchor the contract. Anchoring it via shared TypeScript interface ensures any drift is a compile error, not a Playwright test failure two weeks later.

**Alternative considered:** keep `DocxEditorRef` as the Vue contract and write a manual adapter to `EditorRefLike`. Rejected — adds a maintenance surface that does nothing useful; the contract IS the integration point.

**Implication:** Vue exports a `DocxEditorRef` type that's literally `EditorRefLike` from agents. React already does this implicitly; we make it explicit in both adapters.

### Decision 11: Streaming chat reactivity uses regular `ref`, not `shallowRef`

**Choice:** agent chat messages (`AgentMessage[]`) use a regular Vue `ref` or `reactive`, not `shallowRef`. ProseMirror state is the only thing that needs `shallowRef` (Decision 2); chat messages are small arrays of POJOs that benefit from Vue's deep reactivity for token-by-token streaming updates.

**Why:** the reasons for `shallowRef` on EditorState (huge nested immutable, ProseMirror manages its own version) don't apply to chat messages. Streaming tokens append to the last message's text; Vue's deep reactivity makes that re-render correctly without manual `triggerRef`. Forcing `shallowRef` would require manual triggers on every token = visible jank.

**Implication:** `<AgentChatLog>` binds to `messages.value` (or `messages` if reactive) and re-renders per token. Confirm visually that scroll-to-bottom and Markdown rendering remain smooth at typical streaming rates (~30-60 tokens/sec).

### Decision 12: `@eigenpal/docx-editor-agents` description + README rewrite is a precondition

**Choice:** before any UI components migrate into `packages/agent-use/`, rewrite the package's `description` field in `package.json` from "Agent-friendly API for DOCX document review" to something that names the new role explicitly (e.g. "Agent SDK and chat UI for the DOCX editor — works with React or Vue"). Ship a top-level `packages/agent-use/README.md` with a subpath table (`/`, `/bridge`, `/server`, `/mcp`, `/ai-sdk/server`, `/react`, `/vue`) and a one-line summary of each. This README MUST exist before tasks 9.1 and 9.9 (component migrations) land.

**Why:** post-migration, the package owns four roles — bridge, MCP/AI-SDK adapters, React UI, Vue UI. A consumer doing `npm install @eigenpal/docx-editor-agents` for an MCP integration will see a directory tree containing `<AgentPanel.vue>` and wonder if they got the wrong package. The current description claims "headless review API"; reality post-migration is "everything agent." Without a README clarifying subpaths, the package reads as confused.

**Implication:** task 12.3 ("write `packages/agent-use/README.md`") moves from the docs phase into section 9 as a precondition (renumbered 9.0). The `description` field change is a separate small commit that lands before component migrations begin.

### Decision 13: Agent SDK ships in `@eigenpal/docx-editor-agents/vue`, not a separate package

**Choice:** add a `/vue` subpath export to the existing `@eigenpal/docx-editor-agents` package, mirroring the existing `/react` subpath. Vue components live in `packages/agent-use/src/vue/`. Same package, same versioning, same fixed group as the editor adapters. The framework-agnostic bridge/server/mcp/ai-sdk subpaths stay where they are and are reused.

**Why:** consumers should be able to swap React for Vue at the host-app layer without changing the agent dependency. One package, two UI flavours, single source of truth for the agent contract. Mirrors the pattern of the `*-editor-react` / `*-editor-vue` split where React and Vue UIs are sibling adapters over a shared engine — same shape applied to the agent SDK.

**Alternative considered:** ship `@eigenpal/docx-editor-agents-vue` as a separate package. Rejected — doubles the publish surface, doubles the changelog, and creates a versioning mismatch where the Vue agent SDK could lag the React one.

**Implication:** `packages/agent-use/package.json` `exports` field grows a `./vue` entry. `tsup.config.ts` adds a `vue: 'src/vue/index.ts'` entry. Vue is added to `peerDependenciesMeta` as optional. The framework-isolation lint rule applies to the agent package internally too: files under `src/vue/**` cannot import React, files under `src/react/**` cannot import Vue, files outside both cannot import either.

### Decision 14: All five packages stay in the fixed group through 1.x

**Choice:** keep all five packages (`@eigenpal/docx-editor-react`, `-vue`, `-core`, `-agents`, `-js-editor` shim) in the `.changeset/config.json` `fixed` group through the 1.x line. No public roadmap commitment to a future split.

**Why:** the fixed group earns its keep on the 1.0 train — coordinated rename, parity story across editor adapters matters, packages ship together. Through 1.x the assumption is the same: agent UI churn aligned with editor churn keeps the surface coherent for consumers. If/when an internal scheduling discussion concludes the agents package should float on its own cadence, that's an implementation decision made then, not a public roadmap commitment now.

**Alternative considered:** schedule a 2.0 split as a public follow-up issue. Rejected — committing to a public 2.0 cadence change before we've shipped 1.0 is premature, and earlier doc passes on this train have explicitly said no 2.0 framing in public artifacts. Internal flexibility, no premature public commitment.

**Implication:** no follow-up issue. No changeset entry mentioning 2.0. No code change in this branch.

### Decision 15: Vue editor and Vue agent UI use independent un-stub gates

**Choice:** the un-stub criterion for `@eigenpal/docx-editor-vue` requires only the editor matrix rows to be `done` or `omitted-v1`. The un-stub criterion for `@eigenpal/docx-editor-agents/vue` (a separate `[STUB]`-style marker, e.g. a `[BETA]` prefix in the package's description for the Vue subpath until ready) requires only the agent matrix rows. Both can ship on the same release train if both are ready; either can defer to 1.1.

**Why:** binary all-or-nothing forces the team to either delay the editor for a slow agent UI rollout or ship both with quality compromises. Independent gates let each surface ship when it's actually ready. The fixed group still aligns versions — what changes is the description metadata that signals readiness to npm consumers.

**Alternative considered:** ship Vue editor with `agents/vue` as `omitted-v1` if agent UI lags, then bring it back in 1.1 with a documented changeset. Rejected because the matrix would carry rows that flicker between `omitted-v1` and `done` across minor versions — confusing audit trail. Independent description-level gates are cleaner.

**Implication:** task 13.x un-stub gate splits into 13a (editor) and 13b (agent UI). Either can land first. The shared release train still ships them together when both are ready, and the matrix rows are honest in either timing.

### Decision 16: Performance budget — concrete numbers, scripted measurement

**Choice:** four named perf budgets, each with a measurement script and a fail threshold:

| Metric                                           | Fixture                                    | Threshold                                       | Script                           |
| ------------------------------------------------ | ------------------------------------------ | ----------------------------------------------- | -------------------------------- |
| Cold-start TTI (mount → first paint of page 1)   | `large.docx` (200+ paragraphs, 5+ tables)  | ≤1500ms p95 on a baseline laptop                | `scripts/perf/cold-start.mjs`    |
| Input latency (keystroke → state update → paint) | typing 60 chars/sec into mid-doc paragraph | p95 within 10% of React adapter on same fixture | `scripts/perf/input-latency.mjs` |
| Save round-trip (`save()` → `ArrayBuffer`)       | unmodified `large.docx`                    | within 5% of React adapter                      | `scripts/perf/save.mjs`          |
| Scroll-during-edit FPS (typing while scrolling)  | `large.docx`                               | ≥50 FPS sustained                               | `scripts/perf/scroll-fps.mjs`    |

Scripts write local JSON to ignored `test-results/perf/` by default. Set
`PERF_WRITE_ARTIFACTS=1` to write PR evidence under `notes/perf/`.

**Why:** "within 10% of React" with no metric name is vibes. Real numbers anchored to scripts make the gate enforceable, the failure mode debuggable, and the regression catchable in CI later if we wire the same scripts into a perf-regression workflow.

**Implication:** new `scripts/perf/` directory. Tasks gain perf-script wiring under section 11.

### Decision 17: Three test trees with distinct purposes

**Choice:** test responsibilities split into three top-level directories:

- `tests/` — React-only regressions. Existing suite. Per-PR runs.
- `tests/vue/` — Vue-only regressions. Things that could only break in Vue (SFC scoped style ordering, Vue reactivity edge cases, `<script setup>` quirks).
- `tests/parity/` — cross-adapter contract. Same fixture, both adapters, behaviour MUST match. Failure surfaces "react-only / vue-only / parity-broken / core-broken" via the spec naming.

Each directory has its own runner script: `bun run test:e2e:react`, `:vue`, `:parity`. CI gates differ — `:parity` runs on every PR; `:react` and `:vue` run on PRs that touch the corresponding adapter.

**Why:** without this clarity, a test failure is ambiguous (is the bug in core, in one adapter, or in the contract?). Folder routing names the failure class up front.

**Implication:** `tests/` stays React-only as it is today; new `tests/vue/` and `tests/parity/` directories are created. Tasks 7.1 — 7.6 reference both new trees.

### Decision 18: `EditorRefLike` versioning policy

**Choice:** `EditorRefLike` is now the agent-bridge contract that Vue and React both satisfy. Versioning rules:

- **Adding a method** to `EditorRefLike` is a **minor** bump in `@eigenpal/docx-editor-agents`, but requires a **coordinated minor bump** in both editor adapters in the same release train so both implement the new method. The fixed group enforces this.
- **Changing an existing method's signature or removing a method** is a **major** bump for the entire fixed group. Update CHANGELOG with migration guidance.
- The interface is documented as a contract in `packages/agent-use/src/bridge.ts` JSDoc on the type itself, naming this policy.

**Why:** `EditorRefLike` is the integration contract; drift is the most likely failure mode. Naming the policy avoids "we'll figure it out next time" debates.

**Implication:** small JSDoc edit on the interface, small mention in `packages/agent-use/README.md` (from Decision 12). No tooling needed.

### Decision 19: Public consumer API hierarchy — composable is primary, ref is secondary

**Choice:** Vue's `useDocxEditor()` composable returning a reactive surface is the **primary** consumer-facing API. The `<DocxEditor>` component's exposed `ref` (typed as `EditorRefLike`) is the **secondary** path, intended specifically for agent bridge wiring and for consumers who explicitly want imperative access.

**Why:** Vue idiom is composables-first. Forcing every consumer to reach for a `ref<EditorRefLike>` because that's what React does produces un-Vue-y code in the wild. Composable returns a reactive `editorState`, `selection`, `commands`, etc. — natural for `<script setup>` consumption. The ref stays as a pure agent-integration anchor.

**Alternative considered:** make the ref the only public API (1:1 React parity). Rejected per this review's finding — symmetry-as-a-value forces non-idiomatic Vue.

**Implication:** README quick-start uses `useDocxEditor` first, the component-with-ref second. Spec language updated to call out the hierarchy: composable for normal consumption, ref for integration.

### Decision 20: Multi-layered parity gates (defense in depth)

**Choice:** rather than relying on the Playwright `tests/parity/` suite as the only parity guard, layer parity gates by speed and scope so drift is caught locally before push, not just in CI:

| Gate                          | Where it runs                                    | Speed | What it catches                                                                                                        |
| ----------------------------- | ------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| **Type-level surface parity** | `bun run typecheck`                              | <5s   | `DocxEditorRef` / `EditorRefLike` interface drift between adapters                                                     |
| **Export parity script**      | `check:parity` + CI                              | <2s   | Public component/composable list drift between `packages/{react,vue}/package.json` exports                             |
| **i18n validation**           | `i18n:validate` + prepublish                     | <1s   | Translation key drift in the shared `@eigenpal/docx-editor-i18n` locale files                                          |
| **Snapshot parity**           | unit test, pre-commit                            | <10s  | `Document` model round-trip drift (serialise → deserialise → assert deep-equal across adapters)                        |
| **Parity smoke E2E**          | on-demand (`bun run test:e2e:parity:smoke`) + CI | <30s  | Critical-path divergence: mount fixture, type 5 chars, toggle bold, save, assert byte-equal                            |
| **Full parity E2E**           | CI on parity-affecting PRs                       | ~5min | Per-feature behavioural parity (the existing `tests/parity/` suite)                                                    |
| **Visual diff**               | CI on every PR                                   | ~2min | Pixel-level divergence past 0.1% tolerance                                                                             |
| **Bundle size parity**        | CI on every PR                                   | <5s   | Adapter bundle size diverges past tolerance (e.g. 15% — Vue may be smaller, but a sudden gap signals duplicated logic) |
| **Accessibility parity**      | CI weekly + pre-release                          | ~1min | axe-core violation set differs between routes                                                                          |
| **Pre-publish gate**          | npm publish workflow                             | ~2min | Aggregates: typecheck + parity checks + i18n validation + packed consumer install + built parity preview + smoke E2E   |

**Why:** the user typing in `examples/vue/` should see drift as a red squiggle, not a Playwright failure 10 minutes later in CI. Each layer is cheap on its own. Fast parity feedback belongs in the dev loop where it costs seconds, not in PR review where it costs context-switches.

**Alternative considered:** rely on a single comprehensive Playwright suite. Rejected — too slow to run on every save; developers turn off pre-push hooks that take >30s; drift accumulates and surfaces at integration time.

**Husky integration.** The repo already uses husky (per `package.json`). Add a single new hook under `.husky/`:

- `pre-commit` runs `bun run typecheck && bun run check:parity` (target <10s total — fast checks only)

Smoke parity is **opt-in via `bun run test:e2e:parity:smoke`**, not auto-run on push. Pre-push hooks that take 30s annoy contributors and get bypassed; CI runs the same script either way. The dev-loop value of the smoke set comes from `dev:parity:watch` (Decision 21) where it re-runs on save while you're already iterating, not from blocking git push.

**Implication:** new `scripts/check-export-parity.mjs`, `scripts/check-i18n-parity.mjs`, `scripts/parity-smoke.mjs`, `scripts/parity-bundle-size.mjs`. New tasks under section 8b. Decision 17's three test trees stay; this decision adds non-Playwright gates around them.

### Decision 21: Pair-edit dev mode (developer experience tooling)

**Choice:** ship a `bun run dev:parity:watch` script that runs both Vite dev servers + a Playwright watch mode that re-runs the parity smoke on file changes. The dev sees both adapters live AND gets parity feedback within seconds of saving a Vue file.

**Why:** today's `bun run dev:parity` builds once and serves; you have to manually rebuild after changes. Watch mode + smoke-on-save is the "feels like a unit test" feedback loop for parity work specifically. Catches "I broke parity" the moment it happens.

**Scope:** convenience only. Not a release gate; not in CI. Just a contributor productivity tool. If it doesn't work cleanly, drop it without blocking the rest of the plan.

**Implication:** small. One new script entry. Concurrently runs the two existing dev servers + `playwright test tests/parity/smoke/ --watch`.

### Decision 22: Agentic review pass — sessions write to `notes/`, not directly to source

**Choice:** when running Claude/Codex review sessions over the Vue surface, each session writes findings to `openspec/changes/vue-editor-robust-implementation/notes/<topic>.md`. The hardening tasks in `tasks.md` cite which notes they address. Source changes go through normal PR review.

**Why:** keeps the agentic output reviewable as artifacts ("here's what the reactivity audit found") and avoids the trap of agents auto-committing fixes that nobody verified. Notes are durable; transient agent sessions are not.

**Alternative considered:** agents open PRs directly. Rejected for now — too easy to ship subtle Vue bugs that pass typecheck but break runtime.

## Risks / Trade-offs

- **[Risk] PR #245 has reactivity bugs that surface only at scale (large docs, fast typing).** → Mitigation: profile the Vue route on the largest fixture in the parity corpus before flipping `[STUB]` off. If lag is meaningfully worse than React (>10% on the same metric), block the un-stubbing until fixed.

- **[Risk] CSS divergence between adapters.** Vue SFC scoped styles vs React Tailwind utilities may render differently even when the DOM structure matches. → Mitigation: the parity matrix scenarios include "visual regression at standard zoom" with screenshot diffs.

- **[Risk] Plugin API divergence.** React's plugin host has hooks (`useEditorState`, etc.) that Vue would need to reproduce as composables. If the plugin API surface drifts adapter-to-adapter, third-party plugins can't be written once and used in both. → Mitigation: explicitly out of v1 scope. Vue ships without third-party plugin support; only built-in features. Document this clearly in the spec's "deliberately omitted" list.

- **[Risk] Playwright runtime doubles.** Running the full suite against both adapters adds ~10-15 minutes to CI. → Mitigation: stays gated behind `bun run test:e2e:full`; PRs run the affected-spec heuristic from CLAUDE.md. The full pass runs on release.

- **[Risk] Vue v1 ships before all editor parity matrix entries are green.** Pressure to "just ship" with un-stubbed Vue could leak. → Mitigation: the un-stub task in `tasks.md` is explicitly gated on "all editor matrix entries marked done OR explicitly omitted with a documented reason." Agent UI rows use the independent gate from Decision 15.

- **[Trade-off] We're publishing a community-contributed package as a 1.0.0 commitment.** Cruiser13's authorship is preserved in `git log`, but Eigenpal owns the npm package and the API contract. → Mitigation: explicit attribution in `packages/vue/README.md` ("community-supported, foundation by @Cruiser13") and the changelog entry. No corporate cosplay.

- **[Risk] Un-stub gate couples Vue editor and Vue agent UI release timing.** Older task wording coupled `[STUB]` removal to every matrix row, including agent-SDK rows. → Mitigation: Decision 15 splits editor and agent gates. Vue editor can un-stub once editor rows are green; agent UI readiness remains tracked by its own matrix rows and metadata.

- **[Trade-off] Framework-isolation lint is a hard constraint that may force ugly workarounds.** If a Vue adapter genuinely needs to inspect React-only state for some interop case, the lint blocks it. → Acceptable: that case shouldn't exist by construction. If it shows up, it's a signal to push the shared logic into core, not to relax the lint.

## Migration Plan

1. **Pre-merge:** review PR #245 — focus on package.json correctness, exports map, build config, and major architectural decisions (reactivity model). Land minor fixups via PR comments rather than waiting for the hardening branch.
2. **Merge PR #245** to `1.0.0-release`. `[STUB]` description stays. `/vue/` route on parity preview now serves the real editor (likely buggy in places).
3. **Open `vue-editor-robust-implementation` branch** off `1.0.0-release`. Work the tasks list.
4. **Run agentic review passes** (reactivity, accessibility, framework-isolation). Each pass writes findings to `notes/`. Tasks reference findings by note number.
5. **Build the Playwright `tests/vue/` suite.** Mirror the spec files in `tests/`, adjust selectors as needed, share fixtures from `examples/parity/fixtures/`.
6. **Build the parity matrix.** One row per component, columns: React-status, Vue-status, parity-test, notes. Lives in `specs/vue-react-parity/spec.md`. Update on every implementation PR.
7. **Manual QA pass.** Side-by-side at `1-0-0.docx-editor.dev/react/` and `/vue/` with the standard fixture set. Capture screenshots; file issues for any visual divergence.
8. **Drop `[STUB]`.** Last task in `tasks.md`. Updates `package.json` description, `README.md` packages-table caveat, and the `/vue/`-only banner. Requires every editor parity matrix row to be `done` or explicitly `omitted-v1`; agent rows follow their independent gate.
9. **Merge `vue-editor-robust-implementation` to `1.0.0-release`.** Vue 1.0.0 ships with the rest of the train when the long-lived branch merges to `main`.

**Rollback:** if hardening uncovers blocking issues we can't resolve before the 1.0.0 train ships, revert PR #245's merge on `1.0.0-release`, restore the stub, and ship Vue at `0.1.0-preview.0` with a "preview, not production-ready" description. The fixed group in `.changeset/config.json` would need vue temporarily moved to `ignore`. This is the only path that ships React 1.0 without a broken Vue 1.0 alongside.

## Open Questions

- Does PR #245's component naming match React's where it should? E.g. is the Vue `BasicToolbar.vue` the same surface as React's `Toolbar.tsx`, or did the contributor rename for Vue idiom? Affects the parity matrix structure — answered during the audit task.
- Does PR #245 use SFC `<script setup>` consistently, or mix styles? Standardize on `<script setup lang="ts">` everywhere if not.
- What's the agent SDK story for Vue? React has `@eigenpal/docx-editor-agents/react` with hook-based subscriptions. Vue would need composable equivalents. **Tentative answer:** out of v1 scope; document as a known omission and file a follow-up issue.
- Can we share i18n string lookup between adapters? React's `useTranslation` hook returns `t(key)`. Vue would need a composable `useTranslation()` returning the same `t`. Probably trivial; confirm during implementation.
- Does the Vue example need its own DocxEditor demo separate from the existing `examples/vue/`, or is one demo enough? **Tentative answer:** one demo, the existing `examples/vue/` becomes the real demo replacing the placeholder.
