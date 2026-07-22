# Browser/Yjs/DOCX engine POC

## Goal

Replace the open-ended architecture-falsification program with one visible,
binary product milestone:

> Open a bounded minimal DOCX in a browser, edit and format its paragraph,
> synchronize two Yjs replicas, undo only the local actor's change, save, reopen,
> and preserve semantic content plus untouched capsule bytes.

The POC is complete when one Playwright flow proves that sequence through the
public `EditorDriver`.

## Retained decisions

- One long-lived `Y.Text` for the body story.
- Plain JSON opening-boundary embeds.
- Immutable Candidate B mark-contribution records.
- The synchronous transaction/origin executor.
- ProseMirror as the editing surface; the model remains canonical.
- Bounded parsing and exact preservation of one unsupported OOXML capsule.

The previous v1 schema rejection remains historical evidence. The large,
unexecuted formatting oracle and the fifteen-gate program are not POC
prerequisites.

## Milestones

### 1. Minimal DOCX boundary

Generate one deterministic DOCX fixture with one editable paragraph and one
unsupported capsule. Load it through a bounded ZIP/XML adapter. Reject DTDs,
oversized parts, traversal paths, and external relationships.

### 2. Tiny canonical/Yjs store

Project the fixture into one body sequence and immutable mark contributions.
Support text insertion/deletion and bold/italic toggles through the existing
synchronous transaction foundation. Two replicas exchange real Yjs updates.

### 3. Visible editor

Mount a minimal ProseMirror editor and a read-only synchronized replica in a
small Vite page. Expose load, text/format inspection, edit, undo, save, and
reopen through `EditorDriver`. The page shows connection, save, and reopen
status without introducing production UI.

### 4. Save and reopen

Patch only the owned paragraph range in `word/document.xml`. Preserve the
unsupported capsule bytes exactly. Reopen the generated DOCX through the same
adapter and compare text, bold/italic coverage, stable paragraph identity, and
capsule bytes.

### 5. End-to-end finish line

One Playwright test:

1. opens the POC;
2. loads the deterministic DOCX;
3. edits and bolds text;
4. observes the second replica converge;
5. applies a remote edit and proves local undo preserves it;
6. saves and reopens;
7. verifies semantic state and capsule preservation.

## Explicit non-goals

- Production DOCX coverage, layout fidelity, pagination, PDF, tables, headers,
  accessibility, or performance claims.
- Exhaustive oracle generation, protocol review suites, or adversarial cases
  not triggered by the POC flow.
- Production package migration or publishing.

## Stop rules

- No new `*-oracle`, `*-protocol`, or `*-review` suite unless a failing POC
  behavior requires it.
- Prefer direct behavior tests over descriptor-only artifacts.
- A milestone is accepted when its focused behavior and the end-to-end flow
  pass; speculative edge-case expansion is deferred.
- Unresolved risks are recorded at completion and do not expand scope unless
  they break the POC's defined flow or trust boundary.
