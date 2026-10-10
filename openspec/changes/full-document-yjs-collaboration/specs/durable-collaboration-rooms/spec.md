## ADDED Requirements

### Requirement: Room state is durable independently from connected clients

A persistent room SHALL retain its shared document, metadata, blob references,
authorization metadata, and last valid checkpoint when no client is connected.

#### Scenario: Last client disconnects

- **WHEN** the final client leaves a persistent room
- **THEN** the room SHALL remain joinable according to the host retention policy

#### Scenario: Server restarts with durable storage

- **WHEN** a server restarts and its storage adapter contains a committed room checkpoint and later updates
- **THEN** the server SHALL reconstruct the same `roomGenerationId`, apply later updates in order, and validate before accepting writers

### Requirement: Room schemas are explicit and versioned

Every room SHALL declare protocol, shared-schema, repair, and canonical-model
versions plus an immutable `roomGenerationId` before a client attaches a canonical
editor.

#### Scenario: Supported room version

- **WHEN** client and room versions are compatible
- **THEN** the client SHALL validate the room and attach one canonical replica

#### Scenario: Unsupported major version

- **WHEN** a client cannot interpret the room's major schema or repair version
- **THEN** the client SHALL refuse attachment without changing shared or canonical state

### Requirement: Schema migration is checkpointed and recoverable

A stable room migration SHALL be deterministic, administrative, exclusive of active
writers, and create a replacement room generation.

#### Scenario: Successful migration

- **WHEN** an administrator migrates a compatible room under a maintenance lock
- **THEN** the system SHALL retain the old generation, build and validate a new generation, and atomically activate it

#### Scenario: Failed migration

- **WHEN** migration or post-migration validation fails
- **THEN** the host SHALL retain the active generation unchanged and discard the failed candidate generation

#### Scenario: Experimental schema changes

- **WHEN** an experimental milestone introduces an incompatible schema
- **THEN** the system MAY require a new room or explicit destructive reset and SHALL NOT claim stable migration

### Requirement: Transient offline edits converge

The first production offline guarantee SHALL cover a running client that loses
transport temporarily and reconnects to the same compatible room.

#### Scenario: Client reconnects

- **WHEN** a running client authors admitted edits while disconnected and later reconnects
- **THEN** a managed client SHALL submit one ordered unmerged frame per local transaction and stop at the first NACK

#### Scenario: Offline frames were merged

- **WHEN** a provider delivers several transactions as one merged update
- **THEN** the receiver SHALL treat it as one batch and SHALL NOT claim to reconstruct original transaction boundaries

#### Scenario: Client process closes

- **WHEN** an offline client closes or refreshes without an enabled durable local persistence adapter
- **THEN** the product SHALL NOT claim that unsent edits survive the process lifetime

### Requirement: Checkpoints preserve valid recoverable state

The room host SHALL create bounded checkpoints that include shared state, schema
versions, required blob references, and the identity of the last valid canonical
projection and room generation.

#### Scenario: Checkpoint creation

- **WHEN** configured update, time, or administrative thresholds are reached
- **THEN** the host SHALL persist a validated checkpoint without disconnecting readers

#### Scenario: Checkpoint restores a new process

- **WHEN** a new replica loads checkpoint state
- **THEN** it SHALL restore document structs and client IDs but SHALL start with no transaction origins, receipt boundaries, or undo stack

#### Scenario: Checkpoint restore

- **WHEN** an administrator restores a checkpoint under a writer maintenance lock
- **THEN** the host SHALL validate a new generation from checkpoint state only, atomically activate it, retain the old generation, and disconnect old sessions

#### Scenario: Missing checkpoint blob

- **WHEN** a checkpoint references an unavailable required blob
- **THEN** restore SHALL fail without replacing the current valid room

#### Scenario: Restore candidate is invalid

- **WHEN** restore, reset, migration, or compaction candidate validation fails
- **THEN** the host SHALL destroy the candidate and leave the active generation unchanged

#### Scenario: Administrator rolls back

- **WHEN** an administrator rolls back to a valid retained generation under a maintenance lock
- **THEN** the host SHALL atomically switch the active pointer without merging Yjs updates between generations

#### Scenario: In-place restore is attempted

- **WHEN** an administrator requests restore, destructive reset, representation migration, or compaction
- **THEN** the host SHALL create a new `Y.Doc` and SHALL NOT apply an old checkpoint onto the active `Y.Doc`

### Requirement: Retention and deletion are host-controlled

Room and blob retention SHALL use explicit host policy, and destructive deletion SHALL
require administrative authorization.

#### Scenario: Room reaches retention limit

- **WHEN** a room meets configured expiration conditions
- **THEN** the host SHALL checkpoint or delete it according to policy and record the action

#### Scenario: Shared blob remains referenced

- **WHEN** another retained room or checkpoint references a content-addressed blob
- **THEN** room deletion SHALL NOT remove that blob

#### Scenario: Administrator deletes room

- **WHEN** an authorized administrator deletes a room
- **THEN** the host SHALL reject new joins and remove eligible state according to retention and audit policy

### Requirement: DOCX is an import and export snapshot

The durable collaboration artifact SHALL be versioned room state, not a repeatedly
round-tripped DOCX file.

#### Scenario: Room exports DOCX

- **WHEN** an authorized participant exports a valid room
- **THEN** the system SHALL serialize the latest valid canonical projection without discarding room history

#### Scenario: Externally edited DOCX returns

- **WHEN** a DOCX exported from a room is edited outside the room and uploaded
- **THEN** the default flow SHALL create a new room instead of merging it into live history

#### Scenario: Administrator replaces room

- **WHEN** an administrator explicitly resets a room from DOCX
- **THEN** the system SHALL lock writers, durably retain the old generation, validate the DOCX into a new generation, atomically activate it, disconnect old sessions, and record a destructive reset

### Requirement: Old generations cannot write

Every connection SHALL identify the active `roomGenerationId`. Each received update
SHALL remain bound to that connection generation in persistence and audit records.

#### Scenario: Old client submits after generation replacement

- **WHEN** a client submits an update for a non-active generation
- **THEN** the host SHALL reject it, disconnect that replica, and require a clean join to the active generation

#### Scenario: Disconnected client submits again

- **WHEN** a generation switch has disconnected a bound session
- **THEN** later submissions SHALL return `disconnected` until the client completes a clean join
