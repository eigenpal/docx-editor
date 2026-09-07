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

There are also two deterministic 500+ page fixtures for the structural-edit scenarios
(Enter, Backspace-join, Ctrl+Enter). They are generated on demand — too large to commit —
and their SHA-256 is pinned by the gates, so regeneration is byte-identical:

```bash
bun scripts/create-synthetic-massive-edit-fixture.mjs
bun run bench:edit e2e/fixtures/generated/synthetic-massive-multisection.docx
bun run bench:edit e2e/fixtures/generated/synthetic-massive-singlesection.docx
```

`synthetic-massive-multisection.docx` is the repeated-copy shape a user produces by pasting
a template until the document passes 500 pages: 105 sections, ~8.4k top-level blocks,
repeated multi-page tables with `w:tblHeader` rows. `synthetic-massive-singlesection.docx`
is the same content as one section with chapter-style `w:pageBreakBefore` headings. Both
can also be loaded in the demo (`?fixture=synthetic-massive-multisection.docx`) after
copying them into `e2e/fixtures/`.

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

## Huge-document benchmarks

Prefer these when the question is typing latency. The synthetic fixtures above are built for
deterministic work-counter gates; they are small enough that a whole-document regression
hides inside their noise floor. The huge-document section runs the pinned 521-page
reproduction (`e2e/fixtures/typing-perf-521pp.docx`, SHA-256 in
`e2e/fixtures/typing-perf-521pp.manifest.json`): 12,820 paragraphs, 81 sections, tables,
drawings, notes and TOCs — the shape where per-keystroke costs that scale with the document
actually show. A change that looks flat on a 5-page example and saves 50 ms per keystroke
here is a change worth landing; the reverse is a regression the small fixtures cannot see.

```bash
# Headless: keystroke-to-settled latency through the FULL mounted surface —
# input, flush, layout, paint, selection — on the pinned huge fixture.
bun run bench:huge

# Capture before/after results
bun run bench:huge --json > /tmp/settle-before.json
bun run bench:huge --compare /tmp/settle-before.json

# Any other document, or shorter runs
bun run bench:huge path/to/document.docx --keystrokes 10 --warmup 1

# Browser: the same fixture through the real demo UI (needs `bun run dev` on :5173).
# Fail-closed — latency prints only when the structural evidence validates.
bun run bench:huge:browser
```

The headless half runs under happy-dom with the fixed measurer, so its absolute paint
milliseconds are inflated relative to a browser: compare runs on the same machine and read
the work counters as the hardware-independent evidence. Pagination is deterministic, so
`settle-bench-gates.test.ts` pins the per-keystroke work (placed paragraphs, reused pages,
full passes) inside `bun run test` — a regression on the huge document fails CI even though
the wall-clock numbers stay a manual comparison. The browser half is
`typing-url-audit.mjs`, which validates that trusted input reached a painted revision before
it reports anything.

The same fixture also leads the CI browser benchmark: `edit-browser.bench.spec.ts` runs a
`521pp-*` scenario pass on it and lists those rows FIRST in the PR-comment typing-latency
table, with its work counters pinned in `edit-browser-bench-gates.ts`
(`PINNED_HUGE_EXPECTED_LAYOUT_WORK`). The table itself leads with the FRAME median — the
time from the keystroke until the edit is visible — because the input-task median it used
to lead with pinned at the clock floor (0.00–0.05 ms) once typing buffered its work off the
input task, and a table led by it colored nothing.

## Wasted-layout-work benchmark

```bash
bun run bench:scope-waste
bun run bench:scope-waste --keystrokes 20 --json
```

The editing benchmark measures how much one layout pass costs. This one measures how many
passes the engine computes and then throws away, which is a different failure and one that
timings hide: a discarded pass is paid for in full and repeated, so a small fixture lays out
twice per keystroke while every median still looks ordinary.

