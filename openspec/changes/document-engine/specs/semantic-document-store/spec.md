## ADDED Requirements

### Requirement: Four distinct state contracts
The engine MUST define `DocOp` as semantic mutation, `ModelChange` as committed
notification, replication update as opaque incremental backend bytes, and
snapshot as full encoded backend state. No contract SHALL be represented or
documented as another contract's wire format.

#### Scenario: Remote update is applied
- **WHEN** a backend accepts an opaque remote update
- **THEN** it MUST mutate only staged backend state; the coordinator MUST derive and normalize canonical state, commit both states, and emit `ModelChange` without originating `DocOp`s

### Requirement: Semantic and PM-free DocumentStore
`DocumentStore` SHALL expose current authored model state, semantic apply and
transaction methods, model-change subscription, history, and anchor operations.
It MUST contain no ProseMirror, DOM, transport, or CRDT-specific public type.

#### Scenario: Headless mutation
- **WHEN** a server applies a `DocOp` with no editor or DOM installed
- **THEN** the store MUST commit the same semantic state and notification as a browser store

### Requirement: Atomic multi-part transactions
Every command that changes one or more stories or package parts MUST validate,
normalize, and commit atomically as one revision and one history group.
Subscribers SHALL observe either the complete result or no result.

#### Scenario: Cross-part command fails validation
- **WHEN** image insertion creates a story node but its relationship fails validation
- **THEN** the transaction MUST roll back every body, media, relationship, and content-type mutation

### Requirement: Deterministic validation and normalization
All local semantic writes MUST pass through command validation, apply, repair,
and normalization. Remote envelopes MUST pass transport authorization and
integrity checks, then merged state MUST pass the same deterministic structural
repair and normalization path without reconstructing absent intent.
Canonical authored fingerprints MUST match for the same converged input.

#### Scenario: Concurrent structural conflict
- **WHEN** replicas merge a row deletion with an edit to a cell in that row
- **THEN** the declared deterministic repair rule MUST produce the same valid state and IDs on every replica

### Requirement: ModelChange describes dependency effects
A committed `ModelChange` SHALL include before/after revision, origin, directly
dirty identities, structural effects, and changed dependency keys sufficient for
binding reconciliation, cache invalidation, and pagination restart. It MUST NOT
promise that only directly dirty blocks require work.

#### Scenario: Style edit changes many dependents
- **WHEN** a shared style used by paragraphs in several sections changes
- **THEN** the notification MUST identify the style dependency so invalidation can include every affected paragraph and flow

### Requirement: JSON-safe external target resolution
External targets SHALL use `paraId` plus an optional unique phrase or explicit
location discriminator and SHALL carry no live or backend-specific handle.
Missing or ambiguous targets MUST fail without mutation. `paragraphIndex` MUST
NOT be canonical.

#### Scenario: Phrase is ambiguous
- **WHEN** the supplied phrase occurs more than once in the addressed paragraph and no discriminator makes it unique
- **THEN** resolution MUST return `ambiguous` and the transaction MUST remain unmodified

#### Scenario: Target crosses RPC
- **WHEN** an external target is JSON serialized and resolved against the same revision in another process
- **THEN** it MUST resolve to the same semantic location or the same typed failure

### Requirement: Internal anchors survive edits
The store SHALL resolve external targets into opaque engine-owned
`AnchorHandle`s. Private anchor records MAY contain story and block identity,
backend-relative text position, and affinity. Split, join, move, delete, undo,
and concurrent edit semantics MUST be shared by selections, annotations,
awareness, and display items without exposing backend bytes.
The Yjs backend SHALL represent its private edit-surviving text positions with
`Y.RelativePosition`; other backends SHALL satisfy the same observable anchor
contract without exposing or emulating Yjs wire types publicly.

#### Scenario: Insertion at an anchor
- **WHEN** concurrent text is inserted exactly at an internal anchor
- **THEN** the anchor MUST remain before or after the insertion according to its affinity

#### Scenario: Anchored content is deleted
- **WHEN** the entire anchored range is deleted
- **THEN** resolution MUST apply the declared collapse, detach, or tombstone rule and MUST NOT attach to unrelated text

