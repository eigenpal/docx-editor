## ADDED Requirements

### Requirement: Semantic and replication contracts remain distinct
The spike SHALL define `DocOp`, `ModelChange`, opaque replication updates, and snapshots as four distinct contracts. `DocumentStore` and `ReplicatedStoreBackend` MUST remain free of ProseMirror types, and both local and Yjs-backed execution MUST accept the same semantic operation vocabulary.

#### Scenario: Headless operation uses no editor projection
- **WHEN** a PM-free server applies an insert-text `DocOp`
- **THEN** the store commits a `ModelChange`, the backend emits its own replication representation, and no ProseMirror or DOM value is required

### Requirement: One normalization path commits semantic state
Every mutation in the spike SHALL pass through semantic validation, canonical
model mutation, deterministic normalization, one revision commit, and one
`ModelChange` carrying before/after toy structural ranges, identity mappings,
commit ID, and mutation origin. A projection MUST NOT become authoritative
before the normalized model commit.

#### Scenario: Browser typing commits model first
- **WHEN** local typing is mapped from the browser projection
- **THEN** the resulting `DocOp` is normalized and committed to the model before the projection is treated as committed

### Requirement: Supported operations have deterministic identity semantics
The spike SHALL support insert, delete, split, join, bold, and italic semantic operations with deterministic paragraph identity and equivalent results in local and Yjs-backed stores.

#### Scenario: Replicas converge after concurrent operations
- **WHEN** two Yjs-backed replicas exchange concurrent supported operations in different delivery orders
- **THEN** both replicas converge on equivalent authored canonical state and stable identities

### Requirement: Internal annotation anchors survive concurrent edits
The spike SHALL expose one opaque citation/annotation `AnchorHandle`. Its private
record MAY use story/block identity, backend-relative text position, and
affinity. Trusted snapshot and awareness serialization MUST use a versioned
document/checkpoint-bound envelope. Insertion at an endpoint MUST follow
affinity; full-range deletion MUST collapse/detach; split/join MUST remap by
addressed text; and an anchor MUST NOT attach to unrelated text.

#### Scenario: Concurrent insertion follows affinity
- **WHEN** a replica inserts text exactly at an annotation endpoint while another replica retains the annotation
- **THEN** the merged endpoint resolves before or after the insertion according to its recorded affinity

#### Scenario: Concurrent deletion detaches a consumed range
- **WHEN** a concurrent deletion consumes the full annotated range
- **THEN** both endpoints collapse to the deletion boundary and the annotation is marked detached without attaching to other text

#### Scenario: Concurrent split and join remap endpoints
- **WHEN** concurrent edits split the anchored paragraph and later join the resulting paragraphs
- **THEN** each endpoint follows its addressed text into the split tail when applicable and resolves in the surviving joined block at the equivalent boundary

### Requirement: Origin and awareness metadata are explicit
Committed changes SHALL use `MutationOrigin` for human, agent, remote, undo,
redo, and repair. Binding reconciliation SHALL use `ProjectionOrigin` and MUST
NOT be committed. Awareness SHALL use `AwarenessOrigin`, remain ephemeral, and
MUST NOT enter authored state, history, audit operations, updates, or snapshots.

#### Scenario: Origin domains remain distinguishable
- **WHEN** mutations, binding reconciliation, and awareness updates occur
- **THEN** each domain is distinguishable and only mutation origins appear in `ModelChange`

#### Scenario: Awareness remains outside authored state
- **WHEN** awareness metadata is updated and the document is snapshotted or exported
- **THEN** the metadata is observable through the awareness channel but absent from authored state, snapshots, and exported OOXML

### Requirement: Replication coordinator is atomic and idempotent
The spike MUST stage local canonical and Yjs mutations in one coordinator
transition, normalize once, commit both or neither, assign commit/update IDs and
one monotonic local revision, emit one `ModelChange`, and suppress echoes.
Remote updates MUST authenticate and deduplicate by stable update/constituent IDs,
stage merge, normalize/repair inside the same Yjs transaction, publish once, and
propagate repair once. State vectors MAY optimize sync but MUST NOT prove update
or delete-set coverage. Only the coordinator MAY derive/publish canonical state
or emit `ModelChange`; the backend MUST NOT do either directly.

#### Scenario: Duplicate remote update follows repair
- **WHEN** one remote update requires repair and both original and repair bytes are redelivered
- **THEN** authored fingerprint, state vector, local revision count, and notification count MUST remain unchanged after first coverage

### Requirement: Transaction context is synchronous
The spike store MUST pass an explicit synchronous transaction context. Async
callbacks, nesting, and reentry MUST fail; exceptions MUST roll back canonical
and Yjs stages and emit no revision, history, notification, or update.

#### Scenario: Nested transaction is attempted
- **WHEN** a transaction callback opens another transaction
- **THEN** the outer transaction MUST abort with a typed error and both stores MUST remain unchanged

### Requirement: Toy Yjs schema is exact
The root MUST contain versioned `meta`, `storyOrder`, `stories`, `blocks`,
`texts`, `marks`, `capsules`, and `allocator` keys using the container and
ownership rules in the design. Marks MUST use half-open relative endpoints and
affinity; GC MUST be disabled. Records MUST be keyed by collision-free creation
identity and retain proposed semantic ID and actor/commit provenance; every
collision candidate MUST remain observable until actor/commit-ordered repair.

#### Scenario: Schema fingerprint is computed
- **WHEN** two replicas converge after a mark edit and ID collision
- **THEN** decoded root/container types, order, ownership, endpoints, repaired IDs, tombstones, and canonical fingerprint MUST match

### Requirement: Spike snapshot restores proof state
The durable spike snapshot MUST contain schema/normalization version, document
ID, authored/Yjs state, ID allocator, local revision, state vector/checkpoint,
opaque anchor envelopes, update coverage, actor/session/group history, redo
eligibility, and origin-safe audit cursor. Restore MUST publish only after every
component validates.

#### Scenario: Snapshot reopens after undo
- **WHEN** the spike snapshots after an undo and remote interleaving
- **THEN** authored fingerprint, anchors, IDs, applied stable update/constituent IDs, state-vector metadata, and eligible redo behavior MUST match before close

### Requirement: Audit proof separates index from replay
The harness MUST append a redacted audit index and a distinct access-controlled,
encrypted replay journal containing complete versioned `DocOp` payloads for each
successful commit. It SHALL use independently declared finite retention and
authorization policies and MUST keep projection/awareness events and raw text
out of the redacted index.

#### Scenario: Authorized replay is requested
- **WHEN** an authorized test replays a committed sequence
- **THEN** it MUST use journal payloads while an audit-index-only reader cannot recover document text