That waste is also a correctness signal, which is why it is a gate rather than a report. A
pass discarded as stale leaves the painted DOM one revision behind the model, so the
post-edit caret cannot be written into the nodes on screen and the next repaint reads the
pre-edit caret back — the cursor jumps to the start of the story. That was issue #361.

Each scenario types a fixed burst into a DIFFERENT story — body, table cell, a header and
footer declared in the file, a header edited after a package-level op, a header created in
the session, and a footnote — and reports the passes discarded during the burst.
`scope-waste-bench-gates.test.ts` pins every one of them at zero, so the normal test suite
fails on a regression. Every counter is hardware-independent.

Types into one story only, and you measure nothing: each story part counts its own
revisions, and the body's happens to match the package's until a non-body edit or a
package-level op moves one without the other. Adding a scenario means adding its name to
`EXPECTED_SCENARIOS` in the gate, which fails if the list and the report disagree.

### CI performance-benchmark comment

`.github/workflows/bench.yml` runs two benchmarks on every PR, each twice: once on the PR
merge ref (the PR merged into current `main`) and once on the `main` tip that merge ref was
built against (using that commit's own copy of the scripts, in a separate worktree), so the
delta isolates exactly what merging the PR changes:

- the browser typing-latency test from `e2e/edit-browser.bench.spec.ts` — keystroke handler
  and frame latency through the real adapter, review rail, and paginated DOM: the number a
  typing user feels;
- `bench:edit --runs 10` — the headless engine pipeline with deterministic work counters.

The two sides run INTERLEAVED (head, base, base, head): a whole benchmark run inherits the
machine's momentary state, so back-to-back one-shot runs systematically favor one side.
`scripts/bench/edit-bench-comment.mjs` aggregates each side's runs (mean of medians), renders
all reports into a single sticky PR comment — the typing-latency table first, the engine table
below it, plus any work-counter changes — and refuses to color a delta smaller than the
observed same-side spread, so the comment measures its own noise instead of reporting it as a
result. Comparability is guarded per report by the fixture SHA-256: if the fixture changed on
the PR, or the baseline predates a benchmark, that section degrades to head-only numbers.

Timings in that comment are informational: shared runners are noisy, so the job never fails on
a head-vs-base wall-clock delta, and the single-sample timing tails run warn-only there
(`EDIT_BROWSER_BENCH_TIMING_TAILS=warn` — one scheduler stall on a shared runner trips a
max-sample gate). Deterministic gates still apply — `edit-bench-gates.test.ts` pins the engine
work counters inside `bun run test`, and the browser spec's structural and median-based gates
fail the job when the HEAD browser run trips them; a failing BASELINE browser run only
degrades the comment to head-only numbers. Fork PRs cannot receive comments (read-only
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
# tracked-change sites (gitignored fixture). It also measures cold/cached
# tracked-change predicate projection and filtered cold/warm layout.
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

## 2026-08-20 structural-edit pass — results

The trigger was a 500+ page document (a template repeated past 500 pages: 105 sections,
~8.4k blocks, ~17k paragraphs) where one Enter or Backspace re-laid the whole document
(~1 s of layout per keypress in the browser) while plain typing stayed incremental. Medians
of 3 runs, Apple Silicon, Bun 1.3.14, fixed measurer, `synthetic-massive-multisection.docx`.

| Scenario                          | Before                          | After                            |
| --------------------------------- | ------------------------------- | -------------------------------- |
| `enter-split-middle`              | 587 ms, placed 8400/8400        | 7.5 ms, placed 5, reused 624     |
| `backspace-join-middle`           | 576 ms, placed 8398/8398        | 7.3 ms, placed 3, reused 624     |
| `enter-split-early`               | 590 ms, placed 8400/8400        | 7.8 ms, placed 16                |
| `page-break-middle`               | (full relayout, +1 page)        | 11.6 ms, placed 43               |
| `wrap-middle-text`                | 22 ms, cache cold every pass    | 9 ms, cache warm                 |
| Typing pass (17k-paragraph repro) | layout ~54 ms + transact ~16 ms | layout ~31 ms + transact ~1.6 ms |

What the counters found, and what changed:

1. **The multi-section structure key embedded absolute block bounds**
   (`multi-section-layout.ts`): a split or join shifts `blockStart`/`blockEndExclusive` of
   every section after it, so the key changed and EVERY per-section session was thrown
   away — one Enter re-laid all 105 sections. The bounds are gone from the key; content
   changes are what the child sessions' own per-block keys detect.
2. **The per-section context embedded the raw document page index**
   (`semantic-layout.ts`): an Enter that added one page shifted `pageIndexStart` of every
   section below, making each of them incomparable and forcing full section relayouts.
   Page numbers re-project at finalize and page shells renumber at remap, so the index is
   out of the context; the one real dependence — page PARITY (even/odd headers,
   inside/outside anchored drawings) — is tracked on the session and checked separately.
   Table header-repeat line ids switched to section-local page occurrences for the same
   reason.
3. **Retention ran per section and evicted every other section's break cache**
   (`layout-cache.ts`): each section's pass called `retain` with only its own keys, so a
   multi-section document had a 0% cache hit rate across passes — every structural edit
   re-measured every paragraph. The orchestrator now retains once over the union
   (including table-cell keys recorded per table node), entries age out over generations
   instead of being evicted while live, the LRU cap never evicts the current working set,
   and the sweep runs on a stride of passes.
4. **Convergence required an exactly equal completed-page count** (`semantic-layout.ts`):
   an edit that added or removed a whole page could never reconverge, so everything below
   re-placed. When the in-page flow state matches at a checkpoint but the page count
   differs, the unchanged tail is now reused through `remapPage` — same page-relative
   fragments, new shells `delta` sheets over — gated by `convergenceTailShiftAllowed`
   (title page, parity, note reserves, wrap exclusion zones refuse the shift).
5. **Content-control boundaries re-indexed every span of every page per pass**
   (`content-control-boundary-layout.ts`, extracted from `semantic-layout.ts`): control
   collection now memoizes per top-level block node, and placed geometry memoizes per
   page record filtered to the paragraphs controls actually name — a typing pass walks
   the two pages it rebuilt, not 630.
6. **Every op's lock resolution walked the whole tree** (`tree-op-content-controls.ts`):
   `enclosingContentControls` re-descended from the root per target; it now climbs the
   part's id→parent index. `transact` on the 17k-paragraph document dropped ~10× .

Not changed, deliberately: every convergence guard that must hold exactly (fragment
signatures, anchor state, defer counts), every content-control lock semantic (the climb
returns byte-identical chains), and the bench's round-0 oracle — every incremental result
above is byte-identical to a clean full pass, asserted per scenario on every gate run.

## Paragraph cache diagnostics

The edit benchmark JSON includes `cacheDiagnostics` alongside each scenario's existing
`work` counters. `beforeEdit` and `afterEdit` are lifetime-counter snapshots: subtract them
to isolate the edit from cold layout and warmup. They distinguish soft/hard limit pressure,
stale-generation eviction, one-shot releases and explicit clears. `payload` counts unique
broken-line, span and drawing records reachable through the cache.

These are on-demand inspections outside the measured transaction/layout windows. They do
not touch LRU order or hit/miss counts. Key and span text bytes describe logical UTF-16
payload, not retained JS heap: object headers, interning, shared backing storage, property
graphs, DOM and WASM resources are excluded. Use the browser heap benchmark for retained
heap comparisons; do not add these logical counts to post-GC heap totals.

Internal callers can inspect built-in caches with `paragraphCacheDiagnostics(cache)` and
line caches with `paragraphBreakPayload(cache)` from `layout/paragraph-cache-diagnostics.ts`.
Custom cache implementations return `undefined`; the public cache interface is unchanged.
Inspection walks the cache, so it belongs in an explicit diagnostic action rather than
every keystroke or paint. Readers are weakly associated with their owning cache.
