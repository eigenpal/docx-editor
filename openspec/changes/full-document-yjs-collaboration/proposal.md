## Why

The existing collaboration proof validates fast concurrent text edits inside existing
paragraphs, but it intentionally refuses every structural, formatting, review, media,
and non-body edit. The next change must find one compositional replication model for
the whole canonical DOCX package without creating a second command protocol or
discarding the engine's identity-keyed incremental layout work.

## What Changes

- Add one measured harness that compares nested Yjs XML with a stable-node registry
  before selecting the durable shared representation. Both candidates must prove
  path-local canonical object reuse, structural move behavior, package validity, and
  200-page edit performance against the same explicit kill criteria.
- Bind collaborative replication below `TreeDocOp`, at the canonical package mutation
  primitive layer. ProseMirror remains a projection, and editor commands remain
  unchanged.
- Freeze the authorable mutation manifest at the implementation base commit and extend
  collaboration to every operation in that manifest. This change does not implement
  editor capabilities that the base commit cannot author.
- Represent the whole OPC package, including XML part creation and deletion,
  relationships, content types, and content-addressed binary blobs.
- Preserve stable logical node identity independently from Yjs item identity and
  materialize remote changes through chunked child sequences without rebuilding
  unaffected subtrees.
- Add deterministic, idempotent safe repair for invalid concurrent structures and
  quarantine states that cannot be repaired without semantic loss.
- Replace mixed snapshot undo with actor-scoped collaborative undo for all admitted
  edits while preserving remote work and review attribution.
- Add versioned room schemas, immutable room generations, checkpoints, bounded transient
  offline convergence, and a new-room or generation-replacement rule for DOCX files
  edited outside a live room.
- Add an optional deployable collaboration server module for Bun and Node. It provides
  persistent rooms, room-level read/edit/admin authorization, memory and
  single-instance file storage adapters, a production storage interface, resource
  limits, checkpoints, quarantine, and server-side validation/export.
- Keep clients as immediate Yjs replicas. Authorized server rooms disable direct peer
  synchronization, so clients cannot bypass the server policy boundary.
- Publish client replication and the optional server as separate experimental support
  claims. The server targets Node 22 or later and Bun 1.3 or later.
- Deliver experimental capability milestones, but do not claim full collaboration
  support until every canonical mutation class passes convergence, identity,
  save/reopen, and performance gates.

## Capabilities

### New Capabilities

- `full-document-yjs-replication`: Versioned primitive-layer replication and
  identity-preserving canonical materialization for every frozen authorable package
  mutation.
- `collaboration-repair-and-conformance`: Deterministic merge repair, quarantine,
  convergence, semantic fidelity, undo ownership, and performance requirements.
- `durable-collaboration-rooms`: Durable room lifecycle, schema migration,
  checkpointing, reconnect behavior, external-DOCX reset rules, and blob retention.
- `collaboration-server-runtime`: Optional Bun/Node host module with transport,
  persistence adapters, room roles, resource controls, validation, and export hooks.

### Modified Capabilities

None.

## Impact

- `packages/collaboration-yjs/src/__tests__/` contains the isolated representation
  experiments. After they pass, `packages/core/src/store/package/` gains a narrow
  observable package-mutation primitive boundary.
- `packages/core/src/collaboration/` expands from paragraph text ports to package-level
  collaboration contracts while remaining free of Yjs and server dependencies.
- `packages/collaboration-yjs/` receives a new versioned full-package schema,
  materializer, repair integration, migration policy, and provider-neutral room state.
- A new optional server package and runnable Bun/Node examples add WebSocket,
  persistence, authorization, checkpoint, and export integration.
- Every typed and generic tree operation, package serializer, history path, automation
  client, React adapter, and future adapter must use the same canonical transaction
  and collaboration capability gates.
- Conformance fixtures, large-document benchmarks, API snapshots, package graphs,
  security limits, docs, examples, and consumer changesets are affected.
