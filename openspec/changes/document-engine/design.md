## Context

The engine is a greenfield implementation consumed by browser adapters, headless
workers, server processes, automation hosts, and generated language clients.
Earlier architecture changes established useful pieces but disagreed about the
canonical representation, synchronization currency, editor ownership,
incremental layout, addressing, and public naming. This design consolidates
those pieces into one implementation authority.

The future `EditorHost` is PM-free and `EditorBinding` remains the sole
PM-aware target boundary. No current-stack orchestration object is an
alternative public object model or production authority.

The input and output fidelity target is OPC/OOXML. A package contains multiple
related stories and parts, authored values whose omission is meaningful,
significant XML order, and content not yet understood by the engine. Every
package value is untrusted. The engine therefore needs both semantic editing and
lossless preservation without using a browser, ProseMirror, or a CRDT data
structure as the canonical public model.

The data flow is:

```text
DOCX bytes
  -> bounded OPC/XML trust boundary
  -> canonical authored package model
  <-> semantic DocumentStore
  <-> local or Yjs ReplicatedStoreBackend
  <-> EditorBinding <-> ProseMirror projection
  -> fingerprinted resolved caches with revision provenance
  -> measure -> paginate -> resolve -> anchored display list
  -> DOM | native PDF | print | hit-test
```

All public programmatic surfaces converge on semantic operations:

```text
DocxEditor.parse/DocxEditor.applyEdits/DocxEditor.query
agent and MCP JSON commands
DocxEditor.* proxy object model
DocxEditor.createEditor/EditorHost
                    -> DocOp[] -> DocumentStore transaction
```

`EditorHost` is runtime and adapter integration: it provides lifecycle,
scheduling, mounted surfaces, events, and browser services. `EditorBinding` is
the only ProseMirror-aware component: it maps transactions and selections
between a ProseMirror projection and the semantic store. A headless engine can
use neither, a browser object-model client can use a host without directly using
the binding, and framework adapters normally compose both.

## Goals / Non-Goals

**Goals:**

- Preserve authored OPC/OOXML state, including unsupported content, while
  enabling semantic edits across all stories and related parts.
- Define one deterministic validation, normalization, identity, transaction,
  history, and anchor model for local, collaborative, browser, worker, and
  server execution.
- Separate semantic mutation, model notification, replication updates, and
  snapshots so each contract can evolve and be tested independently.
- Make layout deterministic and dependency-aware, with one anchored display
  list consumed by all output and interaction backends.
- Expose the public API only through `DocxEditor.*`, using a batched
  Office JavaScript-style request context and lazy proxies.
- Support addressable collaboration, offline replay, persistence, migrations,
  server editing, generated clients, durable citations, and conformance gates.
- Keep package and extension boundaries explicit so optional capabilities and
  heavy runtime dependencies do not leak into the base bundle.

**Non-Goals:**

- Reusing the current adapter implementation as the canonical engine.
- Making ProseMirror, layout output, a resolved style tree, or a CRDT-specific
  structure canonical.
- Sending semantic operations directly as the replication wire format.
- Promising a second replication backend before it passes the same conformance
  suite as the Yjs implementation.
- Defining product entitlement policy in the engine. Distribution controls
  package availability; core has no runtime license checks.
- Choosing unratified performance numbers before representative baselines exist.

## Decisions

### D1: Canonical state is the authored package model

`DocumentModel` contains an authored package graph, stable part and
relationship identities, editable stories, authored properties including
explicit omission and raw values, and ordered preservation capsules for unknown
or unsupported content. Resolved styles, numbering, fields, fonts, and layout
inputs are derived caches carrying model revision as provenance and keyed for
reuse by dependency/input fingerprints plus immutable operation environment.
They are never serialized as authored state.

