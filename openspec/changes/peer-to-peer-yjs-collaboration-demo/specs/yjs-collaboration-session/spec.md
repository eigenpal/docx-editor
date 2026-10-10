## ADDED Requirements

### Requirement: Canonical tree remains authored authority

The collaboration session SHALL apply every local and remote authored change through the validated canonical tree transaction path. Yjs shared state SHALL coordinate supported replicated intent but MUST NOT become an input to layout, paint, or DOCX serialization, and ProseMirror MUST NOT be used as the replication authority.

#### Scenario: Remote text update commits

- **WHEN** a remote Yjs update changes supported text in an existing body paragraph
- **THEN** the session derives the corresponding typed tree operations, commits them atomically with remote origin, and layout and save consume the resulting canonical tree

#### Scenario: Remote update cannot be expressed

- **WHEN** a remote shared-state change cannot be represented by the supported tree-operation slice
- **THEN** the session reports a typed refusal and MUST NOT silently mutate, drop, or reconstruct canonical authored content

### Requirement: Provider-neutral session

The Yjs collaboration integration SHALL accept a consumer-owned Yjs document and awareness channel without depending on a specific network, persistence, room, or hosting provider. The default core editor import graph MUST remain Yjs-free.

#### Scenario: Provider supplies synchronized document

- **WHEN** a consumer supplies a Yjs document and awareness channel connected by any compatible provider
- **THEN** the same collaboration session API synchronizes supported document state without inspecting or owning that provider

#### Scenario: Default editor is imported

- **WHEN** an application imports the default core or adapter editor entry point without collaboration
- **THEN** Yjs, WebRTC, signaling, and provider code are absent from the reachable bundle graph

### Requirement: Single bounded baseline initialization

The session SHALL bind one collaboration document to one immutable bounded DOCX baseline identified by document ID, protocol version, schema version, byte length, and cryptographic digest. A creator SHALL initialize an empty session once; a joiner SHALL receive and validate that baseline and MUST NOT independently seed the same content.

#### Scenario: Creator initializes an empty room

- **WHEN** one creator supplies a valid DOCX within the collaboration resource limits to an uninitialized Yjs document
- **THEN** the session records exactly one immutable baseline and exposes the opened canonical document after initialization commits

#### Scenario: Joiner receives the room baseline

- **WHEN** a joiner connects without local document bytes to an initialized room
- **THEN** the joiner waits for, validates, opens, and exposes the room's baseline before accepting authored edits

#### Scenario: Competing initialization arrives

- **WHEN** a second creator attempts to initialize an already initialized room with any baseline
- **THEN** initialization is refused without replacing or merging baseline bytes

#### Scenario: Mismatched or oversized baseline arrives

- **WHEN** received metadata, digest, schema, protocol, byte count, or bounded DOCX parsing does not validate
- **THEN** the session enters a typed error state and publishes no editable document

### Requirement: Existing body paragraph text synchronization

The smallest demo SHALL synchronize UTF-16 text insertion and deletion only within existing body paragraphs that have valid stable `w14:paraId` identities. Paragraph creation, split, join, reorder, and every non-text or non-body operation MUST be refused as unsupported by the collaboration session.

#### Scenario: Concurrent insertion converges

- **WHEN** two replicas insert text at the same position of the same existing body paragraph and exchange updates in different orders
- **THEN** both canonical trees converge to the same authored text and semantic digest

#### Scenario: Overlapping delete and insert converge

- **WHEN** one replica deletes a range while another inserts text in an overlapping location and all updates are delivered
- **THEN** every replica derives the same final canonical paragraph text

#### Scenario: Structural command is attempted

- **WHEN** a collaborative client attempts Enter, paragraph join, table editing, drawing editing, comment editing, formatting, or another operation outside insertion and deletion in an existing body paragraph
- **THEN** the collaboration session refuses the command with a specific experimental-scope reason and makes no local or shared-state write

### Requirement: Local and remote origin isolation

The collaboration session SHALL distinguish local human, local agent, remote, projection, awareness, undo, and repair origins. Remote, projection, and awareness activity MUST NOT create local semantic undo entries.

#### Scenario: Remote update is applied

- **WHEN** a replica applies a valid remote text update
- **THEN** the resulting canonical transaction carries the frozen remote mutation origin and does not increase that actor's local undo depth

#### Scenario: Local projection reconciles

- **WHEN** canonical state reconciliation updates a local projection after a collaboration commit
- **THEN** no Yjs update, authored tree mutation, or history entry is generated in feedback

### Requirement: Actor-local collaborative undo

Collaborative undo and redo SHALL use one actor-scoped Yjs history for the supported shared text types and SHALL update the canonical tree through the same validated derivation path. An actor MUST NOT undo another actor's accepted edits.

#### Scenario: Actor undoes after a remote edit

- **WHEN** Alice inserts text, Bob later inserts text, and Alice invokes undo
- **THEN** Alice's accepted insertion is reversed while Bob's insertion remains on every replica

#### Scenario: Collaborative mode invokes legacy snapshot undo

- **WHEN** a collaborative editor receives an undo command for supported shared text
- **THEN** the command is routed through collaborative actor-local undo rather than pointer-swapping a package snapshot that could erase remote work

### Requirement: Awareness is non-canonical

The collaboration session SHALL publish identity, connection presence, and selections through the supplied awareness channel. Awareness SHALL be ephemeral and MUST NOT alter canonical revision, undo history, snapshots, Yjs authored state, or DOCX output.

#### Scenario: Remote selection changes

- **WHEN** a collaborator changes a collapsed or ranged selection in a supported paragraph
- **THEN** peers receive paragraph identity plus Yjs-relative endpoints and render a non-editable semantic-layout overlay without changing document revision

#### Scenario: User disconnects

- **WHEN** an awareness client disconnects or its state expires
- **THEN** its presence and remote-selection furniture disappear without an authored transaction

### Requirement: Idempotent and atomic update handling

The session SHALL tolerate duplicate, delayed, and out-of-order Yjs updates. A remote update SHALL be staged and validated before canonical publication, and any failure SHALL leave the previously published canonical document unchanged.

#### Scenario: Duplicate update is delivered

- **WHEN** the same valid Yjs update is delivered more than once
- **THEN** at most one canonical model change is published

#### Scenario: Remote derivation fails

- **WHEN** deriving or validating a remote update fails before publication
- **THEN** canonical revision, package, indexes, history, and subscriber output remain unchanged and the failure is observable

### Requirement: Save and reopen equivalence

Every replica SHALL save from its canonical package. Once replicas have received the same updates, save/reopen SHALL produce equal canonical fingerprints and semantic digests for the supported collaboration slice.

#### Scenario: Converged replicas save

- **WHEN** two replicas have converged after concurrent supported edits
- **THEN** each saved DOCX reopens with equal supported paragraph text, stable paragraph identities, canonical fingerprint, and semantic digest

### Requirement: Explicit lifecycle and status

The collaboration session SHALL expose initialization, ready, disconnected, error, and destroyed states and SHALL provide deterministic teardown. It MUST NOT claim that provider connectivity alone proves document readiness or convergence.

#### Scenario: Session is destroyed

- **WHEN** the consumer destroys the collaboration session
- **THEN** observers, awareness listeners, undo managers, and editor attachments are released while consumer-owned providers and Yjs documents remain consumer-owned unless a convenience wrapper explicitly owns them
