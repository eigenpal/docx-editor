## ADDED Requirements

### Requirement: Behavioural parity with React adapter

For every feature in the React adapter's v1 scope (editing, formatting, lists, tables, comments, tracked changes, find/replace, hyperlinks, images, page setup, printing, i18n, keyboard shortcuts), the Vue adapter SHALL produce the same observable result given the same input. Specifically: same `Document` input → same on-page rendering, same DOCX bytes on save, same keyboard shortcuts trigger the same commands, same i18n strings appear in the same UI surfaces.

#### Scenario: Same DOCX renders identically

- **WHEN** the same fixture DOCX is mounted in `<DocxEditor>` (Vue) and `<DocxEditor>` (React) at the same viewport size and zoom
- **THEN** the rendered HTML structure within the editor's content area produces matching screenshots within a 0.1% pixel tolerance
- **AND** both adapters report the same page count, paragraph count, and computed page break positions

#### Scenario: Same edit produces same DOCX bytes

- **WHEN** identical edit sequences (typed characters, formatting commands, paragraph operations) are applied to both adapters via their respective imperative APIs
- **THEN** the bytes returned from `save()` are byte-equal
- **AND** the resulting DOCX opens cleanly in Microsoft Word

#### Scenario: Keyboard shortcut parity

- **WHEN** a user presses `Ctrl+B` (or `Cmd+B` on macOS) with a non-empty selection in either adapter
- **THEN** both apply the bold mark to the selected text
- **AND** the toolbar bold-button state updates simultaneously
- **AND** the same shortcut dispatch path is exercised in both (commands resolved through `@eigenpal/docx-editor-core`, not duplicated per-adapter)

### Requirement: Per-component parity matrix

The change SHALL maintain a parity matrix in this spec file with one row per UI component / feature area. Each row tracks: feature name, React status, Vue status, parity test reference, notes. Statuses are `done`, `partial`, `missing`, or `omitted-v1`. The matrix is the source of truth for "what's left to ship." Implementation PRs touching a feature MUST update the corresponding row.

**Definition of `done`** (all three SHALL hold):

1. The corresponding `tests/parity/<feature>.spec.ts` is green for both `/react/` and `/vue/` routes on the parity preview.
2. Visual regression diff against the baseline screenshots in `tests/parity/__screenshots__/<feature>/` is under 0.1% pixel tolerance.
3. The feature is signed off in `notes/qa-signoff.md` after a manual side-by-side QA at `1-0-0.docx-editor.dev/{react,vue}/`.

A PR may not move a row to `done` without all three. `partial` means at least one criterion is met but not all; `missing` means none are met; `omitted-v1` means deliberately deferred with a documented reason in the notes column.

**Matrix lifecycle.** The matrix is a living artifact through the 1.x line. Rows that are stably `done`/`done` (both React and Vue at `done` for ≥2 minor releases without churn) collapse into a single "parity baseline" assertion at the top of the spec; only `partial`/`missing`/`omitted` rows stay enumerated. This prevents the matrix from growing unbounded as the editor adds features.

**Matrix-update enforcement.** A CI check SHALL diff PR file paths: any PR that modifies a path under `packages/react/src/components/`, `packages/agent-use/src/react/`, `packages/vue/src/components/`, or `packages/agent-use/src/vue/` MUST also modify either `specs/vue-react-parity/spec.md` (the matrix) or `omitted-from-matrix.md` (an explicit opt-out file in the same directory). Missing the update fails CI.

The current matrix:

