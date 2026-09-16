# Bulk revision benchmark and review

Use this benchmark to compare one filtered decision with a loop over individual review cards.
It covers issues [#859](https://github.com/eigenpal/docx-editor/issues/859) and
[#860](https://github.com/eigenpal/docx-editor/issues/860).

## Run the comparison

From the repository root, run:

```sh
bun install --frozen-lockfile
bun scripts/bench/bulk-review-bench.ts 100 1000 10000
bun scripts/bench/bulk-review-bench.ts --action=reject 100 1000 10000
```

Each document contains the requested number of insertion revisions, alternating between Ada
and Grace. The benchmark hides Grace and resolves Ada's half of the document. Each mode opens
a fresh DOCX in the real shared editor with the Pro review module, under happy-dom.

Timing starts after loading, initial pagination, and filtering. It includes synchronous command
preflight, the transaction, review refresh, layout, and paint work. It excludes user think time,
network activity, and asynchronous browser rendering. These are integration timings, not a
browser latency guarantee.

Each JSON line reports:

- `completed` and `finished`: how many selected decisions actually resolved, and whether all did.
- `ms`: elapsed time for those decisions.
- `commits`: editor change events during the measured operation.
- `refreshCycles`: calls through the shared review commit and layout refresh boundary.
- `fullLayoutPasses`: the layout engine's cumulative full-pass counter increase. Incremental
  passes are not included in this counter; `refreshCycles` measures the orchestration boundary.

The script verifies the actual remaining revision count. A batch fails the benchmark if it
commits or refreshes more than once, performs more than one full layout, or resolves a hidden
revision.

By default, the loop stops after its first operation that takes total elapsed time past
60 seconds. An unfinished loop is reported explicitly. Its timing is a lower bound, not an
estimate of the full loop. To run every selected decision without this limit, add `--full-loop`.
To measure only batches, add `--batch-only`.

## Reference results

Measurements use an Apple M4 Pro, macOS 15.7.4, Bun 1.3.14, and the repository's locked dependencies.
Run the commands on an otherwise idle machine when comparing latency. Results vary with document
structure, fonts, revision density, and machine load.

| Action | Total revisions | Mode  | Elapsed (ms) | Decisions resolved | Commits | Refresh cycles | Full layout passes |
| ------ | --------------: | ----- | -----------: | ------------------ | ------: | -------------: | -----------------: |
| accept |             100 | batch |         53.5 | 50                 |       1 |              1 |                  1 |
| accept |             100 | loop  |        790.2 | 50                 |      50 |             50 |                  1 |
| accept |           1,000 | batch |        218.4 | 500                |       1 |              1 |                  1 |
| accept |           1,000 | loop  |     40,013.0 | 500                |     500 |            500 |                  1 |
| accept |          10,000 | batch |      2,008.8 | 5000               |       1 |              1 |                  1 |
| accept |          10,000 | loop  |     60,648.7 | 65 (incomplete)    |      65 |             65 |                  1 |
| reject |             100 | batch |         43.8 | 50                 |       1 |              1 |                  1 |
| reject |             100 | loop  |        910.6 | 50                 |      50 |             50 |                  1 |
| reject |           1,000 | batch |        147.4 | 500                |       1 |              1 |                  1 |
| reject |           1,000 | loop  |     38,738.0 | 500                |     500 |            500 |                  1 |
| reject |          10,000 | batch |      1,667.0 | 5000               |       1 |              1 |                  1 |
| reject |          10,000 | loop  |     60,126.9 | 68 (incomplete)    |      68 |             68 |                  1 |

Every batch completed its selection. The 10,000-revision loops hit the time cap after resolving
only 65 accept decisions and 68 reject decisions out of 5,000. Their reported times are lower
bounds for completing the full selection.

## Proposed latency budget

For the reference machine and fixture, propose median command budgets of 100 ms at 100 revisions,
500 ms at 1,000 revisions, and 2,500 ms at 10,000 revisions. These are proposed for maintainer
review; they have not been agreed as a product SLO. The initial 2,000 ms target for 10,000 revisions
was narrowly missed. The 2,500 ms proposal leaves room for the observed run-to-run variation.

Three accept-batch runs measured:

| Total revisions | Samples (ms)              | Median (ms) | Proposed budget (ms) |
| --------------- | ------------------------- | ----------: | -------------------: |
| 100             | 53.5, 52.7, 52.4          |        52.7 |                  100 |
| 1,000           | 218.4, 219.9, 203.9       |       218.4 |                  500 |
| 10,000          | 2,008.8, 2,176.5, 2,014.0 |     2,014.0 |                2,500 |

The reject timings above are single reference runs. Keep wall-clock comparisons outside CI's
hardware-independent gates. Every measured batch must still resolve only its requested set,
commit once, refresh once, and perform no more than one full layout pass.

## Review coverage

The implementation uses exact canonical revision sites and one operation per affected part.
The shared editor commits all affected parts atomically. The API targets one story per sync.
Neither path loops over individual decisions to write the document.

The review covered the following failure modes:

- Author visibility and predicates compose; explicit keys override them. Offscreen revisions and
  unopened stories participate without opening retained story stores during preflight.
- Reused OOXML IDs do not alias different authors, kinds, or stories. Replacements, move pairs,
  nested changes, row subtrees, and paragraph properties are preflighted as related groups.
- Unsupported numbering revisions survive paragraph merges. A formatting record without
  restorable properties is skipped on rejection instead of being reported as resolved.
- Complete tracked rows resolve even when the typed API collection omits them. Incomplete rows
  remain pending. Unsupported descendants cannot be consumed by a selected ancestor.
- Empty, duplicate, stale, foreign-context, and foreign-story inputs have explicit behavior.
  Unknown targets are reported; foreign targets reject the transaction.
- Document protection, content control locks, viewing mode, and collaboration write admission
  remain on the normal transaction path. A failed write cannot publish a partial result.
- Undo and redo restore the selected decision. Save/reopen retains hidden and unsupported changes.
  Pending counts are read after commit because surviving revisions can regroup.
- Public server and browser imports compile. `resolve()` returns a typed `ClientResult` that is
  readable after sync. Existing strict `acceptAll()` and `rejectAll()` signatures remain unchanged.

The browser demo is at `http://localhost:5173/?bulkReview=1&fixture=bulk-review.docx` after
`bun run dev:react`. Its automated checks exercise both actions through the shared command and
the public browser API, and inspect saved OOXML as well as the UI:

```sh
bunx playwright test --config e2e/editor-smoke.config.ts bulk-review.interaction.spec.ts
```

The user guide in `docs/site/content/editor-api/revisions.mdx` documents selection, result fields,
skip reasons, recovery, migration, and runnable examples. It follows Google's task-oriented
[developer documentation style](https://developers.google.com/style): address the reader,
use active voice, introduce prerequisites, and explain what each example accomplishes.

## Validation

- Full repository suite: 14,311 tests passed across 1,131 files after the final correctness fixes.
- Browser demo: four Playwright tests passed for accept/reject, filtering, explicit batches,
  unsupported changes, undo/redo, saved XML, and reopening.
- Released collaboration clients: the complete matrix passed for 2.18.0, 2.19.0, and 2.19.1,
  with both deterministic seeds and both document creators.
- Package builds, workspace type checking, public API snapshots, documentation checks, i18n,
  license checks, architecture gates, and the production React demo build were checked.

The optional root-wide `typecheck:root` still reports existing example errors: missing translation
keys in the older automation panels, a collaboration callback type in `ComposedEditorDemo.tsx`,
and a Vite plugin type comparison. The workspace typecheck and compiled browser/headless API
checks pass. The new demo and batch API have no diagnostics in that root check.

Self-review found and fixed issues in public exports, read-only story preflight, pending-count
regrouping, paragraph-property preservation, malformed formatting records, and the production
demo build prerequisites. The final pass found no remaining P2-or-higher issues in this change.
