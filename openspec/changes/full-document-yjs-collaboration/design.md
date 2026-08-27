## Context

The paragraph collaboration proof keeps one canonical `TreePackageStore` in each
participant and mirrors existing body paragraph text through Yjs. It proves the
attachment, awareness, undo, transport, and headless seams. It does not answer how
concurrent structural edits preserve OOXML validity, stable identity, package
fidelity, or incremental layout performance.

The engine currently expresses user intent as typed `TreeDocOp` values, but those
operations eventually mutate a smaller set of canonical XML and package structures.
Replicating every operation would create a second command protocol. Replicating the
ProseMirror projection would lose package content. The follow-on therefore targets
the canonical package mutation primitives.

The shared representation must cover typed nodes and lossless generic OOXML. It must
also cover package parts, relationships, content types, and binary resources. Remote
materialization must keep object identity for unaffected subtrees because store and
layout caches use that identity.

The product remains a library. Consumers may use peer-to-peer transport, a hosted
Yjs provider, or an optional deployable server module. EigenPal does not operate a
required collaboration service.

## Goals / Non-Goals

**Goals:**

- Define one replication architecture that can represent every canonical package
  edit without a command-by-command CRDT twin.
- Prove the representation through measured identity, move, validity, size, and
  200-page performance gates before production integration.
- Keep the canonical tree as the only source consumed by editor commands, layout,
  paint, automation reads, and DOCX serialization.
- Use Yjs as the durable replicated backing state for a collaborative room.
- Preserve stable logical node identity across peers, moves, checkpoints, and
  canonical materialization.
- Converge all stories, review data, package metadata, relationships, and media.
- Repair only deterministic safe invalid states and quarantine all other states
  before canonical publication.
- Provide persistent rooms through an optional Bun/Node server module while clients
  remain immediate Yjs replicas.
- Target complete editing compatibility from the first architecture. Milestones may
  remain experimental until the complete gate passes.

**Non-Goals:**

- A second wire protocol for every `TreeDocOp`.
- ProseMirror-owned collaboration.
- A server that serializes every client keystroke before local display.
- An EigenPal-operated signaling, TURN, persistence, or collaboration service.
- End-to-end encrypted rooms in the first production version. The server may inspect
  content for validation and export.
- Automatic three-way merge of a DOCX edited outside an active room.
- Interoperability with Microsoft Word's proprietary live coauthoring protocol.
- A full implementation before the representation spike passes.

## Decisions

### D1: Start a separate follow-on change

The existing `peer-to-peer-yjs-collaboration-demo` change remains a bounded proof.
Its remaining browser, headless, conformance, and manual gates must finish without
expanding its supported edit set.

This change owns full-package representation, repair, durability, and server work.
It builds on the proof contracts after the proof is complete.

Alternative considered: expand the proof change. Rejected because its explicit stop
criteria and support claims would become impossible to audit.

### D2: Gate the architecture on a dual-representation materialization spike

The first implementation phase is one isolated test harness over one `OoxmlPart`.
It compares nested Yjs XML with a stable-node registry and replicated child-ID
sequences. Each backend seeds two independent `Y.Doc` values, exchanges updates
without a provider, and materializes results through the same immutable tree machinery.

The spike covers:

- Concurrent text, attribute, child insertion, child deletion, split, join, table
  row insertion, and structural move cases.
- Equivalent dirty-path derivation from Yjs XML events and registry map/array deltas.
- Cached materialization through one scratch-only bounded range replacement helper.
- Stable logical identity independent from a Yjs item ID.
- `canonicalOoxmlFingerprint`, `validateOoxmlPart`,
  `validateOoxmlPartDelta`, serialize/reopen `semanticDigest`, Yjs snapshot size, and
  actor-scoped undo.
- A 200-page local-versus-remote edit benchmark using existing benchmark tooling.

The spike passes only when a remote one-character insertion:

- Allocates fewer than three times the canonical nodes allocated by the equivalent
  local edit.
- Preserves reference identity for every node outside the edited ancestor path.
- Does not trigger whole-document layout invalidation.
- Keeps warm remote materialization and paint within two times the equivalent local
  path and within the existing sub-frame typing gate.

