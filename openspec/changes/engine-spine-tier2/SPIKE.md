# Spike: is `DocxEditorEngine` the right abstraction?

Run after the eng-review + outside voice challenged the premise (class vs pure-function lift). Two questions, answered against the real code.

## Q1 — What is `run()`'s real input contract? Push or pull?

`runLayoutPipeline`'s dep array (`useLayoutPipeline.ts:532-559`) is ~24 values. Classified:

**Derivable inside `run` from `document` (NOT irreducible inputs):**

- `pageSize, margins, finalPageSize, finalMargins` ← `getPageSize`/`getMargins(sectionProperties)` — **already core** (`layout-bridge/sectionGeometry.ts:28,44`).
- `columns, finalColumns` ← `getColumns(...)` — React-local pure fn (`internals/columnLayout.ts:26`), lifts trivially.
- `contentWidth` ← derived from pageSize − margins.
- `sectionProperties, finalSectionProperties` ← from `document`.
- `headerContent, …firstPageFooterContent` ← `resolveHeaderFooter` + `convertHeaderFooter*` — already core (HF resolve is shared).
- `styles, theme` ← from `document`.

**Genuine host seams (~6):** `zoom`, `getScrollContainer`, the host elements (pages/viewport/body), `resolvedCommentIds` (React-only; Vue empty), `getHfPmView`/`getHfPmDoc`, plus the already-core `syncCoordinator` (SelectionBridge).

**Verdict:** the outside voice's "run needs ~25 inputs" is true by COUNT but ~18 are derived-from-`document`. The real contract is `run(state)` + pull `document` + ~6 host getters. **The input explosion is not a blocker.** Caveat that IS real: both adapters must stop computing geometry their own way (React upstream, Vue inline at `useDocxEditor.ts:314-327`) and delegate geometry resolution to the engine. That's a bounded change touching both adapters, and it requires `getColumns` → core. Decision 4 ("push-based, never reads framework state") needs rewording: the engine _pulls_ editor inputs (`document`, `zoom`, host els) via host getters — those are editor state exposed by the host, not React/Vue reactive primitives. Mild softening, defensible.

## Q2 — Does `engine.load`/`save` lift cleanly against React's actual structure?

No — and this is where the outside voice was most right. React's load is NOT a unit; it's `useHistory` as source-of-truth + four reactive effects:

- `loadBuffer`: `parseDocx` → `history.reset(doc)` (`useDocumentLoader.ts:73-90`)
- body view recreate: a `useEffect` on the document prop (`OffscreenEditorHost.tsx:398-421`)
- agent build: a `useEffect` on `history.state` (`useDocumentLoader.ts:110-116`)
- comment extract + `seedCommentAllocator`: another `useEffect` (`:122-147`)

`engine.save` reads `agentRef` (bound to React `history.state`) + the `comments` React `useState` array + `documentName` (`useFileIO.ts:59-120`).

**Verdict:** owning load/save in the engine is a **source-of-truth inversion** (engine owns the document lifecycle; React's `useHistory`/agent/comments become subscribers or host callbacks), not a sequence lift. Coherent but materially bigger than the plan stated. This is where the class earns or loses.

## Recommendation: refined scope (the natural seam)

The two halves have very different risk:

- **Layout + scheduler + transaction loop = CLEAN.** `run` lifts well (inputs derive from `document`; geometry helpers already core). The scheduler and transaction handler are small and self-contained. This is ~70% of the dedup value and the lower-risk half.
- **View lifecycle + load/save = ENTANGLED.** Per-rId views both adapters trigger reactively; load/save are a source-of-truth inversion bound to React's history/useState.

So regardless of the class-vs-function decision, **the right first move is the same**: lift the layout/scheduler/transaction-loop into the engine; keep view lifecycle + session (load/save) adapter-side for now. The plan's own fallback note already permits this ("engine owns layout+scheduler+loop while views/session stay adapter-side").

- If **#89 (vanilla) is wanted** → continue to the engine class, and treat load/save as a deliberate source-of-truth inversion step (rescoped, not a "lift the sequence" step). View lifecycle next.
- If **#89 is not near-term** → the engine can stop at layout+scheduler+loop; `run` can even be a pure function the adapters call (the class is only needed to _own_ views + session). Most of the dedup, far less risk.

**This is decidable empirically AFTER the clean half ships:** build the engine for layout+scheduler+loop first (low risk, high value), see how the `EngineHost` contract feels in practice, then decide whether to absorb views+session (the class payoff for #89) or stop. The `#89` priority question resolves itself once we see whether owning session is worth the inversion.

## Plan adjustments from the spike

1. Reword design Decision 4: engine _pulls_ `document`/`zoom`/host-els via host getters; never touches framework reactive primitives.
2. Add to step 1: move `getColumns` to core; both adapters delegate geometry resolution to the engine (React stops computing it upstream).
3. Rescope step 5 (load/save): it is a source-of-truth inversion (engine owns document lifecycle; adapter history/agent/comments become subscribers), gated on the #89 decision. Until then the engine may stop at layout+scheduler+loop+views.
4. Re-sequence option: ship layout+scheduler+loop (steps 1-3) as the committed core; treat views (4) and session (5) as a second decision point informed by how the contract feels.
