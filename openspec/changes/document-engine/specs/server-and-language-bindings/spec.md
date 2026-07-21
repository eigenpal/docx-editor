## ADDED Requirements

### Requirement: Server execution needs no browser or ProseMirror
The server engine SHALL parse, create, query, semantically edit, synchronize,
layout, save DOCX, and export PDF with no DOM, browser process, or ProseMirror
dependency.

#### Scenario: Headless document workflow
- **WHEN** a server opens a DOCX, replaces text, inserts an image, and exports DOCX and PDF
- **THEN** the workflow MUST complete through the semantic store and runtime ports without starting a browser

### Requirement: Requests are revision-aware and isolated
Each server request context SHALL pin document identity, tenant identity,
`baseRevision`, origin, authorization, resource budget, and cancellation.
Queued writes MUST commit atomically against current state or return explicit
stale/precondition/conflict results.

#### Scenario: Stale target changed concurrently
- **WHEN** a request syncs after another request invalidated its target precondition
- **THEN** sync MUST reject the write or safely re-resolve its anchor according to policy and MUST NOT overwrite unrelated content

### Requirement: RPC mirrors semantic schemas
The server boundary SHALL expose versioned RPC schemas for document lifecycle,
external targets, commands, queries, request-context batches, results, errors,
snapshots, updates, and export streams. It MUST reuse the runtime validators and
semantic registries used in process.

#### Scenario: Invalid RPC command
- **WHEN** a request fails its registered JSON Schema
- **THEN** the server MUST return `invalidArgs` before opening a write transaction

### Requirement: Generated clients do not duplicate the engine
Language clients, including Python clients, SHALL be generated or implemented as
typed schema/RPC bindings. They MUST NOT reimplement package parsing, semantic
normalization, target resolution, layout, synchronization, or serialization.

#### Scenario: Python and JavaScript submit equivalent batch
- **WHEN** both clients send schema-equivalent operations against the same revision
- **THEN** the server MUST produce equivalent authored state, results, and revisions

### Requirement: Large values stream or chunk
The server MUST support streaming or bounded chunking for package input,
snapshots, update logs, broad query results, DOCX output, and PDF output where
full buffering is not semantically required. Streams MUST support cancellation, backpressure, size
limits, and integrity checks.

#### Scenario: Export is cancelled
- **WHEN** a client cancels a large PDF stream
- **THEN** server layout/output work MUST stop promptly, release resources, and leave canonical document state unchanged

### Requirement: Server operations enforce trust and authorization
The server MUST authenticate and authorize open, read, write, sync, export, and
administrative migration operations. It SHALL isolate tenant resources, sanitize
untrusted package and URL data, enforce resource limits, and attach auditable
origin metadata to server writes.

#### Scenario: Unauthorized export
- **WHEN** a caller may read metadata but lacks export permission
- **THEN** export MUST fail before package bytes, display-list data, fonts, or images are disclosed

### Requirement: Protocol and schema evolution are negotiated
Clients and servers SHALL negotiate supported protocol, command-schema, and
snapshot versions. Additive evolution MUST preserve unknown fields where
required; incompatible versions MUST fail with actionable version metadata.

#### Scenario: Client is too old
- **WHEN** a client cannot represent a required command or result version
- **THEN** the server MUST reject the operation before mutation and report supported version ranges

### Requirement: Server and in-process conformance is shared
The same fixture suite MUST compare in-process and RPC execution for parse,
create, operations, queries, errors, revisions, DOCX save, PDF output, and
malicious-input behavior.

#### Scenario: Conformance fixture runs over RPC
- **WHEN** a fixture is executed directly and through a generated client
- **THEN** semantic results and output hashes or declared equivalence metrics MUST match

### Requirement: Reads are immutable and rebase is explicit
Each request context MUST read from an immutable base revision. Writes MUST
declare `reject`, `resolveAnchors`, or command-specific `rebase` mode. Commit
MUST use compare-and-swap against the current revision; implicit policy choice
is forbidden. Conflict results MUST include redacted expected/actual revision,
failed precondition, target status, and retryability.

#### Scenario: Reject mode sees newer revision
- **WHEN** commit CAS finds a revision newer than the immutable base
- **THEN** every write MUST fail as one atomic conflict without target re-resolution

### Requirement: Requests and commits are idempotent
RPC batches MUST carry idempotency keys bound to tenant, document, schema
version, operation kind, and canonical request hash. The server MUST
persist or derive the prior result with commit ID and revision so retry after
timeout cannot duplicate a semantic commit, export charge, or update.
Same key and same hash within retention MUST return the original redacted
result. Same key with a different hash MUST return non-retryable `conflict`.
Retention MUST have a declared finite minimum and policy maximum and MUST cover
the advertised client retry window. A retry after expiry is a new attempt and
MUST provide current revision/target preconditions.

#### Scenario: Commit response is lost
- **WHEN** the same idempotency key and payload are retried
- **THEN** the server MUST return the original redacted result and MUST NOT create another revision

### Requirement: Python generation is reproducible
The Python generator MUST consume the canonical versioned schema/IDL bundle and
produce the import package `docx_editor`, mirroring `DocxEditor` namespace,
proxy, load/sync, result, and lifecycle semantics in idiomatic Python, with typed
document handle, synchronous and asynchronous
request-context APIs, command/query models, result unions, streams,
cancellation, binary references, and version negotiation. Golden generated
source, type-check fixtures, serialization vectors, and direct-versus-RPC
behavior MUST be versioned.

#### Scenario: Schema bundle is regenerated
- **WHEN** the canonical schema is unchanged
- **THEN** Python golden artifacts MUST be byte-identical and pass static type and wire-vector tests

### Requirement: RPC result mapping preserves common errors
RPC transport status MUST map from `DocxEditor.Result` without replacing stable
semantic codes. Retryability, conflict evidence, failing batch indices, and
redaction MUST survive generated-client decoding; transport failures MUST remain
distinguishable from semantic failures.
Application, validation, conflict, authorization, and resource failures MUST
decode as `DocxEditor.Result`/idiomatic `docx_editor` result values. Only a
transport or protocol failure preventing receipt/validation of a valid envelope
MUST throw its generated typed exception.

#### Scenario: Locked operation crosses Python RPC
- **WHEN** a Python client submits a valid write rejected by a content lock
- **THEN** it MUST receive the common non-retryable `locked` result rather than a generic transport exception