An allocation ratio of ten or more fails the representation. A ratio from three
through ten permits one bounded optimization pass. The spike also fails if a
structural move cannot preserve concurrent edits and one stable logical identity
without an unbounded repair protocol.

Alternative considered: implement Yjs XML first and add the registry only after a
failure. Rejected because sunk implementation work would bias representation selection.

The completed spike selects the stable-node registry. Nested Yjs XML lost logical
identity and concurrent descendant text during a move, so it failed the mandatory move
gate. After one bounded parent-index optimization, the registry passed all maintained
200-page gates. Remote total measured 31.766 ms median and 35.615 ms p95 against
56.128 ms and 71.598 ms ceilings. Remote allocation was six nodes with zero off-path
allocation.

### D3: Bind collaboration at a canonical package mutation boundary

`TreeDocOp` remains the intent and validation API. The current single-part write
boundary contains four structural functions plus one batch composer:

- `replaceChildren`
- `insertChildren`
- `replaceNode`
- `removeNode`
- `applyEdits`

Text, attribute, and namespace changes currently rebuild nodes and pass through those
functions. The package shell has a second required boundary through `withPart`,
`withNewPart`, `withoutPart`, `withRelationship`, `withContentTypeOverride`,
`withRelationshipsPartFor`, and `withBinaryPart`. Header/footer, note, comment,
image, hyperlink, numbering, and custom XML lifecycle orchestrators bracket several
of these writes into one package transaction.

The collaboration journal normalizes those existing hooks into compositional effects:

- `putNode(descriptor)`, which creates the record an inserted node needs before its
  text, attribute, namespace, and child effects arrive
- `spliceText(logicalId, utf16Start, deleteCount, insert)`
- `setAttribute(logicalId, qname, value | null)`
- `setNamespaceBinding(logicalId, prefix, uri | null)`
- `spliceChildren(parentLogicalId, start, deleteCount, childLogicalIds)`
- `moveNode(logicalId, destinationParentLogicalId, destinationIndex)`
- `putXmlPart(name, rootLogicalId)` and `deleteXmlPart(name)`
- `putRelationship(owner, record)` and `deleteRelationship(owner, relationshipId)`
- `putContentTypeOverride(partName, mediaType)` and its delete form
- `putBinary(descriptor)` and `deleteBinary(storageKey)`

`replaceChildren`, `insertChildren`, and child removal lower to `spliceChildren`.
`applyEdits` remains a composer. A same-ID `replaceNode` lowers to text, attribute,
namespace, and child effects. Actual replacement tombstones the old logical record and
inserts a new logical ID.

Relationships and content-type overrides remain first-class package effects because
the canonical package currently keeps derived relationship and external-target
sidecars plus `[Content_Types].xml` bytes. All string patchers and sidecar writers must
route through one implementation. XML part rename remains unsupported because the
frozen authorable manifest has no rename operation.

The primitive audit confirms 69 `TreeDocOp` kinds, but refutes the earlier claim that
`ooxml-edit.ts` already contains seven mutation primitives. Full replication must
intercept both part-tree and package-shell writes. The spike must verify the normalized
effect list against every direct package write. Any mutation that cannot be expressed
compositionally becomes another primitive, not a command-specific replication handler.

`replacePackageShell` is forbidden during active collaboration except for validated
bootstrap, materialization, or room-generation replacement. Every normal tree,
lifecycle, comment, image, numbering, and custom XML mutation emits one journal per
`TreePackageStore` transaction.

Without collaboration, the journal applies to the immutable package exactly as it
does now. With collaboration, a validated journal applies in one Yjs transaction and
then materializes one canonical publication. Editor commands and adapters never
write Yjs directly.

Alternative considered: mirror all `TreeDocOp` values. Rejected because offsets and
locally minted IDs do not converge, and each new operation would require a wire twin.

### D4: Separate logical identity from Yjs item identity

Initial parsed nodes keep the canonical ids that the OPC bytes already contain.
Every replica that seeds from the same baseline therefore shares those ids.

A canonical node id minted by an edit has the shape `<partName>#new:<counter>`.
The counter is scoped to one part.
Two replicas start from the same baseline bytes.
Each replica then mints the SAME id for the DIFFERENT node it inserted.

