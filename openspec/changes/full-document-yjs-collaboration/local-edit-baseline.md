# Local one-character edit baseline

OpenSpec task 1.7 for `full-document-yjs-collaboration`.

- Captured: 2026-08-26T09:47:07.167Z
- Measured SHA: `56848c853f5e0b5e9c1a19d6adb80f311f71424e` (`origin/main`)
- Fixture: `/Users/timurkramar/GitHub/docx-editor/e2e/fixtures/synthetic-long-edit.docx`
- SHA-256: `ca8ee28a8d40ae7914a820303b96ddbbe8f06d37325b0fc2ae6f1140aea96321`
- Runtime: Bun 1.3.14, arm64, darwin
- Config: 9 measured rounds, 2 warmup, fixed(6px,14px)
- Edit: insertText('X') at offset 0 on paragraph 1600 (`/word/document.xml#0.0.1599` / `4A7E6EC2`)

This capture replaces a stale record that wrote 203 into
`layout.reusedPages`. That field is `LayoutSession.stats.reusedPages`. On
`origin/main` it is 154, the same value `edit-bench-gates` pins for
`steady-middle-text`. 203 is `paint.reusedPageRecords` (page-record object
identity). The two counters are not interchangeable.

## Gate-worthy work counters (deterministic)

These values matched on three independent 9+2 runs. Use them as the gate.

| Metric                                        | Value                       |
| --------------------------------------------- | --------------------------- |
| Canonical allocated nodes                     | 6                           |
| Canonical reused nodes                        | 34551                       |
| Canonical total before → after                | 34555 → 34557               |
| Allocated on edited paragraph path            | 6                           |
| Allocated off edited paragraph path           | 0                           |
| Dirty impact                                  | text-local                  |
| Dirty ids                                     | /word/document.xml#0.0.1599 |
| Created / deleted ids                         | 0 / 0                       |
| Dependency keys                               | 1                           |
| Layout placed / total                         | 13 / 3200                   |
| Layout reused pages (`LayoutSession.stats`)   | 154                         |
| Layout full passes                            | 1                           |
| Pages before → after                          | 204 → 204                   |
| Layout cache hits / misses / evictions / size | 12 / 3201 / 0 / 3201        |
| Reused / new page records (object identity)   | 203 / 1                     |
| Materialized pages                            | 4                           |
| Reused / rebuilt paint elements               | 204 / 0                     |
| Yjs incremental update (bytes)                | 14                          |
| Yjs snapshot after insert (bytes)             | 742057                      |
| Yjs paragraph count                           | 3200                        |

## Advisory timings and RSS (machine-dependent)

Do not fail a pull request from these numbers. The machine was loaded.
JSON records run 3 (quietest p95 of the three).

| Timer       | Run 1 median / p95 (ms) | Run 2 median / p95 (ms) | Run 3 median / p95 (ms) |
| ----------- | ----------------------- | ----------------------- | ----------------------- |
| Transaction | 7.361 / 11.348          | 7.215 / 11.567          | 6.770 / 8.565           |
| Layout      | 2.217 / 4.813           | 1.867 / 3.681           | 1.868 / 2.365           |
| Paint       | 13.256 / 23.178         | 13.031 / 20.720         | 12.716 / 14.398         |
| Total       | 23.269 / 36.018         | 22.029 / 35.968         | 21.435 / 24.360         |

| RSS delta edit through paint (bytes) | Run 1    | Run 2    | Run 3    |
| ------------------------------------ | -------- | -------- | -------- |
|                                      | 24395776 | 26394624 | 19628032 |

Heap used delta and external delta stayed 0 on every run.

## Methods

- Load e2e/fixtures/synthetic-long-edit.docx, normalize paragraph identity, and pick the middle body paragraph (edit-bench steady-middle-text).
- Each round starts from a fresh TreePackageStore, layout session, and paragraph layout cache.
- Warm layout with two layoutSemanticDocument passes and a fixed measurer (6px, 14px), matching scripts/bench/edit-bench.ts.
- Insert one character with insertText at UTF-16 offset 0.
- Canonical allocation compares object identity of every node in the main part before and after the transaction.
- Dirty scope is TreeModelChange.dirty/created/deleted/impact/dependencyKeys from the committed transaction.
- Layout work counters come from the warmed LayoutSession plus ParagraphLayoutCache.stats. `reusedPages` is 154.
- Page-record identity is a separate count: 203 of 204 page objects keep identity; 1 page record is new.
- Paint uses happy-dom. The viewport pins the edited page plus one overscan page. Incremental paint reuse counts retained page element identity.
- Memory samples process.memoryUsage() with no GC between stages. RSS and external bytes are the usable process-level signals on this Bun runtime.
- Yjs size seeds the proof paragraph map (docx-body-paragraphs-v1) with every w14:paraId text, fixes clientID=1, then encodes the incremental update for inserting X at the start of the target Y.Text.

## Limitations

- This is the local one-character baseline only. It does not apply a remote Yjs update or materialize a collaborative replica.
- Yjs size uses the current paragraph-text proof schema, not a full-document XML or registry CRDT. The baseline DOCX blob is not stored in Yjs.
- Paint runs in happy-dom, not Chromium. It excludes React, selection sync, and the review rail. Use bench:edit:browser for those layers.
- Viewport materialization paints the edited page plus overscan, not every sheet. Page-record identity still covers the whole document.
- Bun 1.3.14 did not change process.memoryUsage().heapUsed between edit, layout, and paint samples. Canonical node counts and RSS are the allocation signals.
- Work counters are the gate. Wall-clock medians and RSS deltas are advisory.
- `scripts/bench/collaboration-local-edit-bench.ts` is not on `main`. This capture ran that harness in a worktree of `origin/main` against main store, layout, and paint.

## Command

```bash
bun scripts/bench/collaboration-local-edit-bench.ts --runs 9 --warmup 2 --json --out openspec/changes/full-document-yjs-collaboration/local-edit-baseline.json --md openspec/changes/full-document-yjs-collaboration/local-edit-baseline.md
```
