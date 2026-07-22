## 1. Disposable Harness and Contracts

- [x] 1.1 Create an isolated, non-shipping spike harness with deterministic fixtures, seeded randomization, revision/origin logging, and explicit assertions that the implementation contains only the scoped proof features.
- [x] 1.2 Define the tiny authored model for one body story, paragraphs, text, bold/italic marks, stable paragraph IDs, authored omission/raw lexical values, and one ordered unsupported OOXML capsule.
- [x] 1.3 Define distinct spike-only `DocOp`, `ModelChange`, opaque replication update, snapshot, origin, awareness, and internal anchor contracts with no ProseMirror types outside `EditorBinding`.
- [x] 1.4 Define one JSON-schema-backed `DocxEditor.*` command and verify that no alternate facade namespace or alias is exposed.
- [x] 1.5 Before implementation, review and freeze a versioned oracle manifest containing exact source text/style mutation and zero-based indexing, capsule bytes/boundaries/owner slot/namespace/siblings, toy shaping/rounding, cold/warm cache state, expected pagination fingerprint bytes/hash, included phases, counter increment definitions/ceilings, and an independently produced oracle hash.
- [x] 1.6 Before backend implementation, review and freeze exact toy Yjs root keys/container types/creation-keyed records/semantic-ID provenance/ownership/order/mark endpoints/schema version/origins/GC/collision precedence and opaque trusted anchor envelope. **Historical v1 evidence only** — superseded by `yjs-schema-v2-design.md`; v1 acceptance does not prove v2.
- [x] 1.7 Before binding/history implementation, review and freeze exact normalization precedence, IME input/output strings, selection grapheme boundaries/affinities, grouped undo/redo histories, snapshot expectations, and fixture comparators. **Historical v1 binding/history oracle evidence only** — the task 2.5 v2 oracle is required before tasks 2.6–2.8.
- [x] 1.8 Record retired Playwright and old-core-coupled package test retirement in `spike/engine-core-spike-harness/migration/playwright-inventory.v1.json` and `spike/engine-core-spike-harness/migration/package-test-inventory.v1.json`; retain only behavioral obligations through those inventories plus OpenSpec requirements, require no replacement for implementation-only assertions, defer browser reference research so later observations stay corroborating fixture evidence only, and keep browser E2E blocked until an engine-neutral public `EditorDriver`/`DocxEditor.*` transport with stable command/query and `DisplayItem`/export comparators exists.

## 2. Semantic Store and Backends

Historical v1 path (tasks 2.1–2.3): proves coordinator, local backend, and PM-free server execution against the **rejected** nested schema. Checked items remain evidence; they do not authorize v2 backend or undo work.

- [x] 2.1 Implement insert, delete, split, join, bold, and italic operations through one validate, mutate, deterministic-normalize, commit, and notify path with the specified paragraph identity rules. *(v1 schema path)*
- [x] 2.2 Implement local and model-shaped Yjs backends plus the sole atomic replication coordinator with staged commit/merge, rollback, repair propagation, stable commit/update/constituent IDs, state-vector optimization only, idempotence, and echo suppression. *(v1 nested schema — falsified for undo; does not prove v2)*
- [x] 2.3 Implement PM-free server execution for `DocOp` and the schema-backed command, returning the same semantic result shape as browser execution. *(v1 schema path)*

Yjs schema v2 redesign (`yjs-schema-v2-design.md`). Each item below is one commit-sized dependency boundary and remains unchecked.

- [x] 2.4 **Formatting A/B falsification (isolated experiment).** Compare exact Candidate A (`bold`/`italic` `Y.Text` keys; enable with `format(globalStart, length, { [key]: contributionId })`; disable with `{ [key]: null }`; creation-only `formattingMetadata`; ordered `toDelta()` projection; no ownership/conflict workaround) against Candidate B (immutable add/remove ranges with canonical-base64url relative envelopes) under identical fixtures, seeds, delivery orders, checkpoints, and limits. Record the winner against overlapping same-kind actor undo, observed-disable/unseen-enable, bold/italic independence, text/split/join behavior, semantic mark ID/provenance, authored omission/raw intent, undo/reopen/redo, non-destructive normalization, convergence, and resource bounds. Use frozen tie-breakers; if neither passes, block v2. No production/backend migration in this commit.
- [x] 2.5 **Lean reviewed v2 contracts and scenario catalog (no implementation).** Keep the compatibility filenames `yjs-schema.v2.json`, `binding-oracle.v2.json`, `history-oracle.v2.json`, and `comparator-contracts.v2.json`, but freeze only the task 2.4 `mark-contributions` winner's closed schema/constants, binding/history responsibilities, comparator input schemas, and concise G-v2-1..G-v2-10 action/assertion descriptors. Descriptor integrity hashes are reproducibility checks only; descriptors MUST NOT claim to be canonical-state fingerprints or precomputed implementation outputs. Tasks 2.6–2.8 and 3.x own direct executable assertions for the behavior they implement. The abandoned `experiments/yjs-formatting-bakeoff/oracle/**` corpus is unexecuted historical work, non-authoritative, and MUST NOT be consumed. Depends on 2.4.
- [ ] 2.6 **Synchronous transaction/origin foundation.** Implement explicit synchronous transaction context and `MutationOrigin`/`ProjectionOrigin`/`AwarenessOrigin`, rejecting async, nested, reentrant, mixed-origin, and failed preflight transactions atomically. Depends on 2.5; no v2 schema migration or history integration in this commit.
- [ ] 2.7 **V2 backend migration.** Migrate Yjs and local backends to the spike-only one-`Y.Text` body sequence, plain JSON boundary embeds, bound relative endpoints, the selected formatting representation, deterministic projection, and monotonic repair evidence; enforce all frozen preflight limits and update conformance tests. Depends on 2.6; no `Y.UndoManager` actor history in this commit.
- [ ] 2.8 **Combined Y.UndoManager actor history and acceptance.** Integrate one public `Y.UndoManager` per actor+session scoped to `bodySequence` plus any winner-required formatting root, stable origin token, explicit `stopCapturing`, same-session manager-stack redo semantics, bounded reconstruction journal, durable reopen, and local behavioral parity; pass G-v2-1..G-v2-10 and gate 8. Depends on 2.7. Allocator, audit, awareness, capsules, and repair metadata remain untracked.
  - **Final experiment verdict — `REJECT_CURRENT_MODEL_SHAPE` (v1):** public `Y.UndoManager` durability/grouping/staging can work via a bounded reconstruction journal, but the v1 nested `Y.Map`/`Y.Text` replacement shape fails same-target nested remote edits and overlapping marks. v2 redesign in `yjs-schema-v2-design.md` resolves granularity/ownership; task 2.8 remains blocked until 2.4–2.7 complete. Store-level inverse DocOp runtime integration and task-2.2 history-effect replication records remain quarantined/removed.
