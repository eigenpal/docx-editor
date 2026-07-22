## ADDED Requirements

### Requirement: Semantic and replication contracts remain distinct
The spike SHALL define `DocOp`, `ModelChange`, opaque replication updates, and snapshots as four distinct contracts. `DocumentStore` and `ReplicatedStoreBackend` MUST remain free of ProseMirror types, and both local and Yjs-backed execution MUST accept the same semantic operation vocabulary.

#### Scenario: Headless operation uses no editor projection
- **WHEN** a PM-free server applies an insert-text `DocOp`
- **THEN** the store commits a `ModelChange`, the backend emits its own replication representation, and no ProseMirror or DOM value is required

### Requirement: One normalization path commits semantic state
Every mutation in the spike SHALL pass through semantic validation, canonical
model mutation, deterministic normalization (v2: projection from sequence +
the task 2.4 winner's `FormattingEvidence` plus monotonic repair evidence,
without destructive rewrite of actor-authored containers), one revision commit, and one
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
record MUST use start/end public-API-encoded `Y.RelativePosition` envelopes
bound to envelope version, document ID, schema/backend version, checkpoint,
story-sequence creation ID, assoc, and affinity. Each plain-JSON envelope MUST
store canonical bounded `relativePositionBase64Url: string`, never
`Uint8Array`; bytes MAY exist only ephemerally after the design's bounded
character/length/canonical-reencode validation succeeds. Paragraph-local UTF-16
offsets MAY enter the API but MUST resolve to envelopes during commit preflight
and MUST NOT persist. Wrong-document/version/sequence, malformed,
unknown-lineage, or initially unresolvable endpoints MUST reject atomically. An
existing endpoint made unresolvable by deletion MUST detach at a proved deletion
boundary or resolve detached/null; it MUST NOT attach to unrelated text.

#### Scenario: Concurrent insertion follows affinity
- **WHEN** a replica inserts text exactly at an annotation endpoint while another replica retains the annotation
- **THEN** the merged endpoint resolves before or after the insertion according to its recorded affinity

#### Scenario: Concurrent deletion detaches a consumed range
- **WHEN** a concurrent deletion consumes the full annotated range
- **THEN** both endpoints collapse to the deletion boundary and the annotation is marked detached without attaching to other text

#### Scenario: Concurrent split and join remap endpoints
- **WHEN** concurrent edits split the anchored paragraph and later join the resulting paragraphs
- **THEN** each relative endpoint follows its addressed sequence item and projection resolves it in the correct split or joined paragraph without rewriting the envelope

#### Scenario: Endpoint belongs to another document
- **WHEN** an annotation or winner-defined range operation supplies an envelope bound to another document or story sequence
- **THEN** preflight rejects the whole transaction with no canonical, Yjs, history, repair, audit, or notification effect

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

### Requirement: Toy Yjs schema v2 is exact
The spike MUST use the v2 sequence + bake-off-winner schema in
`yjs-schema-v2-design.md`. The root SHALL contain versioned `meta`, `storyOrder`,
`stories` (each with one bootstrap `bodySequence: Y.Text`), `capsules`,
`allocator`, and `audit`, plus only the winner-owned formatting evidence root
frozen by task 2.5. Paragraph boundaries MUST be immutable
length-1 plain JSON values inserted with `Y.Text.insertEmbed`, never
`Y.XmlElement` or another nested `Y.AbstractType`; split inserts one embed, join
removes one, and neither creates or deletes a `Y.Text`. Absolute sequence
mapping MUST count an embed as one while paragraph-local UTF-16 mapping MUST
exclude embeds.

Formatting MUST use the reviewed task 2.4 KISS winner, `mark-contributions`,
and expose only the representation-neutral
`FormattingEvidence` contract to semantic projection. Evidence MUST preserve
stable creation identity, semantic mark IDs, actor/commit provenance, authored
omission/raw intent, and half-open boundary-clipped resolved segments. The task
2.5 contract MUST freeze only the winner's closed storage topology and
deterministic evidence/normalized-ID derivation; no loser root or comparator may
remain. The abandoned `experiments/yjs-formatting-bakeoff/oracle/**` corpus is
unexecuted historical work and MUST NOT be consumed.

Concurrent boundary collisions MUST retain every boundary in converged sequence
order, project adjacent boundaries as zero-text paragraphs, and resolve proposed
ID collisions by lexicographic `(actorId, commitId, creationId)` precedence.
Repair evidence MUST use a deterministic version/kind/proposal/involved-ID key,
allow only absent-key insert or identical idempotent replay, and MUST NOT
update/delete evidence, embeds, winner-owned formatting history, or actor text. GC MUST be
disabled. The v1 nested `blocks`/`texts`/`marks` schema is rejected historical
evidence only.

#### Scenario: Schema comparison is implemented
- **WHEN** two replicas converge after concurrent boundary and formatting edits
- **THEN** the task 2.7 tests directly compare decoded sequence order, winner `FormattingEvidence`, repair evidence, and canonical authored state using the frozen comparator input schemas

#### Scenario: v1 nested schema is not authoritative
- **WHEN** implementation work begins after the v2 design approval
- **THEN** `yjs-schema.v2.json` and v2 history/binding oracles MUST be frozen before backend or undo code ships

### Requirement: Reviewed formatting selection is fixed
The spike SHALL treat the reviewed task 2.4 KISS experiment as authoritative
and use `mark-contributions` as the v2 representation. Historical unexecuted
oracle corpora MUST NOT supersede or supplement that result.

#### Scenario: Winner contract is frozen
- **WHEN** task 2.5 records the v2 storage contract
- **THEN** it contains only `mark-contributions` fields and rules, while implementation tasks own direct executable behavioral assertions

### Requirement: V2 trust limits are closed and atomic
The spike MUST preflight a staging document before any local transaction, remote
update, snapshot restore, or journal replay mutates live state. Preflight SHALL
enforce these ceilings: 64 reconstruction-journal events; 48-event retained horizon; 32 undo
and 32 redo entries per actor session; 16 actor sessions; 256 KiB update; 4 MiB
genesis payload; 4 MiB aggregate replay bytes; 8 MiB snapshot; 256 KiB
`bodySequence` UTF-16 units; 4096 boundaries; 8192 formatting-evidence source
records; 256 causal-disable targets where the winner uses them; 4096
repair-evidence records; 4 KiB canonical embed payload; and
validation nesting 4. Any malformed input or single/aggregate breach MUST reject
the whole operation with no live Yjs/canonical commit, revision, repair,
journal/history/audit change, notification, or emitted update.

#### Scenario: Aggregate replay exceeds its ceiling
- **WHEN** individually valid replay records exceed 4 MiB in aggregate
- **THEN** preflight rejects the replay before any live state or history stack changes

### Requirement: Spike snapshot restores proof state
The durable spike snapshot MUST contain schema/normalization version, document
ID, authored/Yjs state, ID allocator, local revision, state vector/checkpoint,
opaque anchor envelopes, update coverage, actor/session/group history, redo
eligibility, reconstruction-journal limits/horizon, and origin-safe audit
cursor. Restore MUST publish only after every component and aggregate limit
validates.

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