If shared state keys records on that minted id, the merge joins two different nodes.
One author's content is destroyed.
The other author's content appears twice.

The production session maps canonical ids to replica-scoped logical ids.
`packages/collaboration-yjs/src/document-identity.ts` exports `LogicalIdentityMap`.
Every `putNode` effect receives a fresh logical id from `LogicalIdAllocator`.
Later effects in the same journal resolve through the map.
The pass is ordered because a later effect can name a node this journal just created.
Ids that came from the shared baseline resolve to themselves.
Every replica read those ids from the same bytes.
The map resets after each materialized install.
Every node then already carries a logical id.
A re-minted canonical id would otherwise resolve to the wrong node.

Yjs client/clock item IDs remain internal ordering identities. They do not become
`OoxmlNodeId`, `w14:paraId`, comment IDs, relationship IDs, drawing IDs, or revision
IDs. Word-facing IDs keep their own typed allocation and collision repair rules.
Word-facing collision repair remains deferred.

Rejected alternative: a process-wide mint scope in core.
`setNodeIdMintScope` in `packages/core/src/store/package/ooxml-edit.ts` was
implemented and then reverted.
Two replicas in one process share module state.
Examples are headless tests, the server runtime, and two editors on one page.
The last attach won.
The scope changed ids without making them unique.
That result is worse than no scope.
Core is unchanged as a result.
A test in `packages/core/src/store/__tests__/ooxml-edit.test.ts` pins the property:
two documents opened from the same bytes mint the SAME ids.

This separation permits checkpoints, materializer cache replacement, and a possible
representation fallback without changing public canonical identity.

Alternative considered: derive `OoxmlNodeId` directly from Yjs item IDs. Rejected
because moves, clones, migrations, and checkpoint reconstruction can replace the Yjs
item while the logical document object remains the same.

### D5: Use a full-package shared schema only after the spike passes

The preferred schema candidate is one versioned `Y.Doc` with immutable room metadata,
a part directory, XML part roots, binary blob references, and repair/migration
metadata. Typed canonical kinds remain a materialized interpretation of XML names and
placement. They are not duplicated into a second shared typed schema.

XML part creation and deletion are first-class. Authorable part rename remains
unsupported. Relationship records and content-type overrides use dedicated package
effects that preserve their XML projection and canonical sidecars.

The experimental session carries binary bytes in a separate `Y.Map` under the key
`docx-package-blobs-v1`.
The map is keyed by digest and capped at 64 MiB total.
Digests are immutable, so two replicas that write one key write the same bytes.
A joiner can therefore materialize media.
Bytes stay out of the node registry.
A one-character edit does not re-encode an image.
Consumer blob lease and garbage collection remain deferred.
The later durable-server design in D18 still places large bytes outside ordinary
Yjs updates.

The spike selects nested Yjs XML or the stable-node registry only after both candidates
run through the same gates. If both fail, the change stops for architecture review
before considering Loro or another CRDT.

Alternative considered: place raw media blobs inside node records. Rejected because
large binary updates inflate merge state, checkpoints, memory, and reconnect cost.
The experimental `docx-package-blobs-v1` map is keyed by digest.
It is a bounded interim, not unkeyed media inside node records.

### D6: Materialize only changed paths

The materializer keeps caches from selected-backend records and logical IDs to frozen
canonical nodes. It consumes backend events, invalidates only changed ancestors, and
rebuilds child lists through a bounded range replacement operation.

An unaffected node returns the exact previous object. The root and ancestors of a
changed node receive new references. Package and layout dirty sets derive from the
same changed paths and preserve existing incremental convergence behavior.

No remote edit may parse, serialize, or rebuild the complete DOCX package.

### D7: Stage local intent and quarantine invalid remote state

A local collaborative transaction:

1. Plans normal `TreeDocOp` values against one canonical revision.
2. Validates the resulting primitive journal and resource limits.
3. Applies the journal in one Yjs transaction.
4. Emits one unmerged update frame for managed transport.
5. Materializes and publishes one canonical revision.

The production session splits those steps across two directions that cannot loop.
The local store commits and emits one journal.
The session applies that journal to shared state in one Yjs transaction.
The transaction is tagged with a local origin.
A shared-state change with any other origin materializes one canonical package.
`CollaborationDocumentPort.applyRemotePackage` publishes that package as one
revision.
`TreePackageStore.publishRemotePackage` records no legacy history and emits no
primitive journal.
A remote publication therefore cannot feed another journal back into shared state.

