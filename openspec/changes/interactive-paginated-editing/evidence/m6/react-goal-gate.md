# React goal gate — final review round

Frozen HEAD for review: `checkpoint-247bd2aa`. Fixes: `checkpoint-a0379959`.

Three fresh independent reviewers with no prior context — correctness, security, and
architecture — each told to assume this round's fixes introduced new defects, because
every one of the six prior rounds found defects in the previous round's fixes.

## Ordered React task list

| Row | Task | Commit |
| --- | --- | --- |
| 1 | M6D.1 — default comprehensive fixture | `checkpoint-cb197a21` |
| 2 | M6P.1 — per-block partial editability | `checkpoint-dd1d901f` |
| 3 | M6V.1 — retired React chrome parity | `checkpoint-11369d0b` |
| 4 | M6K.1 — native ProseMirror command behavior | `checkpoint-86480c6b` |
| 5 | M6S.1 — gap-free selection presentation | `checkpoint-247bd2aa` |
| 6 | React goal gate | this document |

## Findings and disposition

### Blocker — quadratic layout DoS, sixth generation (security)

`deprecatedFlatDocOffset` walked every body block to accumulate a flat offset, and
`toDisplayPages` calls it once per painted text item: **O(items x blocks)**. Review
measured it dominating a 7,752 ms publish at **5,180 ms**, and an ORDINARY ~18 KB
document — 6,000 plain one-run paragraphs, nothing crafted — freezing the synchronous
open path for **1.25 s**, re-paid on every document-changing keystroke. Full-path
exponent reached **2.04**.

Why it survived five rounds is the load-bearing part: every SIBLING scan in
`toDisplayPages` had already been memoized in earlier rounds — `blockRecordById`,
`whitespaceBoxFromCaretEdges`, `paragraphTextById` — and this one was left because **no
guard instrumented it**. Fixed by indexing on the semantic index. Measured after, 500 to
8,000 paragraphs: 116 / 196 / 392 / 769 / 1,532 ms, ratios 1.69 / 2.00 / 1.96 / 1.99 —
linear.

**The guard was vacuous too, and that is the more important correction.** Verified by
reverting the fix: at 500→2,000 AND at 2,000→8,000 the ratio stays under 8x *with the
quadratic present*, so both spans passed straight through the defect. The guard now spans
2,000→16,000, where linear is ~8x and quadratic ~64x, and it is confirmed to FAIL on
revert.

### High — reverse mapper did not validate paragraphs against the read-only policy

The atom branch consulted the policy; the paragraph branch and the alignment helper
`nodeMatchesBlock` checked only `block.kind`. A projected paragraph carrying a
policy-read-only block's `semId` was accepted and emitted `setParagraphRuns` — the store
committed and `emitPreservedPart` then threw at SAVE. That is exactly the
"commit followed by save failure" the design forbids, and the partial-editability spec
names the scenario. Both sites now consult the policy.

### High — the editability policy was never recomputed