This prevents read or layout operations from turning inherited values into
direct formatting on save. Selective serialization patches only byte ranges
owned by changed semantic records inside a changed XML part, preserving every
unowned byte span, prefix, whitespace sequence, attribute order, unknown
sibling, and capsule boundary. Whole-region regeneration is allowed only when
the parser recorded complete ownership and a deterministic equivalence oracle;
otherwise serialization fails safely or falls back to a declared whole-part
rewrite mode that is never called lossless. Untouched parts retain original
bytes and package ordering where allowed.
Conformance compares exact uncompressed XML-part byte ranges separately from a
semantic ZIP-container comparator that permits recompression-driven compressed
payload, CRC, size, offset, and directory metadata changes.

**Alternative considered:** store a resolved object-model-shaped tree. Rejected
because it cannot preserve package constructs, authored omission, relationship
semantics, or unsupported content.

### D2: The store and replication backend have distinct contracts

Four contracts are deliberately separate:

1. `DocOp` is a JSON-safe semantic mutation request.
2. `ModelChange` is the notification emitted after a committed normalized
   transaction, containing revisions, dirty identities, dependency effects, and
   origin.
3. A replication update is opaque backend-owned bytes used for incremental
   synchronization.
4. A snapshot is full encoded backend state used for initial synchronization,
   persistence, migration, and recovery.

`DocumentStore` owns semantic validation, transactions, normalization, history,
anchors, and current authored state. `ReplicatedStoreBackend` owns Yjs state,
update encoding, snapshots, relative positions, and awareness. Neither exposes a
ProseMirror type. A local backend implements the same behavioral contract
without networking.

An optional `YjsBinding` bridges an EXTERNALLY-OWNED `Y.Doc` to the store (revised
per ADR-S10; there is no public `ReplicationCoordinator`). It is thin and
origin-driven. Remote: it subscribes to the doc's update/transaction events, and on
a non-local origin derives the merged model from the backend and publishes it into
the store via `publishDerived`, which normalizes once and emits exactly one
`ModelChange` and one monotonic revision — Yjs is the merge authority, so remote
command intent is never reconstructed from opaque bytes. Local: it subscribes to
committed `ModelChange` and mirrors the changed blocks into the `Y.Doc` inside a
`doc.transact(fn, localOrigin)`, so the provider computes the incremental update and
the binding ignores its own echo by origin. Duplicate delivery is already idempotent
at the CRDT layer, so there is no application-level update-id set. Transport,
persistence, offline replay, and awareness belong to the consumer's provider, not the
engine. The load-bearing invariant is unchanged: a backend never mutates canonical
state or emits `ModelChange` directly — canonical state changes only through store
entries (`transact`/`applyEdits`/`undo`/`publishDerived`). `engine-core` runs fully
without any Yjs integration.

Yjs stores model-shaped records keyed by collision-free creation identity with
ordered creation-ID collections. Each record retains proposed semantic ID and
actor/commit provenance so concurrent semantic-ID candidates remain observable
until deterministic repair. It uses collaborative text for textual content,
explicit marks/annotations, and opaque preservation capsules. It does not
store a ProseMirror XML fragment. A later backend is admissible only after it
passes store, anchor, undo, persistence, and convergence conformance. Automerge
is the named later candidate, not a production commitment before that gate.

**Alternative considered:** one interface in which `DocOp`, wire update, and
snapshot are interchangeable. Rejected because remote merges need not recover
the original semantic operations, and snapshots have different lifecycle and
security properties from updates.

### D3: One atomic validation and normalization path

Every writer enters the same pipeline:

```text
resolve external target if present
  -> validate command, lock, revision, and preconditions
  -> apply DocOps in one transaction
  -> deterministic repair and normalization
  -> commit one revision and history group
  -> emit one ModelChange
  -> derive replication update and invalidate caches
```

`DocumentStore.transact(origin, callback)` passes a synchronous
`TransactionContext` to the callback; only `context.apply(op)` stages writes.
The callback MUST NOT return a promise, and nesting or reentrant commit is
rejected. Exceptions and failed validation, normalization, or backend commit
roll back every staged canonical and backend change. Commit returns revision,
commit ID, positional results, and the single `ModelChange`; rollback emits no
revision, history, notification, audit entry, or replication update.

