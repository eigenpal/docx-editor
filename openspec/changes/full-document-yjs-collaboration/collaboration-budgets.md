# Collaboration performance budgets

OpenSpec task 0.6 for `full-document-yjs-collaboration`.

This artifact freezes pull-request work-counter budgets and maintained hardware
timing budgets. It uses the task 1.7 local one-character capture in
`local-edit-baseline.json` and the existing `steady-middle-text` counters in
`scripts/bench/edit-bench-gates.test.ts`.

Do not mark a pull request as green from wall-clock numbers. Do not mark a
maintained hardware job as green from work counters alone.

## Sources

- Baseline: `openspec/changes/full-document-yjs-collaboration/local-edit-baseline.json`
- Captured: 2026-08-24T20:22:39.110Z
- Fixture: `e2e/fixtures/synthetic-long-edit.docx`
- SHA-256: `ca8ee28a8d40ae7914a820303b96ddbbe8f06d37325b0fc2ae6f1140aea96321`
- Bytes: 27897
- Edit: `insertText('X')` at UTF-16 offset 0 on paragraph 1600
  (`/word/document.xml#0.0.1599` / `4A7E6EC2`)
- Measurer: `fixed(6px,14px)`
- Local capture: 2 warmup rounds, 9 measured rounds
- Recorded profile: Bun 1.3.14, arm64, darwin

A fixture hash mismatch fails the run before any budget comparison.

## Lanes

| Lane                                                                                                  | Pull request | Maintained hardware          |
| ----------------------------------------------------------------------------------------------------- | ------------ | ---------------------------- |
| Canonical allocation, dirty scope, layout work, page identity, paint reuse, proof-schema update bytes | Gate         | Gate                         |
| Transaction, layout, paint, and total milliseconds                                                    | Record only  | Gate on the recorded profile |
| RSS delta                                                                                             | Record only  | Gate on the recorded profile |
| External-memory delta                                                                                 | Record only  | Record only                  |
| `heapUsed` deltas                                                                                     | Do not gate  | Do not gate                  |
| Chromium eligible typing presentation (16.7 ms median, 33.4 ms p95)                                   | Do not gate  | Gate on the browser profile  |

`heapUsed` stayed 0 across edit, layout, and paint on Bun 1.3.14. Canonical node
counts are the allocation signal. RSS is the process-level memory signal.

Happy-dom paint is not the sub-frame typing gate. Local happy-dom paint median
is 16.126 ms. Local total median is 28.064 ms. Those numbers already sit at or
above one 16.7 ms frame. The 16.7 / 33.4 ms budget applies to Chromium
`beforeinput` presentation from
`openspec/changes/sub-frame-large-document-typing/`, not to this headless paint.

## Ratios

From design D2 and the replication spec:

- Remote canonical allocation **pass**: fewer than 3× local (`ratio < 3`).
- Remote canonical allocation **optimize**: `3 ≤ ratio < 10`. One bounded
  optimization pass is allowed, then remeasure.
- Remote canonical allocation **kill**: `ratio ≥ 10`, or any off-path
  allocation, or a lost move identity.
- Remote layout work, paint work, and warm timings **pass**: at most 2× local.
- RSS **pass** on the recorded profile: at most 2× local.

Local allocated nodes = 6, so remote pass is `allocated < 18`, optimize is
`18 ≤ allocated < 60`, and kill is `allocated ≥ 60`. Off-path allocation must
stay 0. Off-path allocation is a kill, not an optimize band.

## Pull request work counters

Work counters must match across extra runs. Pull-request tests use 1 warmup and
1 measured run. Extra runs are allowed only when every work field stays equal.

### Local one-character path

The local non-collaborative path and the local authoring path must match the
1.7 capture exactly. Layout fields also lock to `edit-bench-gates` scenario
`steady-middle-text`.

| Field                                  | Budget                        |
| -------------------------------------- | ----------------------------- |
| Canonical allocated                    | 6                             |
| Canonical reused                       | 34551                         |
| Canonical total before → after         | 34555 → 34557                 |
| Allocated on paragraph path            | 6                             |
| Allocated off paragraph path           | 0                             |
| Dirty impact                           | `text-local`                  |
| Dirty ids                              | `/word/document.xml#0.0.1599` |
| Created / deleted                      | 0 / 0                         |
| Dependency keys                        | 1                             |
| Layout placed / total                  | 13 / 3200                     |
| Layout reused pages                    | 154                           |
| Layout full passes                     | 1                             |
| Pages before → after                   | 204 → 204                     |
| Cache hits / misses / evictions / size | 12 / 3201 / 0 / 3201          |
| Reused / new page records              | 154 / 50                      |
| Materialized pages                     | 4                             |
| Reused / rebuilt paint elements        | 204 / 0                       |
| Proof-schema incremental update        | 14 bytes                      |
| Proof-schema snapshot after insert     | 742057 bytes                  |
| Yjs paragraph count                    | 3200                          |