| Feature                          | React | Vue        | Parity test                                    | Notes                                                                                                               |
| -------------------------------- | ----- | ---------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Mount + render DOCX              | done  | done       | e2e/tests/parity/smoke/mount.spec.ts           | Covered by smoke parity, local visual screenshots, and QA evidence in `notes/qa-signoff.md`                         |
| Bold/italic/underline            | done  | done       | e2e/tests/parity/smoke/toggle-bold.spec.ts     | Bridge formatting smoke covers bold; italic/underline share the same core command path                              |
| Alignment                        | done  | done       | tests/parity/alignment.spec.ts                 | Vue toolbar dispatches shared core alignment commands; covered by editor contract and local QA evidence             |
| Bullet & numbered lists          | done  | done       | tests/parity/lists.spec.ts                     | Vue toolbar dispatches shared core list commands; covered by editor contract and local QA evidence                  |
| Indent / outdent                 | done  | done       | tests/parity/lists.spec.ts                     | Vue toolbar dispatches shared core indent commands; covered by editor contract and local QA evidence                |
| Font family + size               | done  | done       | tests/parity/fonts.spec.ts                     | Vue picker surface is implemented and wired through shared formatting commands                                      |
| Text color + highlight           | done  | done       | tests/parity/colors.spec.ts                    | Vue picker surface is implemented and wired through shared formatting commands                                      |
| Tables — insert / edit / delete  | done  | done       | tests/parity/tables.spec.ts                    | Vue table toolbar, selection, merge/split, borders, and cell operations are implemented                             |
| Find / replace                   | done  | done       | tests/parity/find-replace.spec.ts              | Vue uses shared i18n keys for labels, counts, titles, controls, and match navigation                                |
| Hyperlinks                       | done  | done       | tests/parity/hyperlinks.spec.ts                | Vue supports web-address/bookmark tabs, URL validation, and bookmark submission                                     |
| Image insert / resize / replace  | done  | done       | tests/parity/images.spec.ts                    | Vue overlay has 8 handles, rotation, drag ghost, live dimensions, aspect-lock resizing, and selected-image menu     |
| Page setup (size, margins, etc.) | done  | done       | tests/parity/page-setup.spec.ts                | Vue dialog is wired to section properties and shared page setup commands                                            |
| Printing                         | done  | done       | tests/parity/print.spec.ts                     | Browser print handoff is implemented through the Vue toolbar/menu path                                              |
| Comments                         | done  | done       | e2e/tests/parity/smoke/agent-tool-call.spec.ts | Sidebar, inline markers, replies, and bridge comment insertion are implemented                                      |
| Tracked changes                  | done  | done       | tests/parity/tracked-changes.spec.ts           | Vue extracts tracked changes, renders sidebar cards, and wires accept/reject through shared core commands           |
| Keyboard shortcuts dialog        | done  | done       | tests/parity/keyboard-shortcuts.spec.ts        | Dialog is implemented and localized through shared i18n keys                                                        |
| AI context menu                  | done  | done       | tests/parity/ai-context-menu.spec.ts           | Vue menu is implemented through `@eigenpal/docx-editor-agents/vue`                                                  |
| Document outline                 | done  | done       | tests/parity/document-outline.spec.ts          | Vue outline is implemented with heading navigation                                                                  |
| i18n (locale switching)          | done  | done       | tests/parity/i18n.spec.ts                      | Vue `i18n` prop provides reactive shared-locale fallback; shared locale validation passes                           |
| Header / footer editing          | done  | done       | tests/parity/header-footer.spec.ts             | Inline header/footer editor is implemented in Vue                                                                   |
| Symbol insertion                 | done  | done       | tests/parity/symbols.spec.ts                   | Vue empty/recent UI strings use shared i18n keys and symbol insertion is wired                                      |
| Footnotes / endnotes             | done  | done       | tests/parity/footnotes.spec.ts                 | Vue number-format labels react to locale changes and footnote properties dialog is implemented                      |
| Paste special                    | done  | done       | tests/parity/paste-special.spec.ts             | Vue dialog uses shared i18n keys and paste mode handling is implemented                                             |
| Plugin API — built-in plugins    | done  | done       | tests/parity/plugin-api.spec.ts                | Vue accepts external PM plugins, forwards decorations, and rejects React-only plugin shapes with descriptive errors |
| Plugin API — third-party plugins | done  | omitted-v1 | n/a                                            | Vue composable plugin contract is post-v1                                                                           |
| Agent SDK — `<AgentPanel>`       | done  | partial    | e2e/tests/parity/agent-panel.spec.ts           | Shipped #352; spec at `e2e/tests/parity/agent-panel.spec.ts` (3 cases). Pending: visual baselines + QA sign-off     |
| Agent SDK — chat log             | done  | partial    | e2e/tests/parity/agent-timeline.spec.ts        | `AgentChatLog` shipped #352. Exercised via timeline spec; dedicated chat-log spec deferred                          |
| Agent SDK — composer             | done  | partial    | (covered by agent-panel spec)                  | `AgentComposer` shipped #352 (Vue 3 `v-model`). Dedicated parity spec deferred                                      |
| Agent SDK — suggestion chip      | done  | partial    | (no parity spec yet)                           | `AgentSuggestionChip` shipped #352. Parity spec deferred — primitive button, low risk                               |
| Agent SDK — timeline             | done  | partial    | e2e/tests/parity/agent-timeline.spec.ts        | Shipped #352; spec covers streaming/done/long-cap (6 cases). Pending: baselines + QA                                |
| Agent SDK — AI context menu      | done  | partial    | tests/parity/ai-context-menu.spec.ts           | Migrated to `agent-use/src/vue/components/AIContextMenu.vue` in #352; labels prop for i18n                          |
| Agent SDK — AI response preview  | done  | partial    | tests/parity/ai-response-preview.spec.ts       | Migrated to `agent-use/src/vue/components/AIResponsePreview.vue` in #352; labels prop                               |
| Agent SDK — `useAgentBridge`     | done  | partial    | (no parity spec yet)                           | Shipped #352. Mirrors React `useAgentChat`; `author` accepts `MaybeRef<string>`                                     |
| Agent SDK — `useAgentEvents`     | done  | omitted-v1 | n/a                                            | Bridge has no event source today; React doesn't ship this hook either — added to both adapters in 1.x               |
| Agent SDK — tracked-change flow  | done  | missing    | tests/parity/agent-tracked-change.spec.ts      | Agent proposes → preview → accept/reject; same DOCX bytes                                                           |
| Agent SDK — comment threading    | done  | missing    | tests/parity/agent-comment-thread.spec.ts      | Agent `replyTo` lands in same thread shape                                                                          |
| Agent SDK — tool error UI        | done  | missing    | tests/parity/agent-tool-error.spec.ts          | Failure surfaces same copy + retry flow                                                                             |
| Agent SDK — multi-step run       | done  | missing    | tests/parity/agent-multi-step.spec.ts          | Timeline shows steps in same order/state                                                                            |
| Agent SDK — streaming tokens     | done  | missing    | tests/parity/agent-streaming.spec.ts           | Token stream renders without jank in Vue                                                                            |
| Agent SDK — byte-equal tool out  | done  | missing    | tests/parity/agent-bytes.spec.ts               | Same tool sequence → byte-equal DOCX both                                                                           |
| Real-time collaboration          | done  | omitted-v1 | n/a                                            | Yjs binding for Vue is post-v1                                                                                      |
| SSR / Nuxt module                | n/a   | omitted-v1 | n/a                                            | Editor is client-only                                                                                               |

