## Why

Tier 1 (#706) centralized the duplicated pure `(view, args) → result` logic into core. What remains duplicated is the **stateful orchestration**: the layout pipeline, the ProseMirror view lifecycle, the transaction→repaint loop, and the load/save session seam. Each lives twice — `useLayoutPipeline.ts` + `PagedEditor.tsx` + `OffscreenEditorHost.tsx` + `HiddenHeaderFooterPMs.tsx` + `useDocumentLoader.ts` + `useFileIO.ts` on the React side, and `useDocxEditor.ts` on the Vue side — and has silently drifted. Exploration confirms the orchestration is ~85% identical; only the reactivity primitive (React refs/effects vs Vue refs/watch) and a handful of React-only features differ.

Tier 2 lifts that orchestration into a `DocxEditorEngine` class in `packages/core/src/editor/`, behind dependency-injected seams (view factories, host elements, output callbacks). This (a) removes the largest remaining duplication, (b) closes the silent Vue parity gaps the drift created, and (c) reduces the vanilla JS package (#89) to a thin wrapper. Where adapters diverge, React is the more complete implementation, so the engine adopts React's behavior — which closes most of the issue's "Tier 3" gaps in the same pass.

## What Changes

A new `packages/core/src/editor/` module exporting `DocxEditorEngine` (+ controller factories), built and adopted in **five sequential, independently-shippable steps**. Each step keeps the framework state machines and reactivity bridges in the adapters; only the orchestration logic moves.

1. **Engine skeleton + layout pipeline** — `engine.run(state)` lifts the identical 6-step pass (buildBoxTree → measure → HF-resolve → margin-extend → layOutPages + footnote-stabilize → paintPages) from React's superset version. Output hooks (`onLayout`, `onPainted`, `onAnchorPositions`, scroll-restore) are DI'd so each adapter opts into what it renders. Vue gains the React-only pieces it lacks (columns/per-block widths, scroll anchor restore, the `painter:painted` signal, `resolvedCommentIds`/`pageBorders` render options).
2. **rAF coalescing scheduler** — `engine.scheduleLayout(state)` lifts React's requestAnimationFrame coalescer; Vue wires to it, fixing its synchronous-relayout-per-keystroke perf gap (5 keystrokes → 1 paint instead of 5).
3. **Transaction→repaint loop** — `engine.handleTransaction(tr, state)` lifts the shared handler (decoration-notify, scroll-flag stripping, schedule-or-immediate, SDT-focus reapply, selection-overlay gating). Both adapters' `dispatchTransaction` route through it.
4. **PM view lifecycle** — `engine` owns the body EditorView + `Map<rId, EditorView>` for header/footer, behind a `mountView(host, state)` / `destroyView(view)` DI seam. The enumerate/mount/teardown/writeback steps (identical today) move to core; adapters keep their reactive vs imperative trigger.
5. **Load/save session seam** — `engine.load(buffer)` (normalize → parseDocx → recreate views → initial layout, **with the `loadGenerationRef` race guard**) and `engine.save({ selective })` (selective save via the agent path + tracked-change clear). Vue adopts the race guard and selective save it currently lacks.

React's `PagedEditor`/`DocxEditor`/hooks and Vue's `useDocxEditor` become thin wrappers over the engine. The parity contract and the full Playwright suite gate every step.

Out of scope: shipping `@eigenpal/docx-editor-js` (#89 — becomes cheap _after_ this, separate change); the cell-drag→CellSelection pointer promotion (closes the Vue cell-select gap, but it's pointer-controller work that can ride step 3 or land separately); overlay-painting strategy (stays per-framework — React declarative, Vue imperative).

## Capabilities

### New Capabilities

- `editor-engine`: `DocxEditorEngine` class in `core/editor/` — the top-level orchestrator tying PM views, layout pipeline, transaction loop, and load/save together behind DI'd framework seams.
- `engine-layout-run`: `engine.run(state)` — the shared 6-step layout pass with DI'd output hooks (centralized from React's superset; Vue reaches parity).
- `engine-scheduler`: `engine.scheduleLayout(state)` — rAF coalescing so rapid transactions collapse to one layout/paint per frame, in both adapters.
- `engine-transaction-loop`: `engine.handleTransaction(tr, state)` — the shared transaction→repaint handler (scroll-flag strip, SDT-focus, schedule-vs-immediate).
- `engine-view-lifecycle`: body + per-rId HF EditorView create/teardown/writeback behind a `mountView`/`destroyView` DI seam.
- `engine-session`: `engine.load(buffer)` (with race guard) and `engine.save({ selective })` (selective + tracked-change clear), shared by both adapters.

### Modified Capabilities

## Impact

- **`@docx-editor.dev/core`**: gains `editor/` (engine + controller factories) and a matching `exports` key. Largest new core surface to date.
- **`@docx-editor.dev/react`**: `PagedEditor.tsx` (~1800 lines), `useLayoutPipeline.ts`, `OffscreenEditorHost.tsx`, `HiddenHeaderFooterPMs.tsx`, `useDocumentLoader.ts`, `useFileIO.ts` become thin engine wrappers. No public ref/prop API change.
- **`@docx-editor.dev/vue`**: `useDocxEditor.ts` (~900 lines) becomes a thin wrapper. **Gains**: columns, scroll-restore, the `painter:painted` signal, rAF coalescing (perf), the load race guard, and selective save — closing several silent divergences.
- **Vanilla package (#89)**: unblocked — becomes a ~150-line wrapper over the engine.
- **Risk: HIGH.** Unlike Tier 1's pure leaf functions, this is the stateful core editing loop. Behavior-identical refactoring of the two largest components is the hard part. Mitigated by: strict step-by-step sequencing (each step is one PR under the full test suite + parity contract), adopting React (the complete impl) as canonical, and keeping reactivity bridges adapter-side. Per-step the diff is large but the behavior delta should be near-zero for shared paths.