### Remote one-character path

Compare a warm remote apply of the same insert against the local exact row.

| Field                                     | Pass                | Optimize  | Kill                         |
| ----------------------------------------- | ------------------- | --------- | ---------------------------- |
| Canonical allocated                       | `< 18`              | `18..59`  | `≥ 60`                       |
| Allocated off paragraph path              | `0`                 | —         | `> 0`                        |
| Dirty impact, ids, created, deleted, keys | exact local row     | —         | any widening                 |
| Layout placed                             | `≤ 26`              | —         | `≥ 3200` or `fullPasses > 1` |
| Layout total                              | 3200                | —         | other                        |
| Reused pages                              | `≥ 154`             | —         | `< 154`                      |
| Pages                                     | 204 → 204           | —         | count change                 |
| Cache evictions                           | 0                   | —         | `> 0`                        |
| Cache hits                                | `≥ 12`              | —         | —                            |
| Reused page records                       | `≥ 154`             | —         | `< 154`                      |
| New page records                          | `≤ 50`              | —         | `> 50`                       |
| Materialized pages                        | 4                   | —         | other                        |
| Reused paint elements                     | 204                 | —         | other                        |
| Rebuilt paint elements                    | 0                   | —         | `> 0`                        |
| Incremental update bytes                  | `< 42` and `< 4096` | `42..139` | `≥ 140`                      |
| Snapshot growth (after − before)          | `< 42`              | `42..139` | `≥ 140`                      |

Proof-schema snapshot size 742057 is the local denominator for this bench. A
full-document XML or registry snapshot may be larger than the paragraph-text
proof. Task 2.11 must recapture local snapshot bytes per backend. After that
capture, 3× / 10× apply to the same backend's local versus remote path, not to
the proof-schema total.

One-character incremental bytes must stay independent of document size. The
4096-byte absolute cap is a document-size independence ceiling. It is not a
license to ignore the 3× proof-schema band for this scenario.

### Reconnect work counters

Empty reconnect (no pending edits):

| Field                        | Budget                  |
| ---------------------------- | ----------------------- |
| Canonical allocated          | 0                       |
| Allocated off paragraph path | 0                       |
| Dirty / created / deleted    | empty                   |
| Extra full layout passes     | 0                       |
| Pages before and after       | equal                   |
| Rebuilt paint elements       | 0                       |
| Snapshot delta               | `≤ 7420` (1% of 742057) |

Reconnect that applies one buffered character uses the remote one-character
work budgets.

Until task 7.6 defines a distinct checkpoint format, checkpoint bytes equal
snapshot bytes of the admitted state. Reconnect must not require a larger
blob than that checkpoint budget.

## Join payload and transport ceiling

A joiner receives the whole document as one Yjs update, so join cost is a size
budget, not a work-counter budget.

Measured on `examples/vite/public/sample.docx` (36 KiB on disk, 12,196 registry
nodes), Bun 1.3.14, arm64, darwin:

| Shape                                                  | Total    | Per node |
| ------------------------------------------------------ | -------- | -------- |
| First full-document registry encoding                  | 6304 KiB | 517 B    |
| Current registry encoding                              | 2844 KiB | 239 B    |
| Floor: flat map, one packed string per node             | 299 KiB  | 25 B     |
| Floor: plus one `Y.Array` per node for children         | 598 KiB  | 50 B     |
| Floor: plus children populated                          | 886 KiB  | 74 B     |

The 74-byte row is the reachable floor. The per-node `Y.Array` is what gives
concurrent child ordering, which the registry requires, so no encoding below
that row is admissible. `MAX_BYTES_PER_NODE` in
`packages/collaboration-yjs/src/__tests__/document-size.test.ts` is 160, which
sits above the floor and below the current encoding.

A browser rejects a single SCTP message above roughly 256 KiB, and `y-webrtc`
hands each sync message to `simple-peer` in one `send` call with no splitting.
`y-webrtc` also wraps that call in `try {} catch {}`, so an oversize update fails
with no error surface and the joiner waits until its own timeout.

Encoding alone cannot clear that ceiling. Even the 886 KiB floor is over three
times the best-case single-message limit, so the transport must frame the update.
`packages/collaboration-yjs/src/webrtc-chunking.ts` frames any message above 16
KiB and passes smaller messages through unchanged, which keeps awareness and
incremental updates wire-compatible with a peer that has no shim.

Budgets:

- Join payload **gate**: at most 160 bytes per registry node.
- Frame size **gate**: every framed message at most 16 KiB, which every browser
  accepts.
- Unframed messages stay unframed, so a one-character update never pays framing
  overhead.
- Join payload **record only**: total KiB and frame count per fixture. They
  follow node count, which the fixture fixes.

## Maintained hardware budgets