`installAuthoritativePackageSnapshot` bypasses the local shell merge.
Merging local numbering over an agreed remote package reverted remote list edits
forever.

If `applyPrimitiveJournal` refuses a local journal, the session sets status
`error`.
It then republishes shared state over the local store.
Shared state is the authority.
A local commit that cannot replicate is taken back.
The replica does not keep a silent divergence.

A peer-to-peer remote update has already merged before application code observes it.
The session validates and repairs its candidate before canonical publication. A
managed server applies each frame to isolated candidate state before authoritative
persistence and broadcast.

Quarantine and repair origins remain deferred.
If repair cannot preserve semantics, the replica will keep its last valid canonical
revision and enter quarantine. It reports typed issues and does not save or author
new edits until an administrator resets, migrates, or restores the room.

Alternative considered: publish best-effort invalid XML. Rejected because layout,
editing, and export require canonical invariants.

### D8: Repairs are deterministic, idempotent, and do not race

Each repair rule has a version, stable ordering, bounded work, and one canonical
outcome from the same shared state. The default repair is a pure materialization rule
with stable derived IDs. It publishes a canonical repair-origin revision without
writing a competing Yjs transaction from every replica.

Safe repair may remove duplicate parent references, normalize invalid known elements
to generic nodes, allocate colliding Word-facing IDs, or restore required wrapper
shape when semantics are unambiguous. It must not invent missing review intent,
choose between conflicting user text, or silently discard unknown content.

When shared state itself must change, only an explicit versioned maintenance operation
may normalize it. That operation must be idempotent and must not duplicate required
children when several replicas observe the same issue. Repair and maintenance origins
do not enter actor undo.

Every repair records an audit item. An unrepairable issue quarantines the room.

### D9: Collaborative undo owns every admitted collaborative edit

The experimental full-document session uses one `Y.UndoManager` over the registry's
tracked types with the local origin.
Actor-scoped undo for the full package remains deferred.

The target remains one actor-scoped `Y.UndoManager` for every admitted shared
transaction, including text, structure, formatting, review metadata, part
references, and blob references.
A compound editor command becomes one undo item.

Remote, bootstrap, migration, repair, checkpoint, awareness, and projection origins
are excluded. Snapshot pointer swaps remain available only outside collaborative
sessions because they can erase accepted remote work.

Tracked changes remain document content. Undo changes the actor's authored shared
transaction; it does not accept or reject another actor's tracked revision.

Undo is replica-local and process-lifetime. A new `Y.Doc` loaded from a checkpoint,
generation, or NACK rebase starts with an empty undo stack.

### D10: Provide an optional durable server peer

`@docx-editor.dev/collaboration-server` provides a deployable room host for Node 22 or
later and Bun 1.3 or later. It speaks documented `y-websocket` sync and awareness
framing plus versioned extension messages. It uses the same room schema as browser
and headless clients.

Server implementation starts only after the full-package schema, blob contract,
validation, and quarantine behavior stabilize. Before that gate, version one ships
provider adapters and deployment guidance only. This avoids freezing a server surface
around the paragraph proof schema.

The server provides:

- Persistent rooms that survive zero connected clients.
- Room-level `read`, `edit`, and `admin` authorization.
- Authentication and authorization callbacks.
- Memory and single-instance file storage adapters.
- A production storage interface for consumer databases and object stores.
- Content-addressed binary storage hooks.
- Update size, room size, client count, rate, recursion, and element limits.
- Checkpoints, compaction hooks, retention, room deletion, and restore.
- Canonical validation, quarantine records, and DOCX export hooks.
- Health, structured audit, and observability hooks without document-content logs.

The server is readable by design. Deployments use TLS and host-controlled encryption
at rest. End-to-end encryption is deferred because it conflicts with server-side
validation and export.

The server does not become the sole editing authority. Clients apply local Yjs
transactions immediately and converge through the durable server peer. Authorized
server rooms disable direct peer document synchronization, because peer traffic would
bypass server policy.