`DocxEditor.applyEdits` and one `DocxEditor.RequestContext.sync()` are
all-or-nothing batches. Same-sync creations receive transaction-local symbolic
IDs; the engine validates their dependency graph topologically, stages
resolution, and validates every item without
invoking mutating handlers and reports invalid items positionally. Any failure
aborts all writes; otherwise-valid items receive `aborted` results referencing
the failing indices. No candidate post-write value is exposed and no canonical
or backend state changes; requested loads materialize from the result's explicit
unchanged reconciled revision.

Transactions can span body, headers, footers, notes, comments, media,
relationships, content types, styles, and numbering. Subscribers never observe
intermediate package-invalid state. ProseMirror plugins cannot commit canonical
semantic repairs independently; such repairs must become `DocOp`s before the
store commits.

Stable identities exist for stories, blocks, paragraphs, tables, rows, cells,
runs where anchoring requires them, parts, relationships, comments, revisions,
bookmarks, controls, and annotations. Split retains the original ID on the first
fragment and creates one for the tail; join retains the first surviving ID; move
retains identity; semantic replacement creates a new identity; undo restores
deleted identity; concurrent conflicts are resolved by deterministic repair.

**Alternative considered:** let each importer, editor plugin, and backend
normalize independently. Rejected because replicas and output paths could
produce different valid-looking models.

### D4: External targets and internal anchors are different layers

External callers use JSON-safe targets based on `paraId` and an optional unique
phrase or explicit location discriminator. No live handles or backend bytes
cross JSON/RPC boundaries. Missing and ambiguous matches fail without mutation.
`paragraphIndex` is never a canonical address.
`paraId` normalizes ASCII hexadecimal case-insensitively. Phrase matching uses
Unicode NFC, case-sensitive scalar equality, authored whitespace, and zero-based
occurrence. Range endpoints use grapheme-boundary positions and explicit
affinity; the union includes document boundaries and versioned preconditions.

After resolution, the store creates an opaque engine-owned `AnchorHandle`.
Its private record contains story and block identity, backend-relative position
where textual movement must survive edits, and before/after affinity. Internal
anchors power selections, comments,
tracked changes, citations, awareness, display items, and hit testing. The
resolver reports the revision at which an external target was resolved and
applies preconditions at commit.

Only trusted backend, awareness, and persistence channels may serialize an
anchor, using a versioned envelope bound to document ID, backend kind, anchor
schema, checkpoint, affinity, and authenticated opaque bytes. Public JSON/RPC
targets never contain this envelope. Restore validates document, version,
checkpoint, and authorization; stale or unmigratable handles return a typed
invalid-anchor result rather than another location.

**Alternative considered:** expose internal relative positions publicly.
Rejected because they are backend-specific, not naturally JSON-safe, and cannot
be trusted across documents.

### D5: EditorBinding is a bidirectional engine boundary

Registered operation mappers translate a complete ProseMirror transaction,
including mapped multi-steps and appended transactions, against a shadow
`EditorState`. The actual view is not dispatched. Mappers derive `DocOp[]`
against evolving mappings and commit one store transaction. Rejection discards
the shadow state; success reconciles the actual view exclusively from normalized
canonical state.

Unsupported steps may apply only to the shadow state to derive
`ReplaceBlockContent`, which preserves identity and replaces owned semantic
content and capsules only when ownership is proven. `ReplaceNode` is semantic
replacement and mints a new identity. If neither mapping is safe, the command
is disabled or rejected.

`ModelChange` carries before/after structural descriptors for changed ranges, or
a binding-owned revision index retains those descriptors until every bound view
acknowledges reconciliation. Reverse reconciliation translates them into minimal ProseMirror steps,
falling back to affected-block replacement. It preserves text selection, stored
marks, node selection, and table-cell selection through internal anchors.
IME state records start revision, anchored composing range, initial text, local
composition text, and ordered inbound changes. Intersecting reconciliation is
deferred. Composition commit maps final composing text once, commits one
semantic history group, then applies queued normalized changes in revision
order; cancellation discards local composition and reconciles queued changes.