### Requirement: History and undo are behaviorally consistent
Solo and collaborative stores SHALL expose equivalent undo grouping, redo, ID
restoration, and origin reporting. Collaborative undo MUST affect only eligible
changes authored by the current user. As fixed by
`../../spike-architecture-decision.md`, the Yjs backend MUST use an
actor/session-scoped `Y.UndoManager` over eligible tracked local origins,
composed with semantic validation, normalization, grouping, identity behavior,
and notifications. Hand-authored inverse `DocOp` history MUST NOT implement
collaborative transformation.

#### Scenario: Per-user collaborative undo
- **WHEN** two users edit and the first user invokes undo
- **THEN** only the first user's latest eligible history group MUST be reverted and both replicas MUST converge

### Requirement: Versioned persistence and schema evolution
Snapshots and persisted update logs SHALL include schema version, document
identity, revision/checkpoint metadata, and applied migrations. Migrations MUST
be deterministic, resumable, validated before publication, and recoverable from
the prior checkpoint.

#### Scenario: Migration is interrupted
- **WHEN** a process stops after writing a candidate migrated snapshot but before validation and publication
- **THEN** reopening MUST use or resume from a valid checkpoint and MUST NOT expose partially migrated state

### Requirement: The canonical store is the sole authority; a backend never mutates it directly
The authored `DocumentStore` model is canonical. A replication backend MUST NOT
mutate canonical state or emit `ModelChange` directly; canonical state changes
ONLY through the store's own entries — `transact`, `applyEdits`, `undo`/`redo`,
and `publishDerived(model, origin)`. A remote merge that has already converged in
the backend is published as ONE atomic revision via `publishDerived`, which emits
one `ModelChange` and one monotonic revision. Local commits and remote merges
share the same normalize-once, one-commit-ID, one-revision, one-`ModelChange`
guarantee. This requirement is transport- and CRDT-neutral: it holds whether
there is no backend, a local backend, or an external Yjs document.

> Supersedes the former "sole `ReplicationCoordinator`" state machine (see ADR-S10).
> There is no public coordinator; the Yjs boundary is an optional `YjsBinding`
> (see the addressable-document-sync capability).

#### Scenario: Remote merge publishes atomically
- **WHEN** a backend has merged a remote change and the derived model is published through `publishDerived`
- **THEN** exactly one revision, one `ModelChange`, and one history entry MUST result, and observers MUST never read intermediate staged state

#### Scenario: A backend attempts to notify canonical subscribers directly
- **WHEN** any replication backend tries to mutate canonical state or emit a `ModelChange` without going through a store entry
- **THEN** that path MUST NOT exist in the public surface; only store entries change canonical state

### Requirement: Remote validation distinguishes intent from structure
Local commands MUST pass schema, authorization, lock, revision, target, and
precondition validation before mutation. Merged remote state MUST pass
deterministic structural validation and repair before it is published as a
derived revision. The engine MUST NOT claim to reconstruct remote command intent
that is absent from opaque backend updates. Envelope-level authentication,
authorization, size, and identity checks are the concern of whichever transport
carries the updates (an optional binding/provider), not of the canonical store.

#### Scenario: Remote merge is unrecoverably invalid
- **WHEN** merged backend state violates a non-repairable canonical invariant
- **THEN** publication MUST be rejected, prior canonical state retained, and malformed-update evidence reported

### Requirement: Transactions use an explicit synchronous context
`DocumentStore.transact(origin, callback)` SHALL pass a synchronous
`TransactionContext` whose `apply` method only stages operations. Async
callbacks, nesting, and reentrant commit MUST be rejected. Commit SHALL return
commit ID, revision, positional results, and one `ModelChange`; exceptions or
any failed stage MUST roll back without notifying subscribers.

#### Scenario: Transaction callback throws
- **WHEN** the callback throws after staging several operations
- **THEN** all stages MUST be discarded and subscribers MUST observe nothing

### Requirement: Public batches are all or nothing
`DocxEditor.applyEdits` and one `DocxEditor.RequestContext.sync()` MUST
schema-validate every queued write and topologically resolve transaction-local
symbolic IDs against staged creations before invoking commit handlers. Any
failure SHALL abort all writes. Results SHALL remain positionally aligned:
failing items carry their errors and otherwise-valid items carry `aborted` with
the failing indices. An aborted batch MUST emit no revision, history group,
`ModelChange`, replay-journal entry, update, or candidate post-write value.
Requested loads MUST still materialize from the explicitly identified unchanged
reconciled revision.
Application, validation, conflict, authorization, and resource failures MUST
return common result envelopes. Only transport/protocol failure preventing
receipt or validation of a valid envelope MUST throw a typed exception.

