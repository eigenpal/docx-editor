## 1. Disposable Harness and Contracts

- [x] 1.1 Create an isolated, non-shipping spike harness with deterministic fixtures, seeded randomization, revision/origin logging, and explicit assertions that the implementation contains only the scoped proof features.
- [x] 1.2 Define the tiny authored model for one body story, paragraphs, text, bold/italic marks, stable paragraph IDs, authored omission/raw lexical values, and one ordered unsupported OOXML capsule.
- [x] 1.3 Define distinct spike-only `DocOp`, `ModelChange`, opaque replication update, snapshot, origin, awareness, and internal anchor contracts with no ProseMirror types outside `EditorBinding`.
- [x] 1.4 Define one JSON-schema-backed `DocxEditor.*` command and verify that no alternate facade namespace or alias is exposed.
- [x] 1.5 Before implementation, review and freeze a versioned oracle manifest containing exact source text/style mutation and zero-based indexing, capsule bytes/boundaries/owner slot/namespace/siblings, toy shaping/rounding, cold/warm cache state, expected pagination fingerprint bytes/hash, included phases, counter increment definitions/ceilings, and an independently produced oracle hash.
- [x] 1.6 Before backend implementation, review and freeze exact toy Yjs root keys/container types/creation-keyed records/semantic-ID provenance/ownership/order/mark endpoints/schema version/origins/GC/collision precedence and opaque trusted anchor envelope.
- [x] 1.7 Before binding/history implementation, review and freeze exact normalization precedence, IME input/output strings, selection grapheme boundaries/affinities, grouped undo/redo histories, snapshot expectations, and fixture comparators.

## 2. Semantic Store and Backends

- [x] 2.1 Implement insert, delete, split, join, bold, and italic operations through one validate, mutate, deterministic-normalize, commit, and notify path with the specified paragraph identity rules.
- [x] 2.2 Implement local and model-shaped Yjs backends plus the sole atomic replication coordinator with staged commit/merge, rollback, repair propagation, stable commit/update/constituent IDs, state-vector optimization only, idempotence, and echo suppression.
- [x] 2.3 Implement PM-free server execution for `DocOp` and the schema-backed command, returning the same semantic result shape as browser execution.
- [ ] 2.4 Implement actor/session/group history, actor-local undo/redo, redo invalidation, remote interleaving, identity restoration, repair ownership, and durable snapshot/reopen behavior.
  - **Final experiment verdict — `REJECT_CURRENT_MODEL_SHAPE`:** public `Y.UndoManager` durability/grouping/staging can work via a bounded reconstruction journal, but the current model-shaped nested `Y.Map`/`Y.Text` replacement shape fails same-target nested remote edits and overlapping marks because untracked replacement consumes tracked undo items and undo of locally created nested types deletes later remote child edits. Therefore task 2.4 remains unchecked and the next design must change model granularity/ownership or undo requirements before implementation. Store-level inverse DocOp runtime integration and task-2.2 history-effect replication records remain quarantined/removed.
- [ ] 2.5 Implement explicit synchronous transaction context and `MutationOrigin`/`ProjectionOrigin`/`AwarenessOrigin`, rejecting async/nested/reentrant transactions.
- [ ] 2.6 Implement a redacted audit index and separate encrypted access-controlled replay journal with complete versioned `DocOp` payloads and independent finite retention/security fixtures.

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
- [ ] 5.2 Prove gates 5–8 across the selection matrix, exact IME strings, grouped undo/redo, remote interleaving, identity restoration, normalization, and snapshot/reopen.
- [ ] 5.3 Prove gates 9–10: browser and server layout read only equivalent canonical state and produce equivalent pagination, and export/reopen preserves semantic content plus authored properties.
- [ ] 5.4 Prove gates 11–12: selective export preserves the untouched capsule and authored lexical intent, and the schema-backed browser/server command produces equivalent state and results.
- [ ] 5.5 Prove gates 13–14: the annotation anchor obeys all concurrent edit rules and origin/awareness metadata remains distinct without reconciliation loops or authored-state leakage.
- [ ] 5.6 Prove gate 15 against every concrete fixture ceiling and canonical convergence fingerprint.
- [ ] 5.7 Add seeded property runs for projection/model parity and concurrent replica convergence, with failures reporting fixture, seed, operations, origins, revisions, and divergent state.

## 6. Spike Decision Record

- [ ] 6.1 Run the complete fifteen-gate suite for local, Yjs, browser-binding, and PM-free server paths and record pass/fail evidence for every gate.
- [ ] 6.2 Record the final undo verdict and any architecture falsification, unresolved risk, or measured limitation without converting the spike harness into production engine code.
- [ ] 6.3 Remove or quarantine any implementation breadth not required by a gate and confirm the spike remains a disposable prerequisite rather than a production engine milestone.
