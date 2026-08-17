# Pipeline benchmark

Measures each stage of the one pipeline — bytes → parse → identity → store → layout →
edit/relayout → save — on a long document, so stage-level regressions show up as numbers
instead of anecdotes.

## Editing regression benchmark

For repeatable optimization work on the repository-owned, synthetic 200-page reviewed fixture:

```bash
# Human-readable medians, p95s, and deterministic layout-work counters
bun run bench:edit

# Capture before/after results
bun run bench:edit --json > /tmp/edit-before.json
bun run bench:edit --compare /tmp/edit-before.json

# Override the fixture or repetition counts
bun run bench:edit path/to/document.docx --runs 15 --warmup 3

# Rebuild or verify the deterministic synthetic fixture
bun scripts/create-synthetic-long-edit-fixture.mjs
bun scripts/create-synthetic-long-edit-fixture.mjs --check
```

The command runs fixed edits at fixed early and middle-document paragraphs against a fixed
text measurer. Every measured round starts from a fresh store and a warmed layout session, so
edits do not accumulate between samples. It reports two kinds of evidence:

- **Work counters** (`placed/total`, reused pages, full passes, cache hits/misses/evictions) are
  hardware-independent and reveal algorithmic improvements or regressions.
- **Median and p95 timings** measure the user-facing cost but remain hardware-sensitive. Compare
  repeated runs on the same machine; no wall-clock benchmark can be independent of CPU load,
  power mode, or thermal state.

The scenarios cover one-character typing, a text insertion that wraps onto new lines, and
explicit hard breaks at middle and early positions. Baseline comparisons verify the fixture's
SHA-256, so changed document bytes cannot masquerade as a performance change. The normal test
suite pins their deterministic work counters; wall-clock timings stay a manual comparison. This
benchmark intentionally excludes browser paint, React, and DOM selection; use the demo Perf HUD
when validating those layers.

Run timing comparisons sequentially. Concurrent benchmark processes compete for CPU and can hide
or exaggerate timing changes; the structural work counters remain deterministic either way.

### CI benchmark comment

