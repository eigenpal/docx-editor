## ADDED Requirements

### Requirement: Representation selection is evidence-gated

The system SHALL compare nested Yjs XML and a stable-node registry in one isolated
representation spike before integrating a full-document shared schema into the editor.

#### Scenario: One representation passes

- **WHEN** one candidate meets every identity, move, validity, fidelity, and 200-page performance gate
- **THEN** the implementation may use that representation for the full-package schema

#### Scenario: A representation fails

- **WHEN** either candidate allocates at least ten times the canonical nodes of an equivalent local edit or loses concurrent edits during a move
- **THEN** the implementation SHALL reject that candidate even when the other candidate passes

#### Scenario: Both representations fail

- **WHEN** both candidates fail any kill criterion
- **THEN** the implementation SHALL stop for architecture review without editor integration

### Requirement: Collaboration binds below editor operations

The system SHALL derive collaborative changes from one canonical package mutation
primitive journal rather than maintain a wire handler for each `TreeDocOp`.

#### Scenario: New canonical operation uses existing primitives

- **WHEN** a new editor operation composes existing text, attribute, child, move, part, or binary-reference primitives
- **THEN** the operation SHALL collaborate without a new operation-specific replication handler

#### Scenario: Mutation cannot use existing primitives

- **WHEN** a canonical mutation cannot be represented by the declared primitive journal
- **THEN** the canonical mutation boundary SHALL add one compositional primitive before collaboration admits that edit

### Requirement: Frozen authorable mutation coverage

The completed capability SHALL converge every operation in the authorable mutation
manifest frozen at the implementation base commit.
The experimental `createDocumentCollaboration` session SHALL admit every authorable
mutation at `gateOperations`.
It SHALL refuse a write only when the session is unready, unattached, or destroyed.

#### Scenario: Typed document content changes

- **WHEN** collaborators concurrently use a typed operation present in the frozen manifest
- **THEN** every replica SHALL converge to an equivalent valid canonical package

#### Scenario: Generic OOXML changes

- **WHEN** an admitted edit moves, inserts, removes, or changes lossless generic OOXML
- **THEN** every replica SHALL preserve the generic namespace, name, attributes, bindings, child order, text, and stable logical identity

#### Scenario: Ready session admits authorable mutations

- **WHEN** a ready attached `createDocumentCollaboration` session receives an authorable `TreeDocOp`
- **THEN** `gateOperations` SHALL return null and SHALL NOT refuse the operation by class

#### Scenario: Unready session refuses writes

- **WHEN** the session is not ready, not attached, or destroyed
- **THEN** `gateOperations` SHALL refuse the operation

#### Scenario: Headless session fixtures converge

- **WHEN** `packages/collaboration-yjs/src/__tests__/document-session.test.ts` drives real `TreeDocOp` values through the store, port, and session
- **THEN** the other peer's canonical fingerprint and save/reopen digest SHALL match

#### Scenario: Editor cannot author a capability

- **WHEN** the base editor has no authorable operation for an OOXML capability
- **THEN** this change SHALL NOT claim or implement that editing capability

### Requirement: Full OPC package replication

The shared room SHALL represent XML part lifecycle, relationships, content types, and
binary resource references as one versioned package.
The experimental session SHALL carry binary bytes in a separate `Y.Map`.
The map key SHALL be `docx-package-blobs-v1`.
Entries SHALL be keyed by digest.
Total stored blob bytes SHALL stay at or below 64 MiB.

#### Scenario: XML part changes

- **WHEN** an admitted transaction creates, deletes, renames, or edits an XML part
- **THEN** the part directory and all affected package references SHALL converge atomically

#### Scenario: Shared state stays deliverable to a joiner

- **WHEN** a replica joins a room
- **THEN** the shared state SHALL encode small enough for the configured transport to deliver as one update
- **THEN** encoded cost per node record SHALL stay at or below 160 bytes
- **THEN** encoded cost per node record SHALL NOT grow with document size

#### Scenario: Relationship changes reach the serialized part