`MutationOrigin` identifies human, agent, remote, undo, redo, migration, repair,
and server writes. `ProjectionOrigin` identifies binding reconciliation and
never enters canonical state, history, snapshots, audit operations, or
replication. `AwarenessOrigin` identifies ephemeral presence and never enters
authored state. Projection-generated transactions are ignored by the forward
mapper.

Undo behavior is defined at the common store contract: solo and collaborative
modes expose the same grouping and redo behavior, and collaborative undo affects
only the current user's eligible changes. The completed POC rejected
hand-authored inverse `DocOp` history for collaboration and selected a composed
mechanism: actor/session-scoped `Y.UndoManager` transforms tracked local Yjs
work, while the semantic store/coordinator owns validation, normalization,
identity behavior, grouping, and notifications. See
`spike-architecture-decision.md` ADR-S4.

History records `ActorId`, `SessionId`, group ID, commit ID, mutation origin,
forward/inverse operations, identity tombstones, and normalization ownership.
Explicit group IDs and request-context sync delimit groups; IME commit is one
group. Remote, repair, migration, awareness, and projection events are not
locally undoable. Agent edits are undoable only when assigned to the actor. New
eligible local commits clear that actor's redo stack; remote commits do not.
Undo/redo restore stable identities across remote interleaving. Durable editing
snapshots include undo/redo eligibility and restore it exactly.
Successful commits append two distinct records: a redacted audit index for
routine observability and an encrypted, access-controlled replay journal with
complete versioned `DocOp` payloads. They have independent finite retention,
authorization, tenant isolation, key rotation, deletion/legal-hold, and
tamper-evidence policies; raw text never enters the redacted index.

**Alternative considered:** bind ProseMirror directly to Yjs. Rejected because
the backend stores the package model, while ProseMirror represents only an
editable projection.

### D6: Layout invalidation follows dependency closure

`ModelChange` identifies directly dirty nodes and changed dependency keys.
Invalidation expands through style, numbering, section, font, image,
header/footer, field, note, table, and annotation dependencies. Measurement
records model revision as provenance and reuses across revisions only when
transitive dependency/input fingerprints and producer version match immutable
operation-scoped resource/configuration/extension/shaping snapshots. Epoch
change during work restarts affected derivation. Pagination restarts at the earliest
affected flow position and continues until page state converges with cached
state. Page-dependent fields and destinations then resolve; any geometry-changing
result restarts the necessary pass. Results are `converged`; deterministically
`cycleResolved` and fully revalidated; or `nonConverged` with a diagnostic-only
stable prefix that cannot be saved/exported as complete.

The convergence fingerprint is the canonical sequence of page/column
boundaries, flow IDs, break causes, note assignments, header/footer variants,
resolved field values, and fixed-point geometry at the reuse frontier. The
frontier advances only after consecutive passes match. A finite configured pass
limit is bounded by a non-disableable hard ceiling. Repeated fingerprints use a
documented lexicographic tie-break followed by complete revalidation; otherwise
the engine returns a diagnostic-only stable prefix and typed trace, never
silently unstable or complete output.

The engine never promises to process only directly changed blocks. A one-line
edit can repaginate later pages, and a style or section edit can invalidate many
stories.

**Alternative considered:** relayout only IDs named by `ModelChange`. Rejected
because pagination, numbering, styles, headers, footnotes, and references create
downstream dependencies.

### D7: One anchored display list drives outputs

`ShapingEnvironment` hashes font bytes, face index, variation axes, shaping
library/version, Unicode data version and normalization policy, script,
language, direction, OpenType features, fallback order, fixed-point scale, and
rounding mode. Shaping computes clusters,
bidi order, advances, kerning, ligatures, fallback, and vertical metrics without
a browser font stack. Layout places sections, columns, paragraphs, lists,
tables, floating and inline images, headers, footers, notes, controls, comments,
revisions, and fields. Display items carry final geometry plus document anchors,
semantic roles, clipping, transforms, and navigation targets.