#### Scenario: Matrix accuracy

- **WHEN** an implementation PR is opened that touches a feature listed in the matrix
- **THEN** the PR description references the matrix row being affected
- **AND** the spec file is updated within the same PR to reflect the new status (e.g., `partial` → `done`)

### Requirement: Playwright parity test suite

A parallel Playwright spec suite SHALL exist at `tests/vue/` mirroring the React `tests/` suite, exercising the same fixtures from `examples/parity/fixtures/` against the `/vue/` route on the parity preview deployment. Specs SHALL share fixture corpus but MAY use framework-aware selectors. Both suites SHALL be runnable via standard `bun run test:e2e` invocations.

#### Scenario: Same fixture, both adapters

- **WHEN** Playwright runs `tests/parity/formatting.spec.ts` against both `/react/` and `/vue/` on the parity preview
- **THEN** the same DOCX fixture loads, the same edits are applied via API, the resulting DOM screenshots compare within tolerance
- **AND** the test passes for both routes or fails identifying which adapter diverged

#### Scenario: New parity test required for new matrix row

- **WHEN** a new feature row is added to the parity matrix
- **THEN** a corresponding `tests/parity/<feature>.spec.ts` file SHALL exist before the matrix row can move to `done`

### Requirement: Type-level API surface parity

The Vue and React adapters' public TypeScript surface SHALL be assignable to each other's contract types where the spec demands parity. React's `DocxEditorRef` currently satisfies the full `EditorRefLike` bridge contract from `@eigenpal/docx-editor-agents/bridge`. Vue's `DocxEditorRef` is staged: every bridge method it exposes MUST borrow the `EditorRefLike` signature via `Pick<>`, and the type-level test expands as each method lands. Full Vue assignability flips on before un-stub.

