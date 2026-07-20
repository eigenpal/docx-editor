## Context

Issue #696 Tier 2. Tier 1 (#706, merged) centralized the pure logic; this lifts the stateful orchestration. Exploration mapped four components against `origin/main` (file:line):

- **Layout pipeline** — React `useLayoutPipeline.ts:203-623`, Vue `useDocxEditor.ts:308-526`. ~85% identical 6-step pass. React is a strict superset.
- **PM view lifecycle** — React `OffscreenEditorHost.tsx:282-421` (body) + `HiddenHeaderFooterPMs.tsx:122-275` (HF map); Vue `useDocxEditor.ts:532-781`. Create/teardown/writeback near-identical; the trigger differs (React reactive, Vue imperative).
- **Transaction→repaint loop** — React `PagedEditor.tsx:476-510` + scheduler `useLayoutPipeline.ts:597-613`; Vue `useDocxEditor.ts:566-604`. Only structural diff: React's rAF coalescer vs Vue's synchronous relayout.
- **Load/save** — React `useDocumentLoader.ts` (load, with `loadGenerationRef` guard) + `useFileIO.ts:59-120` (selective save + `clearTrackedChanges`); Vue `useDocxEditor.ts:816-888` (no race guard, full repack, no clear).

Constraints: CLAUDE.md dual-rendering model (hidden PM = editing state; painter = sole visible renderer; HF = one persistent EditorView per rId). Parity contract gates ref/prop surface. The intentional #670 divergence (Vue overlay adds scrollTop, React doesn't) must remain adapter-supplied. The float-zone measure pipeline (`measureBlocksWithFloats`) is already core and is the model for a clean centralize.

## Goals / Non-Goals

**Goals:**

- One `DocxEditorEngine` in `core/editor/` owns the orchestration; React/Vue become thin wrappers.
- Behavior-identical for shared paths; adopt React (the complete impl) where adapters diverge, closing Vue gaps.
- Each of the 5 steps independently shippable under the full Playwright suite + parity contract.
- Keep reactivity bridges, overlay painting, and event-source subscriptions adapter-side.

**Non-Goals:**

