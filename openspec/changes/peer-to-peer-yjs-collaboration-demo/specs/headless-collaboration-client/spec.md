## ADDED Requirements

### Requirement: DOM-free collaboration participation

A headless collaboration client SHALL be able to initialize or join the same provider-neutral Yjs session, open the canonical DOCX package, observe collaboration status and model changes, and synchronize supported edits without constructing layout, paint, ProseMirror, React, or a browser DOM.

#### Scenario: Server-side agent joins

- **WHEN** an automation process supplies a Yjs document and compatible provider connected to an initialized collaboration room
- **THEN** it receives the baseline, opens a DOM-free canonical session, and can read the current document after readiness

#### Scenario: Headless package is bundled

- **WHEN** a consumer imports the headless collaboration entry point
- **THEN** the reachable graph excludes browser DOM, React, Vue, ProseMirror view, WebRTC, and layout/paint dependencies

### Requirement: Agent edits use canonical automation transactions

An AI agent SHALL submit authored changes through the existing automation planning and transaction path. The collaboration client MUST NOT expose direct mutable Yjs shared types as a bypass around tree-operation validation.

#### Scenario: Agent inserts supported text

- **WHEN** an agent queues a supported insertion in an existing body paragraph and synchronizes its automation context
- **THEN** one validated canonical transaction commits with agent attribution, updates Yjs with the same intent, and reaches connected browser and headless replicas

#### Scenario: Agent requests unsupported structure

- **WHEN** an agent requests a paragraph split, table mutation, comment mutation, formatting change, or another operation outside the smallest collaboration slice
- **THEN** the request is refused before shared authored state changes and the agent receives a typed machine-readable reason

### Requirement: Stable actor and operation identity

Each headless client SHALL provide stable actor and session identities, and each authored transaction SHALL carry a unique operation or constituent identity suitable for duplicate detection, attribution, audit correlation, and actor-local undo ownership. Process restarts MUST NOT silently reuse another actor's identity.

#### Scenario: Agent reconnects after process restart

- **WHEN** an agent reconnects with the same authorized actor identity and a new session identity
- **THEN** new edits remain attributable to that actor while duplicate previously acknowledged operations are idempotent

### Requirement: Provider remains consumer-selected

The headless collaboration API SHALL accept any Yjs-compatible provider available in the consumer's runtime. The library SHALL NOT require or operate a collaboration server, and WebRTC MUST NOT be required for headless participation.

#### Scenario: Agent uses a WebSocket provider

- **WHEN** a server-side agent connects a Yjs document using a consumer-operated Hocuspocus, `y-websocket`, Liveblocks Yjs, or equivalent provider
- **THEN** it attaches the resulting Yjs document and awareness channel to the same headless collaboration API used by other providers

#### Scenario: Agent shares an in-process document

- **WHEN** a test or worker attaches an already synchronized in-memory Yjs document without a network provider
- **THEN** the headless client operates without requiring provider-specific APIs

### Requirement: Headless reads observe committed canonical state

Agent reads and automation queries SHALL observe only a committed canonical revision. Shared-state receipt, baseline parsing, or an unvalidated remote update MUST NOT become visible as a partial document.

#### Scenario: Agent queries during remote update processing

- **WHEN** a remote update is staged but canonical validation has not published
- **THEN** agent reads continue to return the previous committed revision

### Requirement: Agent presence is optional and non-canonical

A headless client MAY publish agent identity, activity, or selection through awareness, but it SHALL be able to participate without a visual cursor. Agent awareness MUST NOT alter authored state, revisions, undo, save output, or document attribution.

#### Scenario: Non-rendering agent edits

- **WHEN** an agent submits a supported edit without publishing a selection
- **THEN** the edit synchronizes normally and browser peers may show agent activity without fabricating a document cursor

### Requirement: Untrusted agent output is bounded and validated

Every value submitted by an agent SHALL be treated as untrusted input and pass the same operation validation, resource limits, protection checks, URL and package safety rules, and atomic refusal behavior as human-authored input.

#### Scenario: Agent submits oversized text

- **WHEN** an agent submits text or a transaction that exceeds the configured collaboration or operation budget
- **THEN** the transaction is refused atomically and no local or remote authored state changes

### Requirement: Headless lifecycle is deterministic

The headless collaboration client SHALL expose readiness, error, disconnection, and teardown and SHALL unsubscribe all collaboration and automation listeners on destruction without terminating consumer-owned providers.

#### Scenario: Agent job ends

- **WHEN** the process destroys its headless collaboration client
- **THEN** pending local transactions are either explicitly completed or aborted, listeners are released, and the supplied provider lifecycle remains the consumer's responsibility
