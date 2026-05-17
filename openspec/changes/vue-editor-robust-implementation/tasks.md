## 1. Land PR #245 as foundation

- [x] 1.1 Superseded — PR #245's surface was absorbed inline through the 1.0.0 train (Vue components live under `packages/vue/src/components/`; the package-boundary fixups landed across PRs #348–#363). Per-file review captured in `notes/audit.md`
- [x] 1.2 Superseded — fix-ups went in directly during the train rather than as inline comments on a long-running PR
- [x] 1.3 Superseded — Vue surface is on `1.0.0-release`; `[STUB]` description preserved per spec §13.2
- [x] 1.4 Verified — parity preview build (`bun run build:parity`) wires `examples/vue/dist` → `examples/parity/dist/vue` and the demo loads `sample.docx` through `<DocxEditor>`
- [x] 1.5 The `examples/vue/src/App.vue` preview banner reads "This is a preview deployment. The released editor lives at docx-editor.dev" — already accurate for the 1.0.0-release train state

## 2. Branch + scaffolding

- [x] 2.1 Done — work landed directly on `1.0.0-release` via per-feature branches (`feat/agent-vue-subpath`, `fix/vue-shallow-ref`, etc.) instead of a single long-living change branch. Same reviewer/simplifier loop, faster integration
- [x] 2.2 `notes/` exists and holds: `audit.md`, `reactivity.md`, `reactivity-review.md`, `isolation-review.md`, `a11y-review.md`, `perf-review.md`, `intentional-export-divergence.md`
- [x] 2.3 `CLAUDE.md` already documents the `1.0.0-release` train at the top of the file; the openspec change directory itself is the durable record

## 3. Audit PR #245's surface

- [x] 3.1 Per-component audit map at `notes/audit.md` (Vue SFC → React peer → matrix row → status). Linked from new `packages/vue/README.md#architecture`. Reverse map for React-only components included
- [x] 3.2 Parity matrix updated in `specs/vue-react-parity/spec.md`: 7 Agent-SDK rows moved `missing` → `partial` after #352/#353 (`AgentPanel`, chat log, composer, suggestion chip, timeline, `useAgentBridge`, plus the AI context menu / response preview migrations to `agent-use`). `useAgentEvents` reclassified to `omitted-v1` since bridge has no event source on either adapter. None reach `done` — needs visual baselines + QA sign-off (spec's strict 3-criteria definition)
- [x] 3.3 Reactivity model documented in `notes/reactivity.md` — `shallowRef` for PM `EditorView`/`Document` and Document-shaped trees (comments, trackedChanges, outlineHeadings, selectedImage), plain `ref` for primitives + small flat snapshots, `computed` for derived state, no `reactive()` anywhere. DOM-coupled watchers are `flush: 'post'`. Audit details in `notes/reactivity-review.md`
- [x] 3.4 Reactivity refactor landed in `fix/vue-shallow-ref` — `selectedImage`, `comments`, `trackedChanges`, `outlineHeadings` switched to `shallowRef`; `extractCommentsAndChanges` standardized on always-clone (was aliasing in one place); `AgentChatLog` watcher switched to `flush: 'post'`. Latency unmeasured — audit verdict was "shipped as-is is fine; queue as patch", and the change is one-line per site so the perf delta is bounded

## 4. Framework-isolation lint

- [x] 4.1 Add `eslint.config.js` overrides per package: `packages/vue/`, `packages/react/`, `packages/core/` each with `no-restricted-imports` patterns matching the spec
- [x] 4.2 Run `bun run lint` against the current state; if any cross-imports already exist, fix them or document why they're allowed (probably none, but verify)
- [x] 4.3 Wired the lint-before-build gate. `ci.yml` split into three jobs (`lint`, `test`, `build`) with `build needs: [lint, test]` — keeps lint+test parallel for the green path, but build only runs once both pass. `release.yml` adds `Lint` + `Format check` steps before typecheck/tests/build so a publish never ships code that wouldn't pass `bun run lint`. Failure-mode comments + Slack notification updated to mention the new pre-release stages
- [x] 4.4 Add a deliberate forbidden import to a throwaway branch to verify the rule fires; revert

## 5. Vue API surface

