## Retained historical decisions (closed)

These tasks are complete evidence. They do not reopen and are not POC blockers.

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

- [x] **Milestone 1 — OpenSpec rewrite.** Replace remaining falsification tasks with five POC milestones, declare the Playwright finish line, move fifteen gates and oracle obligations to deferred risks, and align proposal, design, tasks, and capability specs.
- [ ] **Milestone 2 — Bounded minimal DOCX adapter.** Deterministic fixture; bounded JSZip/XML load; reject DTD/traversal/external relationships; save patches owned paragraph only; preserve capsule bytes exactly; focused unit tests in `spike/engine-core-spike-harness/tests/poc-docx.test.ts`.
- [ ] **Milestone 3 — Tiny canonical Yjs store and collaboration.** One `Y.Text` plus Candidate B mark contributions; insert/delete and bold/italic toggles via synchronous transactions; two-replica convergence; actor-local undo preserving remote work; focused unit tests in `spike/engine-core-spike-harness/tests/poc-store.test.ts`.
- [ ] **Milestone 4 — ProseMirror browser surface and EditorDriver.** Minimal Vite page with editable editor and read-only replica; load/edit/bold/italic/undo/save/reopen through public `EditorDriver`; model-first reconciliation; focused binding tests in `spike/engine-core-spike-harness/tests/poc-browser-binding.test.ts`.
- [ ] **Milestone 5 — Save/reopen Playwright finish line.** One Playwright test in `e2e/engine-poc.spec.ts` proves load → edit → bold → replica convergence → remote edit → local undo preserving remote work → save → reopen → semantic and capsule preservation; record result in `poc-result.md`.

## Deferred risks (not POC tasks)

The former falsification program items below are explicitly deferred. They do not
block POC completion:

- v2 backend migration breadth, G-v2-1..G-v2-10 re-freezes, audit/replay (old 2.7–2.9)
- binding IME/selection/annotation breadth (old 3.2–3.4)
- architecture-suitability fixtures: selective patch comparator, browser/server command parity, annotation anchor matrix, awareness instrumentation, synthetic layout (old 4.1–4.5)
- fifteen-gate suite and property/fuzz parity harness (old 5.1–5.7, 6.1–6.3)
