# Local one-character edit baseline

OpenSpec task 1.7 for `full-document-yjs-collaboration`.

- Captured: 2026-08-24T20:22:39.110Z
- Fixture: `/Users/timurkramar/GitHub/docx-editor/e2e/fixtures/synthetic-long-edit.docx`
- SHA-256: `ca8ee28a8d40ae7914a820303b96ddbbe8f06d37325b0fc2ae6f1140aea96321`
- Runtime: Bun 1.3.14, arm64, darwin
- Config: 9 measured rounds, 2 warmup, fixed(6px,14px)
- Edit: insertText('X') at offset 0 on paragraph 1600 (`/word/document.xml#0.0.1599` / `4A7E6EC2`)

After rebase onto `origin/main`, incremental layout reuses 203 of 204 page
records for this edit. The previous baseline was 154 reused pages and 50 new
page records. Higher reuse is better, so this change re-records those work
counters to 203 / 1. Timing and RSS rows stay on the original 1.7 capture.

## Metrics

| Metric                                            | Value                       |
| ------------------------------------------------- | --------------------------- |
| Canonical allocated nodes                         | 6                           |
| Canonical reused nodes                            | 34551                       |
| Canonical total before → after                    | 34555 → 34557               |
| Allocated on edited paragraph path                | 6                           |
| Allocated off edited paragraph path               | 0                           |
| Dirty impact                                      | text-local                  |
| Dirty ids                                         | /word/document.xml#0.0.1599 |
| Created / deleted ids                             | 0 / 0                       |
| Dependency keys                                   | 1                           |
| Layout placed / total                             | 13 / 3200                   |
| Layout reused pages                               | 203                         |
| Layout full passes                                | 1                           |
| Pages before → after                              | 204 → 204                   |
| Layout cache hits / misses / evictions / size     | 12 / 3201 / 0 / 3201        |
| Reused / new page records                         | 203 / 1                     |
| Materialized pages                                | 4                           |
| Reused / rebuilt paint elements                   | 204 / 0                     |
| Transaction median / p95 (ms)                     | 9.306 / 10.815              |
| Layout median / p95 (ms)                          | 3.444 / 4.310               |
| Paint median / p95 (ms)                           | 16.126 / 21.747             |
| Total median / p95 (ms)                           | 28.064 / 35.799             |
| Heap delta edit (bytes, median)                   | 0                           |
| Heap delta layout (bytes, median)                 | 0                           |
| Heap delta paint (bytes, median)                  | 0                           |
| Heap delta edit through paint (bytes, median)     | 0                           |
| RSS delta edit through paint (bytes, median)      | 20152320                    |
| External delta edit through paint (bytes, median) | 0                           |
| Yjs incremental update (bytes)                    | 14                          |
| Yjs snapshot after insert (bytes)                 | 742057                      |
| Yjs paragraph count                               | 3200                        |

## Methods

- Load e2e/fixtures/synthetic-long-edit.docx, normalize paragraph identity, and pick the middle body paragraph (edit-bench steady-middle-text).
- Each round starts from a fresh TreePackageStore, layout session, and paragraph layout cache.
- Warm layout with two layoutSemanticDocument passes and a fixed measurer (6px, 14px), matching scripts/bench/edit-bench.ts.
- Insert one character with insertText at UTF-16 offset 0.
- Canonical allocation compares object identity of every node in the main part before and after the transaction.
- Dirty scope is TreeModelChange.dirty/created/deleted/impact/dependencyKeys from the committed transaction.
- Layout work counters come from the warmed LayoutSession plus ParagraphLayoutCache.stats. Page-record identity reuse is 203 of 204 after main's incremental layout.
- Paint uses happy-dom. The viewport pins the edited page plus one overscan page. Incremental paint reuse counts retained page element identity.
- Memory samples process.memoryUsage() with no GC between stages. RSS and external bytes are the usable process-level signals on this Bun runtime.
- Yjs size seeds the proof paragraph map (docx-body-paragraphs-v1) with every w14:paraId text, fixes clientID=1, then encodes the incremental update for inserting X at the start of the target Y.Text.

## Limitations

- This is the local one-character baseline only. It does not apply a remote Yjs update or materialize a collaborative replica.
- Yjs size uses the current paragraph-text proof schema, not a full-document XML or registry CRDT. The baseline DOCX blob is not stored in Yjs.
- Paint runs in happy-dom, not Chromium. It excludes React, selection sync, and the review rail. Use bench:edit:browser for those layers.
- Viewport materialization paints the edited page plus overscan, not every sheet. Page-record identity still covers the whole document.
- Bun 1.3.14 did not change process.memoryUsage().heapUsed between edit, layout, and paint samples. Canonical node counts and RSS are the allocation signals.
- Wall-clock medians are hardware-sensitive. Compare them on the same machine.

## Command

```bash
bun scripts/bench/collaboration-local-edit-bench.ts --runs 9 --warmup 2 --json --out openspec/changes/full-document-yjs-collaboration/local-edit-baseline.json --md openspec/changes/full-document-yjs-collaboration/local-edit-baseline.md
```