Computed once inside `openDocxSession` and closure-captured, contradicting two written
design decisions ("recomputed after canonical changes that can affect block identity or
preservation evidence"; "keyed by canonical revision"). Undo, redo, and a remote commit
through a shared store all left the projection and the guards on a stale snapshot. Now
refreshed per revision, including from undo/redo, which bypass `applyPmDoc`.

### High — M6V.1's four new public props broke `check:editor-contract`

Declared in that gate and in `parity.contract.json`, marked as a **time-boxed** gap that
10V.1 must remove rather than an idiomatic framework divergence. A divergence with no
closing task is how a gate quietly stops meaning anything.

### High — `check:parity-contract` was passing vacuously; it now fails, correctly

It reads the untracked `docs/api/docx-editor-react/index.api.md`, which lists **8** props
while source declares **12**. That stale snapshot is why four new public props were
invisible to it. Regenerating requires `api:extract` on paths under an explicit
never-stage instruction, so it is left RED for an owner decision rather than worked
around. A gate reporting a true inconsistency is strictly better than one passing on
stale data.

### High — `--doc-page-gap` unbound (pre-existing, unchanged by this range)

`--doc-page-gap` (a public `--doc-*` token) and `DEFAULT_PAGE_GAP_PX` (engine constant)
are two independent literals. Measured: overriding the token to 72px left
`getScrollGeometry().pageGapPx` at 24 and moved a hit test by **24 blocks** on page 6,
growing linearly with page index. Recorded, not fixed here: it predates this range and
binding CSS to engine geometry is its own task.

## Verified clean by independent review

- **Partial editability privilege is well-guarded.** In-place edit patches only its byte
  range; the table stays verbatim; structural delete, same-count reorder, and a forged
  paragraph over a read-only atom are all rejected and reprojected. `save()` emits
  read-only blocks verbatim by hash, and `emitPreservedPart` independently re-validates
  source and baseline hashes, failing closed.
- **The delegated `beforeinput` set does not widen the trust boundary.** All seven types
  remove a range or insert a break; data-carrying types (`insertReplacementText`,
  autocorrect) are still rejected. Every delegated native edit reconciles through PM's
  DOM observer into `applyPmDoc`, re-applying the read-only and structural guards.
- **`mergeSelectionRunsPerLine` is linearithmic**, not quadratic: 80,000 rectangles merge
  in ~6 ms, and it does not re-run the bridge per keystroke.
- **`assessBodyEditability` is linear** — 1.9 ms to 55 ms across a 64x size range.
- **No new DOM/markup surface.** `retired-chrome.ts` is static constant data; chrome
  renders through React's escaping; the `?pmref=1` raw ProseMirror reference is isolated
  and cannot reach the production store.
- **New chrome does not move geometry.** Click-to-offset round-trips within 2 px at zooms
  0.5/1.0/1.25/2.0 with the toolbar horizontally scrolled and the scroller at 0–7,000,
  because host metrics read a live rect.

## Recorded, not fixed (Medium/Low)

Second policy authority (`runIsProjectable` narrowing produces no diagnostic, so
`readOnlyRegions` under-reports); three sites still classifying from `block.kind` alone;
`InteractionHostMetrics` described three incompatible ways; `getCaretClientRect` returns
a hybrid space (width/height unscaled at zoom); hardcoded swatch hexes in
`retired-chrome.ts` against the token rule; no changeset for the range; the "sticky" ruler
row has no scrolling ancestor; `examples/vite/screenshots/` became untracked-visible when
`.gitignore` was narrowed.

## Gates at `checkpoint-a0379959`

| Gate | Result |
| --- | --- |
| engine suites (core + binding + editor) | **1,090 pass** |
| `check:export-parity` | pass, 49 names |
| `check:editor-contract` | pass |
| `check:adapter-css-thin` | pass |
| `check:public-docs-surface` | **FAIL — 25 undocumented public names** |
| `check:parity-contract` | **FAIL — 4 props missing from the React snapshot** |
| `typecheck` | only `@docx-editor.dev/nuxt` TS5097, pre-existing |

### Correction to this table (independent architecture review)

This table originally omitted `check:public-docs-surface` and mis-stated the parity
failure, so it understated the gate. Three things are true and were not recorded:

1. `bun run check:parity` is an `&&` chain that **exits at `check:public-docs-surface`**,
   so `check:parity-contract` never runs inside the composite. Reporting the composite as
   "red on the parity contract" was wrong; it is red earlier.
2. The 25 missing names (`renderAsync`, `DocxEditorHandle`, `RenderAsyncOptions`, the
   React toolbar and plugin surfaces) were dropped by `checkpoint-701c1a9f` / `checkpoint-12fedecf`
   (`refactor(react|vue)!: strip adapter onto the Editor contract`) — before this change
   and outside its scope, but they belong in the record.
3. `docs/api/docx-editor-react/index.api.md` and its Vue counterpart were **deleted from
   git** by those same commits and now exist only as untracked local files. On a clean CI
   clone `check-parity-contract.mjs` exits with `Missing required file`, not with the
   drift reported here — meaning the recorded diagnosis reproduces only on this machine.

None of this is caused by M6D.1/M6P.1/M6V.1/M6K.1/M6S.1, and none of it is fixed by
writing a snapshot from the current source: restoring deleted public API and re-tracking
API Extractor output is an owner decision, not a gate-closing convenience.
