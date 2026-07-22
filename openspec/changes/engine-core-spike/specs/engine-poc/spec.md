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
performance, multiple stories, cells, tables, or production schema behavior.
The sole production authority is `openspec/changes/document-engine/design.md`
plus `openspec/changes/document-engine/specs/**`.

#### Scenario: Production work follows the POC
- **WHEN** production layout, output, or export work is proposed
- **THEN** `document-engine` conformance remains required independently of the
  POC result

### Requirement: Retained stack choices are fixed
The POC SHALL use Yjs v2 with one long-lived `bodySequence: Y.Text`, plain JSON
opening-boundary embeds, immutable Candidate B `mark-contributions`, the retained
synchronous transaction/origin executor, public `Y.UndoManager` per actor/session
for local undo, and ProseMirror with model-canonical commit order.

#### Scenario: POC code uses retained decisions
- **WHEN** a POC milestone adds implementation
- **THEN** it uses the retained v2/Candidate B direction without reopening v1,
  exhaustive oracle generation, or the former gate suite

### Requirement: Product progress is milestone-based
The POC SHALL have exactly five product milestones: bounded DOCX load; tiny
collaborative Yjs store; visible ProseMirror `EditorDriver`; save/reopen
integration; and one Playwright finish line. Planning and specification edits
MUST NOT count as product progress.

#### Scenario: Progress is reported
- **WHEN** POC status is inspected
- **THEN** `tasks.md` and `implementation-status.md` identify the exact completed,
  in-review, and pending product milestones

### Requirement: Binary completion is one Playwright flow
The POC SHALL be complete when one focused Playwright test driven through the
public `EditorDriver` proves: open page; load deterministic DOCX; edit and bold
text; second-replica convergence; remote edit followed by local undo preserving
remote work; save and reopen; and preserved text, formatting, stable paragraph
identity, and captured capsule bytes.

#### Scenario: Finish line passes
- **WHEN** the Playwright flow completes successfully
- **THEN** the POC is accepted without the former fifteen gates, synthetic
  layout proofs, or exhaustive protocol suites

#### Scenario: Finish line fails
- **WHEN** the flow fails on a defined product behavior or trust boundary
- **THEN** implementation fixes that behavior before marking the POC complete

### Requirement: KISS stop rules govern proof work
The POC MUST NOT add a new oracle, protocol, or review suite unless a failing
POC product behavior requires it. Direct behavior tests SHALL own expectations,
and descriptor-only artifacts MUST NOT block milestone acceptance.

#### Scenario: A milestone adds tests
- **WHEN** focused milestone tests are added
- **THEN** they assert user-visible behavior or a mandatory trust boundary
  directly

### Requirement: DOCX trust boundary is mandatory
The minimal adapter MUST bound ZIP and XML work, reject DTD/entity declarations,
oversized parts, unsafe paths, and external relationships, and XML-escape
authored text on save. Exact byte preservation applies to the captured
unsupported capsule substring in uncompressed `word/document.xml`; the owned
paragraph may be rebuilt and ZIP metadata/compression may change.

#### Scenario: Untrusted DOCX is loaded
- **WHEN** a package violates a declared POC ZIP/XML boundary
- **THEN** loading rejects before exposing parsed document state

### Requirement: Deferred breadth does not block the POC
The POC SHALL keep the former gate suite, named v2 re-proofs, synthetic layout,
annotation, awareness/audit, browser/server parity, and property/fuzz breadth as
recorded deferred risks. They MUST NOT become POC prerequisites unless the
Playwright flow fails on the narrower behavior.

#### Scenario: Deferred proof is proposed
- **WHEN** unrelated gate or protocol work is proposed before the finish line
- **THEN** it remains out of scope

### Requirement: POC result is recorded
At completion the change SHALL record the Playwright command/URL, result, and
deferred risks in `poc-result.md`.

#### Scenario: Milestone 5 completes
- **WHEN** the Playwright finish line passes
- **THEN** `poc-result.md` records the evidence without claiming production
  conformance