#### Scenario: Vue ref drops an implemented bridge method

- **WHEN** a Vue contributor removes an implemented bridge method such as `getCurrentPage` from the `<DocxEditor>` ref's exposed methods
- **THEN** `bun run typecheck` fails with a type-level test asserting conformance for the implemented `EditorRefLike` subset
- **AND** the failure points at the missing method by name

### Requirement: Export parity check

A pre-commit gate SHALL diff the public exports between `packages/react/package.json` and `packages/vue/package.json` (parsed `exports` field) plus their respective `src/index.ts` named exports (AST-walked recursively across barrel re-exports). Exports listed in one but not the other are flagged unless the missing export appears in `notes/intentional-export-divergence.md` with a documented reason. Walking the source rather than `dist/index.d.ts` avoids a build dependency, resolves through TypeScript path aliases natively, and produces the same name set.

The gate runs in two tiers: subpath drift (the `exports` field) is **strict** and fails the build; named-export drift is **informational** during the 1.0.0 hardening (Vue's surface lags React's by hundreds of names while community PRs catch up) and flips to strict at task §13b on un-stub.

#### Scenario: React adds a new public component, Vue doesn't

- **WHEN** a PR adds `export { NewWidget } from './NewWidget'` to `packages/react/src/index.ts` without a corresponding export in `packages/vue/src/index.ts`
- **THEN** `bun run check:export-parity` fails locally on pre-commit
- **AND** the same script fails in CI as a separate gate

#### Scenario: Documented intentional divergence

- **WHEN** an export is React-only by design (e.g. a React-flavoured hook with no Vue equivalent) and is listed in `notes/intentional-export-divergence.md`
- **THEN** `check:export-parity` accepts it and passes
- **AND** the notes file's existence is the audit trail

### Requirement: i18n key parity

Adapter i18n files (where present) SHALL share the same key set at every locale. A pre-commit gate SHALL diff key paths between `packages/react/i18n/<lang>.json` and `packages/vue/i18n/<lang>.json` (when both exist) and fail if any locale differs in keys. Both adapters MAY share a single source-of-truth i18n directory if the build can route to it; the gate enforces parity regardless of layout.

#### Scenario: Vue i18n file misses a key

- **WHEN** React adds `dialogs.newFeature.title` to `packages/react/i18n/en.json` and the corresponding Vue locale file is not updated
- **THEN** `bun run check:i18n-parity` fails with the missing key path

### Requirement: Snapshot parity (Document round-trip)

A unit-level parity test SHALL feed identical edit sequences to both adapter engines through their respective public APIs and assert the resulting `Document` model is deep-equal. This catches drift in command implementations or schema differences without paying the cost of a full Playwright run.

#### Scenario: Same edit sequence, deep-equal Document

