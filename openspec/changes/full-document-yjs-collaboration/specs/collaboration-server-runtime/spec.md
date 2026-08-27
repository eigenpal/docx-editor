## ADDED Requirements

### Requirement: Server runtime is optional and deployable

The project SHALL provide an optional collaboration server module that consumers can
run on Node 22 or later and Bun 1.3 or later without making the editor depend on a
docx-editor-operated service.

#### Scenario: Bun host starts server

- **WHEN** a consumer supplies room configuration, storage, and authorization to the Bun example
- **THEN** the host SHALL accept compatible collaboration clients and persist rooms

#### Scenario: Node host starts server

- **WHEN** a consumer supplies equivalent configuration to the Node example
- **THEN** the host SHALL provide the same room protocol and canonical outcomes

#### Scenario: Consumer uses another provider

- **WHEN** a consumer supplies a compatible hosted or self-managed Yjs provider instead
- **THEN** the core editor and provider-neutral collaboration attachment SHALL remain usable without the server module

### Requirement: Server is a durable peer, not the sole edit authority

Clients SHALL apply valid local Yjs transactions immediately and SHALL converge
through the server without waiting for a per-keystroke canonical server commit.
Authorized server rooms SHALL disable direct peer document synchronization.

#### Scenario: Connected edit

- **WHEN** an authorized editor authors a valid local transaction
- **THEN** the client SHALL publish locally before network round-trip and SHALL synchronize the update to the server

#### Scenario: Temporary network loss

- **WHEN** an authorized running client disconnects
- **THEN** it MAY continue admitted edits within configured bounds and SHALL send ordered unmerged frames after reconnect

#### Scenario: Read-only client

- **WHEN** a client has only the `read` role
- **THEN** the server SHALL reject its authored updates even if the local client attempted to create them

#### Scenario: Client update is rejected

- **WHEN** authorization or semantic validation rejects an update
- **THEN** the client SHALL discard that replica, rejoin the active generation, and replan remaining journals instead of replaying dependent Yjs bytes

### Requirement: Room authorization uses defined roles

The server SHALL expose room-level `read`, `edit`, and `admin` roles through
consumer-supplied authentication and authorization callbacks.

#### Scenario: Reader joins

- **WHEN** an authenticated principal receives `read`
- **THEN** the principal SHALL receive allowed room state and SHALL NOT publish document updates or administrative actions

#### Scenario: Editor joins

- **WHEN** an authenticated principal receives `edit`
- **THEN** the principal SHALL read and publish bounded document updates but SHALL NOT reset, migrate, restore, or delete the room

#### Scenario: Administrator acts

- **WHEN** an authenticated principal receives `admin`
- **THEN** the principal MAY perform configured checkpoint, migration, restore, retention, reset, and deletion actions

#### Scenario: Authorization fails

- **WHEN** authentication or room authorization rejects a request
- **THEN** the server SHALL reveal no room state, blob, presence, or document metadata

#### Scenario: WebSocket authenticates

- **WHEN** a client requests an HTTP upgrade
- **THEN** consumer callbacks SHALL authenticate bounded request metadata before any room state or sync message is sent

#### Scenario: Authorized room attempts peer synchronization

- **WHEN** a client connects to a server-authorized room
- **THEN** the client SHALL use the server as its only document-update path

### Requirement: Server transport has an explicit compatibility target

The server SHALL implement documented `y-websocket` sync and awareness framing.
Administrative, generation, blob, and audit operations SHALL use versioned extension
messages.

#### Scenario: Standard provider connects

- **WHEN** a compatible client uses a room mode that does not claim trusted managed receipts
- **THEN** the server SHALL synchronize the active generation without editor API changes

### Requirement: Managed updates have authenticated receipts

Authorized server rooms SHALL use one unmerged frame per local transaction through
the managed client extension.

#### Scenario: Client ID first appears

- **WHEN** an authenticated session submits new structs from an unregistered Yjs client ID
- **THEN** the server SHALL bind that client ID immutably to the connection principal

#### Scenario: Frame contains another client ID

- **WHEN** `parseUpdateMeta` reports new structs from a client ID not bound to the session
- **THEN** the server SHALL reject the frame as impersonation and SHALL NOT apply or forward it

#### Scenario: Delete-only frame arrives

- **WHEN** a frame contains no new struct range
- **THEN** attribution SHALL come from the authenticated connection receipt rather than the deleted struct IDs

#### Scenario: Frame is accepted

- **WHEN** isolated candidate validation succeeds
- **THEN** the server SHALL persist the frame and a bounded principal, client ID, sequence, digest, time, generation, and outcome receipt before broadcast

### Requirement: Server storage is pluggable

The server module SHALL include memory and single-instance file adapters and SHALL
define a production storage interface for room updates, checkpoints, metadata, audit
records, and content-addressed blobs.

#### Scenario: Memory adapter

- **WHEN** a developer starts the server with memory storage
- **THEN** rooms SHALL survive zero connected clients but SHALL be documented as lost on process exit

#### Scenario: File adapter

- **WHEN** a consumer starts one server process with file storage
- **THEN** rooms SHALL survive process restart and the adapter SHALL reject unsafe paths and unsupported concurrent writers

#### Scenario: Production adapter

- **WHEN** a consumer implements the production interface
- **THEN** the server SHALL not assume a specific database, object store, or deployment platform

