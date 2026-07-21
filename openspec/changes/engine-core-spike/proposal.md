## Why

The model-canonical direction (`modular-core-api`, `chromium-free-rendering-engine`,
`ooxml-document-pipeline`) is sound, but an architecture review of commit
`checkpoint-e743b783` correctly found that it concentrates the hard complexity into three
components the specs treated as adapters — the canonical **DocumentModel**, the
**DocumentStore** + its replication backend, and the **EditorBinding** (PM↔model
mapping). Those are the engine. Several statements also presented unsolved
problems as consequences of the architecture (one currency; only-changed-blocks
relayout; whole-doc projection is "half the work").

This change does two things: (1) resolves the foundational contracts those three
components need, as first-class specs; and (2) defines a **risk-first vertical
spike** whose only job is to *falsify* the architecture before the full OOXML
pipeline is built. If the narrow slice cannot hold IME, selection, undo, and
remote reconciliation cleanly, the architecture is reconsidered here — cheaply —
not after the DOCX model exists.

## What Changes

- **Office JavaScript-style shape is a facade, not the storage schema.** The canonical store is
  an authored, lossless package model (runs, paragraph-mark props, field
  boundaries, bookmarks, content controls, relationship IDs, theme refs, raw/
  omitted values, unsupported-content capsules, order where significant). The
  `DocxEditor.*` object model is a lazy facade over it.
- **Authored is canonical; resolved is a derived cache.** Style/numbering
  resolution is a fingerprinted cache with revision provenance, not stored in the tree, so export never
  normalizes authored intent into direct formatting.
- **Four named contracts, not "one currency."** `DocOp` (semantic mutation
  vocabulary), `ModelChange` (committed change notification), backend replication
  update (opaque bytes), and snapshot are distinct. The backend converts
  committed ops into replication updates.
- **Three boundaries, PM-free replication.** `DocumentStore` (semantic, PM-free),
  `ReplicatedStoreBackend` (opaque bytes; the CRDT lives here), `EditorBinding`
  (the only PM-aware layer). No PM type in the CRDT package. (`remote-document-sync`
  D1 corrected accordingly.)
- **EditorBinding is a first-class engine.** An extensible `OperationMapper`
  (step→ops, model-change→reconcile), an explicit unsupported-transaction
  fallback policy, one authoritative normalization path, and defined reverse
  reconciliation (selection/IME/loop-prevention/origin-tagging).
- **Stable identity + compound anchors** with defined split/join/move/delete
  semantics; projections carry opaque engine anchor handles, not PM offsets or
  public backend-relative bytes.
- **Atomic multi-story transactions** (`store.transact`) so one command touching
  body + relationship + media + numbering commits as one revision.
- **Incremental layout narrowed** to dependency-aware invalidation with a
  pagination restart point, not "only the changed block".
- **Server isolation** via revision-aware `RequestContext` (`baseRevision`,
  precondition-carrying ops).
- **Security mechanics** (not policy): auth/authz hooks, size/rate/resource
  limits, malformed-update handling, audit metadata — seams specified even though
  policy stays integration-owned.
- **A falsification spike**: one body story, paragraphs, text, bold/italic, stable
  paragraph IDs, insert/delete/split/join, Yjs + local backends, minimal layout —
  gated on fifteen pass/fail proofs.
- **Five architecture-suitability proofs added without widening production
  scope**: selective preservation of unsupported OOXML and authored lexical
  intent; browser/server parity for one schema-backed `DocxEditor.*` command;
  concurrent edit survival for one annotation anchor; explicit origin and
  awareness separation without loops; and bounded dirty measurement and
  pagination restart work for one synthetic large-document edit.
- **Narrow authority.** Passing the spike accepts only the canonical-store,
  replication-coordinator, editor-binding, anchor, origin/awareness, undo, and
  fixture-bounded-work architecture. Production shaping, pagination, output,
  accessibility, PDF, and performance remain gated by `document-engine`.
- **Executable toy layout.** The synthetic fixture pins deterministic toy
  shaping inputs, one dependency-changing edit, a canonical pagination
  fingerprint with a pass bound, and concrete fixture-owned work ceilings.

## Capabilities

### New Capabilities

- `canonical-document-model`: the authored, lossless package model + preservation
  capsules + stable IDs + fingerprinted resolved cache with revision provenance; the `DocxEditor.*`
  Office JavaScript-style facade over it.
- `semantic-operations`: `DocOp`/`ModelChange`/replication-update/snapshot as four
  contracts, `store.transact` atomicity, identity-under-edit rules, and opaque
  engine-owned anchor handles.
- `editor-binding`: the `OperationMapper` contract, unsupported-transaction
  fallback policy, single normalization path, and reverse reconciliation
  (selection/IME/loops), with the parity property-test as an acceptance gate.
- `engine-falsification-spike`: the narrow vertical slice and its fifteen pass/fail
  gates that must hold before the full OOXML pipeline is built.

### Modified Capabilities

<!-- This spike records prerequisite architecture proofs. The authoritative
     production corrections and complete contracts live in document-engine. -->

## Impact

- **Sequencing**: this spike gates use of the canonical store, replication
  coordinator, editor binding, anchors, origin/awareness, undo, and bounded-work
  architecture in the production pipeline. Production shaping, layout, output,
  and performance still require their own conformance gates.
- **Contracts**: pins DocumentModel/DocOp/ModelChange/DocumentStore/EditorBinding
  as first-class specs; downstream changes depend on them.
- **Backends**: local + Yjs built together (seam-neutrality canary); Automerge is
  reached only against the conformance suite, never assumed.
- **No product behavior**: this is contracts + a throwaway-scope spike; the spike
  code is a falsification harness, not shipped surface.