The output also contains a semantic tree with logical reading order, language,
roles, headings, tables, lists, alt text, artifacts, and references. Glyph items
map logical Unicode ranges through bidi and cluster maps to visual glyphs.
Justification, compression/expansion, and text-fit are explicit per-line and
per-cluster fixed-point advance adjustments. Hit testing inverts transforms,
intersects accumulated clips in z-order, and resolves cluster affinity.
Reviewed algorithms freeze eligible justification opportunities/exclusions,
bidi visual-order quotient/remainder allocation, compression/expansion and
text-fit limits, semantic/display IDs and ownership links, grapheme caret
positions within ligatures, and pointer/hit eligibility.
Accessible DOM and tagged PDF preserve reading order and roles; PDF uses
`ActualText` when visual glyph order differs from logical text.

DOM paint, native PDF, print, accessibility projection, and hit testing consume
that IR and do not reinterpret CSS or rederive geometry. PDF embeds/subsets
fonts, emits positioned glyphs and images, creates internal and external link
annotations, and applies clipping and transforms directly from the IR. The same
model, ports, fonts, and configuration must produce equivalent pagination and
anchoring in browser, worker, and server runtimes.

### D8: `DocxEditor.*` is the only public object model

The high-level API is declared only through `DocxEditor.*`. `DocxEditor.run`
creates a revision-aware `DocxEditor.RequestContext`; proxies queue loads and writes;
`DocxEditor.RequestContext.sync()` atomically materializes requested values, reconciles to the current
revision, validates stale-range preconditions, applies queued `DocOp`s, and
returns typed results for application, validation, conflict, authorization, and
resource outcomes. Only a transport/protocol failure preventing receipt or
validation of a valid envelope throws a typed exception. Collections,
`DocxEditor.ClientResult`, tracked objects,
and `DocxEditor.InsertLocation` have familiar Office JavaScript-style semantics.

The document layer (`DocxEditor.parse`, `DocxEditor.create`,
`DocxEditor.applyEdits`, `DocxEditor.query`, and save),
agent/MCP JSON schemas, object-model proxies, and browser commands use one
command/query registry and one result/error taxonomy. Search, content controls
and locking, comments, tracked changes, sections, tables, headers/footers,
images/relationships, citations, DOCX export, and PDF export are reached through
that common semantic path.

Public entry points are stable and audience-specific. Experimental geometry is
kept off the durable application API and is retired as adapters move to
anchored display-list contracts. No source-path or workspace alias may become a
supported entry.

The package root exports the `DocxEditor` namespace value and types. Explicit
non-object-model assets may be exported only as `./styles.css`, `./tailwind`,
`./schemas`, `./types`, `./plugin`, and temporary `./geometry`. No bare durable
object-model function or type is exported. Retired module subpaths may remain as
deprecated forwarding entries for exactly one major release, but MUST forward
to `DocxEditor.*` and MUST NOT create another namespace alias.

Bytes enter through `DocxEditor.parse` or `DocxEditor.create`, producing a
document/store handle. `DocxEditor.run(handle, callback)` opens a context over
that store. `DocxEditor.createEditor({ document, host })` attaches layout and
`EditorBinding` to the same store and never copies canonical state. Tracked
proxies survive sync only while their context/run is open; close/completion
invalidates all proxies. Handles own explicit close/dispose; editor disposal
never disposes an externally owned handle.

### D9: Extensions are vertical bundles over explicit runtime ports

A capability registry owns parse, serialize, validate, normalize, command,
query, ProseMirror mapping, dependency, layout, display-list, object-model, and
schema contributions. A feature bundle declares dependencies, conflicts,
replacements, required ports, and deterministic registration order. The engine
fails initialization on missing or cyclic dependencies rather than depending on
import order.

Runtime ports cover fonts, shaping, images, clocks, identity, persistence,
transport, scheduling, audit, authorization, and resource accounting. Browser,
worker, and server adapters supply only the ports available in that runtime.
Optional output and collaboration packages are distribution-gated; core has no
license-key branch or degraded entitlement mode.

`technology-selection.md` is the dependency-selection record for these package
boundaries. It distinguishes selected collaboration mechanisms from candidates
that require milestone bake-offs and fixes the infrastructure that production
MUST NOT hand-roll. Candidate names are not production dependencies until their
owning milestone records the required license, runtime, determinism, security,
bounded-work, performance, fallback, and version evidence.

