## ADDED Requirements

### Requirement: The POC uses the retained v2 KISS core
The POC core SHALL use one long-lived body `Y.Text`, one plain-JSON opening
boundary for the single paragraph, and immutable Candidate B add/remove mark
contributions. The rejected v1 nested schema and abandoned formatting-oracle
corpus MUST NOT be consumed.

#### Scenario: Core storage is inspected
- **WHEN** the POC store is created
- **THEN** it contains the v2 body sequence and Candidate B contribution root
  without per-paragraph nested shared types

### Requirement: Model state is canonical
The POC SHALL commit the Yjs-backed model before ProseMirror reconciliation.
ProseMirror and the read-only replica SHALL remain projections and MUST NOT
become independent authored-state sources.

#### Scenario: Browser edit commits
- **WHEN** an editor transaction changes text or formatting
- **THEN** the store commits first and both visible projections reconcile from
  the committed snapshot

### Requirement: Collaboration remains directly testable
The core SHALL exchange real Yjs updates between two replicas and use one
actor/session `Y.UndoManager` for local undo. Remote work MUST remain untracked
so local undo preserves it.

#### Scenario: Local undo follows remote work
- **WHEN** local work is followed by a remote edit and local undo
- **THEN** only eligible local work is reversed

### Requirement: Implementation stays KISS
Each milestone SHALL add only code required by the five-milestone POC flow or
its mandatory DOCX trust boundary. New abstractions, fixtures, or proof suites
MUST be driven by a failing direct behavior test.

#### Scenario: Additional machinery is proposed
- **WHEN** a new protocol, oracle, generalized backend, or production feature is
  proposed
- **THEN** it is rejected from POC scope unless a current milestone cannot pass
  without it

### Requirement: Milestones have reachable acceptance
A milestone SHALL complete when its direct behavior tests pass and focused
review finds no blocker within the approved POC scope. Review MUST NOT expand
the milestone into deferred production or former falsification breadth.

#### Scenario: Review finds deferred breadth
- **WHEN** a finding concerns behavior outside the POC flow and mandatory trust
  boundary
- **THEN** it is recorded as deferred rather than reopening the milestone

### Requirement: OpenSpec is the sole planning record
The POC SHALL keep design, requirements, tasks, status, and completion evidence
inside `openspec/changes/engine-core-spike/`. External planning-document trees
MUST NOT govern or duplicate the POC plan.

#### Scenario: POC status is requested
- **WHEN** an implementer or reviewer needs current scope or progress
- **THEN** they read this OpenSpec change and its `implementation-status.md`