- Shipping the vanilla package (#89) — separate change, unblocked by this.
- Changing the overlay-painting strategy (React declarative state vs Vue imperative createElement).
- The cell-drag→CellSelection pointer promotion (Vue cell-select gap) — pointer-controller work; may ride a step but is not core to the engine.
- Reworking the ContentNode metrics/page-layout/paint algorithms (already core).

## Decisions

**1. The engine is a plain class constructed with a DI'd `EngineHost`, not a framework-aware object.**

```
new DocxEditorEngine(host: EngineHost)
interface EngineHost {
  // view factories (framework-specific creation; engine owns lifecycle)
  mountView(hostEl, state, dispatch): EditorView
  destroyView(view): void
  getBodyHostEl(): HTMLElement
  getHfHostEl(): HTMLElement
  // render targets + read seams
  getPagesContainer(): HTMLElement | null
  getScrollContainer(): HTMLElement | null   // React; Vue may return null
  getDocument(): Document | null
  getZoom(): number                          // Vue defaults to 1
  // output hooks — each adapter implements what it renders (others no-op)
  onLayout?(layout, blocks, measures): void
  onPainted?(): void                          // React painter:painted signal
  onAnchorPositions?(map): void               // React sidebar
  onScrollRestore?(pending): void             // React scroll anchor
  onTotalPages?(n): void
  scheduleFrame(cb): cancel                    // rAF (React) / nextTick or rAF (Vue)
}
```

Rationale: the four components share state (views ↔ layout ↔ transactions ↔ session), so a single object that holds them and exposes `run`/`handleTransaction`/`load`/`save` is cleaner than 4 disconnected controller factories. `scheduleFrame` is DI'd (not hardcoded rAF) so a headless/SSR host can pass a synchronous stub. Alternative (free functions + a context bag threaded through every call, the Tier 1 style) was rejected: the orchestration is inherently stateful (pending-layout ref, view map, load generation), so a class owning that state is the right altitude.

**2. Adopt React as canonical for every divergence; Vue reaches parity in the same step.**
Per-component resolution: layout → React's superset (columns, scroll-restore, painter:painted, render options); scheduler → React's rAF coalescer; transaction → React's scroll-flag strip + gating; load → React's `loadGenerationRef`; save → React's selective-via-agent + `clearTrackedChanges`. Each is the more-complete/correct side. The DI hooks let Vue _opt out_ of purely-React-UI pieces (e.g. `onRenderedDomContext`) by leaving the hook undefined — so "adopt React" never forces React-only UI into Vue.

**3. Sequence is forced by data dependencies; land the five steps as ordered commits on one branch → one Tier 2 PR (chosen sizing).**
The steps stay individually committed and individually verified (full suite per step) so `git bisect` still isolates a bad step within the branch; the trade vs one-PR-per-step is losing incremental-merge/rollback and a smaller review surface, accepted to match the Tier 1 workflow. Original per-step dependency graph:

```
 step 1 run(state) ──────────────┐
        │ (scheduler calls run)   │ (loop calls scheduler)
 step 2 scheduleLayout ───────────┤
        │                         │
 step 3 handleTransaction ────────┘  (dispatch → handleTransaction → schedule → run)
 step 4 view lifecycle  (views feed run + handleTransaction)
 step 5 load / save     (session seam; recreates views + initial run)
```

Steps 1-3 are the editing hot loop and are tightly coupled (3 calls 2 calls 1). Step 4 (views) feeds them but its trigger stays adapter-side, so it can land after the loop is shared. Step 5 (session) is the most independent. Each step: centralize to engine, wire React first (it's the canonical source so its behavior shouldn't change), then wire Vue, then run the full suite in both.

**4a. Timing-equivalence is a hard requirement, not an assumption (eng-review decision).**
"Centralize React verbatim = zero behavior delta" only holds if the engine's output hooks fire at the _same point in React's lifecycle_ they do today. React's scroll-restore and selection-overlay correctness depend on `useLayoutEffect` ordering relative to commit. Therefore: the engine emits via host hooks but does NOT dictate _when_ the adapter acts on them — React's host re-defers `onScrollRestore`/`onLayout`/`onPainted` to the same `useLayoutEffect`/event point as today (not synchronously inside `run`). Step 1 adds a regression test asserting scroll-anchor restore and selection-overlay position survive a relayout unchanged. Any timing drift is a bug, not an acceptable delta.

**4. Reactivity stays adapter-side; the engine pulls editor inputs via host getters, never framework reactive primitives (revised after spike).**
The engine never touches React refs / Vue refs directly. It _pulls_ editor inputs — `document`, `zoom`, the host elements, `resolvedCommentIds` — through `host` getters, and _derives_ the rest (pageSize/margins/columns via core `getPageSize`/`getMargins`/`getColumns`, HF content via the core HF-resolve helpers, sectionProperties/styles/theme from `document`) inside `run`. So `run(state)`'s real contract is `state` + `host.getDocument()` + ~6 host getters, not ~20 push-args (see SPIKE.md Q1). The geometry-resolution layer (sectionProperties → geometry) must therefore move fully into core and _both_ adapters delegate it (React stops computing it upstream, Vue stops deriving it inline). Adapters still call `engine.handleTransaction(tr, state)` and the engine calls back via `host.onLayout(...)`; the HF view _trigger_ stays adapter-side via `engine.syncHfViews(document)`.

**5. Load/save is a source-of-truth inversion, not a sequence centralize, and is gated on the #89 decision (revised after spike).**
The spike (SPIKE.md Q2) found React's load is `useHistory`-as-source-of-truth + four reactive effects (parse/history, body-view recreate, agent build, comment extract), and `save` reads the agent (bound to React history) + the `comments` `useState`. Owning these in the engine means the engine becomes the document source-of-truth and React's history/agent/comments become subscribers/host-callbacks — coherent but materially bigger than "centralize the sequence." The race guard itself lifts trivially; the session _ownership_ does not. Therefore load/save (step 5) and view lifecycle (step 4) are a **second decision point**, taken after the clean half (layout + scheduler + transaction loop) ships and the `EngineHost` contract is proven in practice. If #89 (vanilla) is wanted, absorb views+session into the engine; if not, the engine can stop at the hot loop (and `run` could even stay a pure function the adapters call).

## Risks / Trade-offs

- **[HIGH: behavior drift in the hot editing loop]** — this is the core typing/layout/paint path; a subtle regression (e.g. a dropped scroll-flag strip, a coalescing change) is felt on every keystroke. → Ship one step per PR; wire React first (canonical, zero behavior delta expected) and validate before touching Vue; run the FULL Playwright suite (not a grep subset) on each step in both adapters; keep before/after screenshots for the visual-regression specs.
- **[Vue gains React behaviors that may surface latent Vue bugs]** (rAF coalescing changes timing; selective save changes output bytes; race guard changes load ordering). → Each Vue adoption is its own PR half; treat output-byte changes (selective save) as a deliberate, changeset-noted behavior change and round-trip-test in Word/LibreOffice.
- **[The `EngineHost` interface ossifies early]** — get it wrong and every step fights it. → Design the full `EngineHost` in step 1 from all four exploration maps (done above), but only implement the layout subset first; add hooks per step. Treat it as the contract.
- **[Large diffs obscure review]** — each step deletes hundreds of adapter lines and adds engine lines. → Land the engine module and the React wiring in the same PR so the diff shows "moved, not rewritten"; lean on `git diff -M` rename detection where possible.
- **[rAF in tests/headless]** — coalescing via rAF breaks synchronous test expectations. → `scheduleFrame` is DI'd; the engine's own unit tests pass a synchronous stub; adapter E2E uses real rAF.
- **[#670 overlay-offset divergence]** — must stay Vue-only. → The engine never computes overlay coords; it emits layout, adapters paint overlays with their own offset rule (unchanged from today).
- **[the visual-regression safety net is broken on main]** (the `select`/`select-all` screenshot specs fail on `main` today — found during Tier 1). The primary "did rendering change?" gate is unusable as-is. → Step 1 rebaselines/repairs the visual-regression specs FIRST so the pixel-identity gate actually works for the rest of the refactor; do not claim before/after screenshots as the safety net until they're green on main.
- **[Vue scheduler adoption is a timing change, not just perf]** (step 2 flips Vue from synchronous to rAF-coalesced relayout; synchronous-layout consumers see one stale frame). → Step 2 includes an explicit audit of Vue's post-transaction synchronous-layout readers (overlay sync, `getLayout()` consumers, Playwright specs that assert layout immediately after an edit) before flipping the switch.
- **[Vue has no DocumentAgent]** — selective save (step 5) needs the agent + originalBuffer + extension-state queries Vue doesn't wire today. → Step 5 has an explicit "wire DocumentAgent into Vue" sub-task gating the selective-save adoption; Vue stays on full-repack save until it lands. (Kept in step 5 per the sizing decision, but surfaced as a real prerequisite, not a one-liner.)

## Migration Plan

Five PRs, each merged to `main` independently with its own changeset (patch; the fixed group). No flag gating — shared paths stay behavior-identical; Vue gap-closers are additive or deliberate (selective save). Rollback is per-PR `git revert`. Order: 1 run → 2 scheduler → 3 transaction loop → 4 view lifecycle → 5 session. After all five, `PagedEditor`/`useDocxEditor` are thin wrappers and #89 is a small follow-up. If a step proves too risky mid-flight, it can stop there — the engine is usable with only the steps landed (e.g. engine owns layout+scheduler+loop while views/session stay adapter-side).

## Open Questions

- Does `engine.run` keep React's two-pass footnote stabilization inline, or is that already sufficiently core (`stabilizeFootnoteLayout`) to just call? (Leaning: already core, engine just orchestrates the two passes.)
- Should `scheduleFrame` default to rAF inside the engine with Vue overriding, or always be host-supplied? (Leaning: host-supplied, with a rAF default factory exported for adapters that want it.)
- Step 4: does the engine own the per-rId `ExtensionManager` lifecycle too, or just the EditorView? (Leaning: own both — they're 1:1 with the view and identical in both adapters.)
- Whether to fold the cell-drag→CellSelection pointer promotion into step 3 (it touches the same pointer/transaction area and closes a flagged Vue gap) or keep it separate. Decide when step 3 lands.
