## ADDED Requirements

### Requirement: EditorDriver exposes the POC browser surface
The POC SHALL mount a minimal browser page with an editable ProseMirror surface
and a read-only synchronized replica view. Load, text inspection, formatting
inspection, edit, bold, italic, undo, save, and reopen MUST be driven through the
existing public `EditorDriver` without exposing `EditorView` to tests or
Playwright helpers.

#### Scenario: Playwright drives the public driver
- **WHEN** the finish-line test performs load, edit, bold, undo, save, and reopen
- **THEN** each step uses only public `EditorDriver` methods and queries

#### Scenario: EditorView is not exposed
- **WHEN** the POC browser binding is inspected from tests
- **THEN** no public API returns a ProseMirror `EditorView` instance

### Requirement: Model-first binding reconciles the editable view
The POC binding SHALL map supported ProseMirror text transactions to store
mutations, commit the store first, then reconcile the editable view from store
snapshots. Unsupported transactions MUST be rejected rather than bypassing the
store.

#### Scenario: Local typing updates the store
- **WHEN** a user types into the editable surface
- **THEN** the store snapshot updates and the view reflects the normalized store
  state without a raw projection commit bypassing the store

#### Scenario: Format toggle updates the store
- **WHEN** bold or italic is toggled for the current selection
- **THEN** the store records the mark change and both editable and replica views
  reflect the updated formatting after reconciliation

### Requirement: Read-only replica reflects remote convergence
The POC page SHALL render a read-only replica view subscribed to the second store
instance. When Yjs updates are exchanged, the replica MUST converge to the same
text and formatting as the editable store without accepting direct user edits.

#### Scenario: Replica updates after edit
- **WHEN** the editable store commits a local edit and exchanges updates with the
  replica store
- **THEN** the read-only replica displays the same text and bold/italic coverage

### Requirement: Loop prevention for binding reconciliation
Binding-generated reconciliation transactions SHALL carry a binding-reconciliation
origin and MUST be ignored by the forward mapper so remote store updates do not
create feedback loops.

#### Scenario: One remote update reconciles once
- **WHEN** a remote store snapshot change is reconciled into the editable view
- **THEN** the generated reconciliation does not emit a new store mutation

### Requirement: POC status is visible without production UI
The POC page SHALL expose accessible controls and status for connection, save, and
reopen sufficient for Playwright and manual inspection. It MUST NOT introduce
production toolbar chrome or claim adapter parity with React/Vue hosts.

#### Scenario: Save and reopen status is observable
- **WHEN** save or reopen completes or fails
- **THEN** the page exposes a testable status indicator for Playwright assertions

### Requirement: Former binding breadth is deferred
The POC MUST defer IME composition state machines, full selection matrices,
annotation anchor remapping, browser/server command parity, schema-backed
`DocxEditor.*` command equivalence proofs, and G-v2-1..G-v2-10 descriptor gates.
They MUST NOT block POC milestone acceptance unless the Playwright finish line
fails on the specific behavior under test.

#### Scenario: IME matrix is proposed before finish line
- **WHEN** work is proposed to implement the former frozen IME fixture before the
  Playwright flow passes
- **THEN** that work is out of POC scope unless the finish-line flow fails on IME
  behavior

### Requirement: Focused binding tests precede browser E2E breadth
Milestone 4 SHALL include direct behavior tests for model-first text mapping,
selection-assisted mark toggles, reconciliation from snapshots, and loop
prevention before the Playwright finish line is required to pass.

#### Scenario: Binding unit tests pass
- **WHEN** milestone 4 binding tests run
- **THEN** they assert store-first commit order and reconciliation behavior
  without requiring production adapter parity tests
