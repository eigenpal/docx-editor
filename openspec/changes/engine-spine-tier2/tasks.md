**Sizing (chosen): one big Tier 2 PR.** The five steps below are ordered commits on a single branch, landed as one PR (like Tier 1). They remain individually committed and individually verified so a regression is still bisectable by commit. Per-step gate (after each commit): `bun run typecheck` → engine unit tests (synchronous `scheduleFrame` stub) → **FULL** Playwright suite in BOTH adapters (not a grep subset — this is the hot editing loop) → visual-regression before/after. Before opening the PR: `api:extract` + `check:parity-contract` → `bun changeset` (patch) → `bun run format` → Chrome-agent verification of both demos. Within each step, wire React first (canonical, expect zero behavior delta), validate, then wire Vue.

> Tradeoff noted: the design's #1 risk mitigation was one-PR-per-step. Landing all five as one PR trades bisectability-across-PRs and incremental rollback for a single review. Mitigated by keeping the per-step commits + per-step full-suite runs, so `git bisect` still isolates a bad step. If a step proves unexpectedly risky mid-branch, split it back out into its own PR.

## 0. Pre-req: repair the pixel-identity safety net

- [ ] 0.1 Rebaseline/repair the visual-regression specs that fail on `main` today (`select`, `select-all`, etc.) so the "did rendering change?" gate is green BEFORE the refactor starts — otherwise the primary pixel-identity check is unusable. (eng-review finding #4)

## 1. Engine skeleton + layout pipeline — engine.run(state)

- [ ] 1.1 Create `packages/core/src/editor/` with `DocxEditorEngine.ts` + `EngineHost.ts`. Land the layout subset of `EngineHost` now; let it GROW per step rather than locking the speculative view/session shapes up front. Add `./editor` export + tsup entry + typesVersions + exports-map allowlist.
- [ ] 1.2 Move geometry resolution to core: lift `getColumns` (`react/internals/columnLayout.ts`) to core alongside the already-core `getPageSize`/`getMargins` (`flow-model/sectionGeometry.ts`); the engine derives pageSize/margins/columns from `sectionProperties` itself so geometry is NOT a per-call input. Both adapters delegate (React stops computing it upstream, Vue stops deriving it inline at `useDocxEditor.ts:314-327`).
- [ ] 1.3 Lift the 6-step pass from React `useLayoutPipeline.ts:204-527` into `engine.run(state)`: buildBoxTree → computePerBlockWidths+measure → collectFootnoteRefs → HF resolve (via `host.getHfPmView`) → margin extension → layOutPages (+ two-pass footnote stabilize) → paintPages (full React option set). `run` pulls `document`/`zoom`/host-els/`resolvedCommentIds` via host getters and derives everything else (per SPIKE.md Q1).
- [ ] 1.4 Route adapter-specific outputs through host hooks: `onLayout(layout,blocks,measures)`, `onPainted()`, `onAnchorPositions(map)`, `onScrollRestore(pending)`, `onTotalPages(n)`. Each optional.
- [ ] 1.5 React: `useLayoutPipeline.ts` calls `engine.run`; keep React's useState/refs + scroll-restore useLayoutEffect + painter:painted listener as host-hook implementations. Verify zero behavior delta.
- [ ] 1.6 Vue: `useDocxEditor.ts:308-526` runLayoutPipeline calls `engine.run`; implement the host hooks Vue needs, leave React-only ones undefined. Vue gains columns/scroll-restore/painter:painted/render-options.
- [ ] 1.7 Engine unit tests (synchronous host): run produces expected Layout for a fixture doc (with/without footnotes, with/without columns). Core test under `editor/__tests__/`.
- [ ] 1.8 **Timing-equivalence regression test** (eng-review decision #2): assert scroll-anchor restore + selection-overlay position survive a relayout unchanged in React; confirm host hooks fire at the same lifecycle point (post-commit), not synchronously inside `run`.
- [ ] 1.9 Verify: full suite both adapters; visual-regression diff (now that 0.1 made it green); api:extract + parity; changeset.

## 2. rAF coalescing scheduler — engine.scheduleLayout(state)

- [ ] 2.1 Lift React's coalescer (`useLayoutPipeline.ts:597-613`) into `engine.scheduleLayout(state)` using `host.scheduleFrame`. Export a rAF `scheduleFrame` factory for adapters.
- [ ] 2.2 React: route the existing `scheduleLayout` callers through the engine (no behavior change).
- [ ] 2.3 **Audit Vue's synchronous-layout consumers** (eng-review finding #5) — overlay sync, `getLayout()` readers, Playwright specs that assert layout immediately after an edit — BEFORE flipping Vue to coalesced; they will see one stale frame. Fix any that depend on synchronous post-transaction layout.
- [ ] 2.4 Vue: replace synchronous `runLayoutPipeline(newState)` (`useDocxEditor.ts:576`) with `engine.scheduleLayout(newState)` + a rAF `scheduleFrame`. Closes the per-keystroke perf gap.
- [ ] 2.5 Engine unit test: N scheduleLayout calls in one frame → one run with the latest state; synchronous host runs immediately.
- [ ] 2.6 Verify: full suite both adapters (watch for timing-sensitive selection/overlay specs in Vue); changeset.

## 3. Transaction→repaint loop — engine.handleTransaction(tr, state)

- [ ] 3.1 Lift the shared handler from React `PagedEditor.tsx:476-510` into `engine.handleTransaction(tr,newState)`: decoration-notify, docChanged → scheduleLayout + onDocumentChange + overlay refresh, selection-only → immediate overlay/SDT-focus. Strip `UPDATED_SCROLL` (from `OffscreenEditorHost.tsx:317`).
- [ ] 3.2 React: body `dispatchTransaction` (OffscreenEditorHost) + HF dispatch (HiddenHeaderFooterPMs:261-266 → PagedEditor:820) route through `engine.handleTransaction`.
- [ ] 3.3 Vue: body + HF `dispatchTransaction` (`useDocxEditor.ts:566-604`, `761-778`) route through `engine.handleTransaction`. Add scroll-flag stripping (Vue currently lacks it).
- [ ] 3.4 Engine unit test: docChanged schedules + notifies; selection-only updates overlay only; scroll flag cleared; HF docChanged triggers writeback + body schedule.
- [ ] 3.5 Decide (per design open question): fold cell-drag→CellSelection promotion into this PR or defer.
- [ ] 3.6 Verify: full suite both adapters; typing/undo/redo + selection specs; changeset.

## 4. PM view lifecycle — body + per-rId HF map

- [ ] 4.1 Lift body view create/teardown (React `OffscreenEditorHost.tsx:282-421`) and HF enumerate/mount/teardown/writeback (`HiddenHeaderFooterPMs.tsx:122-275`) into the engine behind `host.mountView`/`destroyView`. Engine owns the `Map<rId,EditorView>` + per-rId ExtensionManager.
- [ ] 4.2 Add `engine.syncHfViews(document)` (enumerate+dedup+diff+mount+teardown+writeback). Keep the trigger adapter-side.
- [ ] 4.3 React: `OffscreenEditorHost`/`HiddenHeaderFooterPMs` become thin — call engine view methods; drive `syncHfViews` from the existing `useEffect([slots])`.
- [ ] 4.4 Vue: `createEditorView`/`syncHfPMs` (`useDocxEditor.ts:532-781`) call engine view methods; drive `syncHfViews` from the imperative load path.
- [ ] 4.5 Engine unit test (happy-dom): syncHfViews mounts deduped views, tears down removed rIds + their managers, writes back on docChanged.
- [ ] 4.6 Verify: full suite both adapters; HF edit/click/type specs (hf-click-and-type, hf-text-selection, hf-selection-rects); changeset.

## 5. Load/save session seam — engine.load / engine.save

- [ ] 5.1 Lift load into `engine.load(buffer)` with the private generation counter (race guard from React `useDocumentLoader.ts:59,75,80`): normalize → parseDocx → recreate views → initial run.
- [ ] 5.2 Lift save into `engine.save({selective})` with the selective-via-agent path + reply-marker injection + `clearTrackedChanges` (from React `useFileIO.ts:59-120`).
- [ ] 5.3 React: `useDocumentLoader`/`useFileIO` delegate to engine.load/save (no behavior change).
- [ ] 5.4 **Prerequisite (eng-review finding #3): wire a `DocumentAgent` into Vue** — Vue's composable owns the PM directly with no agent today; selective save needs the agent + originalBuffer + extension-state queries (`getChangedParagraphIds`, `hasStructuralChanges`, `hasUntrackedChanges`). Land this before flipping Vue's save path; Vue stays on full-repack save until it's in.
- [ ] 5.5 Vue: `useDocxEditor.ts:816-888` loadBuffer/save delegate to engine — Vue gains the race guard, selective save, and post-save tracker clear. Note the selective-save output-byte change in the changeset; round-trip-test in Word/LibreOffice.
- [ ] 5.6 Engine unit test: late parse dropped (race guard); selective vs full repack path selection; tracker cleared post-save.
- [ ] 5.7 Verify: full suite both adapters; save/load round-trip specs; manual Word/LibreOffice round-trip; changeset.

## 6. Wrap-up

- [ ] 6.1 Confirm React `PagedEditor`/hooks and Vue `useDocxEditor` are thin engine wrappers (line-count drop); no duplicated orchestration remains.
- [ ] 6.2 Update CLAUDE.md architecture section to point at `core/editor/DocxEditorEngine` as the orchestration owner.
- [ ] 6.3 Update issue #696 with Tier 2 completion; note #89 (vanilla pkg) is now a thin-wrapper follow-up.