Resource budgets form a parent/child reservation tree owned by the initiating
operation. Parsers, extensions, workers, layout passes, transport queues, and
streams reserve work before use, check cancellation at declared bounded
intervals, and release reservations and spill files on every exit. Untrusted
synchronous hooks run in terminable worker isolation. Configurable defaults are
finite; security hard ceilings cannot be disabled. Counters use overflow-safe
arithmetic and boundary tests at N and N+1.
Canonical publication is the cancellation point of no return: abort before it
rolls back all canonical/backend effects; abort after it returns commit
ID/revision and cancels only derived work. Every child budget and worker releases
before the root reservation.

### D10: Addressable sync has a versioned server lifecycle

A document URL resolves to an authenticated document identity and tenancy key.
Participants exchange a versioned snapshot and incremental opaque Yjs updates over
WebSocket or SSE+POST. Offline participants durably queue updates and replay them in
causal order; idempotence and origin tags prevent echo. Awareness is ephemeral,
rate-limited, separately authorized, and never included in authored snapshots.

Persistence stores schema version, package identity, snapshot, update-log
position, migrations applied, and audit metadata. Compaction is atomic and
retains a recoverable prior checkpoint. Engine and storage migrations are
versioned, resumable, observable, and fail closed without partially publishing a
new document version.

Connection states are resolving, authenticating, negotiating, snapshotting,
tailing, live, refreshing-auth, offline, and closed. The handshake exchanges
protocol/schema ranges, backend state vector, checkpoint ID, resume token, and
authorization expiry. Initial sync establishes a snapshot-plus-tail barrier:
updates after the checkpoint are buffered and applied before live. Each local
update has stable update/constituent IDs; acknowledgements name those IDs while
state vectors only optimize exchange. Durable queues delete only explicitly
acknowledged IDs. Retry is at-least-once with idempotent effects. A
compaction gap forces a fresh snapshot barrier. Authentication refresh pauses
sends without dropping queued updates.

Persisted state includes schema and normalization versions, document/package
identity, model-shaped state sufficient to reproduce authored state, stable-ID
allocator state, anchor encoding/checkpoint, local revision, backend state
vector, update IDs/log cursor, migrations, audit cursor, and, for durable
editing snapshots, undo/redo eligibility.

The hub isolates documents by tenant and document key, authenticates before
join, authorizes reads/writes/exports, bounds update and snapshot size, rejects
malformed updates, rate-limits connections and writes, meters layout/export
resources, and records server-originated audit metadata.

### D11: Server and language clients reuse the engine

Server editing loads a document revision into an isolated semantic store and
runs `DocxEditor.*` with no browser and no ProseMirror. RPC methods exchange
versioned JSON schemas, external targets, commands, queries, results, binary
references, and revision preconditions. Generated clients, including Python,
are schema bindings only; they do not reimplement model, normalization, layout,
or serialization logic.
RPC idempotency keys bind tenant, document, schema, operation kind, and canonical
request hash. Different hashes under one retained key conflict; after finite
retention expires, retry is a new attempt requiring current preconditions.
Python imports as `docx_editor` and mirrors `DocxEditor` semantics idiomatically.

Long operations stream or chunk package reads, query results, snapshots, and
exports with cancellation and resource accounting. Concurrent server requests
use explicit base revisions and either anchor-adjust safely or return a
conflict/precondition error.

### D12: Citations are durable first-class annotations

Comments, tracked changes, and citations share durable range-anchor
infrastructure but retain distinct schemas and lifecycle rules. A citation owns
a stable ID, source metadata, formatting metadata, internal anchors, optional
external source identifiers, and navigation state. It survives ordinary edits,
split/join, collaboration, save/reopen, and selective serialization. Deletion or
ambiguity follows an explicit detach, collapse, or tombstone rule and never
silently reattaches to unrelated text.

### D13: Performance and conformance are milestone gates