- **WHEN** an admitted transaction adds or removes a relationship
- **THEN** shared state SHALL carry that change as a relationship record
- **THEN** every replica SHALL materialize the owning `.rels` part to agree with those records,
  because `writeOoxmlPackage` serializes part trees and not the relationship index
- **THEN** a replica that receives the change SHALL export the relationship in the saved bytes

#### Scenario: Binary resource changes

- **WHEN** an admitted transaction adds or removes an image, embedded font, or another binary part
- **THEN** shared state SHALL store the bytes in `Y.Map` `docx-package-blobs-v1` keyed by digest
- **THEN** total stored blob bytes SHALL stay at or below 64 MiB
- **THEN** the node registry SHALL NOT hold the bytes

#### Scenario: Blob lease is deferred

- **WHEN** a replica writes blob bytes into `docx-package-blobs-v1`
- **THEN** the session SHALL NOT require a consumer blob lease or garbage-collection callback

#### Scenario: Missing binary object

- **WHEN** a replica cannot resolve a referenced binary digest
- **THEN** the replica SHALL refuse canonical publication or export that requires the bytes and SHALL report a typed resource error

### Requirement: Stable logical identity

Every collaborative node SHALL use a replica-scoped logical id from
`LogicalIdAllocator`.
The identity SHALL remain independent from Yjs item identity and Word-facing
identifiers.
The session SHALL NOT key shared node records on a locally minted canonical node id
of the shape `<partName>#new:<counter>`.
`LogicalIdentityMap` SHALL mint a fresh logical id for a `putNode` effect whose
resolved id is absent from shared state.
A `putNode` effect whose resolved id is present in shared state SHALL keep that id,
because the journal reports an element rename as `putNode` for the node it renames.
Later effects in the same journal SHALL resolve through that map.
Ids that came from the shared baseline SHALL resolve to themselves.
The map SHALL reset after each materialized install.

#### Scenario: Concurrent node creation from one baseline

- **WHEN** two replicas start from the same baseline bytes and each inserts a different node
- **THEN** each replica's `putNode` effect SHALL receive a distinct replica-scoped logical id
- **THEN** both nodes SHALL survive materialization on every replica

#### Scenario: Minted canonical ids collide

- **WHEN** two replicas mint the same canonical id `<partName>#new:<counter>` for different nodes
- **THEN** shared state SHALL NOT merge those nodes into one record

#### Scenario: Baseline ids resolve to themselves

- **WHEN** a journal names a node that every replica already read from the shared baseline
- **THEN** `LogicalIdentityMap` SHALL resolve that id to itself

#### Scenario: Ordered journal translation

- **WHEN** one journal creates a node and later effects name that canonical id
- **THEN** those later effects SHALL resolve through the map filled by that `putNode`

#### Scenario: Element rename keeps one node

- **WHEN** an operation changes one element's qualified name and keeps its id and children
- **THEN** the registry SHALL rename that element in place
- **THEN** the registry SHALL keep the children, attributes, and namespace bindings of that node
- **THEN** shared state SHALL NOT gain a second record for the renamed node

#### Scenario: Node class change refused

- **WHEN** a `putNode` effect names an existing node of a different node class
- **THEN** the session SHALL refuse the journal

#### Scenario: Map reset after install

- **WHEN** a materialized package is installed as the local canonical revision
- **THEN** the session SHALL reset `LogicalIdentityMap`

#### Scenario: Core mint stays part-scoped

- **WHEN** two documents open from the same bytes in one process
- **THEN** core SHALL mint the same canonical ids
- **THEN** collaboration SHALL keep the created nodes distinct through replica-scoped logical ids

#### Scenario: Node move

- **WHEN** a node moves between valid parents
- **THEN** its canonical logical identity and concurrent descendant edits SHALL survive the move

#### Scenario: Checkpoint reconstruction

- **WHEN** a room reconstructs shared state from a checkpoint
- **THEN** canonical nodes SHALL recover the same logical identities even if Yjs item identities differ

### Requirement: Registry membership uses child arrays

The stable-node registry SHALL use child-ID arrays as the only replicated membership
and ordering authority. It SHALL NOT use a replicated parent register.

#### Scenario: Concurrent move creates duplicate placement