Alternative considered: ship only provider documentation. Rejected because a small
host module materially improves durable room setup, policy consistency, validation,
and export.

### D11: Define bounded offline and external-DOCX behavior

The first production guarantee covers transient disconnection while one client
process stays open. Buffered Yjs updates must converge after reconnect. Durable
browser persistence across refresh or device restart is a later additive capability.

The server retains a room according to host retention policy even when no clients are
connected. File storage is a single-process convenience. Multi-instance deployments
must use the production storage interface and consumer-provided coordination.

A DOCX exported from a room is a snapshot, not the durable collaboration artifact. If
someone edits that file in Word, importing it creates a new room. An administrator
may explicitly replace an existing room only through a destructive reset that records
an audit item and rejects connected writers.

### D12: Version schemas and make migrations explicit

Every room records protocol, shared-schema, repair, and canonical-model versions.
Clients refuse unsupported major versions before canonical attachment.

Experimental milestones may reset rooms instead of migrating them. Before stable
support, each additive migration must be deterministic and checkpointed. Destructive
or representation-changing migrations run under an administrative maintenance lock,
produce a new room generation, and retain the previous generation for rollback.

### D13: Claim support only through a capability matrix

Implementation may proceed in experimental milestones:

1. Representation and identity spike.
2. Text, formatting, paragraph structure, and all story roots.
3. Tables, sections, fields, notes, content controls, comments, and revisions.
4. Drawings, relationships, package part lifecycle, media, and generic OOXML.
5. Durable server, migration, recovery, security, and multi-process headless clients.

Each milestone gates unsupported local commands before shared mutation. Public docs
may describe experimental slices. The product claims full collaboration only after
every current canonical mutation class passes the full conformance matrix.

### D14: Freeze the authorable mutation manifest

The implementation base commit defines one generated manifest of authorable
`TreeDocOp` kinds, package intents, variants, and story scopes. Full collaboration
means complete coverage of that frozen manifest. This change does not implement
missing editor capabilities such as unsupported table merges, tracked moves, VML
authoring, or arbitrary shape editing.

Each later authoring capability must add its manifest row and collaboration fixtures
before it becomes supported. The manifest replaces unbounded claims about every
possible OOXML mutation.

### D15: Use child arrays as registry authority

The registry stores immutable logical IDs, node records, text records, attributes,
namespace bindings, authoritative child-ID arrays, tombstones, and optional
`replacedBy` links. It does not replicate a parent register. The parent-register spike
added stale hints and did not preserve any additional move case.

A move removes the logical ID from known parent arrays and inserts the same ID into
the destination array. Concurrent duplicate placement materializes only the first
preorder occurrence and records `duplicate-parent`. The node record and concurrent
descendant edits remain intact.

Node records are never map-deleted. Deletion uses a tombstone. Join tombstones the
removed node and records `replacedBy` so concurrent children can move to the survivor
without a competing repair transaction.

### D16: Define conflicts before schema implementation

Concurrent move/move keeps the first reachable preorder placement and reports every
other placement. A reachable cycle edge is ignored and reported. An unreachable
content-bearing cycle, delete-versus-descendant-edit orphan, or unresolved join orphan
quarantines the room. Join/edit follows a valid `replacedBy` chain and adopts the
remaining child under the survivor.

The package spike must still decide rename/rename, rename/delete, and part-reference
conflicts. Every result must preserve user-authored content or quarantine. Silent loss
is never a conflict policy.

### D17: Replace destructive room state with a new generation

Yjs updates are monotonic. Applying an old checkpoint cannot remove later integrated
state. Restore, destructive reset, representation migration, and compaction therefore
create generation `N+1` with a new `Y.Doc`.

The host locks writers, validates the new generation, atomically switches the active
generation, disconnects old clients, rejects generation `N` updates, and retains
generation `N` for rollback. Every connection, checkpoint, persistence record, and
audit record carries `roomGenerationId`. Received updates inherit their connection
generation.

Process recovery is different from administrative restore. Recovery loads one
generation checkpoint and its later ordered updates under the same generation ID.
Administrative restore creates a new generation from checkpoint state only. No restore
path applies an old checkpoint onto the active `Y.Doc`.

### D18: Publish blobs before their shared references

