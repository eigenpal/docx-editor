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

### Milestone 2 — implementation under correction

Initial tiny collaborative Yjs store:

- implementation: `checkpoint-598808ab`
- current state: direct RED regressions and correctness fixes are in progress
- open reviewed defects: stable Yjs operation client identity, atomic staged
  publish, exact remote schema validation, maximal formatting projection,
  listener queueing, and direct concurrency/undo evidence
- acceptance: unchecked until those fixes pass focused review

### Milestone 3 — pending

Visible ProseMirror editor and read-only replica through `EditorDriver`.

### Milestone 4 — pending

DOCX save/reopen integration with escaped authored text, stable paragraph
identity, semantic formatting preservation, and exact capsule substring bytes.

### Milestone 5 — pending

One Playwright flow is the binary finish line. Completion evidence will be
written to `poc-result.md`.

## Current implementation authority

- Scope and architecture: `proposal.md`, `design.md`
- Behavioral requirements: `specs/**`
- KISS core rules: `specs/core-kiss/spec.md`
- Milestones: `tasks.md`
- Historical v2 decisions: `yjs-schema-v2-design.md` (non-normative)
