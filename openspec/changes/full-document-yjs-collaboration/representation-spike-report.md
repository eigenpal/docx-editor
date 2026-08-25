# Representation spike comparison

OpenSpec tasks 2.10–2.16 for `full-document-yjs-collaboration`.

Scratch harness: `packages/collaboration-yjs/src/__tests__/representation-spike/`.
This folder does not import `registry-invariant-spike`.
It re-proves the same membership outcomes in its own tests.

Captured: 2026-08-24, Bun 1.3.14, arm64, darwin.
Budgets: `collaboration-budgets.json` maintained-hardware profile.

## Selection

Select the **registry** backend.

The first 200-page edit-plus-materialize sample was 150 ms.
That failed the 56.128 ms remote-total ceiling.
The cause was a full derived-parent rescan plus a full tree walk after every text transaction.

The bounded fix keeps child-ID arrays as the only shared authority.
A non-replicated parent index is built once after seed or snapshot apply.
Child-array events update listings and first-reachable parents.
Text edits do not rescan the map.
The materializer skips clean subtrees when membership did not change.

XML stays **killed** by the move gate and does not receive 200-page work.

| Gate                                                              | XML            | Registry                          |
| ----------------------------------------------------------------- | -------------- | --------------------------------- |
| Remote 1-character allocation (`<3×` pass, `≥10×` kill)           | pass (ratio 1) | pass (6 / 6, ratio 1, off-path 0) |
| Move plus concurrent descendant edit                              | **kill**       | **pass**                          |
| Maintained remote total (`median ≤ 56.128 ms`, `p95 ≤ 71.598 ms`) | skipped        | **pass** (31.766 / 35.615)        |

## Child-array invariant outcomes

Re-proved on the representation registry without importing the other scratch folder:

| Outcome                             | Result                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| First reachable preorder placement  | Concurrent reparents keep one identity. The Keep paragraph wins. Materializer emits `duplicate-parent` and does not emit a second node. |
| Tombstone instead of `Y.Map.delete` | Delete unlinks and sets `deleted: true`. The descendant record stays. Concurrent text yields `orphan-with-content`.                     |
| `replacedBy` join                   | Join moves children, tombstones the removed paragraph, and sets `replacedBy`. Concurrent descendant text stays under the survivor.      |
| Concurrent child insert after join  | Leftover live children of the tombstone are adopted onto the survivor.                                                                  |
| Actor undo                          | Undo of a local move restores placement and keeps remote descendant text. Remote edits are not on the local undo stack.                 |

Issue codes observed in this harness:

`duplicate-parent`, `orphan-with-content`, `deleted-referenced` (when a child array still lists a tombstone), plus the XML move failure (lost logical id / lost descendant text).

Canonical `validateOoxmlPart` issues on the fixture corpus: none.

## Review and generic fixtures (2.10)

Both backends converge and stay valid on:

- comment range start / end / reference
- revision insert wrapper
- content control (`w:sdt`)
- unknown `demo:marker` generic node
- invalid table-in-paragraph placement (demoted, text kept)

## Tiny-fixture bytes (2.12)

Earlier seed of `twoParagraphFixture`:

| Backend  | Seed snapshot | 1-char update | Snapshot after insert | Move updates |
| -------- | ------------: | ------------: | --------------------: | -----------: |
| XML      |          2671 |            10 |                  2676 |          381 |
| Registry |          4026 |            32 |                  4031 |          141 |

Fingerprints, `validateOoxmlPart`, scratch delta validation, and serialize/reopen semantic digests match on both delivery orders.

## Registry 200-page remote comparison (2.11, 2.14)

Fixture: `e2e/fixtures/synthetic-long-edit.docx` (3200 paragraphs, 204 pages, 34555 nodes).
Edit: insert `X` at UTF-16 offset 0 of paragraph index 1599.
Method: 2 warmup rounds and 9 measured rounds on one seeded pair.
Each measured round undoes and restores both replicas.
Work counters were identical across the 9 measured rounds.
The automated test gates these deterministic counters. It records timing and RSS but
does not fail on them because those values belong to the maintained hardware profile.

Local authoring is `insertText` plus local materialize.
Remote apply is `Y.applyUpdate` plus remote materialize.
Remote total is remote apply plus layout plus paint.

| Metric                             |               Local baseline |        Registry measured |
| ---------------------------------- | ---------------------------: | -----------------------: |
| Canonical allocated local / remote |                      6 / n/a |                    6 / 6 |
| Off-path allocated                 |                            0 |                    0 / 0 |
| Layout pages                       |                    204 → 204 |                204 → 204 |
| Layout reused pages                |                          154 |                      154 |
| Layout cache hits / misses         |                    12 / 3201 |                12 / 3201 |
| Reused / rebuilt paint elements    |                      204 / 0 |                  204 / 0 |
| Materialized pages                 |                            4 |                        4 |
| Incremental update bytes           |     14 (paragraph-map proof) |       24 (full registry) |
| Snapshot bytes after restore       | 742057 (paragraph-map proof) | 12711576 (full registry) |

| Timing                     |  Ceiling (2× local) | Registry median | Registry p95 | Verdict  |
| -------------------------- | ------------------: | --------------: | -----------: | -------- |
| Local authoring            |     18.612 / 21.631 |          10.788 |       11.596 | pass     |
| Remote apply / materialize |     18.612 / 21.631 |          11.014 |       12.150 | pass     |
| Layout                     |       6.888 / 8.621 |           4.941 |        6.448 | pass     |
| Paint                      |     32.251 / 43.493 |          15.808 |       18.624 | pass     |
| Remote total               | **56.128 / 71.598** |      **31.766** |   **35.615** | **pass** |

## RSS policy

`heapUsed` is not a gate. Bun 1.3.14 reported a 0 heapUsed delta on the local baseline.

RSS is the maintained-hardware memory gate.
Ceiling: 40,304,640 bytes (`2×` the local `editThroughPaint` median of 20,152,320).

Measured RSS delta median (warm paint to after-edit paint): 13,107,200 bytes.
Verdict: **pass**.

External memory stays record-only. The local denominator is 0.

## Bytes

The 24-byte incremental update is a full-registry `Y.Text` insert, not the paragraph-map proof.
It stays under the pull-request pass ceiling of 42 bytes and far under the 140-byte kill floor.

The 12.7 MiB snapshot is the full node map.
Do not compare it to the 742,057-byte paragraph-map proof snapshot.

## Remaining uncertainty

- These timings are one 9-round sample on the recorded profile, not a CI matrix.
- Mutual-reparent cycles were proved on the invariant-spike toy model, not on this 200-page OOXML tree.
- Word-facing id collision repair is out of scope for this spike.
- XML join of live `Y.XmlElement` children remains impossible. That path is dead because XML is killed.

## Files

Scratch tests and backends live under `packages/collaboration-yjs/src/__tests__/representation-spike/`.
This report is the 2.13 comparison artifact.
OpenSpec `tasks.md` is unchanged.