Hardware jobs use 2 warmup rounds and 9 measured rounds, matching the 1.7
capture. Record `runtime`, `arch`, `platform`, Bun version, and `capturedAt`.
Compare timings and RSS only when `runtime`, `arch`, and `platform` match
`bun-1.3.14-arm64-darwin`. On any other profile, record timings and still
gate work counters.

Remote warm apply ceilings are 2× the 1.7 local medians and p95s:

| Timer       | Median max (ms)    | p95 max (ms)       |
| ----------- | ------------------ | ------------------ |
| Transaction | 18.612418000000616 | 21.630750000000262 |
| Layout      | 6.888415999999779  | 8.620999999999185  |
| Paint       | 32.251415999999154 | 43.493249999999534 |
| Total       | 56.12816799999928  | 71.59799999999996  |

| Memory                            | Max                                            |
| --------------------------------- | ---------------------------------------------- |
| RSS delta edit through paint      | 40304640 bytes                                 |
| External delta edit through paint | Record only because the local denominator is 0 |
| Heap used delta                   | Do not gate                                    |

Reconnect that applies one buffered character uses the same total ceiling
(56.128 ms median, 71.598 ms p95). Empty reconnect timing stays informational
until task 7.4. Empty reconnect must still add no layout or paint work.

Browser eligible typing stays 16.7 ms median and 33.4 ms p95 on the sub-frame
reference profile: production Chromium, 1440 × 1000 at 1×, reduced motion, 100
isolated samples, 180 unpaced characters. That fixture is the 521-page typing
document. This 200-page collaboration bench does not replace it.

## Failure policy

1. Wrong fixture hash fails immediately.
2. A pull-request work-counter miss fails the pull request.
3. Timing, RSS, and heap numbers must not fail a pull request.
4. On the recorded hardware profile, a 2× timing or RSS miss fails the
   maintained job.
5. If the runner profile does not match the recorded profile, skip timing
   gates and still run work counters.
6. A hardware timing flake may rerun once on the same machine. A second miss
   fails the job.
7. Allocation `3 ≤ ratio < 10` allows one bounded optimization pass, then a
   remeasure. A second result in that band fails the representation for
   admission.
8. Allocation `ratio ≥ 10`, off-path allocation, or a lost move identity
   rejects that representation.
9. If a mutation class exceeds its remote ratio, that class stays
   experimental.
10. If both representations fail a kill criterion, stop. Do not integrate
    either into the editor.

## Reasons

- Design D2 requires fewer than 3× canonical nodes, a 10× kill, identity
  outside the edited ancestor path, no whole-document layout invalidation, and
  warm remote materialization and paint within 2× local.
- The repair spec requires deterministic work counters on pull requests and
  hardware-sensitive timings plus retained memory on maintained runs.
- `edit-bench-gates.test.ts` already pins `placed = 13`, `reusedPages = 154`,
  `fullPasses = 1`, and `pages = 204` for `steady-middle-text`. Collaboration
  must not loosen those counters.
- Local allocated = 6 and off-path = 0, so a whole-tree rebuild is a kill, not
  an optimize band.
- Local incremental update = 14 bytes. A one-character update that scales with
  3200 paragraphs fails document-size independence.
- Local RSS delta = 20152320 bytes. Heap used is not a usable Bun 1.3.14
  signal, so hardware memory uses RSS.

## Limitations

- Task 1.7 is a local one-character baseline. It does not apply a remote Yjs
  update or materialize a collaborative replica.
- Yjs sizes use the paragraph-text proof schema, not a full-document XML or
  registry CRDT. Task 2.11 must recapture local snapshot bytes per backend
  before those totals become kill ceilings.
- Reconnect empty-path timings are not in the 1.7 capture. Work counters for
  empty reconnect are defined now. Timing stays informational until task 7.4.
- Checkpoint format is not distinct until task 7.6. The checkpoint budget
  follows snapshot bytes until then.
- Paint runs in happy-dom, not Chromium. It excludes React, selection sync,
  and the review rail.
- Viewport materialization paints the edited page plus overscan, not every
  sheet. Page-record identity still covers the whole document.
- Wall-clock medians are hardware-sensitive. Compare them on the recorded
  profile only.
- These budgets cover the frozen one-character middle-paragraph insert. Other
  mutation classes get the same ratios. They get new absolute local
  denominators when later benches measure them.

## Later enforcement

- A cross-context end-to-end test must exercise the real data channel. Two pages
  in one browser context share a `BroadcastChannel`, and `y-webrtc` prefers it
  over WebRTC, so a same-context pair proves nothing about join payload size.
  `e2e/collaboration.fulldocument.spec.ts` puts the joiner in a separate context
  for this reason.
- Task 2.14 enforces the 3× pass gate and the 10× kill gate in spike tests.
- Task 10.3 runs the full 200-page allocation, layout-cache, dirty-scope,
  paint, memory, update-size, checkpoint-size, and reconnect matrix.
- This task only defines the numbers. It does not change production code.
