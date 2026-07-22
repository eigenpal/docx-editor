# Spike-to-production architecture decision

**Status:** Accepted  
**Date:** 2026-07-22  
**Production authority:** `document-engine/design.md` and
`document-engine/specs/**`

## Context

The completed `engine-core-spike` KISS browser POC proves one bounded product
sequence:

`load DOCX → edit → format → two-replica convergence → remote edit → actor-local
undo → save → reopen`

The exact command, URL, assertions, and deferred risks are recorded in
`openspec/changes/engine-core-spike/poc-result.md`. The POC is disposable
evidence, not shipping engine code and not production conformance.

This record consolidates the architectural decisions that were previously
distributed across the spike design, historical Yjs decision record, KISS
requirements, implementation status, and executable tests.

## Evidence baseline

- Final Chromium flow:
  `cd spike/engine-core-spike-harness && bun run test:e2e`
- POC implementation evidence:
  `openspec/changes/engine-core-spike/implementation-status.md`
- Scope and deferred risks:
  `openspec/changes/engine-core-spike/design.md` and
  `openspec/changes/engine-core-spike/poc-result.md`
- Candidate B formatting experiment:
  `spike/engine-core-spike-harness/tests/yjs-formatting-kiss.test.ts`
- Actor-local undo and convergence:
  `spike/engine-core-spike-harness/tests/poc-store.test.ts`
- Model-first binding and loop prevention:
  `spike/engine-core-spike-harness/tests/poc-pm-binding.test.ts` and
  `spike/engine-core-spike-harness/tests/poc-editor-driver.test.ts`
- Bounded load/save and capsule preservation:
  `spike/engine-core-spike-harness/tests/poc-docx.test.ts`,
  `spike/engine-core-spike-harness/tests/poc-save.test.ts`, and
  `spike/engine-core-spike-harness/e2e/poc-finish-line.spec.ts`
- Rejected v1/inverse-history evidence:
  `spike/engine-core-spike-harness/tests/history-inverse-docop-falsification.test.ts`
  and
  `spike/engine-core-spike-harness/tests/yjs-undo-manager-experiment.test.ts`
- Synchronous transaction and typed-origin evidence:
  `spike/engine-core-spike-harness/tests/synchronous-transaction-executor.test.ts`

These tests are deterministic. A seed is required and recorded by future
randomized production tests; deterministic fixtures do not manufacture a seed.

## Accepted decisions

### ADR-S1 — Authored package state is canonical

The production store owns the current authored OPC/OOXML model. ProseMirror,
layout, display lists, output backends, and public proxies are projections.
Only the semantic store mutation path may commit authored state.

**Evidence:** the POC commits its Yjs-backed model before reconciling
ProseMirror, and save reads the canonical store snapshot rather than the view.

**Production destinations:** tasks 2.*, 3.*, 4.1–4.7, and design D1–D3.

### ADR-S2 — Transactions use synchronous validate → stage → publish

Mutation context and origin are snapshotted before work. Validation and
normalization run against staged prospective state. Publication is atomic;
rejected, async, nested, reentrant, or mixed-origin work has no canonical
effect.

**Evidence:** the reviewed synchronous transaction executor and POC staged Yjs
publication tests.

**Production destinations:** tasks 4.2, 4.4–4.6, and 5.3.

### ADR-S3 — Each story uses a long-lived flat collaborative sequence

The rejected v1 shape of nested actor-owned Yjs paragraph/text types MUST NOT be
revived. Production collaboration uses a long-lived sequence per authored story
with immutable plain-data structural boundaries. Formatting uses immutable
creation-only add/remove contributions carrying actor/commit provenance.

The POC's two-root schema is not the complete production root schema.
Multi-story containers, annotations, allocators, origins, schema versions,
migrations, and coordinator ownership remain tasks 5.2–5.10.

**Evidence:** v1 UndoManager falsification plus the reviewed Candidate B
formatting experiment and the completed POC store.

### ADR-S4 — Collaborative undo composes Y.UndoManager with semantic repair

Hand-authored inverse `DocOp` history is rejected for collaborative undo.
The Yjs backend uses one `Y.UndoManager` per actor/session, tracks only eligible
local mutation origins, and leaves remote work untracked. The semantic
store/coordinator remains responsible for validation, normalization, stable
identity behavior, grouping, notifications, and common local/Yjs conformance.

Production still MUST define redo, durable reopen, snapshot/compaction,
client-reseed, retention, and GC behavior before persistence acceptance.

**Evidence:** actor-local undo after remote interleaving in the POC store and
Playwright finish line; inverse-history and v1 nested-shape falsification tests.

**Production destinations:** tasks 4.11–4.12 and 5.6–5.10.

### ADR-S5 — Origins are separate typed domains

Canonical mutations, projection reconciliation, remote replication, repair,
migration, and awareness use separate typed origins. Projection reconciliation
never maps forward into semantic history, audit, or replication.

**Evidence:** the POC reconciliation-origin feedback-loop tests and synchronous
origin executor.

**Production destinations:** tasks 4.11, 5.3, and 6.9.

### ADR-S6 — EditorBinding is the only ProseMirror-aware integration