`.github/workflows/bench.yml` runs `bench:edit --runs 10` on every PR, twice: once on the PR
merge ref (the PR merged into current `main`) and once on the `main` tip that merge ref was
built against (using that commit's own copy of the script, in a separate worktree), so the
delta isolates exactly what merging the PR changes. `scripts/bench/edit-bench-comment.mjs`
renders both reports into a single sticky PR comment — a per-scenario median table with
deltas, plus any work-counter changes. Comparability is guarded by the fixture SHA-256: if
the fixture changed on the PR, or the baseline predates the benchmark, the comment degrades
to head-only numbers.

Timings in that comment are informational: shared runners are noisy, so the job never fails on
a wall-clock regression. The hard gate stays in `edit-bench-gates.test.ts`, which pins the
deterministic work counters inside `bun run test`. Fork PRs cannot receive comments (read-only
token); their reports are in the `edit-bench-report` workflow artifact.

### Browser editing benchmark

`bench:edit` deliberately stops after the store and layout pipeline. The browser benchmark drives
trusted Chromium input through the real React adapter, review module, toolbar, paginated DOM,
selection synchronization, and review rail:

```bash
bun run bench:edit:browser

# Save machine-readable output or change the repeated sample count
EDIT_BROWSER_BENCH_OUTPUT=/tmp/browser-edit.json bun run bench:edit:browser
EDIT_BROWSER_BENCH_RUNS=11 EDIT_BROWSER_BENCH_WARMUP=3 bun run bench:edit:browser
EDIT_BROWSER_BENCH_SUSTAINED_EDITS=120 bun run bench:edit:browser

# Reproduce rapid typing/key-repeat backlog, or run the one-minute worst-case soak
EDIT_BROWSER_BENCH_BURST_MS=5000 EDIT_BROWSER_BENCH_BURST_HZ=30 bun run bench:edit:browser
EDIT_BROWSER_BENCH_BURST_SCENARIO=arrow-left bun run bench:edit:browser
EDIT_BROWSER_BENCH_BURST_SCENARIO=arrow-down bun run bench:edit:browser
EDIT_BROWSER_BENCH_BURST_SCENARIO=word-left bun run bench:edit:browser
EDIT_BROWSER_BENCH_BURST_SCENARIO=editing-ordered-type \
  EDIT_BROWSER_BENCH_BURST_MS=100 EDIT_BROWSER_BENCH_BURST_HZ=100 bun run bench:edit:browser
EDIT_BROWSER_BENCH_BURST_MS=60000 EDIT_BROWSER_BENCH_BURST_HZ=30 \
  EDIT_BROWSER_BENCH_BURST_SCENARIO=suggesting-backspace bun run bench:edit:browser

# Isolate review-rail cost; save the burst report separately when needed
EDIT_BROWSER_BENCH_REVIEW_RAIL=0 bun run bench:edit:browser
EDIT_BROWSER_BURST_OUTPUT=/tmp/browser-edit-burst.json bun run bench:edit:browser

# Self-test: every measured input task must include this artificial delay
EDIT_BROWSER_BENCH_DELAY_MS=25 bun run bench:edit:browser
```

It reports median/p95 input-task and two-frame presentation latency alongside engine
layout/paint/selection timings, Event Timing when Chromium reports it, deterministic layout-work
counters, and the materialized DOM size. It also types 20 warmup plus 180 measured consecutive
characters without undo in editing and suggesting modes, comparing the first and last ten edits
and reporting garbage-collected JavaScript heap growth. The environment is pinned to headless Chromium,
1440×1000 at 1× scale, light mode, reduced motion, one worker, a fixed fixture, fixed edit
positions, warmups, and fresh undo between samples. A separate clipboard case measures copying one
or many paragraphs and pasting small or 8 KB single-line payloads, asserting the exact transferred
and resulting text.

The burst scenarios dispatch trusted typing, Backspace/Delete, Arrow movement, word movement, and
line/document-start navigation at a fixed rate without waiting for the preceding frame, which
reproduces hardware key repeat instead of hiding backlog behind Playwright waits. They report
requested versus processed events, handler and completion latency, post-dispatch drain time, Event
Timing queue delay, long tasks, maximum frame gap, DOM size, peak heap, forced-GC heap change, and the
final model selection. The ordered-typing scenario also asserts the exact resulting text and caret
after a ten-digit burst while replaying delayed browser selection echoes. The test fails on dropped
or reordered events, broken virtualization, or React's maximum-update-depth error.

Browser milliseconds cannot be hardware-independent. Use the exact work counters as the CI-safe
algorithmic gate, and compare repeated browser runs on the same machine. The injected-delay mode
verifies that the browser measurement itself responds to a known regression rather than merely
printing plausible numbers.

#### CI gates and threshold rationale

The Playwright benchmark now fails on regressions instead of only logging them:

- **Deterministic layout work** — each latency scenario pins `placed`, `total`, `reusedPages`, and
  `fullPasses` to the same values as headless `bench:edit` on the synthetic fixture. These counters
  are hardware-independent and catch algorithmic backsliding (for example, reverting to whole-document
  layout).
- **Self-calibrated timing tails** — for input task, frame, layout, paint, and selection, `p95` must
  stay within `max(3× median, median + 50 ms)`. This compares each metric to itself within a run
  rather than pinning absolute milliseconds, which would be flaky across CI machines.
- **Engine vs input bound** — the sum of layout/paint/selection medians must stay within
  `max(5× input-task median, 500 ms)`, catching cases where engine sub-steps dominate the input
  path without requiring a fixed wall-clock budget.
- **Cross-scenario sanity** — wrap typing median must stay within `6×` single-character typing on
  the same fixture, preventing wrap-specific blowups while allowing hardware variance.
- **Sustained typing** — the last ten edits may not more than double the first ten (`100%` median
  growth cap) for input task or frame latency; per-edit maxima are capped relative to the last
  window's `p95`. Post-GC heap growth after 180 edits stays below 50 MiB.
- **Burst handler tails** — navigation scenarios keep the existing `< 25 ms` handler median gate
  (the pre-index path was seconds). All burst scenarios require handler `p95 ≤ max(4× median,
median + 40 ms)` and `maxFrameGapMs < 500 ms` so multi-second stalls fail even when medians look
  fine. Arrow-up, word-left, line-start, and document-start run at 2 s instead of 5 s in the
  default suite to keep total runtime reasonable while still asserting selection movement and
  latency. Backspace scenarios use the same 2 s window from the paragraph midpoint so deletion
  counts stay assertable without end-of-paragraph coalescing swallowing the whole paragraph.
  The ordered-typing echo scenario stays opt-in via
  `EDIT_BROWSER_BENCH_BURST_SCENARIO=editing-ordered-type` because it uses a 100 ms / 100 Hz
  window rather than the default burst cadence.
- **Document state** — burst typing, suggesting typing, Backspace, and forward Delete assert exact
  paragraph text and caret offsets where the canonical tree changes; suggesting Backspace asserts
  unchanged canonical paragraph length with caret movement and undo availability because tracked
  deletions do not remove bytes until accepted. Editing Backspace runs from the paragraph midpoint
  and asserts the deleted character count matches processed events (rapid end-of-paragraph Backspace
  coalesces into larger deletes and remains a manual soak scenario).
- **Injected-delay self-test** — unchanged: measured handler/input deltas must include at least
  `0.8×` the configured artificial delay in both latency and burst modes.

## Running it

```bash
# Build the 20x-length profiling fixture (gitignored; ~420 KB zip, 6 MB document.xml)
node scripts/create-sample-20x-fixture.mjs

# Run the staged benchmark
bun scripts/bench/pipeline-bench.ts            # table output
bun scripts/bench/pipeline-bench.ts --json     # machine-readable

# Attribute time to functions
bun --cpu-prof scripts/bench/pipeline-bench.ts # writes CPU.*.cpuprofile

# Review-path benchmark: the same document carrying ~1,080 comments and ~800
# tracked-change sites (gitignored fixture)
node scripts/create-review-20x-fixture.mjs
bun scripts/bench/review-bench.ts
```

The fixture is the demo `sample.docx` with its body repeated 20 times (bookmark ids,
hyperlink anchors and drawing ids uniquified per copy): ~12,700 paragraphs, 300 tables,
~1,800 bookmarks, 100 sections — 521 pages. The bench uses the fixed measurer so numbers
are font-independent; browser-side costs (canvas measurement, paint, React) are profiled
separately in Chrome.

## 2026-08-06 optimization pass — results

Medians of 3 runs, Apple Silicon, Bun 1.3.14, 20x fixture (521 pages).

| Stage                          | Before  | After   | Change |
| ------------------------------ | ------- | ------- | ------ |
| `readOoxmlPackage` (parse)     | 1244 ms | 770 ms  | −38%   |
| `normalizeParagraphIdentity`   | 480 ms  | 330 ms  | −31%   |
| Layout, cold                   | 911 ms  | 755 ms  | −17%   |
| Layout, no-change warm pass    | 124 ms  | 53 ms   | −57%   |
| `transact` insertText (1 char) | 30 ms   | 26 ms   | −15%   |
| Layout, incremental after edit | 125 ms  | 78 ms   | −38%   |
| `writeOoxmlPackage` (save)     | 726 ms  | 475 ms  | −35%   |
| **Total**                      | 3691 ms | 2510 ms | −32%   |

What the profiler found, and what changed:

1. **XML preflight scanned per character** (`xml-reader.ts`): `preflightForbiddenXml` did a
   `slice(i, i+10).toUpperCase()` at every index of a multi-megabyte part and re-sliced the
   whole tail for the entity regex at every `&`. Everything it can object to starts at `<`
   or `&`, so the scan now skips every other character and anchors the entity check with a
   sticky regex. ~350 ms of parse.
2. **Namespace maps copied per element** (`ooxml-tree.ts`, `ooxml-validate.ts`,
   `ooxml-serialize.ts`): parse, validate and serialize each copied the inherited
   prefix→URI map for every node, though almost no node declares namespaces. All three
   walks are copy-on-write now. This was the single largest allocation source (~400 ms of
   `new Map` in parse alone) and also speeds up every `transact`, which re-validates the
   touched part.
3. **Validation path strings built eagerly** (`ooxml-validate.ts`): issue paths are now
   derived from a shared index trail only when an issue is reported; a valid document
   reports none.
4. **Paragraph cache keys rebuilt and re-hashed per pass** (`layout-cache.ts`): `nodeToken`
   walked every paragraph subtree on every layout pass, and the joined key was a fresh
   multi-kilobyte string whose hash the JS engine had to recompute on every cache `get`.
   Tokens are now memoized per immutable paragraph/table node, and the assembled key is
   memoized per node so unchanged paragraphs hand the SAME string object back to the cache.
   In a Chrome keystroke trace on the 20x document, `ParagraphLayoutCache.get` went from
   ~129 ms per keystroke of self-time to unmeasurable.
5. **Whole-tree scans repeated per layout pass** (`semantic-layout.ts`, `toc-layout.ts`):
   `contentControlContextToken` and the three TOC paragraph-id scans ran on every pass,
   including no-change passes that reuse every page. All four are memoized per immutable
   part reference.
6. **Tables read twice per pass** (`semantic-table.ts`): `readTableStructure` is a pure
   function of an immutable node and scalar inputs, called by document-order indexing, flow
   layout and row measurement. It now carries a single-entry memo per table node.
7. **Serializer assembled strings bottom-up** (`ooxml-serialize.ts`): `serializeNode`
   builds into a shared accumulator with one final join, and `significantChildren`
   short-circuits for the (dominant) element-only child lists.
8. **Package copy per staged op** (`ooxml-package.ts`): `withPart` copies the parts map
   directly instead of spreading it through an intermediate entries array.

Not changed, deliberately: deep-freezing of the canonical tree (an invariant the store's
immutability contract and these very memos rely on), the full fail-open revalidation in
`normalizeParagraphIdentity` (kept; made cheaper by items 2–3), and every validation or
security bound — no rule was weakened, only recomputation of already-proven facts removed.

Browser (Chrome, dev server, same fixture): load-to-521-pages ≈ 7.5 s wall including Vite
module loading; keystroke-to-paint median ~300 ms before AND after — the engine's share
shrank (item 4), but dev-mode React overhead and per-revision whole-document derivations
(content-control walk, revision projection, note references, drawing projection — each a
full-tree scan per edit) dominate the interactive path. Making those derivations
incremental is the next lever, and it is a design change, not a micro-optimization.

## 2026-08-06 review-scale pass — results

The review fixture is `sample.docx` with 50 comments (10 of them replies anchored over
exactly the parent's range) and 40 tracked changes (15 insertions, 15 deletions, 5
delete+insert replacement pairs) injected, then the body repeated 20 times with comment
and revision ids uniquified per copy: ~1,080 comments and ~800 tracked-change sites over
540 pages — the "long reviewed contract" shape. Before and after are the SAME bench
script (its stage names below) run against the pre- and post-change engine; medians of 3
runs, Apple Silicon, Bun 1.3.14.

| Stage                                            | Before | After  | Change |
| ------------------------------------------------ | ------ | ------ | ------ |
| `collectReviewItems` (repeat, unchanged tree)    | 116 ms | 5 ms   | −96%   |
| `collectReviewItems` (fresh root, after an edit) | 117 ms | 52 ms  | −55%   |
| `revisionItemsOf` (repeat read)                  | 86 ms  | 3 ms   | −96%   |
| `locateSites` (repeat read)                      | 54 ms  | ~0 ms  | —      |
| `commentAnchorsOfStory` (repeat read)            | 12 ms  | 0.5 ms | −96%   |
| `paragraphOrderOfPart` (repeat read)             | 13 ms  | ~0 ms  | —      |
| `hasReviewContent` (after the queue was read)    | 17 ms  | 1 ms   | −94%   |
| `reviewItems()` after keystroke (local patch)    | 7.5 ms | 6 ms   | —      |
| `reviewItems()` cold (document open)             | 207 ms | 197 ms | ~same  |

The fresh-root path is what an accept, reject, comment write or undo pays before the rail
repaints; the unchanged-tree path is what any second reader (automation, a re-render, the
geometry pass) pays. The cold document-open read is deliberately reported as unchanged:
the first derivation builds the per-node memos either way, and the win is every read
after it. What the profiler found, and what changed:

1. **Every full-tree review fact was re-derived per call** even though each is a pure
   function of immutable nodes. `locateSites` merged 82,800 entries into a fresh `Map` per
   call on warm per-paragraph memos; `paragraphOrderOfPart` walked the whole tree three
   times per derivation (replacement pairing, the queue's merged order, the session's
   cached order); `commentAnchorsOfStory` re-walked every paragraph's markers. All are now
   memoized on the immutable node they are a function of — the part root for merged
   indexes, the paragraph for marker points, the table row for tracked-row anchors — the
   same pattern the 2026-08-06 layout pass established.
2. **`collectRevisionSites` memoized per paragraph only**, so a document of tables
   re-walked every `w:trPr`/`w:tcPr` per derivation. The memo now covers table subtrees
   too, which also feeds `hasReviewContent` and accept-all.
3. **`anchorTrackedRows` re-descended every paragraph** looking for table rows. A
   paragraph CAN hold one — a textbox in a run holds block content, tables included — so
   the subtrees are memoized per paragraph rather than pruned: the ordinary paragraph
   costs one cached empty answer, and a textbox table keeps its anchors.
4. **Replacement pairing scanned every insertion per deletion.** Pairing is exact
   end-to-start position equality, so insertions are indexed by their start position and
   the scan is one lookup.
5. **The content-control gate re-walked the whole document per keystroke**
   (`contentControlsIn` was cached per root, and every transaction makes a new root).
   Outside any control, a block's entries are a pure function of the block subtree, so the
   walk now composes memoized per-paragraph/per-table answers instead of descending.
6. **The layout lane carried its own `paragraphOrderOfPart` copy**, unmemoized; it now
   re-exports the store's.
7. **The revision CARDS were rebuilt per read even when every index hit.** A real
   heavily-tracked document (Word mints an id per editing burst) produces tens of
   thousands of cards from a few thousand wrappers, and assembling them cost ~40 ms per
   unchanged-tree read — more than everything the index memos saved. `revisionItemsOf`
   is memoized per part root now, bounded like the indexes; on such a document the
   unchanged-tree re-derive drops from ~48 ms to ~6 ms. The paragraph-scoped view the
   local patch derives is deliberately uncached (each keystroke would churn the ring).

Not changed, deliberately: the local-patch keystroke path (already sub-10 ms), every
validation and security bound, and the derivation SEMANTICS — the queue, its order, its
threading and pairing rules are byte-for-byte the same, only recomputation of
already-proven facts was removed. The shared memoized `Map` instances (`locateSites`,
`paragraphOrderOfPart`) keep their public signatures; callers must treat them as
read-only, which every in-repo caller already did (declaring them `ReadonlyMap` is a
follow-up, being a public signature change).

Two bounds keep the memos honest under adversarial input and long sessions: cached site
arrays replay through a plain loop (a spread would hit the engine's argument-count limit
on a table holding tens of thousands of tracked markers), and the per-ROOT caches are
bounded to recent roots (`recent-root-cache.ts`) so the undo history's retained snapshots
do not each pin an O(document) derived index — per-NODE memos are exempt, because
unchanged nodes are shared across revisions.