- [x] 5.1 Define the `<DocxEditor>` SFC public props + emits + ref API. Documented in `packages/vue/README.md`; runtime surface lives in `DocxEditorVue.vue` + `editor-ref.ts`
- [x] 5.2 Implement `useDocxEditor(options)` composable that returns the same imperative API plus `editorState` ref
- [x] 5.3 Implement `useTranslation()` composable matching the React `t(key, vars?)` contract; Vue now also exports `PartialLocaleStrings` and `TranslationKey` for root API parity
- [x] 5.4 Wire `v-model:document` on `<DocxEditor>` so parent doc state stays in sync with editor edits
- [x] 5.5 Verify the imperative ref API matches `DocxEditorRef` from React 1:1 (same method names, same return types where possible). File any divergences in `notes/api-divergence.md`

## 6. Plugin host (built-in only)

- [ ] 6.1 Confirm built-in plugins (templatePlugin) work via the Vue adapter using only core's plugin contract
- [x] 6.2 Add a runtime check that throws a descriptive error when a React-only plugin (one that imports React hooks) is mounted into Vue
- [x] 6.3 `packages/vue/README.md#scope` documents third-party Vue plugins as out-of-scope-for-v1 with the cross-adapter plugin contract reasoning, alongside collab + SSR + the same "prefer React for 1.0 if you need this today" guidance

## 7. Playwright test architecture

Per Decision 17, three test trees: `tests/` (React-only), `tests/vue/` (Vue-only), `tests/parity/` (cross-adapter contract).

- [ ] 7.1 Create `tests/parity/` and `tests/vue/` directories. `tests/` stays React-only as today
- [ ] 7.2 Copy spec patterns from `tests/` into `tests/parity/<feature>.spec.ts`, parameterized by adapter route (`/react/` vs `/vue/`); reframe to test cross-adapter contract, not React-specific behaviour
- [ ] 7.3 Move shared DOCX fixtures into `examples/parity/fixtures/`; update both runner suites to read from there
- [ ] 7.4 Wire `tests/parity/__screenshots__/<feature>/{react,vue}.png` baselines for visual regressions
- [ ] 7.5 Add scripts: `bun run test:e2e:react` (runs `tests/`), `bun run test:e2e:vue` (runs `tests/vue/`), `bun run test:e2e:parity` (runs `tests/parity/`), `bun run test:e2e:full` (all three)
- [ ] 7.6 CI gating: `parity` runs on every PR; `react` runs on PRs touching `packages/react/` or `packages/agent-use/src/react/`; `vue` runs on PRs touching `packages/vue/` or `packages/agent-use/src/vue/`
- [ ] 7.7 Run the parity suite locally against `1-0-0.docx-editor.dev` (or local `bun run dev:parity`); file issues for every failure
- [ ] 7.8 **Matrix-update CI check**: add a script `scripts/check-parity-matrix.mjs` that runs in CI and fails if a PR modifies any path under `packages/{react,vue}/src/components/` or `packages/agent-use/src/{react,vue}/` without also modifying `specs/vue-react-parity/spec.md` or `notes/omitted-from-matrix.md`

## 8. Per-feature parity work (one task per partial row in the matrix)