#### Scenario: Multi-instance deployment uses file adapter

- **WHEN** more than one server instance attempts to use the single-instance file adapter
- **THEN** startup or room acquisition SHALL fail clearly instead of risking split-brain persistence

#### Scenario: File adapter commits state

- **WHEN** the file adapter commits room or checkpoint state
- **THEN** it SHALL use an exclusive store lock and temporary-file plus atomic-rename publication

#### Scenario: Production storage activates a generation

- **WHEN** a validated replacement generation becomes active
- **THEN** production storage SHALL use atomic compare and swap under a maintenance lock

### Requirement: Server enforces resource and protocol limits

The server SHALL enforce configurable bounded limits before or during update,
awareness, room, checkpoint, and blob processing.

Defaults SHALL limit one update to 1 MiB, awareness to 16 KiB, one blob to 32 MiB,
room state to 64 MiB, connections to 32 per room, and updates to 50 per second per
connection. Hosts MAY configure lower finite limits.

#### Scenario: Client exceeds update rate

- **WHEN** a client exceeds configured update or awareness rate limits
- **THEN** the server SHALL throttle or disconnect it and SHALL record bounded audit metadata

#### Scenario: Room exceeds budget

- **WHEN** an update would exceed room state, element, depth, text, client, or blob-reference limits
- **THEN** the server SHALL reject or quarantine according to the validated protocol path

#### Scenario: Blob exceeds policy

- **WHEN** uploaded binary bytes exceed configured size or media policy
- **THEN** the server SHALL reject the blob before making its digest available to room state

#### Scenario: Blob reference is published

- **WHEN** a client adds a binary resource
- **THEN** it SHALL durably upload and verify the digest, size, canonical media type, and lease before committing the digest reference

#### Scenario: Blob reference is removed

- **WHEN** active room state no longer references a blob
- **THEN** storage SHALL retain it while any lease, pending persist, active or retained generation, checkpoint, offline frame, or undo item can reference it

#### Scenario: Managed blob frame is accepted

- **WHEN** candidate validation accepts an ordered frame with blob references
- **THEN** the server SHALL persist and ACK frames in sequence before converting their leases to retained ownership

#### Scenario: Managed blob frame is rejected

- **WHEN** the server NACKs a frame with blob references
- **THEN** storage SHALL keep its pins until replica disposal or successful rebase

#### Scenario: Referenced bytes remain missing

- **WHEN** visible bytes remain unavailable after three bounded retries
- **THEN** the server SHALL quarantine and preserve the last-valid checkpoint with every required blob

#### Scenario: Garbage collection races with a new pin

- **WHEN** collection selects an unpinned digest and a new pin appears before deletion
- **THEN** storage SHALL recheck pins and SHALL NOT delete the bytes

### Requirement: Server validates, quarantines, and exports

The server SHALL be able to materialize the supported room schema into the canonical
package for validation, quarantine decisions, checkpoints, and DOCX export without
layout, paint, React, Vue, or ProseMirror.

#### Scenario: Valid export

- **WHEN** an authorized request exports a healthy room
- **THEN** the server SHALL serialize the latest valid canonical package and required blobs

#### Scenario: Invalid room state

- **WHEN** server validation finds an unrepairable state
- **THEN** the server SHALL quarantine the room, preserve its last valid checkpoint, and reject authoring and export

#### Scenario: Headless agent joins

- **WHEN** an authorized headless client joins through the server
- **THEN** it SHALL use the same room schema, roles, validation, and convergence rules as browser clients

### Requirement: Server trust model is explicit

The first server version SHALL permit server-side document inspection and SHALL
require secure transport and host-controlled protection of persisted content.

#### Scenario: Production network connection

- **WHEN** a client connects outside a documented local development mode
- **THEN** the deployment SHALL use authenticated TLS transport

#### Scenario: Persisted room content

- **WHEN** the server stores room updates, checkpoints, audit metadata, or blobs
- **THEN** storage protection and encryption at rest SHALL be controlled and documented by the host

#### Scenario: End-to-end encrypted room requested

- **WHEN** a consumer requires content that the server cannot inspect
- **THEN** the first server version SHALL report that server-side validation and export are incompatible and SHALL NOT claim end-to-end encryption support

### Requirement: Server operations are observable without content leakage

The server SHALL expose health, room lifecycle, connection, update, checkpoint,
quarantine, repair, migration, export, and error hooks without logging document
content or secret credentials.

#### Scenario: Health probe

- **WHEN** an operator invokes the health hook or endpoint
- **THEN** it SHALL report runtime and storage readiness without exposing room content

#### Scenario: Structured event

- **WHEN** a room lifecycle or policy event occurs
- **THEN** the server SHALL emit bounded identifiers, counts, timings, outcome codes, and versions

#### Scenario: Secret-bearing failure

- **WHEN** authentication, storage, or transport fails
- **THEN** logs and hooks SHALL omit tokens, process environments, document text, and raw update bytes

### Requirement: Server package remains optional and open

`@docx-editor.dev/collaboration-server` SHALL use Apache-2.0 and remain outside every
default browser and core dependency graph.

#### Scenario: Consumer installs core without server

- **WHEN** a consumer installs editor packages without the server package
- **THEN** no `ws`, `node:http`, `node:https`, or server storage dependency SHALL enter the browser graph