- **WHEN** the snapshot test loads `simple.docx`, applies `[bold(0..5), insertText("hello"), addComment(paraId, "test")]` against both Vue's `useDocxEditor` and React's equivalent, and serialises both back to `Document`
- **THEN** the two `Document` objects are deep-equal
- **AND** any divergence flags the specific path that differs

### Requirement: Smoke parity test (on-demand tool)

A focused subset of parity tests SHALL exist as an on-demand tool callable via `bun run test:e2e:parity:smoke`, completing in under 30 seconds. The smoke set is the critical path: mount fixture, type characters, toggle bold, save, assert byte-equal DOCX output. The set lives at `tests/parity/smoke/` and is also invoked by CI and by the `dev:parity:watch` script. It SHALL NOT be wired as a pre-push hook — opt-in only.

#### Scenario: On-demand smoke run catches critical-path drift

- **WHEN** a contributor runs `bun run test:e2e:parity:smoke` against a local `bun run dev:parity` server before pushing
- **THEN** the run completes in under 30 seconds wall-clock on a baseline laptop
- **AND** it covers at minimum: editor mount, text input, bold toggle, save round-trip
- **AND** failures point at the same spec CI would flag

#### Scenario: CI also runs smoke as a backstop

- **WHEN** a PR opens against `1.0.0-release` or `main`
- **THEN** CI runs `bun run test:e2e:parity:smoke` as a separate job
- **AND** the job is fast enough (<30s + setup) to gate every PR

### Requirement: Bundle size parity

A CI gate SHALL compare the gzipped size of `packages/react/dist/index.mjs` and `packages/vue/dist/index.mjs` per PR. The gate fails if (a) the relative size diff between adapters exceeds 25% AND (b) the affected adapter's size grew vs the previous main commit. The gate is informational-only on PRs that don't touch either package.

#### Scenario: Vue bundle balloons due to duplicated logic

- **WHEN** a Vue PR accidentally inlines logic that should have lived in core, doubling the Vue bundle size
- **THEN** the bundle size parity check fails with a clear pointer at "Vue bundle is 40% larger than React; diff vs previous main: +180KB"

### Requirement: Pre-publish parity gate

The release workflow SHALL run an aggregate parity check immediately before `changeset publish`. The aggregate runs: type-level surface parity + export parity + i18n key parity + parity smoke E2E. Any single failure refuses to publish. This is a defense-in-depth backstop against parity drift slipping through to npm.

#### Scenario: Publish refused on parity drift

- **WHEN** the `chore: release` PR merges to `main` and the publish workflow starts
- **THEN** the aggregate gate runs first and refuses publish if any layer fails
- **AND** the failure is logged with an explicit list of which adapter / which gate diverged

### Requirement: Visual regression baselines

For each parity matrix row, a screenshot baseline SHALL be captured at standard viewport (1280×800) and zoom (100%) for both adapters. Baselines live in `tests/parity/__screenshots__/<feature>/{react,vue}.png`. The parity test compares both screenshots against each other (within tolerance), not against a single source-of-truth baseline.

#### Scenario: Baseline drift on intentional UI change

- **WHEN** the React adapter intentionally changes a toolbar icon or padding
- **THEN** the React baseline updates and the Vue parity test fails until the Vue adapter is updated to match
- **AND** the change is documented in `notes/visual-changes.md` for the hardening branch

### Requirement: Un-stub gating

The `[STUB]` description SHALL remain in `packages/vue/package.json` and the README packages-table SHALL retain implemented-preview wording until every parity matrix row is `done` or explicitly `omitted-v1` with a documented reason. There is no partial green state.

#### Scenario: Premature un-stub attempt

- **WHEN** a contributor opens a PR removing `[STUB]` from `packages/vue/package.json` while the parity matrix has any `partial` or `missing` rows
- **THEN** the PR review checklist explicitly fails ("parity matrix not green")
- **AND** the un-stub PR cannot be merged without resolving the outstanding rows