- [ ] 2.9 **Audit and replay.** Implement the redacted audit index and separate encrypted access-controlled replay journal with complete versioned `DocOp` payloads, frozen retention/aggregate-byte limits, authorization fixtures, and atomic replay preflight. Depends on 2.8.

## 3. Browser Binding and Reconciliation

- [ ] 3.1 Map complete transactions against a shadow `EditorState`, discard on rejection, commit canonical state first, then reconcile the actual view; use identity-preserving `ReplaceBlockContent` only with proven ownership.
- [ ] 3.2 Implement reverse reconciliation through internal anchors, including logical-caret preservation for remote insertion before the caret and deterministic boundary resolution when remote deletion contains the caret.
- [ ] 3.3 Implement the frozen IME state machine with start revision, anchored range, exact insert/delete expected strings, commit/cancel ordering, and one semantic history group.
- [ ] 3.4 Tag binding-generated transactions with binding-reconciliation origin, ignore them in the forward mapper, and prove one remote change cannot create a feedback loop.

## 4. Architecture-Suitability Fixtures

- [ ] 4.1 Implement the frozen selective patch fixture with an exact uncompressed XML-part range comparator and semantic ZIP-container comparator allowing recompression metadata changes while capsule, namespace, sibling position, and unowned XML bytes remain exact.
- [ ] 4.2 Run the identical schema-backed `DocxEditor.*` command from identical state through browser binding and PM-free server execution and compare canonical state, revision effects, and result data.
- [ ] 4.3 Implement one citation/annotation range anchor and deterministic concurrent tests for insertion affinity, full-range deletion collapse/detach, split tail remapping, join survivor remapping, and refusal to attach to unrelated text.
- [ ] 4.4 Implement ephemeral awareness plus origin instrumentation that distinguishes human, agent, remote, undo, and binding reconciliation and proves awareness is absent from authored state, snapshots, and export.
- [ ] 4.5 Implement frozen toy shaping, the `style-A` dependency edit, canonical pagination fingerprint, four-pass bound, and exact projection/measurement/pagination/scan/dependency counters.

## 5. Fifteen-Gate Falsification Suite

- [ ] 5.1 Prove gates 1–4: local typing emits only `DocOp`, canonical state commits first, two Yjs replicas converge, and a PM-free server edit reconciles into both browser replicas.
- [ ] 5.2 Prove gates 5–8 across the selection matrix, exact IME strings, grouped undo/redo, remote interleaving, identity restoration, v2 proof gates G-v2-1..G-v2-10, and snapshot/reopen.
- [ ] 5.3 Prove gates 9–10: browser and server layout read only equivalent canonical state and produce equivalent pagination, and export/reopen preserves semantic content plus authored properties.
- [ ] 5.4 Prove gates 11–12: selective export preserves the untouched capsule and authored lexical intent, and the schema-backed browser/server command produces equivalent state and results.
- [ ] 5.5 Prove gates 13–14: the annotation anchor obeys all concurrent edit rules and origin/awareness metadata remains distinct without reconciliation loops or authored-state leakage.
- [ ] 5.6 Prove gate 15 against every concrete fixture ceiling and canonical convergence fingerprint.
- [ ] 5.7 Add seeded property runs for projection/model parity and concurrent replica convergence, with failures reporting fixture, seed, operations, origins, revisions, and divergent state.

## 6. Spike Decision Record

- [ ] 6.1 Run the complete fifteen-gate suite for local, Yjs, browser-binding, and PM-free server paths and record pass/fail evidence for every gate.
- [ ] 6.2 Record the final undo verdict and any architecture falsification, unresolved risk, or measured limitation without converting the spike harness into production engine code.
- [ ] 6.3 Remove or quarantine any implementation breadth not required by a gate and confirm the spike remains a disposable prerequisite rather than a production engine milestone.
