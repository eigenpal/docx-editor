## Context

Issue #696 proposes unifying React/Vue editor orchestration into a shared `core/editor/` engine (Tier 2). Tier 1 is the pre-work: lift the pure `(view, args) → result` logic that is already duplicated across `packages/react/` and `packages/vue/`, with no engine and no new architecture. Core already owns the heavy path (`parseDocx`, `toProseDoc`/`fromProseDoc`, `layOutPages`, `measureBlocksWithFloats`, `LayoutPainter`, `resolveDomPosition`, all commands, `Subscribable` + coordinators) with zero framework imports.

Code mapping established (file:line) for each target:

- **paraText helpers** — React `internals/pmAnchors.ts:52-64` + `internals/vanillaText.ts:13-93`; Vue `utils/paraTextHelpers.ts` (carries the `TODO(file-size-cap)` to move to core).
- **Query helpers** — React inline closures `useDocxEditorRefApi.ts:383-485`; Vue pure functions `utils/refApiQueries.ts:28,74,102`.
- **domSelection dedup** — React `internals/domSelection.ts:29-113` (`getCaretFromDom`) + `:123-192` (`computeSelectionGeometryFromDom`) duplicate core `getCaretPositionFromDom` / `readSelectionGeometry` (`layout-bridge/resolveDomPosition.ts:477,398`). `applyCellSelectionHighlight` at `:204-255`. Vue already calls core for the first two (`useSelectionSync.ts:178,207`) and lacks the third.
- **applyFormatting** — React `useDocxEditorRefApi.ts:228-381`; Vue `useFormattingActions.ts:82-213`. Mark body byte-for-byte identical; differ only on how `EditorView` and the style resolver are obtained, plus import path (Vue reaches `/commands/paragraph`, React uses the index).
- **Table-resize** — React readers/commits isolated in `internals/tableResize.ts:40-196`, FSM in `useTableResizeState.ts`; Vue inlines both in `useTableResize.ts:226-399`.
- **Image commit** — React `useImageInteractions.ts:44-149`; Vue `ImageSelectionOverlay.vue:574-651` (commit ~`627-702`).
- **Drag auto-scroll** — React `hooks/useDragAutoScroll.ts` wired via `usePagesPointer.ts:528,594`; Vue `composables/useDragAutoScroll.ts` exported but **never called**.
- **Comment ops** — React `useDocxEditorRefApi.ts:109-226` + `commentFactories.ts` (module counter `getNextCommentId` / `bumpNextCommentIdAbove`); Vue `useCommentManagement.ts:44-163` (inline `Math.max(...)+1`, separate comment vs revision id spaces).

