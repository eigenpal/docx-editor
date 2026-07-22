## Why

The model-canonical direction (`modular-core-api`, `chromium-free-rendering-engine`,
`ooxml-document-pipeline`) is sound, but an architecture review of commit
`checkpoint-e743b783` correctly found that it concentrates the hard complexity into three
components the specs treated as adapters — the canonical **DocumentModel**, the
**DocumentStore** + its replication backend, and the **EditorBinding** (PM↔model
mapping). Those are the engine.

Prior work in this change produced retained historical evidence: a disposable
harness, v1 schema rejection, Candidate B immutable mark contributions, lean v2
contracts, and a synchronous transaction/origin executor. That work is closed and
does not reopen.

This change now defines a **disposable browser POC** whose only job is to prove
one visible product sequence through the public `EditorDriver`: load a bounded
minimal DOCX, edit and format one paragraph, synchronize two Yjs replicas,
perform actor-local undo that preserves remote work, save, reopen, and preserve
semantic content plus the exact captured unsupported capsule substring in
uncompressed `word/document.xml`.

## What Changes

- **Scope replacement, not additive layer.** The open-ended falsification
  program (fifteen gates, exhaustive oracle freezes, synthetic layout, annotation/
  awareness/audit breadth, old E2E blocking) is superseded by five POC milestones
  and one Playwright finish line. Those former obligations become explicit
  deferred risks and non-goals, not POC blockers.
- **Narrow authority.** This is a non-shipping browser POC in the spike harness.
  It does not accept production engine conformance, package migration, or
  publishing. Production shaping, layout, output, accessibility, PDF, and
  performance remain gated by `document-engine`.
- **Retained decisions carried forward:** one long-lived `Y.Text` body story;
  plain JSON opening-boundary embeds; immutable Candidate B mark contributions;
  the synchronous transaction/origin executor; ProseMirror as editing surface with
  model-canonical commit order; bounded parsing and exact preservation of one
  unsupported OOXML capsule.
- **Five pending POC milestones:** bounded minimal DOCX boundary; tiny canonical
  Yjs store with two-replica synchronization and actor-local undo; visible
  ProseMirror editor through `EditorDriver`; save/reopen integration preserving
  semantic state and the captured capsule substring; one Playwright E2E finish
  line. The OpenSpec rewrite is completed setup, not product progress.
- **Binary completion.** One focused Playwright flow proves load → edit → bold →
  replica convergence → remote edit → local undo preserving remote work → save →
  reopen → semantic and capsule preservation.
- **Stop rule.** No new `*-oracle`, `*-protocol`, or `*-review` suite unless a
  failing POC product behavior requires it. Direct behavior tests own
  expectations.
- **Security boundary.** The minimal DOCX adapter MUST enforce bounded ZIP/XML,
  reject DTDs/oversized parts/traversal paths/external relationships, XML-escape
  authored text, and preserve exactly the captured unsupported capsule substring
  in uncompressed `word/document.xml`. The owned paragraph region may be rebuilt;
  ZIP metadata and entry compression may change.
- **EditorDriver unblocks browser E2E.** The existing public `EditorDriver`
  boundary enables the focused Playwright flow. This POC does not claim full
  adapter or browser parity with production packages.

## Capabilities

### New Capabilities

- `canonical-document-model`: the POC's one-paragraph authored model, stable
  paragraph identity, and one captured unsupported capsule substring preserved
  byte-for-byte on save.
- `semantic-operations`: the POC store's text insertion/deletion, bold/italic
  toggles, two-replica Yjs convergence, and actor-local undo preserving remote
  work.
- `editor-binding`: minimal ProseMirror binding and `EditorDriver` transport for
  load, edit, format inspection, undo, save, and reopen without exposing
  `EditorView`.
- `engine-falsification-spike`: the disposable browser POC scope, milestones,
  finish line, stop rules, deferred risks, and retained historical decisions.

### Modified Capabilities

<!-- This POC records prerequisite architecture evidence. The authoritative
     production corrections and complete contracts live in document-engine. -->

## Impact

- **Sequencing**: completing the POC does not unblock production pipeline work
  beyond recording retained decisions and deferred risks. Production conformance
  still requires `document-engine`.
- **Contracts**: the four capability specs describe POC behavior only; they do
  not supersede `document-engine`.
- **Harness only**: spike code is disposable proof in
  `spike/engine-core-spike-harness/` and `e2e/`; it is not shipped surface.
- **No product migration**: adapters and published packages are out of scope.
