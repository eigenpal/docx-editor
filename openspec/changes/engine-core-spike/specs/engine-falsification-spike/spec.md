## ADDED Requirements

### Requirement: The POC remains deliberately narrow
The implementation SHALL be a disposable browser POC limited to one body story,
one editable paragraph, text, bold and italic marks, stable paragraph identity,
text insertion and deletion, bold/italic toggles, two Yjs replicas, one
unsupported OOXML preservation capsule, a minimal ProseMirror editor, a
read-only synchronized replica view, and save/reopen through the public
`EditorDriver`. It MUST NOT implement the production document engine, production
adapter parity, or package migration.

#### Scenario: POC scope is reviewed
- **WHEN** the POC implementation and dependencies are inspected
- **THEN** every component exists to exercise a POC milestone or the Playwright
  finish line and no production feature breadth has been added

### Requirement: POC authority is narrow
This change SHALL prove one browser-visible editing sequence only. It MUST NOT
accept production shaping, pagination, display-list, accessibility, PDF,
performance, multiple stories, cells, tables, or production schema behavior. The
sole production authority is `openspec/changes/document-engine/design.md` plus
`openspec/changes/document-engine/specs/**`. Completing the POC does not replace
production conformance gates.

#### Scenario: Production work is proposed after POC completion
- **WHEN** production layout or export work is proposed
- **THEN** the production layout/output and performance conformance gates MUST
  still be required independently of the POC result

### Requirement: Retained stack choices are fixed
The POC SHALL use Yjs with one long-lived `bodySequence: Y.Text`, plain JSON
opening-boundary embeds, immutable Candidate B `mark-contributions`, the
synchronous transaction/origin executor from completed spike work, public
`Y.UndoManager` per actor/session for local undo, and ProseMirror as the editing
surface with model-canonical commit order. Networking MAY use any transport for
the demo page and MUST NOT become a production engine dependency.

#### Scenario: Demo transport is replaced
- **WHEN** the POC page substitutes another transport for demo wiring
- **THEN** store semantics, Yjs update bytes, and EditorDriver contracts remain
  unchanged

### Requirement: Retained historical decisions do not reopen
The POC MUST treat completed harness work, v1 schema rejection, Candidate B
selection, lean v2 contract artifacts, and the synchronous transaction executor
as closed historical evidence. They MUST NOT be treated as open prerequisites
that block POC milestones or require oracle re-freezes before later milestones.

#### Scenario: POC implementation begins after retained work
- **WHEN** a POC milestone adds code
- **THEN** it MAY build on retained decisions without rerunning v1 falsification,
  exhaustive oracle generation, or the former acceptance-gate suite

### Requirement: Product progress starts at zero
The POC MUST define exactly five product milestones, all pending at rewrite
time: bounded minimal DOCX boundary; tiny canonical Yjs store with two-replica
sync and actor-local undo; visible ProseMirror editor through `EditorDriver`;
save/reopen integration preserving semantic state and the captured capsule
substring; and one Playwright E2E finish line. The completed OpenSpec rewrite
MUST remain setup/decision history and MUST NOT count as a product milestone.

#### Scenario: Rewrite status is inspected
- **WHEN** POC progress is reported immediately after the scope rewrite
- **THEN** zero of five product milestones are complete

### Requirement: Binary completion is one Playwright flow
The POC SHALL be complete when one focused Playwright test driven through the
public `EditorDriver` proves: open page; load deterministic DOCX; edit and bold
text; second replica convergence; remote edit followed by local undo preserving
remote work; save and reopen; reopened text, formatting, stable paragraph
identity, and exact preservation of the captured unsupported capsule substring
in uncompressed `word/document.xml`.

#### Scenario: Finish line passes
- **WHEN** the Playwright flow completes successfully
- **THEN** the POC is accepted as complete without requiring the former fifteen
  gates, synthetic layout proofs, or exhaustive protocol review suites

#### Scenario: Finish line fails on product behavior
- **WHEN** the Playwright flow fails on load, edit, convergence, undo, save,
  reopen, or capsule preservation
- **THEN** implementation work MUST fix the failing product behavior before the
  POC is marked complete

### Requirement: Stop rule governs new proof artifacts
The POC MUST NOT add new `*-oracle`, `*-protocol`, or `*-review` suites unless
a failing POC product behavior requires one. Direct behavior tests own
expectations. Descriptor-only artifacts MUST NOT block milestone acceptance.

#### Scenario: A milestone adds tests
- **WHEN** a POC milestone lands focused tests
- **THEN** those tests assert product behavior directly rather than depending on
  new exhaustive oracle corpora

### Requirement: Former falsification gates are deferred risks
The POC MUST record the former acceptance-gate suite, named v2 scenario
re-proofs, synthetic layout fixtures, annotation/awareness/audit breadth,
browser/server command parity, and property/fuzz parity harnesses as deferred
risks and non-goals. They MUST NOT be treated as mandatory POC completion
criteria.

#### Scenario: Deferred gate work is proposed mid-POC
- **WHEN** work is proposed to prove gate 15 pagination counters or gate 13
  annotation matrices before the Playwright finish line passes
- **THEN** that work is out of POC scope unless the Playwright flow itself fails
  on the behavior under test

### Requirement: POC result is recorded at completion
When milestone 5 passes, the change SHALL record the Playwright command/URL,
pass/fail evidence, and deferred risks in
`openspec/changes/engine-core-spike/poc-result.md`.

#### Scenario: POC completes
- **WHEN** the Playwright finish line passes
- **THEN** `poc-result.md` documents the result and unresolved deferred risks
  without converting the harness into production engine code
