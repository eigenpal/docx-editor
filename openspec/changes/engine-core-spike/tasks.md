## Retained historical decisions (closed)

These tasks are complete evidence. They do not reopen and are not POC blockers.
The OpenSpec scope rewrite is completed setup/decision work, not a product
milestone and not evidence of POC product progress.

- [x] 1.1 Create an isolated, non-shipping spike harness with deterministic fixtures, seeded randomization, revision/origin logging, and explicit assertions that the implementation contains only the scoped proof features.
- [x] 1.2 Define the tiny authored model for one body story, paragraphs, text, bold/italic marks, stable paragraph IDs, authored omission/raw lexical values, and one ordered unsupported OOXML capsule.
- [x] 1.3 Define distinct spike-only `DocOp`, `ModelChange`, opaque replication update, snapshot, origin, awareness, and internal anchor contracts with no ProseMirror types outside `EditorBinding`.
- [x] 1.4 Define one JSON-schema-backed `DocxEditor.*` command and verify that no alternate facade namespace or alias is exposed.
- [x] 1.5 Review and freeze a versioned oracle manifest for the superseded falsification program. **Historical evidence only** — not a POC prerequisite.
- [x] 1.6 Review and freeze v1 Yjs root schema evidence. **Historical v1 evidence only** — superseded by `yjs-schema-v2-design.md`.
- [x] 1.7 Review and freeze v1 binding/history oracle evidence. **Historical v1 evidence only** — superseded by lean v2 contracts.
- [x] 1.8 Record retired Playwright and old-core-coupled package test retirement inventories. The public `EditorDriver` boundary now unblocks focused browser E2E for the POC; full adapter parity is out of scope.
- [x] 2.1 Implement insert, delete, split, join, bold, and italic on the **rejected v1 schema path**. Historical evidence only.
- [x] 2.2 Implement v1 nested-schema backends and coordinator. Historical evidence only; falsified for undo.
- [x] 2.3 Implement PM-free server execution on the v1 schema path. Historical evidence only.
- [x] 2.4 **Formatting A/B falsification (reviewed KISS experiment).** Candidate B `mark-contributions` selected. Abandoned bakeoff corpus is non-authoritative.
- [x] 2.5 **Lean reviewed v2 contracts and scenario catalog.** Descriptor integrity hashes are reproducibility checks only, not canonical-state fingerprints.
- [x] 2.6 **Synchronous transaction/origin foundation.** Explicit synchronous context; rejects async, nested, reentrant, and mixed-origin transactions atomically.

## POC milestones

Milestone 1 is review-approved. Milestone 2 has an implementation commit but
remains unchecked while review corrections are in progress.

- [x] **Milestone 1 — Bounded minimal DOCX boundary.** Generate and load one deterministic DOCX through bounded ZIP/XML checks; reject DTDs, traversal, oversized parts, and external relationships; capture one unsupported capsule substring from uncompressed `word/document.xml`.
- [ ] **Milestone 2 — Tiny canonical Yjs store.** Use one `Y.Text`, Candidate B mark contributions, and the synchronous executor for insert/delete and bold/italic; prove two-replica synchronization and actor-local undo that preserves remote work.
- [ ] **Milestone 3 — Visible ProseMirror editor through EditorDriver.** Mount the editable surface and read-only replica; expose load, inspection, editing, formatting, and undo through the public `EditorDriver` without exposing `EditorView`.
- [ ] **Milestone 4 — Save and reopen integration.** Rebuild the owned paragraph region, XML-escape authored text, save and reopen through the minimal adapter, preserve semantic state and stable paragraph identity, and preserve exactly the captured unsupported capsule substring.
- [ ] **Milestone 5 — One Playwright E2E finish line.** Drive load → edit → formatting → replica convergence → remote edit → actor-local undo preserving remote work → save → reopen through `EditorDriver`; assert semantic state, stable paragraph identity, and exact captured capsule substring preservation; record the result in `poc-result.md`.

## Deferred risks (not POC tasks)

The former falsification program items below are explicitly deferred. They do not
block POC completion:

- v2 backend migration breadth, former named-scenario re-freezes, audit/replay
- binding IME/selection/annotation breadth (old 3.2–3.4)
- architecture-suitability fixtures: selective patch comparator, browser/server command parity, annotation anchor matrix, awareness instrumentation, synthetic layout (old 4.1–4.5)
- fifteen-gate suite and property/fuzz parity harness (old 5.1–5.7, 6.1–6.3)