The experimental session does not yet use consumer blob leases.
It stores bytes in `Y.Map` `docx-package-blobs-v1` as D5 describes.
Lease, pin reasons, and garbage collection stay deferred.

The durable-server target still cannot commit blob bytes and Yjs state atomically.
A client uploads and verifies bytes first, receives a temporary retention lease,
commits the digest reference, waits for room persistence, and then converts the
lease into retained ownership.

Reference removal does not delete bytes immediately. Retained checkpoints, offline
updates, and older room generations delay garbage collection. Missing bytes block
materialization and trigger bounded retry before quarantine.

The storage key equals the lowercase `sha256:` digest. A blob has one verified
canonical media type; the same digest with a different declared type is refused.
Default limits are 32 MiB, a 30-second lease, and three missing-byte retries.

Pin reasons are lease, pending persistence, active generation, retained generation,
checkpoint, offline frame, and undo item. A NACK keeps frame pins until replica
disposal or successful rebase. PUT and lease persistence are one durable operation.
Accepted frames persist and ACK in sequence. Restart reconstructs pins from durable
descriptors, receipts, checkpoints, generations, and undo policy.

Garbage collection rechecks every pin after candidate selection and immediately before
delete. Quarantine retains a last-valid checkpoint and every blob required to export
it, not only a canonical identity string.

### D19: Authorized rooms use server-only synchronization

Peer-to-peer transport cannot enforce server roles. A room with server authorization
uses the server connection as its only document-update path. Awareness may use the
same server protocol, but direct WebRTC document updates are disabled.

The first server transport targets documented `y-websocket` sync and awareness
compatibility. Custom administrative, generation, blob, and audit operations use
versioned extension messages.

### D20: Rejected updates require replica replacement

A rejected Yjs update remains inside the sender's local `Y.Doc`. The client cannot
subtract it safely. A semantic rejection therefore terminates that replica, discards
its local state, and rejoins the active authoritative generation.

The server validates updates in an isolated candidate state before persistence and
broadcast. Expected refusals happen before the authoritative transaction. An
unexpected exception after transaction entry is a fatal room error, not rollback.

### D21: Separate asserted authorship from trusted audit

Clients may author document-visible review identity under room policy. The server
owns trusted connection principal, role, received-update, persistence, and
administrative audit records. It never treats arbitrary client fields as authenticated
audit attribution.

Yjs `origin`, transaction metadata, and undo history do not survive update encoding.
Struct client IDs survive but are not authentic. Peer-to-peer names and actor fields
therefore remain display or document content, not trusted audit facts.

Managed server attribution comes from the authenticated connection, an immutable
client-ID-to-principal registry, and a receipt log. Document-visible tracked-change
author fields are still editable document content.

### D22: Separate support claims and release gates

Client replication, provider compatibility, durable server transport, storage
adapters, migration, and offline behavior have separate capability claims. Stable
client collaboration does not imply stable server durability.

The optional server package targets Node 22 or later and Bun 1.3 or later. Each
published claim requires its own conformance, security, documentation, and manual
release gates.

### D23: Keep the server host portable and dependency-light

`@docx-editor.dev/collaboration-server` is an Apache-2.0 package in the fixed release
group. It uses `node:http`, `node:https`, and `ws`. It does not require Hocuspocus,
Redis, a database SDK, an object-store SDK, or an observability SDK.

Authentication runs during the HTTP upgrade through consumer callbacks. The callback
receives bounded request metadata and returns a principal. Same-origin cookies are
preferred. Query tokens are an explicit fallback and must never enter logs. Missing
rooms and failed authentication use the same external result.

The server exposes JSON administration and blob HTTP routes beside WebSocket sync.
Production does not create rooms during connection. An administrator creates a room
from a validated DOCX. Local development may explicitly enable insecure automatic
creation.

One storage contract has room, blob, and audit facets. The included memory adapter
survives zero clients. The file adapter supports one process, uses an exclusive
store-root lock, and commits files through temporary writes plus atomic rename.
Production storage supplies maintenance locking and atomic active-generation compare
and swap.

