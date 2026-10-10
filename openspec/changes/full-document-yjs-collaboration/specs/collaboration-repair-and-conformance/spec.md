## ADDED Requirements

### Requirement: Safe repair is deterministic and bounded

Every automatic collaboration repair SHALL be versioned, deterministic, idempotent,
bounded, and equivalent on all replicas that observe the same shared state.

#### Scenario: Repairable invalid merge

- **WHEN** concurrent edits create a documented repairable invariant issue
- **THEN** every replica SHALL derive the same canonical repair under `ORIGIN_IDS.mutationRepair` without emitting competing shared updates

#### Scenario: Repair repeats

- **WHEN** the same repair pass observes an already repaired state
- **THEN** it SHALL produce no additional shared or canonical change

#### Scenario: Shared normalization is required

- **WHEN** repair requires changing the durable shared state rather than its canonical materialization
- **THEN** only an explicit versioned maintenance operation SHALL normalize that state idempotently

#### Scenario: Repair exceeds a resource bound

- **WHEN** a repair would exceed its element, recursion, allocation, or time budget
- **THEN** the session SHALL stop repair and quarantine the room

### Requirement: Repair preserves authored semantics

Automatic repair SHALL NOT choose between conflicting user text, invent missing
review intent, or silently discard unknown content.

#### Scenario: Unambiguous structural normalization

- **WHEN** invalid known placement can demote to a lossless generic node without dropping content
- **THEN** the repair MAY normalize the node and SHALL record an audit item

#### Scenario: Ambiguous review structure

- **WHEN** an orphan comment or revision boundary has no single semantics-preserving repair
- **THEN** the system SHALL quarantine instead of inventing or deleting review intent

### Requirement: Registry structural issues have fixed outcomes

Registry materialization SHALL report stable issue codes and SHALL never invent a
parent for unreachable content.

#### Scenario: Reachable duplicate or cycle edge

- **WHEN** a child ID repeats, appears under another reachable parent, or creates a reachable back-edge
- **THEN** materialization SHALL keep the first valid preorder occurrence and report `duplicate-child`, `duplicate-parent`, or `cycle`

#### Scenario: Content becomes unreachable

- **WHEN** a concurrent delete, move, or cycle leaves live authored content unreachable
- **THEN** materialization SHALL preserve its shared record, report `orphan-with-content` or `unreachable-cycle`, and quarantine the room

#### Scenario: Materialization exceeds depth

- **WHEN** registry traversal exceeds 64 levels
- **THEN** materialization SHALL report `depth-exceeded` and quarantine the room

### Requirement: Quarantine protects the last valid canonical revision

An unrepairable shared state SHALL never replace a replica's last valid canonical
package.

#### Scenario: Remote unrepairable update

- **WHEN** validation finds an unrepairable merged state
- **THEN** the session SHALL retain its previous canonical revision, enter a typed quarantine state, and refuse authoring and export

#### Scenario: Administrator restores room

- **WHEN** an administrator restores a valid checkpoint or performs an explicit room reset
- **THEN** the session SHALL validate the replacement before leaving quarantine

### Requirement: Repair and quarantine are auditable

The system SHALL publish structured audit facts for every repair, quarantine,
restore, migration, and destructive reset without logging document content.

Managed actor attribution SHALL come from authenticated receipts and the immutable
client-ID registry. Yjs origin, awareness identity, and document author strings SHALL
NOT serve as trusted audit identity.

#### Scenario: Automatic repair record

- **WHEN** a repair changes canonical materialization or shared state
- **THEN** the audit record SHALL include room, rule version, issue codes, origin, actor when applicable, and affected logical IDs

#### Scenario: Quarantine record

- **WHEN** a room enters quarantine
- **THEN** the audit record SHALL include bounded issue metadata and the last valid checkpoint identity

### Requirement: Actor-scoped collaborative undo

Collaborative sessions SHALL use actor-scoped shared undo for every admitted mutation
and SHALL exclude remote, repair, migration, bootstrap, checkpoint, awareness, and
projection origins.

#### Scenario: Actor undoes compound edit

- **WHEN** Alice undoes one compound edit that changed text, formatting, and structure
- **THEN** one undo action SHALL reverse Alice's transaction without removing Bob's accepted changes

#### Scenario: Repair follows actor edit

- **WHEN** Alice's edit caused a deterministic repair
- **THEN** Alice's undo SHALL NOT directly undo the repair origin or invalidate current shared structure

#### Scenario: Tracked revision content

- **WHEN** an actor undoes creation of a tracked revision
- **THEN** undo SHALL reverse that actor's shared transaction and SHALL NOT accept, reject, or alter another actor's revision

#### Scenario: Replica is rebuilt

- **WHEN** checkpoint restore, generation replacement, or NACK recovery creates a new `Y.Doc`
- **THEN** its undo stack SHALL start empty unless a future explicit local persistence capability restores it

### Requirement: Conformance proves canonical convergence

Every admitted mutation class SHALL pass a maintained, finite multi-replica schedule
corpus before it becomes supported.

#### Scenario: Delivery permutations

- **WHEN** deterministic seeded pairwise and three-replica schedules cover reversed, duplicated, delayed, disconnected, and generation-restored delivery
- **THEN** all replicas SHALL converge by canonical authored fingerprint and save/reopen semantic digest

#### Scenario: Unknown content

- **WHEN** fixtures contain unknown XML, unknown parts, and binary resources beside concurrently edited content
- **THEN** all replicas SHALL preserve the unknown content and package relationships

#### Scenario: Cross-runtime replicas

- **WHEN** browser, headless Bun/Node, peer-to-peer, and authorized server-only clients apply the supported corpus
- **THEN** they SHALL produce equivalent canonical packages and typed outcomes

### Requirement: Shared input is untrusted

The system SHALL treat every Yjs update, awareness value, checkpoint, blob, room
identifier, authentication claim, and imported DOCX as attacker-controlled input.

#### Scenario: Oversized update

- **WHEN** an update exceeds configured transport or room limits
- **THEN** the receiver SHALL reject or disconnect before unbounded canonical allocation

#### Scenario: Hostile package value

- **WHEN** merged shared values contain unsafe URLs, invalid paths, excessive depth, prototype keys, or executable embedded instructions
- **THEN** the canonical trust boundary SHALL sanitize or reject them before any layout, paint, fetch, execution, or export sink

#### Scenario: Malformed binary reference

- **WHEN** a blob digest, media type, size, or relationship is invalid
- **THEN** the system SHALL reject canonical publication and SHALL NOT fetch an unapproved external resource

### Requirement: Performance regressions block capability admission

Collaboration performance gates SHALL run against the existing large-document
fixtures and identity-sensitive layout caches. Deterministic work counters SHALL gate
pull requests. Maintained benchmark runs SHALL gate hardware-sensitive timings and
retained memory.

#### Scenario: Remote edit exceeds local ratio

- **WHEN** an admitted remote mutation exceeds its allocation, materialization, paint, or dirty-scope ratio
- **THEN** that mutation class SHALL remain experimental and unsupported

#### Scenario: No-change replay

- **WHEN** a duplicate or already-applied update produces no semantic change
- **THEN** the canonical revision, layout pages, and unaffected cache references SHALL remain unchanged