#### Scenario: Middle edit fails
- **WHEN** the third edit in a five-edit batch is invalid
- **THEN** all five results MUST be returned positionally, edits one, two, four, and five MUST be `aborted`, and authored state MUST be unchanged

### Requirement: ModelChange supports reverse reconciliation
`ModelChange` MUST carry before/after revisions, mutation origin, dirty and
deleted identities, moves, split/join mappings, before/after structural
descriptors and anchored ranges, dependency keys, commit ID, and normalization
effects, or reference a binding revision index retaining equivalent data until
all bound projections acknowledge it.

#### Scenario: Deleted block reconciles
- **WHEN** a commit deletes a projected block
- **THEN** the binding MUST be able to recover its old projected range and new deletion boundary without diffing the whole document

### Requirement: Anchor handles are opaque and trusted envelopes are versioned
Public APIs SHALL expose opaque `AnchorHandle` values, not backend-relative
positions. Trusted backend, awareness, and persistence channels MAY serialize a
versioned, authenticated envelope bound to document ID, backend kind, schema,
checkpoint, affinity, and opaque bytes. Public external targets MUST remain
backend-free and JSON-safe.

#### Scenario: Anchor envelope belongs to another document
- **WHEN** restore receives a valid envelope bound to another document
- **THEN** it MUST return `invalidAnchor` and MUST NOT resolve to any local content

### Requirement: Origin domains are separate
`MutationOrigin`, `ProjectionOrigin`, and `AwarenessOrigin` MUST be distinct
types. Only mutation origins MAY enter `ModelChange`, semantic history, audit
operations, snapshots, and replication. Projection reconciliation and awareness
MUST NOT create semantic commits.

#### Scenario: Projection reconciliation occurs
- **WHEN** a canonical change is applied to a bound view
- **THEN** the projection origin MUST be observable to the binding but absent from store history, audit, snapshot, and replication

### Requirement: Undo and redo have executable identity rules
History MUST record actor ID, session ID, group ID, commit ID, eligible origin,
inverse operations, identity tombstones, and repair ownership. Sync and explicit
group IDs delimit groups; one IME commit is one group. New eligible local work
MUST clear that actor's redo stack, while remote work MUST NOT. Undo/redo MUST
restore identities and converge across remote interleaving. Durable editing
snapshots MUST preserve history and redo eligibility; export snapshots MUST
declare history omission.

#### Scenario: Undo survives restore
- **WHEN** a durable editing snapshot is restored after grouped local and remote edits
- **THEN** the same actor MUST be able to undo and redo the same eligible groups with identical restored IDs

### Requirement: Audit index and replay journal are distinct
Each successful semantic commit SHALL append a redacted audit index containing
commit ID, actor/session, mutation origin, operation IDs, base/result revisions,
timestamp-port value, and redacted result metadata. A separate access-controlled,
encrypted replay journal MUST contain complete versioned `DocOp` payloads,
normalization version, and commit ordering sufficient for authorized replay.
Projection and awareness events MUST be excluded from both. Audit-index and
replay-journal retention MUST be independently configurable with finite defaults,
tenant isolation, authorization, key rotation, deletion/legal-hold hooks, and
tamper evidence. Raw document text MUST never enter the redacted index.

#### Scenario: Failed batch is audited
- **WHEN** a batch fails before mutation
- **THEN** a redacted failure event MAY be recorded, but no semantic commit record or revision MUST be appended

### Requirement: Snapshot payload and restore invariants are explicit
A durable snapshot MUST contain schema and normalization versions, document and
package identity, model-shaped state sufficient to reproduce authored state,
stable-ID allocator state, local revision, backend state vector and checkpoint,
anchor encoding version, applied migrations, update-log cursor, audit cursor,
and declared history/redo payload. Restore MUST validate all components before
atomic publication and preserve authored-state, identity, anchor, and history
comparators.

#### Scenario: Snapshot normalization version is unsupported
- **WHEN** restore cannot migrate the snapshot normalization version
- **THEN** restore MUST fail before publication and retain the prior checkpoint