- **WHEN** concurrent moves place one logical ID under several reachable parents
- **THEN** materialization SHALL keep the first preorder placement, report `duplicate-parent`, and preserve the node record and descendant edits

#### Scenario: Node is deleted

- **WHEN** an admitted delete removes a node from the canonical tree
- **THEN** shared state SHALL tombstone the node record instead of deleting its registry map entry

#### Scenario: Paragraph join receives a concurrent child

- **WHEN** one transaction joins a node into a survivor while another transaction adds a child to the removed node
- **THEN** a valid `replacedBy` chain SHALL adopt the child under the survivor without a competing repair transaction

#### Scenario: Joiner rebuilds derived parent indexes

- **WHEN** shared state arrives before the joiner's registry exists
- **THEN** `createDocumentCollaboration` SHALL call `rebuildDerivedIndexes` once after the join handshake

### Requirement: Identity-preserving materialization

Remote materialization SHALL rebuild only changed canonical paths and SHALL reuse
unaffected frozen node references and chunked child sequences.

#### Scenario: Remote character insertion

- **WHEN** one remote character changes one text node
- **THEN** only that node and its ancestors SHALL receive new canonical references

#### Scenario: Local and remote performance comparison

- **WHEN** the existing 200-page benchmark measures equivalent warm local and remote edits
- **THEN** remote allocation SHALL stay below three times local allocation and collaboration-specific absolute latency, work, and memory budgets

#### Scenario: Whole-package rebuild attempt

- **WHEN** a remote event affects one bounded path
- **THEN** the implementation SHALL NOT parse, serialize, or rebuild the complete DOCX package

### Requirement: Atomic local and remote publication

One collaborative editor transaction SHALL produce at most one shared Yjs transaction
and one valid canonical publication.

#### Scenario: Accepted local transaction

- **WHEN** local `TreeDocOp` planning and primitive-journal validation succeed
- **THEN** the system SHALL prevalidate the complete journal, apply one Yjs transaction, emit one unmerged update frame, and publish one canonical revision

#### Scenario: Refused local transaction

- **WHEN** validation or resource limits reject the primitive journal before the store commits
- **THEN** neither shared state nor canonical state SHALL change

#### Scenario: Local journal cannot apply to shared state

- **WHEN** `applyPrimitiveJournal` refuses a journal from a local commit
- **THEN** the session SHALL set status `error`
- **THEN** the session SHALL republish shared state over the local store
- **THEN** the replica SHALL NOT keep the unreplicated local commit

#### Scenario: Remote publication does not loop

- **WHEN** the session materializes a remote shared-state change
- **THEN** `applyRemotePackage` SHALL install one canonical revision
- **THEN** that publication SHALL NOT emit a primitive journal

#### Scenario: Authoritative remote package replaces local shell merge

- **WHEN** a remote package contains numbering edits that a local shell merge would overlay
- **THEN** `installAuthoritativePackageSnapshot` SHALL replace the local package without merging local numbering over the remote result

#### Scenario: Unexpected exception during shared application

- **WHEN** an unexpected exception occurs after the shared transaction starts
- **THEN** the session SHALL enter a fatal error state and SHALL NOT claim transaction rollback

#### Scenario: Transaction metadata crosses replicas

- **WHEN** a Yjs update reaches another replica
- **THEN** the receiver SHALL NOT treat Yjs origin, transaction metadata, awareness identity, or client-authored actor fields as authenticated attribution

#### Scenario: Remote transaction

- **WHEN** a remote Yjs update merges
- **THEN** the system SHALL validate and, when necessary, safely repair the candidate before publishing one canonical revision

### Requirement: Projection layers remain non-authoritative

The canonical materialized tree SHALL remain the only document state consumed by
editor commands, layout, paint, automation reads, and DOCX serialization.

#### Scenario: Collaborative editor rendering

- **WHEN** shared state changes
- **THEN** layout and paint SHALL consume the resulting canonical revision and SHALL NOT read mutable Yjs or ProseMirror state

#### Scenario: Headless collaborative edit

- **WHEN** a headless client authors an admitted edit
- **THEN** it SHALL use the same canonical validation and primitive-journal path as a mounted editor
