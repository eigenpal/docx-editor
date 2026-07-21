## ADDED Requirements

### Requirement: Yjs backend stores model-shaped data
The first replicated backend SHALL use Yjs records shaped around authored parts,
stable-ID blocks, collaborative text, explicit marks and annotations, tables,
styles, numbering, relationships, and preservation capsules. It MUST NOT store a
ProseMirror XML fragment or expose PM types.

#### Scenario: Backend state is inspected
- **WHEN** a replicated document is decoded for conformance testing
- **THEN** its Yjs structures MUST correspond to canonical model records and all PM mapping MUST remain in EditorBinding

### Requirement: Replication updates and snapshots are opaque and versioned
The backend SHALL produce opaque incremental updates and full snapshots with
distinct APIs. Envelope metadata MUST identify protocol/schema version,
document/tenant key, and size before update bytes are applied.

#### Scenario: Oversized or wrong-document update arrives
- **WHEN** an update exceeds limits or names a different document identity
- **THEN** it MUST be rejected before mutation and MUST NOT be rebroadcast

### Requirement: Documents are addressable by resolvable URL
A document URL SHALL resolve through an authenticated resolver to a canonical
document identity, tenant key, endpoint capabilities, and authorization context.
Browser and server participants using that address MUST attach to the same
authoritative replicated document.

#### Scenario: URL resolution is unauthorized
- **WHEN** credentials cannot authorize access to the resolved tenant and document
- **THEN** connection MUST fail before snapshot or awareness data is disclosed

### Requirement: WebSocket and SSE plus POST transports
Synchronization SHALL define a transport-neutral channel over opaque updates and
MUST provide WebSocket and SSE+POST implementations with equivalent initial
sync, bidirectional update, status, reconnect, close, and error semantics.

#### Scenario: SSE connection posts a local update
- **WHEN** an SSE+POST client commits a local transaction
- **THEN** it MUST POST the update idempotently and receive authoritative remote updates through the stream

### Requirement: Offline replay converges without echo
An offline-enabled client SHALL persist unsent updates with document identity,
protocol version, origin, and ordering metadata. Reconnect MUST synchronize
state, replay eligible updates idempotently, and suppress echo through origins
or update identity.

#### Scenario: Two clients edit while disconnected
- **WHEN** both reconnect after independent offline edits
- **THEN** replay and normalization MUST converge on identical authored state without duplicate application

### Requirement: Awareness and presence are ephemeral
Awareness SHALL carry bounded cursor/selection anchors, participant identity, and
optional presence metadata separately from authored state. It MUST be
authenticated, authorized, rate-limited, expiring, and excluded from snapshots,
history, DOCX, and undo.

#### Scenario: Participant disconnects uncleanly
- **WHEN** an awareness lease expires without a close message
- **THEN** peers MUST remove that presence while document content remains unchanged

### Requirement: Persistence, compaction, and migrations are recoverable
The hub SHALL persist versioned snapshots, update-log positions, schema
migrations, and audit metadata. Snapshot compaction MUST be atomic, retain a
recoverable checkpoint until validation, and preserve updates arriving during
compaction.

#### Scenario: Update arrives during compaction
- **WHEN** a client update commits while a new snapshot is being built
- **THEN** recovery MUST include the update exactly once either in the snapshot or the retained log

### Requirement: Hub lifecycle supports semantic server work
The document hub SHALL open, observe, edit through `DocxEditor.*`, export DOCX
or PDF, persist, compact, migrate, and close an isolated document. Server edits
MUST emit normal model changes and replication updates to connected clients.

#### Scenario: Server job edits an open document
- **WHEN** a server request commits an authorized semantic edit
- **THEN** connected clients MUST receive and reconcile its update without a browser running on the server

### Requirement: Sync mechanics enforce isolation and security
The hub MUST authenticate before join, authorize read/write/export and update
application, isolate tenant/document state, reject malformed updates, enforce
connection/update/snapshot/rate/resource limits, record server audit metadata,
and never fetch package-declared external resources.

#### Scenario: Cross-tenant document key is supplied
- **WHEN** a valid user attempts to apply an update under another tenant's document key
- **THEN** authorization MUST fail, no state or presence MUST leak, and the attempt MUST be auditable