`EditorBinding` maps complete ProseMirror transactions to semantic operations,
commits the store first, then incrementally reconciles the actual view from
committed evidence. `EditorHost`, semantic core, server execution, layout, and
public `EditorDriver` contracts MUST NOT expose `EditorView` or ProseMirror
types.

The POC's prefix/suffix text-diff mapper and full-document replacement
reconciliation are proof shortcuts and MUST NOT be implemented. Production uses
transaction step mappings, typed fallback operations, `ModelChange`
before/after evidence, and internal anchors.

**Evidence:** model-first POC binding and loop prevention. The prepend-edit
audit finding demonstrates why the POC mapper is non-production.

**Production destinations:** tasks 6.1–6.10.

### ADR-S7 — DOCX input crosses one bounded trust boundary

ZIP/OPC/XML and relationship values are attacker-controlled. Production parsing
uses finite non-disableable ceilings, path normalization, no entity/DTD
expansion, no implicit external fetch, closed parser intermediates, and
capability-owned semantic parsing. Save escapes authored values and preserves
unsupported content according to explicit ownership.

The POC proves exact preservation of one unsupported capsule and replacement of
one owned paragraph region. Its five-part package grammar, tokenizer, limits,
and serializer are not the production reader or serializer.

**Evidence:** bounded POC load/save adversarial tests and exact capsule
comparison in Playwright.

**Production destinations:** tasks 0.3, 1.3, 2.*, and 3.*.

### ADR-S8 — EditorDriver is the stable browser verification boundary

Browser tests drive an engine-neutral `EditorDriver`/`DocxEditor.*` transport
and never access `EditorView`. Production verification replaces POC DOM
formatting assertions with stable semantic query results and DOCX/display-list/
PDF comparators as those surfaces become available.

**Evidence:** the POC finish-line test drives public driver methods and
independently inspects saved XML.

**Production destinations:** tasks 0.2, 0.9, 7.*, 13.*, and 14.*.

### ADR-S9 — Spike implementation remains disposable

No production package may import from
`spike/engine-core-spike-harness/**`. Production code reimplements accepted
contracts behind production package boundaries and conformance tests. Historical
v1 backends, abandoned formatting-oracle corpora, and POC-only fixture parsers
are evidence or tombstones, not source modules to migrate.

**Production destinations:** tasks 1.4–1.6.

## Rejected alternatives

- ProseMirror or DOM as canonical document state.
- Layout or export reading `EditorView`.
- Collaborative undo implemented by replaying hand-authored inverse `DocOp`s.
- The v1 nested per-paragraph/per-actor Yjs shared-type shape.
- Native Y.Text formatting attributes as the sole actor-owned overlapping mark
  representation.
- Shipping or progressively generalizing `src/poc/**` into the production
  package.
- Treating the former fifteen-gate spike program as a second production
  conformance suite.

## Explicitly unresolved production work

These are assigned production tasks, not reasons to reopen the POC:

- Complete multi-story Yjs root schema and coordinator integration:
  tasks 5.2–5.5 and 5.9–5.10.
- Durable undo/redo, contribution compaction, GC, persistence, client lifecycle,
  migrations, and snapshot recovery: tasks 4.11–4.12 and 5.6–5.8.
- Internal anchors and JSON-safe external targets: tasks 4.8–4.10 and 5.4.
- Unsupported ProseMirror step fallback, minimal reverse reconciliation,
  complete selection handling, and IME state machine: tasks 6.3–6.8 and 6.10.
- Streaming/spooled OPC/XML ingestion, calibrated budgets, cancellation, full
  relationship/content-type semantics, and ownership-scoped capsules:
  tasks 0.3, 1.3, 2.*, and 3.*.
- Layout, output, extensions, addressable sync, server/language bindings,
  annotations, performance, adapters, and release: tasks 8–14.

## Known POC robustness findings carried into production requirements

1. The POC prefix/suffix text mapper can mis-handle prepend or ambiguous edits;
   production task 6.3 MUST map complete PM steps rather than copy it.
2. POC local validation and remote-update rejection can become silent no-ops;
   production tasks 4.4, 5.3, and 5.5 MUST return typed results and observable
   diagnostics.
3. POC client-ID claims and Yjs documents live for the module lifetime;
   production tasks 5.6–5.8 and 10.* own lifecycle, reseed, retention, and
   cleanup.
4. Immutable mark contributions grow without production compaction; tasks 4.11
   and 5.8 MUST define compaction without invalidating eligible undo.
5. The robust historical coordinator tests exercise a rejected v1 shape while
   the browser POC exercises the accepted flat shape; task 5.3 MUST integrate
   the accepted shape into the sole production coordinator before claiming
   backend conformance.

## Consequences and implementation order

Production implementation may proceed under `document-engine` after this ADR
and the prerequisite wording are accepted. The order remains:

1. foundational schema registry, runtime ports, budgets, and comparators;
2. bounded package reader, authored package model, identities, capsules, and
   selective serialization;
3. semantic store, operations, targets, anchors, history, and explicit results;
4. local/Yjs backends plus the sole replication coordinator;
5. production EditorBinding;
6. public object model and the remaining output/runtime surfaces.

The completed POC is a reproducible evidence input to those tasks. It does not
waive any production capability or conformance requirement.