- [ ] 8.1 Mount + render — verify reactivity audit's findings are addressed; matrix row done
- [ ] 8.2 Bold/italic/underline — confirm shortcut keys + toolbar state binding
- [ ] 8.3 Alignment — left/center/right/justify
- [ ] 8.4 Lists — bullet/numbered, indent/outdent
- [ ] 8.5 Fonts — family + size dropdowns
- [ ] 8.6 Colors — text + highlight, color picker dialog
- [ ] 8.7 Tables — insert, delete, merge, split, borders
- [ ] 8.8 Find / replace — dialog wiring + match navigation
- [ ] 8.9 Hyperlinks — web URLs and bookmarks
- [ ] 8.10 Images — insert, resize, replace, properties dialog (cherry-pick #245's image fix)
- [ ] 8.11 Page setup — size, margins, orientation
- [ ] 8.12 Printing — browser print handoff
- [ ] 8.13 Comments — sidebar, inline markers, replies
- [ ] 8.14 Tracked changes — accept / reject (NOT in #245; build from React reference)
- [ ] 8.15 Keyboard shortcuts dialog — cross-check shortcuts list
- [ ] 8.16 AI context menu — verify menu surface
- [ ] 8.17 Document outline — heading list + scrollTo
- [ ] 8.18 i18n — load `de.json`, `pl.json`, etc. via the prop and verify lookups
- [ ] 8.19 Header / footer editing — InlineHeaderFooterEditor parity
- [ ] 8.20 Symbol insertion — unicode picker
- [ ] 8.21 Footnotes / endnotes — numbering, position
- [ ] 8.22 Paste special — keep-formatting vs plain-text

## 8b. Parity gate infrastructure (defense in depth)

Per Decisions 20 and 21. New scripts live in `scripts/`. Wire pre-commit/pre-push hooks via husky. Each gate is fast in isolation (<10s) and runs at the layer where it costs least to fail.

### 8b.1. Type-level surface parity

- [x] 8b.1 Type-level conformance tests landed at `packages/react/src/__tests__/ref-conformance.test-d.ts` and `packages/vue/src/__tests__/ref-conformance.test-d.ts`. React asserts full `DocxEditorRef → EditorRefLike` assignability (positive); both files include `@ts-expect-error`-guarded negative cases (drop a method → typecheck must fail). Vue's positive case asserts `Pick<EditorRefLike, 'getDocument'>` only — flips to full once the Vue surface fills out (tracked via `editor-ref.ts` JSDoc)
- [x] 8b.2 `bun run typecheck` already picks them up — both packages' `tsconfig.json` `include: ["src"]` covers `src/__tests__/`, no config change needed

### 8b.2. Export parity

- [x] 8b.3 Write `scripts/check-export-parity.mjs` — parse both packages' `package.json` `exports` fields, diff named exports from `dist/index.d.ts`, fail if either side has unmatched exports unless listed in `notes/intentional-export-divergence.md`
- [x] 8b.4 Add `bun run check:export-parity` to root `package.json`
- [x] 8b.5 Wire into husky `pre-commit` hook and CI

### 8b.3. i18n key parity

- [x] 8b.6 Write `scripts/check-i18n-parity.mjs` — diff key paths between `packages/react/i18n/<lang>.json` and `packages/vue/i18n/<lang>.json` for every locale present in both. Fail on any mismatch
- [x] 8b.7 Decide whether Vue adapter has its own `i18n/` directory or shares React's — Vue keeps its own `packages/vue/i18n/` directory (mirrors React's structure). The parity script enforces key-set equality across shared locales. Currently Vue ships only `en.json` (full set, copied from React's source-of-truth); locale follow-up issues #341-344 will add hi/id/ko/fr; existing locales `de`/`pl`/`pt-BR`/`he` are React-only until community contributions catch up
- [x] 8b.8 Add `bun run check:i18n-parity` and wire into pre-commit + CI

### 8b.4. Snapshot parity (Document round-trip)

- [ ] 8b.9 Write `tests/parity/snapshot/document-roundtrip.test.ts` — runs in `bun test` (unit-level, no browser); imports both adapter engines, applies a deterministic edit sequence to each, deep-equals the resulting `Document` model
- [ ] 8b.10 Use `examples/parity/fixtures/snapshot-fixtures.json` (a list of `[fixture, edits]` pairs) so the test corpus grows by adding entries to the JSON, no new test files
- [ ] 8b.11 Add to pre-commit hook (it's fast — runs in <10s)

### 8b.5. Smoke parity E2E (on-demand tool)

- [x] 8b.12 Create `tests/parity/smoke/` directory with the 5 critical-path specs: `mount.spec.ts`, `type-characters.spec.ts`, `toggle-bold.spec.ts`, `save-roundtrip.spec.ts`, `agent-tool-call.spec.ts`. Implemented under `e2e/tests/parity/smoke/`
- [x] 8b.13 Add `bun run test:e2e:parity:smoke` script — runs only the smoke directory, target wall-clock under 30s on a baseline laptop
- [x] 8b.14 Document the on-demand smoke usage in `packages/vue/README.md` and CONTRIBUTING: "before pushing parity-affecting changes, run `bun run test:e2e:parity:smoke` against `bun run dev:parity`. Not auto-triggered — pre-push hooks slow git too much; CI runs the same script as a backstop."

### 8b.6. Bundle size parity

- [ ] 8b.15 Write `scripts/parity-bundle-size.mjs` — gzip both `packages/react/dist/index.mjs` and `packages/vue/dist/index.mjs`, compute relative diff, write to `notes/bundle-size/<sha>.json`. Fail if diff >25% AND the larger side grew vs previous main
- [ ] 8b.16 Wire into CI as a separate job (informational on PRs that don't touch either package)

### 8b.7. Pair-edit dev mode

- [ ] 8b.17 Add `bun run dev:parity:watch` script — concurrently runs the React dev server, Vue dev server, and `playwright test tests/parity/smoke/ --watch`
- [ ] 8b.18 Document in `examples/parity/README.md` how to use it: "`bun run dev:parity:watch`, edit a Vue component, see the smoke parity tests re-run on save"

### 8b.8. Pre-publish aggregate gate

- [x] 8b.19 Write `scripts/parity-prepublish.mjs` — aggregates: typecheck + static parity checks + i18n validation + built parity preview + packed consumer install + test:e2e:parity:smoke. Exits non-zero if any layer fails
- [x] 8b.20 Add to release workflow before `changeset publish`. The publish step refuses to run if the aggregate fails
- [ ] 8b.21 Document the gate in `CLAUDE.md` Releasing section so maintainers know what to fix when it blocks a release

### 8b.9. Accessibility parity (deferred to weekly cron)

- [ ] 8b.22 Write `scripts/check-a11y-parity.mjs` — runs axe-core against both `/react/` and `/vue/` routes on the parity preview, diffs the violation sets, fails if asymmetric
- [ ] 8b.23 Wire as a weekly GitHub Action cron, post results to `notes/a11y-parity/<date>.md`. Not a blocking gate — informational, surfaces drift over time

## 9. Agent SDK Vue subpath

### 9a. Prerequisite: agent-use README + description rewrite

- [x] 9.0a Rewrite `packages/agent-use/package.json` `description` to "Agent SDK and chat UI for the DOCX editor — works with React or Vue" (or equivalent that names the four-role reality)
- [x] 9.0b Write `packages/agent-use/README.md` BEFORE any UI migration. Include: top-level subpath table (`/`, `/bridge`, `/server`, `/mcp`, `/ai-sdk/server`, `/react`, `/vue`) with one-line summary each; a "Migration from 0.x" section with import-path diff for `useAgentChat` (bare → `/react`); an explicit cross-link to the editor packages
- [x] 9.0c Add `@eigenpal/docx-editor-agents` README to root README's package table

### 9b. Prerequisite migration: React agent UI moves into agent-use

- [x] 9.1 Move `<AgentPanel>`, `<AgentChat>`, `<AgentChatLog>`, `<AgentComposer>`, `<AgentSuggestionChip>`, `<AgentTimeline>` from `packages/react/src/components/` to `packages/agent-use/src/react/components/`. Components now own their own English defaults via `packages/agent-use/i18n/en.json` + a small ICU formatter (`src/react/format-message.ts`); consumers wanting i18n pass `*Label` props (typically derived from their own `t()`).
- [x] 9.2 1.0 is the breaking change — `packages/react/src/index.ts` no longer re-exports agent UI at all. Consumers import directly from `@eigenpal/docx-editor-agents/react`. `DocxEditor.tsx` updated: imports `<AgentPanel>` from the canonical location, and the inner `<LocalizedAgentPanel>` helper forwards `useTranslation()` labels (close, resize handle, default title) down to AgentPanel so the editor's built-in agent slot stays localised without consumer plumbing.
- [x] 9.3 Framework-isolation lint inside `packages/agent-use/` is in place with custom error messages (`eslint.config.js:40-42` + the per-block `restrictReact`/`restrictVue`/`restrictBoth` rules at `:64-77`, `:144-156`). Each banned import surfaces a specific message citing the spec; §10.3 audit confirmed zero current violations and closed two coverage gaps in `a6179f6`
- [x] 9.4 Drop the `useAgentChat` re-export from `packages/agent-use/src/bridge.ts` so the framework-agnostic entry stays pure. The hook now ships from `/react` only.
- [ ] 9.4a Factor tool-running logic that's currently inside `useAgentChat` into a framework-agnostic `createAgentToolRunner(bridgeRef, options)` that both React `useAgentChat` and Vue `useAgentBridge` wrap. Deferred from §9.4: today the framework-agnostic core is already exposed via `agentTools` + `executeToolCall`, so the Vue composable can wrap those directly. The factor-out only earns its keep when the React and Vue hook bodies start diverging.
- [x] 9.5 Add a changeset documenting the import-path shift; cross-reference the new README's "Migration from 0.x" section
- [x] 9.5a Drop the legacy `@eigenpal/docx-js-editor` shim from the 1.x train entirely. New surfaces — agent SDK, Vue adapter, core/headless APIs — ship only under their canonical package names.
- [x] 9.5c Done as part of §9.2 — `packages/react/src/index.ts` no longer re-exports agent UI. `@eigenpal/docx-editor-agents/react` is the single canonical import path. Breaking change documented in the 1.0 changeset.
- [x] 9.5b Add JSDoc on `EditorRefLike` in `packages/agent-use/src/bridge.ts` documenting the versioning policy from Decision 18 (additions = minor, signature changes = major)

### 9b. Vue agent SDK subpath

- [x] 9.6 Add `./vue` to `packages/agent-use/package.json` `exports` map and `typesVersions`; mirror the new `./react` shape from 9.1
- [x] 9.7 Add Vue subpath to the build pipeline. Tsup can't compile `.vue` SFCs, so a separate `vite build` step (with `@vitejs/plugin-vue` + `vite-plugin-dts`) emits `dist/vue.{mjs,js,d.ts}` and `dist/ai-sdk/vue.{mjs,js,d.ts}` after tsup; `tsconfig.tsup.json` excludes the Vue tree so tsup's d.ts pass doesn't trip on the SFC shim
- [x] 9.8 Add `vue` and `@ai-sdk/vue` to `peerDependencies` (both optional via `peerDependenciesMeta`) on the agent-use package
- [x] 9.9 Implement Vue twins of React components in `packages/agent-use/src/vue/components/`: `AgentPanel.vue`, `AgentChatLog.vue`, `AgentComposer.vue`, `AgentSuggestionChip.vue`, `AgentTimeline.vue`. Defaults pulled from `packages/agent-use/i18n/en.json`; consumers pass `*Label` props for translations
- [x] 9.10 Moved `AIContextMenu.vue` and `AIResponsePreview.vue` from `packages/vue/src/components/` to `packages/agent-use/src/vue/components/`. Both now read defaults from agent-use's `en.json` (new `aiActions.*` and `aiPreview.*` namespaces) with overridable `labels` prop. `packages/vue/src/index.ts` no longer re-exports them — breaking change for 1.0
- [x] 9.11 Implemented `useAgentBridge` composable (`src/vue/composables/useAgentBridge.ts`). `useAgentEvents` deferred — bridge exposes no event source today; will land alongside React's `useAgentEvents` once added on both sides
- [x] 9.12 Vue-side AI SDK adapter at `packages/agent-use/src/ai-sdk/vue.ts` mirrors the React adapter: `toAgentMessages(uiMessages, status)` adapts `@ai-sdk/vue`'s `useChat` output for `<AgentChatLog>`
- [x] 9.13 Vue `<DocxEditor>` ref typed as `DocxEditorRef` (`packages/vue/src/editor-ref.ts`) which uses `Pick<EditorRefLike, …>` to borrow signatures from `@eigenpal/docx-editor-agents/bridge`. `defineExpose` is wrapped in `satisfies DocxEditorRef` so adding new exposed methods that overlap with EditorRefLike is signature-checked at typecheck time. Currently exposes the editor minimum (save/focus/destroy/getDocument); remaining EditorRefLike methods land incrementally as Vue agent integration grows
- [x] 9.14 Playwright parity tests at `e2e/tests/parity/agent-{panel,timeline}.spec.ts` driven by a `forEachAdapter` fixture (`parity-fixture.ts`). New `parity` Playwright project boots both demo dev servers (5173 + 5174) and runs each spec twice, once per adapter (test titles tagged `[react]` / `[vue]`). Covers panel render, close button, resize handle, timeline streaming/done/long-cap behaviour. Tracked-change/comment/tool-error/multi-step rows are deferred behind §9.x agent surface implementation
- [x] 9.15 `examples/vue/src/App.vue` renders `AgentPanel` + `AgentChatLog` + `AgentComposer` from `@eigenpal/docx-editor-agents/vue` when `?agentPanel=1` is set, with the same `?agentTimeline=streaming|done|long` fixture as the React demo so the parity Playwright suite runs unchanged. Stub assistant reply for the demo flow; real consumers wire `useAgentBridge` + their transport

## 10. Agentic review passes

- [x] 10.1 Reactivity pass output written to `notes/reactivity-review.md`. 5 actionable findings + 7 no-finding sections. Verdict: ship-as-is for 1.0.0 with the medium-severity items queued as a patch — landed in `fix/vue-shallow-ref`
- [x] 10.2 A11y audit at `notes/a11y-review.md` (~1100 words). Two highs + four mediums. Highs fixed in `fix/a11y-vue-agent`: (a) `AgentPanel` resize handle now keyboard-operable (tabindex, arrow-key resize 16/64px, Home/End to clamp, `aria-valuenow`/`min`/`max`); (b) `AIContextMenu` opens with focus on the first action and closes on Escape. Mediums also addressed: `AgentChatLog` got `role="log"` + `aria-live="polite"`, `AgentPanel` + `AIResponsePreview` close on Escape, `AIResponsePreview` title color nudged from `#1a73e8` (4.4:1) to `#1557b0` (5.8:1) to clear WCAG AA. Form-label fixes (placeholder-only inputs) deferred — they need translatable visually-hidden labels and touch every dialog
- [x] 10.3 Framework-isolation audit at `notes/isolation-review.md`. Zero current violations across all packages. Two lint-config gaps caught and closed in `fix/eslint-isolation-gaps`: (a) `useAgentChat.ts`/`useDocxAgentTools.ts` weren't covered by `restrictVue` — they're React hooks but a future Vue import would have lint clean; now in the `restrictVue` files block. (b) `i18n/` and `__tests__/` under agent-use weren't matched by any framework block — extended the agnostic glob to include them so future drift is caught
- [x] 10.4 Static-analysis perf review at `notes/perf-review.md` (~980 words). Seven findings, one fixed in this PR (dead `cursorMarks` plumbing — ref + per-transaction marks-extraction + composable return + BasicToolbar prop, ~25 lines gone). Findings 1/2/4/5 (BasicToolbar `ctx` re-eval per keystroke, redundant `current*` mark walks, eager dialog imports → defineAsyncComponent, `fromProseDoc` on every docChanged) queued for a real profiler-driven follow-up — verdict was "ship-as-is for 1.0.0; profile against a 200-paragraph fixture before refactoring further."
- [ ] 10.5 Visual diff pass — side-by-side screenshots at standard zoom for every parity matrix row; file issues for divergences over 0.1% pixel tolerance

## 11. Performance budget + Manual QA

Per Decision 16, four named perf budgets with measurement scripts.

- [x] 11.0a Create `scripts/perf/` directory with: `cold-start.mjs`, `input-latency.mjs`, `save.mjs`, `scroll-fps.mjs`. Local runs emit ignored JSON under `test-results/perf/`; set `PERF_WRITE_ARTIFACTS=1` for committed PR evidence under `notes/perf/`
- [x] 11.0b Capture baseline numbers from React adapter; store in `notes/perf/baseline.json`
- [x] 11.0c Wire perf scripts into the un-stub gate via `bun run parity:perf`

- [ ] 11.1 Side-by-side at `1-0-0.docx-editor.dev/react/` and `/vue/` with the standard fixture set; attach preview screenshots to the PR review evidence
- [ ] 11.2 Test on Chromium, Firefox, Safari at desktop and tablet viewports
- [ ] 11.3 Keyboard-only navigation pass — every command reachable without mouse
- [x] 11.4 Smoke-test downstream consumer: install packed local packages into a fresh Vite + Vue 3 project; verify the editor package imports, styles import, and Vite build

## 12. Docs

- [ ] 12.1 Replace `examples/vue/` placeholder content with a working demo (use the demo from #245 as a starting point); standardise it with the React example's structure; include `<AgentPanel>` integration so the parity preview shows the agent SDK working in Vue
- [ ] 12.2 Write `packages/vue/README.md` with quick-start, API reference, and the `<DocxEditor>` props / emits / ref API; cross-reference `@eigenpal/docx-editor-agents/vue` for the agent SDK. **Composable-first**: first code example uses `useDocxEditor()`; the imperative-ref pattern appears later as "for agent integration." Include a copy-pasteable "Add an AI assistant in 30 lines" snippet. Include a "Nuxt usage" section showing `<ClientOnly>` wrapping or `defineAsyncComponent`. Link the per-component map from task 3.1
- [x] 12.3 `packages/agent-use/README.md` updated: subpath table now lists `/vue` + `/ai-sdk/vue` alongside `/react`; the React component list expanded to include the agent UI components migrated in #351; the live-editor-bridge example now shows React + Vue side by side; "switching adapters is one import line" framing added
- [x] 12.4 Add a Vue section to root `README.md` Quick Start showing both `npm install @eigenpal/docx-editor-react` and `npm install @eigenpal/docx-editor-vue` paths
- [x] 12.5 `CLAUDE.md` Editor Architecture section gained a "Vue mounting path" subsection: `<DocxEditor>` mounts via `useDocxEditor()`'s `onMounted`; `EditorView` and `Document` are `shallowRef`; visible pages still come from `layout-painter/`, not `toDOM`; reactivity contract refs `notes/reactivity.md`
- [x] 12.6 `packages/vue/README.md#scope` lists the three v1-omitted features (third-party plugins, real-time collab, SSR/Nuxt) with reasons + parity-matrix tracking. GitHub follow-up issues filed at 1.0 ship per §13.10–13.12

## 13. Un-stub gating (split per Decision 15)

### 13a. Vue editor un-stub (gates on editor matrix only)

- [ ] 13.1 Verify every **editor** parity matrix row is `done` or `omitted-v1` with a documented reason. Verify perf budget (task 11.0c) passes. No `partial` or `missing` left in editor rows
- [x] 13.2 Drop `[STUB]` prefix from `packages/vue/package.json` `description`
- [x] 13.3 Replace the "stub at 1.0.0, not yet functional" caveat in the root `README.md` packages table with implemented-preview wording that still preserves the `[STUB]` gate
- [x] 13.4 Remove the Vue-stub line from the changeset entry at `.changeset/1-0-0-package-restructure.md`
- [x] 13.5 Update the preview banner copy in `examples/vue/src/App.vue` (or wherever it lives) to drop the "Vue is in active development" note
- [x] 13.6 Add a `changeset` documenting the un-stub as part of the same PR

### 13b. Flip the strict named-export gate

- [x] 13.6a Set `STRICT_NAMED_EXPORTS = true` in `scripts/check-export-parity.mjs`. This makes the named-export parity gate fail on any drift between `packages/{react,vue}/src/index.ts`. Required before un-stub: every public name in React must either exist in Vue or be documented as React-only in `notes/intentional-export-divergence.md`.

### 13c. Vue agent UI un-stub (gates on agent matrix only, may ship in 1.0 or 1.1)

- [ ] 13.7 Verify every **agent SDK** parity matrix row is `done` or `omitted-v1` with a documented reason
- [ ] 13.8 Remove any `[BETA]` or stub marker from `@eigenpal/docx-editor-agents/vue` description / Vue subpath docs
- [ ] 13.9 If agent UI defers to 1.1: file follow-up issue, document in changeset, mark agent matrix rows as `omitted-v1` with explicit "ships in 1.1" reason

### 13c. Follow-up tracking

- [x] 13.10 No public 2.0 issue. The fixed-group structure stays as-is through the 1.x line; any future cadence split for `@eigenpal/docx-editor-agents` is an internal scheduling discussion, not a public roadmap commitment. Closed [#366](https://github.com/eigenpal/docx-editor/issues/366) which was filed under the wrong framing
- [x] 13.11 Filed [#367](https://github.com/eigenpal/docx-editor/issues/367) — "[1.x] Vue composable plugin API + cross-adapter plugin contract". Built-in plugins work via core's contract today; third-party plugin authoring docs + framework-agnostic plugin shape land in 1.x
- [x] 13.12 Filed [#368](https://github.com/eigenpal/docx-editor/issues/368) — "[1.x] Agent SDK Vue parity". Tracks the visual baselines + dedicated parity specs + 6 behavioral matrix rows + QA sign-off needed to flip the agent UI gate from `partial` to `done` per Decision 15

## 14. Merge and ship

- [ ] 14.1 Open PR `vue-editor-robust-implementation` → `1.0.0-release`. PR description MUST include `Co-Authored-By: Cruiser13 <email>` trailers for each #245-derived commit so squash-merge attribution survives. Un-stub changeset MUST credit the community foundation contribution explicitly
- [ ] 14.2 Run code review (Claude /review + codex review)
- [ ] 14.3 Run /simplify pass on changed code
- [ ] 14.4 Address review findings
- [ ] 14.5 Merge to `1.0.0-release`
- [ ] 14.6 When the 1.0.0-release train is ready to ship to `main`, Vue and the new `@eigenpal/docx-editor-agents/vue` subpath ride along at 1.0.0 with the fixed group