Constraints: core `package.json` `exports` is explicit (62 keys, no wildcards) — each new module needs a key. CLAUDE.md mandates layout/measure/paint changes land in both adapters per PR, with `bun run check:parity-contract` + `bun run api:extract` gating any public-surface move. Intentional divergence to preserve: Vue adds `scrollTop`/`scrollLeft` to overlay coords (`useSelectionSync.ts:154`, #670/PR #682) — any lifted painter API keeps the offset adapter-supplied.

## Goals / Non-Goals

**Goals:**

- Eliminate the duplicated pure logic in eight self-contained PRs, each deleting two copies.
- Preserve existing behavior exactly for shared paths; close three Vue gaps (cell highlight, auto-scroll, comment id allocation).
- Keep every PR independently shippable and revertible, gated by targeted Playwright specs in both adapters.
- Leave the adapters as thin delegators/re-exports so no public ref/prop signature changes.

**Non-Goals:**

- No `DocxEditorEngine`, no transaction→repaint loop, no scheduler, no save-path unification (Tier 2/3).
- No `onContentChange`/`onSelectionChange` subscription hub (deferred to the engine — little pure logic to lift).
- No change to gesture FSMs, reactivity bridges, overlay painting strategy, or event-source subscriptions.
- No reshaping of the parity contract buckets (the affected ref methods already sit in `pairedViaInheritance`).

## Decisions

**1. New core modules live under `packages/core/src/prosemirror/` (and `layout-bridge/` for DOM-selection items), one explicit `exports` key each.**
Rationale: matches the existing layout — commands, content controls, and conversion already sit under `prosemirror/`; `resolveDomPosition` sits under `layout-bridge/`. Alternative (a fresh `core/editor/` namespace) is reserved for Tier 2's engine and would imply more than these leaf functions belong there. Proposed homes: `prosemirror/paraText.ts`, `prosemirror/queries.ts`, `prosemirror/applyFormatting.ts`, `prosemirror/tableResize.ts`, `prosemirror/imageCommit.ts`, `prosemirror/commentOps.ts`; `layout-bridge/cellSelectionHighlight.ts`; auto-scroll math co-located with `utils/findVerticalScrollParent` (already core).

**2. Adapters delegate, and keep their old import paths via thin re-exports where call sites are many.**
Rationale: `pmAnchors.ts`/`vanillaText.ts`/`paraTextHelpers.ts` have ~10 import sites; re-exporting from core avoids churn and keeps each PR small. New delegations (ref methods, commit calls) call core directly.

**3. `applyFormatting`/`setParagraphStyle` take an injected `getStyleResolver` dependency; standardize on the `@eigenpal/docx-editor-core/prosemirror/commands` index import.**
Rationale: the only real divergence is resolver sourcing (React's cached resolver over `historyStateRef` vs Vue's `createStyleResolver`). Inject it rather than baking either in. Alternative (passing a resolved resolver object) is less flexible for React's cache. The name-keyed-registry-vs-typed-switch dispatch question from Tier 3 is **not** in scope here — this lifts one function, not the dispatch layer.

**4. Table-resize, image-commit, and comment-ops lift only the pure readers/commit/transaction builders; FSMs and notify wiring stay in adapters.**
Rationale: the FSMs diverge structurally (React `useRef`+parent-driven routing vs Vue plain objects + `install()` global listeners) and are genuine framework glue. The pure math/transaction builders are identical and safe to share. Adapters still resolve the target view (body vs header/footer) before calling core — preserving React's `resizeTargetViewRef` capture for HF correctness.

**5. Comment/revision id allocation: React's monotonic counter is canonical, but lifted as an instance-scoped allocator (eng-review decision).**
Rationale: monotonic allocation with seed-on-load does not reuse freed ids after deletion; Vue's `Math.max(...)+1` collides after deletes and keeps comment vs revision spaces inconsistently separate. React's current `commentFactories.ts` holds the counter in **module-global** mutable state (`let nextCommentId = 1`), which would, once in core, be shared across React + Vue + the future vanilla package _and_ across multiple editor instances on one page. To avoid that hidden global, lift it as a small `createCommentIdAllocator()` factory returning `{ next(), seedAbove(maxId) }`; each adapter instantiates one per editor and threads it into the comment/proposeChange builders. This preserves React's monotonic-no-reuse semantics, fixes Vue's collision bug, and keeps the state instance-scoped. Alternative (keep module-global) was rejected: smaller diff but reintroduces shared process state into core, which breaks the pure-function framing and is a latent multi-instance bug.

**8. Every lifted pure module ships with core unit tests (eng-review decision).**
Rationale: `packages/core` is a unit-tested package (117 test files). The lifted functions are pure `(view/args) → result`, so unit tests are cheap and give regression protection that survives future adapter refactors (unlike adapter-only E2E, which only catches breaks through slow Playwright runs). Each PR adds a `*.test.ts` under `packages/core/src/__tests__/` (or co-located) covering the lifted logic: paraText range/text extraction, query dedup/limits, applyFormatting resolver reconciliation, table-resize clamps + commit math, image float/inline fork, comment-id allocation (monotonic, no reuse after delete, round-trip safe), and the auto-scroll edge-zone curve. PRs 3 and 7 additionally add **automated** Vue specs for their new behaviors (cell highlight, drag auto-scroll) rather than relying on manual demo checks.

**6. Cell-selection highlight and drag auto-scroll are lifted **and** wired into Vue in the same PR.**
Rationale: lifting without wiring leaves dead core code; the user-visible win is Vue reaching React parity. The auto-scroll hook shells stay framework-specific; only the delta math is shared.

**7. PR ordering: 1 paraText → 2 queries → 3 domSelection+cell → 4 applyFormatting → 5 table-resize → 6 image → 7 auto-scroll → 8 comment-ops.**
Rationale: paraText is a dependency of queries/applyFormatting/comment-ops, so it goes first. 1–3 and 7 are near-zero-risk; 8 carries the only behavior decision so it ships last. Each PR: `bun run typecheck` → targeted `--grep` Playwright in both adapters → `api:extract` + `check:parity-contract` if public surface moved → `bun changeset` (patch) → `bun run format`.

## Risks / Trade-offs

- **[Two "identical" copies have silently drifted]** → Diff React vs Vue before each lift; if they differ, core takes the more complete/correct version and the changeset notes the behavior reconciliation (expected for applyFormatting and comment-ops).
- **[applyFormatting resolver semantics differ]** (React caches the resolver over `historyStateRef`; Vue rebuilds via `createStyleResolver` each call) → the injected `getStyleResolver` seam covers the wiring, but the _mark body_ is what's byte-identical, not the resolver. PR 4's core test asserts both resolver styles produce the same applied result; do not assume equivalence.
- **[Image float-branch EMU math computed differently per adapter]** (React via `getPositionFromMouse` prop, Vue via `resolveDomPosition` directly) → core takes a resolved drop position / EMU offset; verify the offset math matches between adapters before deleting either copy (PR 6 core test).
- **[domSelection shim drifts at zoom ≠ 1]** (React resolved overlay rect + zoom internally; core takes an explicit `overlayRect`) → the React shim must produce the same rect the zoom path did; PR 3 includes a zoom≠1 caret-position assertion.
- **[domSelection signature mismatch]** (React resolves overlay rect + zoom internally; core takes an explicit `overlayRect`) → keep a tiny React-side shim that resolves overlay rect/zoom then delegates; delete only the duplicated walk logic, not the convenience wrapper.
- **[Comment id change alters Vue behavior]** → this is intended (bug fix); cover with a Vue tracked-changes/comments spec asserting no id reuse after delete; call it out in the changeset as a fix.
- **[Header/footer target-view regressions in table-resize/image]** → preserve adapter-side view resolution; verify resize and image drag in both body and HF in both demos.
- **[Hidden coupling to React refs in lifted functions]** → enforce pure signatures (`view`/`layout`/`container` as params, no ref access) so the same function serves Vue and the future vanilla wrapper.
- **[Parity contract / api snapshot drift]** → run `api:extract` + `check:parity-contract` on PRs 2, 4, 8 (public ref methods); 1, 3, 5, 6, 7 are mostly internal.

## Migration Plan

Incremental, one PR per lift, each merged independently to `main` with its own changeset (patch; fixed-group bump). No flag gating needed — behavior is preserved for shared paths and the three gap-closers are additive for Vue. Rollback is per-PR `git revert`; because adapters re-export/delegate, reverting a core module revert is isolated. After all eight land, the parity contract reflects unified implementations and the vanilla package (#89) has eight fewer functions to reimplement.

## Open Questions

- Whether `commentFactories.ts` should fully collapse into `core-comment-ops` in PR 8 or be a follow-up — leaning collapse, since the id counter is the canonical piece and leaving a second factory defeats the lift.
- Exact module placement for auto-scroll math (`utils/` vs a small `interactions/` namespace) — minor; resolve during PR 7.
