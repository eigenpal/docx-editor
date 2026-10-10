## ADDED Requirements

### Requirement: Consumer-configured peer-to-peer provider

The peer-to-peer convenience integration SHALL create and connect a Yjs document through `y-webrtc` using a consumer-supplied room ID, identity, signaling endpoints, and optional ICE configuration. The integration MUST NOT depend on a docx-editor-operated signaling, relay, storage, or collaboration service.

#### Scenario: Two browsers join one room

- **WHEN** two browser clients configure the same unguessable room ID and reachable signaling endpoints
- **THEN** they discover one another, establish a WebRTC connection when network conditions permit, and synchronize through the provider-neutral collaboration session

#### Scenario: Consumer supplies ICE servers

- **WHEN** a consumer provides STUN or TURN configuration required by its deployment
- **THEN** the convenience integration forwards that configuration without logging or persisting credentials

### Requirement: Honest no-backend semantics

Documentation and runtime status SHALL distinguish direct peer synchronization from signaling and relay infrastructure. The peer-to-peer proof MUST state that WebRTC normally requires signaling, may require TURN, provides no central authorization or durable shared availability, and cannot guarantee connectivity on every network.

#### Scenario: Public signaling is used

- **WHEN** the demo uses public Yjs signaling endpoints
- **THEN** the UI and documentation identify the setup as a proof rather than a production availability, privacy, authentication, or persistence guarantee

#### Scenario: Direct connection cannot be established

- **WHEN** signaling succeeds but peers cannot establish a direct or configured relay path
- **THEN** the room reports disconnected or error status without presenting the local document as synchronized

### Requirement: Creator and joiner roles

The peer-to-peer API SHALL require an explicit creator or joiner bootstrap role. The creator SHALL supply initial DOCX bytes; the joiner SHALL not supply competing initial content and SHALL wait for room initialization.

#### Scenario: Creator opens a room

- **WHEN** a creator connects with valid initial bytes
- **THEN** the room initializes the shared baseline once and transitions to ready

#### Scenario: Joiner opens a room link

- **WHEN** a joiner connects to the same room without initial bytes
- **THEN** it remains in initializing state until the validated baseline and shared paragraph state arrive

### Requirement: Provider ownership is explicit

The low-level Yjs collaboration API SHALL leave the Yjs document, awareness, and network provider under consumer ownership. A WebRTC convenience object that creates those resources SHALL declare ownership and destroy only the resources it created.

#### Scenario: Low-level session is destroyed

- **WHEN** a consumer destroys a low-level collaboration session
- **THEN** the session detaches without destroying the supplied provider or Yjs document

#### Scenario: Convenience room is destroyed

- **WHEN** a consumer destroys a convenience-created WebRTC room
- **THEN** the room destroys its provider, awareness integration, owned Yjs document, and all attached collaboration resources exactly once

### Requirement: Optional local persistence remains local

If the convenience integration offers IndexedDB persistence, it SHALL be explicitly optional and SHALL be described as per-browser local continuity rather than shared durable room storage.

#### Scenario: Returning peer opens a locally persisted room

- **WHEN** a browser previously persisted the room's Yjs state locally and later reconnects
- **THEN** it may restore that local state and exchange missing updates with available peers without claiming a central authoritative copy exists

### Requirement: Runnable bounded proof

The repository SHALL include a runnable peer-to-peer example that demonstrates create, share-link join, connection state, presence, remote selection, supported concurrent text editing, actor-local undo, disconnect/reconnect, and DOCX save for the smallest supported slice.

#### Scenario: Proof is exercised in two browser contexts

- **WHEN** the collaboration example is opened by two isolated browser contexts with the same room ID
- **THEN** the documented supported scenarios can be performed without a docx-editor-hosted backend and unsupported controls are visibly refused or disabled

#### Scenario: Two developers run separate localhost demos

- **WHEN** two developers on separate machines start the repository demo on localhost and open the same room link with reachable signaling
- **THEN** each local application connects to the other peer and displays the supported edits, presence, and selections from the remote machine

### Requirement: Room identifiers are not authorization

The convenience integration SHALL require a high-entropy room identifier in examples and SHALL document that knowledge of a room ID is not an authorization system. It MUST NOT expose document bytes, signaling tokens, TURN credentials, or user secrets in logs or user-visible diagnostics.

#### Scenario: Example creates a room

- **WHEN** the example generates a shareable room
- **THEN** it uses a cryptographically strong random identifier and warns that applications needing access control must use an authenticated provider