Checkpoints default to 100 accepted updates, five minutes, or an administrator
request. The host retains the latest three valid checkpoints plus the last valid
pre-quarantine checkpoint. Defaults limit updates to 1 MiB, awareness to 16 KiB,
blobs to 32 MiB, room state to 64 MiB, clients to 32 per room, and updates to 50 per
second per connection. Hosts may lower these finite limits.

### D24: Managed transport preserves transaction receipts

One local journal commit emits one Yjs transaction and one unmerged managed frame:
`{ roomGenerationId, sessionId, clientId, sequence, update }`. The authenticated
connection supplies the principal. The client never supplies trusted `principalId`.

The server binds a new Yjs client ID to one principal and never reassigns it. New
struct ranges in `parseUpdateMeta` must belong to that client ID. Delete-only frames
contain no author struct range, so their attribution comes only from the connection
receipt.

Accepted frames receive a bounded receipt containing room generation, principal,
client ID, sequence, update digest, time, and outcome. Frames remain unmerged until
receipt persistence. Checkpoints may merge Yjs state, but they do not replace receipts
or recover transaction boundaries.

After NACK, the client loads the last admitted snapshot into a new `Y.Doc`, registers
its new client ID, and replans pending canonical journals against that state. It does
not replay dependent Yjs bytes from the rejected replica. A refusal during replan is
reported to the user.

Plain `y-websocket` remains sync and awareness compatible. Trusted receipts, semantic
NACK recovery, and server authorization require the managed extension and client
helper. Offline managed clients buffer ordered unmerged frames and stop at the first
NACK.

## Risks / Trade-offs

- **[A candidate cannot preserve a moved node's concurrent edits]** → Make move a
  spike kill criterion and reject that candidate.
- **[A shared representation converges to invalid OOXML]** → Validate changed regions,
  apply bounded deterministic repair, and quarantine before canonical publication.
- **[Remote materialization misses identity caches]** → Reuse event paths, logical-ID
  caches, and chunked child sequences, with allocation and paint gates.
- **[The primitive journal misses direct writes]** → Add source scans, lane tests, and
  mutation-coverage fixtures before integrating collaboration.
- **[Yjs state grows without bound]** → Add checkpoints, measured room budgets,
  retention hooks, and schema-aware compaction experiments.
- **[Binary content overwhelms updates]** → Store bytes by digest outside Yjs and
  validate every size, media type, and package reference.
- **[A malicious client sends a valid Yjs update with hostile XML]** → Treat all
  shared values as untrusted, enforce pre-transport byte limits where possible, and
  validate before canonical publication or export.
- **[Repair races create more updates]** → Require versioned deterministic idempotent
  rules and exclude repair origins from user history.
- **[A file storage adapter is mistaken for clustered production storage]** → Name
  and document it as single-instance and require the production interface for
  multi-instance hosts.
- **[Full compatibility delays user feedback]** → Ship clearly experimental
  milestones while withholding the full-support claim.
- **[Server readability conflicts with customer privacy requirements]** → Document
  the trust model and defer end-to-end encrypted rooms to a separate design.

## Migration Plan

1. Finish and archive the bounded paragraph proof without widening its scope.
2. Implement only the isolated representation spike and publish its measured report.
3. Compare both candidates and select only one that passes every gate. If both fail,
   stop without changing editor or public collaboration APIs.
4. Add the primitive journal behind existing canonical transactions and prove
   non-collaborative output, identity, and performance remain unchanged.
5. Introduce the experimental full-package schema with reset-only room compatibility.
6. Expand admitted mutation classes milestone by milestone through one conformance
   matrix.
7. Add the optional server package after package-level state and blob references are
   stable.
8. Add stable schema migrations, recovery, and support claims only after all gates
   pass.

Rollback before stable schema support deletes the experimental room and reopens its
last exported DOCX or checkpoint. The ordinary non-collaborative editor remains
unchanged throughout the work.

## Open Questions

These are empirical spike questions, not unresolved product scope:

1. Which candidate preserves move and reparent operations without losing concurrent
   edits or stable logical identity?
2. Do XML events or registry deltas permit better path-local materialization for text,
   attributes, and structural changes?
3. What allocation, paint, memory, update-size, and snapshot-size ratios result on
   the 200-page benchmark?
4. Which invariant issue codes require repair after the defined concurrent edit
   corpus?
5. Which candidate gives the better result when both pass every kill gate?
