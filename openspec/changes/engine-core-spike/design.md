## Context

An architecture review of commit `checkpoint-e743b783` accepted the model-canonical
direction but found the three components carrying the real complexity —
`DocumentModel`, `DocumentStore` + replication backend, and `EditorBinding` —
underspecified. Prior spike work produced closed historical evidence: harness
scaffolding, v1 schema rejection, Candidate B immutable mark contributions, lean
v2 contract artifacts, and a synchronous transaction/origin executor.

This design **replaces** the remaining falsification program with a disposable
browser POC. The change path `engine-core-spike` is retained for history; prose
here refers to a POC, not an open-ended architecture gate.

**Authority:** a non-shipping browser POC in the spike harness. It is not
production engine conformance. The sole production authority remains
`openspec/changes/document-engine/design.md` plus
`openspec/changes/document-engine/specs/**`.

## Retained historical decisions (closed, not reopenable)

These items are evidence, not prerequisites that can block or expand POC scope:

- **Harness and contracts (tasks 1.1–1.8).** Disposable spike harness, tiny
  authored model definition, distinct spike contracts, retired test retirement
  inventories, and the public `EditorDriver` boundary that now unblocks focused
  browser E2E.
- **v1 rejection (tasks 2.1–2.3).** The nested v1 schema path is falsified
  historical evidence only; it does not authorize new v1 work.
- **Candidate B (task 2.4).** The reviewed KISS experiment selected immutable
  creation-only `mark-contributions`. The abandoned formatting-bakeoff oracle
  corpus is unexecuted historical work and is neither consumed nor authoritative.
- **Lean contracts (task 2.5).** Compatibility artifacts freeze closed schema/
  constants and scenario descriptors for reproducibility only; they do not freeze
  implementation output or canonical-state fingerprints.
- **Transaction executor (task 2.6).** Synchronous transaction context and
  typed origins reject async, nested, reentrant, and mixed-origin transactions
  atomically.

See `yjs-schema-v2-design.md` for the v2 schema narrative that informed the
retained stack choices. That document is reference material, not a POC task list.

## POC architecture

```
bounded DOCX bytes
  → minimal DOCX adapter (ZIP/XML trust boundary)
  → tiny canonical Yjs store (one bodySequence + markContributions)
  → { ProseMirror editor · read-only replica view }
  → EditorDriver (load / edit / bold / italic / undo / save / reopen)
  → save patches owned paragraph only; capsule bytes untouched
  → Playwright finish line
```

**Model-canonical editing.** ProseMirror processes keystrokes; the store commits
first; the view reconciles from store snapshots. Two Yjs replicas exchange real
updates. One `Y.UndoManager` per actor/session scopes to tracked local work;
remote updates remain untracked so local undo preserves remote edits.

**One paragraph, one capsule.** The fixture has one editable paragraph with text,
bold, and italic, plus one unsupported OOXML capsule whose bytes MUST survive
save/reopen unchanged.

## POC milestones

### Milestone 1 — OpenSpec rewrite (this commit)

Replace falsification tasks with the five milestones below, declare the Playwright
finish line, move former gate/oracle obligations to deferred risks, and mark this
milestone complete.

### Milestone 2 — Bounded minimal DOCX adapter

Generate one deterministic in-memory DOCX with one paragraph and one unsupported
capsule. Load through bounded JSZip/XML validation. Reject DTDs, oversized parts,
traversal paths, and external relationships. Save patches only the owned paragraph
range with XML-escaped text.

### Milestone 3 — Tiny canonical Yjs store and collaboration

Project the fixture into one `Y.Text` body sequence and immutable mark
contributions. Support insert/delete and bold/italic toggles through the existing
synchronous transaction foundation. Two replicas converge via real Yjs updates.
Actor-local undo preserves remote work.

### Milestone 4 — ProseMirror browser surface and EditorDriver

Mount a minimal Vite page with an editable ProseMirror surface and a read-only
synchronized replica. Expose load, text/format inspection, edit, undo, save, and
reopen through the existing public `EditorDriver` without exposing `EditorView`.
Show connection, save, and reopen status without production UI chrome.

### Milestone 5 — Save/reopen Playwright finish line

One Playwright test drives the full product sequence through `EditorDriver` and
asserts reopened text, formatting, stable paragraph identity, and exact capsule
preservation. Record result and deferred risks in `poc-result.md`.

## Binary completion condition

The POC is complete when one Playwright flow proves:

1. open the POC page;
2. load the deterministic DOCX;
3. edit and bold text;
4. observe the second replica converge;
5. apply a remote edit and prove local undo preserves it;
6. save and reopen;
7. verify semantic state and capsule bytes.

No other gate suite, oracle re-freeze, or synthetic layout proof is required
for completion.

## Stop rules

- No new `*-oracle`, `*-protocol`, or `*-review` suite unless a failing POC
  product behavior requires it.
- Prefer direct behavior tests over descriptor-only artifacts.
- A milestone is accepted when its focused behavior tests pass and the end-to-end
  flow still passes; speculative edge-case expansion is deferred.
- Unresolved risks are recorded at completion and do not expand scope unless they
  break the POC's defined flow or trust boundary.

## Explicit non-goals and deferred risks

The following are **not** POC blockers. They are recorded risks deferred to
production conformance or later work:

- The former **fifteen acceptance gates** and exhaustive gate suite (tasks 5.x,
  6.x).
- **G-v2-1..G-v2-10** descriptor re-freezes and v2 backend migration breadth
  beyond what the POC store needs (old tasks 2.7–2.9).
- **Synthetic layout**, pagination fingerprints, toy shaping fixtures, and
  bounded-work counter ceilings (old task 4.5, gate 15).
- **Annotation anchor** concurrent-edit matrix, IME composition state machine,
  selection matrix breadth, and awareness/origin audit instrumentation beyond what
  the Playwright flow needs (old tasks 3.2–3.4, 4.3–4.4, gates 5–7, 13–14).
- **Browser/server command parity**, PM-free server execution, audit/replay
  journals, and schema-backed `DocxEditor.*` command equivalence (old tasks 2.3,
  2.9, 4.2, gate 12).
- **Property/fuzz parity harness** and seeded convergence suites (old task 5.7).
- **Production package migration**, adapter parity, and publishing.
- **Full adapter/browser parity** with React/Vue production hosts.

## Security boundary (mandatory)

Loaded DOCX bytes are untrusted. The minimal adapter MUST:

- cap ZIP decompression ratio and part sizes;
- reject paths with `..` or a leading `/`;
- use a parser that does not resolve DTDs or external entities;
- reject external relationship targets and traversal fetches;
- escape every attacker-derived string written back into XML;
- preserve the unsupported capsule and all unowned bytes exactly.

## Risks / Trade-offs

- **EditorBinding remains high-risk** → the POC proves one paragraph flow, not
  production reconciliation breadth.
- **Yjs undo scope is intentionally narrow** → one actor/session manager on
  tracked types only; durable reopen history beyond the Playwright flow is
  deferred.
- **DOCX adapter is minimal** → one fixture shape; general OOXML coverage belongs
  in `document-engine`.

## Open Questions (deferred, not POC blockers)

- Production persistence, snapshot compaction, and schema evolution.
- Full anchor, IME, and selection matrices.
- Audit/replay and server isolation semantics.
- Layout, pagination, PDF, and performance conformance.