Benchmarks use frozen source bytes for representative 300–500-page reference
classes covering long text,
styles and numbering, tables, images, headers/footers, fields, comments,
tracked changes, and 100+ tracked revisions. Each run records fixture hash,
reference-page metadata, runtime, hardware, fonts, isolation mode, warm/cold
state, at least five warmups and thirty process-isolated measured runs per case,
predeclared percentile and 95% bootstrap CI, dispersion/noise threshold, no
post-hoc outlier removal, whole-case environment-invalid rerun rule, GC policy,
operation, affected closure, bounded-frontier counters, phase timings, peak and
retained memory, bytes read/written, and artifact comparator results.

Before an implementation milestone is accepted, maintainers ratify thresholds
from recorded baselines for parse, open, first layout, incremental edit,
pagination, sync, save, export, and memory. Hot-path tests assert no
whole-document projection, clone, serialization, DOM walk, or unbounded
allocation for a bounded local edit. Streaming/chunked package reads and writes
are required where full buffering is not semantically necessary.

Conformance covers package round-trip, malicious inputs, semantic operations,
normalization, anchors, local/Yjs behavior, undo, two-client convergence,
offline replay, binding parity, cross-runtime layout, display-list output, PDF,
server RPC, generated clients, and extension combinations.
Output conformance also uses an independently reviewed frozen reference-render
corpus for pagination, geometry, raster, text, semantics, and links, and validates
tagged PDF against pinned PDF/UA-1 tooling rather than relying on self-comparison.

### D14: The package boundary is also the trust boundary

The bounded reader applies one normalization profile to ZIP entry names, OPC
part names, and internal relationship targets. It rejects NUL/control characters, backslashes,
drive/UNC forms, percent-encoded separators or dot segments, absolute paths,
traversal, and duplicate normalized names before inflation; relationship
resolution is relative to its owner and cannot escape package root. External
relationship targets use a separate absolute-URI lexical profile, remain
authored, and are never owner-resolved. It also rejects excessive compressed/decompressed size and ratio, unsafe
recursion, and excessive element/part counts. XML parsing preserves significant
order, attributes, whitespace, and lexical values while refusing DTDs, external
entities, and unbounded entity expansion.

Authored relationships retain owner part, authored ID, type, raw target lexical
form, target mode, and order. Content types retain ordered Default/Override
records. Raw relationship/citation targets MAY be XML-escaped into validated
owned XML serialization, which is not a runtime sink. DOM, CSS, navigation, and
fetch sinks receive only allowlist-sanitized projections. External relationships,
remote fonts/images, CSS URLs, and imports are never fetched on open; explicit
user action and an authorized runtime port are required. Content-type resolution
uses ASCII-case-insensitive extensions, Override before Default, preserves
untouched identical duplicates/orphans, and blocks owned edits on conflicting
duplicates, normalized Override names, or MIME records until explicit repair.
Serialization validates
QNames, allocates controlled namespace prefixes, escapes XML attribute/text
values, validates URIs, and reinserts capsules only with captured namespace
context and sibling position. Parser intermediates use null-prototype records
and reject dangerous keys recursively before capability dispatch.
DOM output uses element construction and `textContent`, never HTML-from-string;
CSS-bound strings are escaped and CSS URLs/imports are rejected. A pure,
resource-bounded evaluator handles only allowlisted internal fields; all other
fields, macros, ActiveX, OLE, embedded objects, and executable relationships
remain preserved and inert; explicit scrub export is declared non-lossless.
Parsing, update application,
layout, and export enforce depth, count, time, memory, and output limits.

## Risks / Trade-offs

- **Lossless capsules can conflict with semantic edits** -> every capability
  declares ownership boundaries and invalidation rules; package-part diff tests
  verify untouched capsules and deterministic regeneration.
- **Bidirectional editor reconciliation is the highest-risk subsystem** -> the
  completed POC proves the narrow model-first/loop-prevention direction; tasks
  6.3–6.10 gate production step mapping, fallback, incremental reconciliation,
  selections, IME, origins, and randomized parity.
