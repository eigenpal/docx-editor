# Engine POC implementation status

Updated: 2026-07-22

This is the durable progress record for the v2 KISS browser POC. `tasks.md`
remains the acceptance checklist.

## Retained completed work

- Harness, authored model, contracts, and public `EditorDriver`: retained
  historical spike commits through `checkpoint-07d16224`.
- V1 nested Yjs model: rejected; decision retained in
  `yjs-schema-v2-design.md`.
- Candidate B immutable mark contributions: selected by the reviewed KISS
  experiment (`checkpoint-9f59a19d`, `checkpoint-9273f80a`, `checkpoint-cf8e6e30`).
- Lean v2 contracts: retained implementation notes
  (`checkpoint-4e301195` through `checkpoint-61a2ca37`).
- Synchronous transaction/origin executor: implemented and hardened
  (`checkpoint-ad0913e3`, `checkpoint-f9e6c780`, `checkpoint-a66aa8ec`).
- POC scope replacement: committed and review-approved
  (`checkpoint-4e2582fd`, `checkpoint-c5e35137`, `checkpoint-4d3739c0`, `checkpoint-87bd5512`, `checkpoint-880a7d03`).

## Product milestones

### Milestone 1 — complete and review-approved

Bounded deterministic five-part DOCX loading, exact POC package semantics, and
captured unsupported capsule bytes:

- implementation: `checkpoint-5c31fb30`
- hardening: `checkpoint-994f400a`, `checkpoint-a114eaae`
- result: focused loader and trust-boundary tests pass

### Milestone 2 — complete and review-approved

Tiny collaborative Yjs store with stable operation identity, atomic staged
publish, exact prospective-state validation, maximal formatting projection,
queued notifications, real two-replica convergence, and actor-local undo:

- initial implementation: `checkpoint-598808ab`
- correctness hardening: `checkpoint-5690b441`
- identity and formatting-undo hardening: `checkpoint-c45c8b45`
- result: 24 focused tests and spike typecheck pass; focused acceptance review
  found no remaining blockers
- narrow POC limitation: client-ID claims persist for the module lifetime, so
  teardown/recreation with the same ID is intentionally unsupported

### Milestone 3 — complete and review-approved

Visible ProseMirror editor and read-only replica backed by the canonical store
and exposed through `EditorDriver` without exposing `EditorView`:

- initial implementation: `checkpoint-1ab1532a`
- real PM transaction, reconciliation, repeat-load, and selection hardening:
  `checkpoint-5557ee20`, `checkpoint-d29e97ee`
- toolbar focus preservation: `checkpoint-f2781924`
- browser-runtime Yjs validation fix: `checkpoint-66e59565`
- result: 582 spike tests, typecheck, and Vite build pass; focused acceptance
  review found no remaining blockers
- browser evidence: live load, selected italic toggle, replica convergence,
  undo, and repeat load were verified at `http://localhost:5199/`

### Milestone 4 — complete and review-approved

Bounded save/reopen from the canonical snapshot with exact owned-region
replacement and trusted unowned XML preservation:

- initial implementation: `checkpoint-66d4826d`
- empty document, closed-shape input, and unowned-byte hardening: `checkpoint-5a7920e8`
- tokenizer-offset marker splicing: `checkpoint-45b672ca`
- adjacent empty-region resave: `checkpoint-661cbd13`
- result: 607 spike tests, 85 oracle tests, typecheck, Vite build, and strict
  OpenSpec validation pass; focused acceptance review found no blockers
- retained boundary: one validated POC fixture shape, not a general OOXML
  serializer

### Milestone 5 — pending

One Playwright flow is the binary finish line. Completion evidence will be
written to `poc-result.md`.

## Current implementation authority

- Scope and architecture: `proposal.md`, `design.md`
- Behavioral requirements: `specs/**`
- KISS core rules: `specs/core-kiss/spec.md`
- Milestones: `tasks.md`
- Historical v2 decisions: `yjs-schema-v2-design.md` (non-normative)
