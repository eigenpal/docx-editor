## ADDED Requirements

### Requirement: POC store exposes a tiny mutation surface
The POC store SHALL support text insertion, text deletion, and bold/italic mark
toggles for the single editable paragraph, plus snapshot inspection, local undo,
Yjs update encode/apply, and subscription notifications. It MUST NOT require the
former full `DocOp` vocabulary, PM-free server execution, audit/replay journals,
or annotation anchor matrices for POC completion.

#### Scenario: Local edit updates snapshot
- **WHEN** the POC store inserts text or toggles bold/italic inside the paragraph
- **THEN** `snapshot()` reflects the new text and run formatting immediately
  after commit

### Requirement: One normalization path commits store state
Every POC mutation SHALL pass through the synchronous transaction foundation,
mutate the Yjs body sequence and Candidate B mark contributions, commit once, and
notify subscribers. A ProseMirror projection MUST NOT become authoritative before
the store commit completes.

#### Scenario: Browser edit commits store first
- **WHEN** a ProseMirror transaction maps to a store mutation
- **THEN** the store snapshot updates before the view reconciliation is treated
  as committed

### Requirement: Two Yjs replicas converge on identical snapshots
The POC SHALL support two store instances exchanging real Yjs update bytes and
MUST converge on equivalent text and bold/italic coverage after concurrent edits
delivered in either order.

#### Scenario: Concurrent edits converge
- **WHEN** two replicas exchange concurrent supported edits in different delivery
  orders
- **THEN** both replicas reach equivalent snapshots for text and formatting

### Requirement: Actor-local undo preserves remote work
The POC SHALL use one public `Y.UndoManager` per actor/session scoped to tracked
local mutations on `bodySequence` and Candidate B mark contributions. Remote
updates MUST remain untracked so local undo reverses only the local actor's work.

#### Scenario: Local undo after remote edit
- **WHEN** actor A edits locally, actor B applies a remote update, and actor A
  invokes undo
- **THEN** actor A's local change is reversed and actor B's remote change remains

#### Scenario: Remote update does not clear eligible redo incorrectly
- **WHEN** an actor undoes an eligible local group and additional remote updates
  arrive before redo
- **THEN** remote work is preserved and redo semantics follow the public manager
  for the same actor/session

### Requirement: Retained v2 stack choices apply to the POC store
The POC store SHALL use one bootstrap `bodySequence: Y.Text`, plain JSON
opening-boundary embeds for the single paragraph, and immutable Candidate B
`mark-contributions` selected by completed task 2.4. The abandoned
formatting-bakeoff oracle corpus MUST NOT be consumed.

#### Scenario: Store uses mark-contributions
- **WHEN** the POC store applies bold or italic toggles
- **THEN** formatting state is represented through immutable mark contributions,
  not the rejected v1 nested schema

### Requirement: Former semantic breadth is deferred
The POC MUST defer full split/join identity matrices, opaque anchor envelopes,
replication coordinator idempotence proofs, PM-free server command parity, toy
layout fingerprints, audit/replay separation, and former named-v2-scenario
re-proofs. They MUST NOT block POC milestone acceptance unless the Playwright
finish line fails on the specific behavior under test.

#### Scenario: Deferred coordinator proof is proposed
- **WHEN** work is proposed to prove duplicate remote repair idempotence before
  the Playwright flow passes
- **THEN** that work is out of POC scope unless a failing POC behavior requires it

### Requirement: Transaction context remains synchronous
The POC store MUST continue to use the completed synchronous transaction context.
Async callbacks, nesting, and reentry MUST fail; exceptions MUST roll back staged
mutations and emit no subscriber notification.

#### Scenario: Nested transaction is attempted
- **WHEN** a store mutation callback opens another transaction
- **THEN** the outer operation aborts with a typed error and the snapshot remains
  unchanged