- **Deterministic repair can discard concurrently edited invalid descendants** ->
  rules are explicit, stable-ID based, auditable, and property-tested for replica
  agreement.
- **Cross-runtime fonts can still differ when inputs differ** -> output records
  font identities and substitutions; conformance uses identical font bytes and
  explicit fallback policy.
- **Pagination can fail to converge for cyclic fields or layout dependencies** ->
  detect repeated states, cap passes, and return a diagnosable error instead of
  emitting unstable output.
- **Proxy contexts can become stale during long-running server work** -> pin
  `baseRevision`, resolve through anchors at each sync, and enforce
  preconditions.
- **Offline logs and snapshots can grow without bound** -> versioned compaction,
  retention, quotas, and recoverable checkpoints are mandatory.
- **Extension freedom can break determinism** -> registration declares
  dependencies and deterministic hooks; conformance rejects nondeterministic or
  unbounded capabilities.
- **Native PDF increases implementation scope** -> keep it a pure IR backend and
  gate it on geometry, text extraction, link, clipping, and font tests.

## Migration Plan

1. Accept the completed KISS browser POC evidence and
   `spike-architecture-decision.md`; keep the spike disposable.
2. Implement the bounded package reader, authored model, preservation capsules,
   identities, and selective serializer with package-part diff fixtures.
3. Implement semantic operations, local store, normalization, history, external
   resolver, and internal anchors.
4. Implement the model-shaped Yjs backend beside the local backend and pass the
   shared store, convergence, persistence, and undo suite.
5. Implement EditorBinding and pass forward/reverse mapping, selection, IME,
   origin, and loop-prevention gates.
6. Implement `DocxEditor.*`, shared command/query schemas, create-from-scratch,
   search, feature edits, and browser `DocxEditor.createEditor`/`EditorHost` composition.
7. Implement resolved caches, dependency closure, shaping, convergent
   pagination, anchored display list, DOM/hit-test, and native PDF.
8. Implement addressable transports, offline replay, awareness, persistence,
   migrations, hub isolation, and server export.
9. Add citations and generated language clients over the existing semantic and
   RPC contracts.
10. Ratify benchmark thresholds from representative baselines, pass the full
    conformance matrix, migrate adapters entry by entry, and retire temporary
    compatibility entries with their stated deprecation window.

Rollback is milestone-based. Persisted formats are versioned; a migration must
retain a prior readable checkpoint until validation succeeds. Adapter adoption
is entry-by-entry so an incomplete milestone does not require changing
canonical persisted state.

## Open Questions

Production-critical architecture is decided above. The following choices must
be settled by their named milestone without changing the contracts:

- Tasks 4.11–4.12 and 5.6–5.10 will ratify durable redo, compaction, persistence,
  GC, retention, and client lifecycle around the POC-selected collaborative undo
  mechanism.
- Tasks 6.3–6.8 and 6.10 will select the exact unsupported-step fallback,
  incremental reconciliation, complete selection, and IME implementation.
- The package-model milestone will evaluate `fflate` and
  `fast-xml-parser` under `technology-selection.md`, then select the streaming
  strategy and preservation-capsule granularity from measured fixtures.
  `fast-xml-parser` remains a candidate until hostile DTD/entity, lexical
  fidelity, ordered-node, bounded-work, and cross-runtime gates pass. `JSZip`
  and the spike tokenizer are not production selections.
- The shaping milestone will evaluate `harfbuzzjs` plus `fontkit`, Unicode
  bidi/UAX #14 implementations, `Intl.Segmenter`, and redistributable fallback
  fonts under the technology-selection gates.
- The output, schema, RPC, and persistence milestones will similarly resolve
  the recorded `pdf-lib`/`pdfkit`, TypeBox/Zod/AJV,
  Connect/gRPC/OpenAPI, and `y-indexeddb`/`y-leveldb` candidates.
- The persistence milestone will ratify snapshot cadence, update compaction,
  garbage collection, and retention defaults from measured workloads.
- The performance milestone will ratify numerical latency and memory thresholds
  from the specified representative baselines before implementation acceptance.