### Requirement: Additional backends are conformance-gated
Automerge or any backend other than Yjs MUST NOT be advertised as supported
until it passes the same semantic store, normalization, anchor, undo,
convergence, persistence, offline replay, and migration suite.

#### Scenario: Candidate backend lacks per-user undo
- **WHEN** a candidate backend passes convergence but fails collaborative per-user undo
- **THEN** it MUST remain unsupported and no compatibility claim MUST be published

### Requirement: Yjs root schema and invariants are pinned
The Yjs document MUST contain versioned root keys for metadata, ordered
part/story/block creation identities, collision-free creation-keyed record maps,
text, mark endpoints, annotations,
tables, styles, numbering, relationships, content types, capsules, and allocator
state. The specification MUST define each container type, parent ownership,
ordering representation, half-open mark endpoint affinity, schema version,
transaction origin, GC policy, tombstone policy, and decoded-state invariant.
Every record MUST retain its proposed semantic ID and actor/commit provenance.
Semantic-ID collisions MUST preserve every candidate and resolve by deterministic
actor/commit ordering and repair, never map conflict or last-writer iteration
order.

#### Scenario: Decoded Yjs fixture is inspected
- **WHEN** a fixture is decoded after concurrent ID collision and overlapping marks
- **THEN** root keys, ownership, order, endpoints, repaired IDs, and GC-visible tombstones MUST match the pinned schema

### Requirement: Transport handshake establishes a snapshot-tail barrier
The protocol MUST use resolving, authenticating, negotiating, snapshotting,
tailing, live, refreshing-auth, offline, and closed states. Negotiation SHALL
exchange protocol/schema ranges, state vector, checkpoint, resume token,
authorization expiry, and limits. Updates after the snapshot checkpoint MUST be
buffered and applied before live state.

#### Scenario: Update arrives during snapshot transfer
- **WHEN** the hub commits an update after snapshot checkpoint selection but before transfer completes
- **THEN** the update MUST appear in the tail before the participant enters live state

### Requirement: Delivery is at least once with idempotent effects
Every update MUST carry stable update, constituent-update, and commit IDs.
Receivers SHALL acknowledge stable IDs and MAY include a state vector for sync
optimization; durable queues MUST delete only explicitly acknowledged IDs.
State vectors MUST NOT prove update or delete-set coverage. Duplicate
delivery MUST be a no-op, echo MUST be suppressed, and local revisions need only
be monotonic, not identical across replicas. Convergence SHALL compare canonical
authored and anchor fingerprints; backend state vectors are diagnostic sync
evidence, not semantic equality.

#### Scenario: Acknowledgement is lost
- **WHEN** an applied update is retried because its acknowledgement was lost
- **THEN** the receiver MUST not create another semantic revision or durable effect and MUST acknowledge coverage

### Requirement: Compaction gaps and authentication refresh are recoverable
A resume token older than retained history MUST trigger a fresh snapshot-tail
barrier. Authentication refresh MUST pause outbound sends, preserve durable
queues, reauthorize awareness and document roles, and resume or close without
dropping updates.

#### Scenario: Offline participant reconnects after compaction
- **WHEN** its state vector predates the retained update log
- **THEN** the hub MUST provide a fresh snapshot barrier and then accept idempotent queued updates

### Requirement: Viewer role is explicit
Authorization MUST support a viewer role that may receive snapshots, updates,
and permitted awareness but MUST NOT submit semantic updates, exports, or
administrative operations unless separately granted.

#### Scenario: Viewer posts an update
- **WHEN** a viewer sends a syntactically valid update
- **THEN** authorization MUST reject it before backend staging and MUST NOT disconnect permitted read streaming unless policy requires it

### Requirement: Coalescing preserves update identity
Transport and persistence coalescing MUST preserve update identity. They MAY combine update payloads only when the
envelope retains constituent update IDs, state-vector metadata, commit/audit
association, and acknowledgement semantics. Defaults MUST be selected from
frozen transport baselines and recorded before the sync milestone is accepted.

#### Scenario: Coalesced update is retried
- **WHEN** a payload containing several update IDs is partially known to a receiver
- **THEN** application and acknowledgement MUST remain idempotent for every constituent ID
